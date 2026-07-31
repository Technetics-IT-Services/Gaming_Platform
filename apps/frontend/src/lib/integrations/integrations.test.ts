import { describe, expect, it, vi } from 'vitest';

import { PaymentStatus } from '@/lib/payments';

import { RedisReliableQueue, type RedisClient, postgresHealthProbe, redisHealthProbe } from './backend';
import { envelopeDecrypt, envelopeEncrypt, LocalKMSProvider } from './kms';
import { TwilioSMSProvider } from './notifications';
import { PayPalProvider } from './payments-paypal';
import { AwsSecretsManagerProvider, VaultSecretProvider } from './secrets';
import { SplunkHECForwarder } from './siem';
import { S3Storage } from './storage';
import { type HttpRequest, type HttpResponse, type HttpTransport, ProviderError, withRetry } from './transport';
import { WebAuthnServerProvider } from './identity';

/**
 * Production service integrations (Phase 9). Contract tests every adapter against the
 * FROZEN platform interfaces using a mock transport + fake Redis — no live network.
 * Verifies request shaping, webhook/signature verification, retries/failover,
 * envelope encryption, secret round-trips, SIEM forwarding and the reliable queue.
 * No business or financial logic is exercised or changed.
 */

/** A scriptable mock transport: matches by (method, url-substring) → response. */
function mockTransport(routes: { match: (r: HttpRequest) => boolean; res: HttpResponse | ((r: HttpRequest) => HttpResponse) }[]): HttpTransport & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      const route = routes.find((x) => x.match(req));
      if (!route) return { status: 404, headers: {}, body: '{}' };
      return typeof route.res === 'function' ? route.res(req) : route.res;
    },
  };
}
const ok = (body: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });

describe('transport — retry/backoff', () => {
  it('retries retryable failures then succeeds', async () => {
    let n = 0;
    const result = await withRetry(async () => {
      n += 1;
      if (n < 3) throw new ProviderError('x', 'server', 'flaky', 503, true);
      return 'done';
    }, { sleep: async () => undefined });
    expect(result).toBe('done');
    expect(n).toBe(3);
  });
  it('does not retry non-retryable errors', async () => {
    let n = 0;
    await expect(withRetry(async () => { n += 1; throw new ProviderError('x', 'auth', 'nope', 401, false); }, { sleep: async () => undefined })).rejects.toThrow(ProviderError);
    expect(n).toBe(1);
  });
});

describe('PayPal payment adapter (IPaymentProvider)', () => {
  const cfg = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'wh', PAYPAL_BASE_URL: 'https://api.sandbox.paypal.com' };
  function provider() {
    const http = mockTransport([
      { match: (r) => r.url.endsWith('/v1/oauth2/token'), res: ok({ access_token: 't0k', expires_in: 3600 }) },
      { match: (r) => r.url.endsWith('/v2/checkout/orders'), res: ok({ id: 'ORDER1', links: [{ rel: 'approve', href: 'https://paypal/approve' }] }, 201) },
      { match: (r) => r.url.includes('/capture'), res: ok({ status: 'COMPLETED' }, 201) },
      { match: (r) => r.url.includes('/verify-webhook-signature'), res: ok({ verification_status: 'SUCCESS' }) },
    ]);
    return { p: PayPalProvider.fromConfig(cfg, http), http };
  }

  it('creates an order, captures, and reports health', async () => {
    const { p } = provider();
    const intent = await p.createDepositIntent({ playerId: 'p1', amount: 50_000, currency: 'USD', provider: 'paypal', idempotencyKey: 'idem-1' });
    expect(intent.providerRef).toBe('ORDER1');
    expect(intent.checkoutUrl).toContain('approve');
    const cap = await p.capturePayment('ORDER1', 50_000);
    expect(cap.status).toBe(PaymentStatus.Captured);
    expect(await p.healthCheck()).toBe(true);
  });

  it('sends the PayPal-Request-Id idempotency header', async () => {
    const { p, http } = provider();
    await p.createDepositIntent({ playerId: 'p1', amount: 1000, currency: 'USD', provider: 'paypal', idempotencyKey: 'idem-xyz' });
    const orderCall = http.calls.find((c) => c.url.endsWith('/v2/checkout/orders'))!;
    expect(orderCall.headers!['PayPal-Request-Id']).toBe('idem-xyz');
  });

  it('verifies a webhook via the verify-signature API and normalizes the event', async () => {
    const { p } = provider();
    const body = JSON.stringify({ id: 'EVT1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP1', amount: { value: '500.00' } } });
    const v = await p.verifyWebhook({ headers: { 'paypal-transmission-id': 'a', 'paypal-transmission-time': 'b', 'paypal-transmission-sig': 'c', 'paypal-cert-url': 'd', 'paypal-auth-algo': 'e' }, body });
    expect(v.valid).toBe(true);
    expect(v.event).toMatchObject({ outcome: 'succeeded', amount: 50_000, providerRef: 'CAP1' });
  });

  it('rejects a webhook with missing signature headers (no network)', async () => {
    const { p } = provider();
    const v = await p.verifyWebhook({ headers: {}, body: '{}' });
    expect(v.valid).toBe(false);
  });
});

describe('Twilio SMS adapter — real signature verification', () => {
  it('verifies X-Twilio-Signature (HMAC-SHA1 over url + sorted params)', async () => {
    const http = mockTransport([{ match: (r) => r.url.includes('/Messages.json'), res: ok({ sid: 'SM1' }, 201) }]);
    const twilio = new TwilioSMSProvider({ accountSid: 'AC', authToken: 'token', from: '+1', endpoint: 'https://api.twilio.com' }, http);
    const sent = await twilio.send({ to: '+1999', body: 'hi' });
    expect(sent).toMatchObject({ ok: true, providerRef: 'SM1' });
    const url = 'https://example.com/callback';
    const params = { MessageStatus: 'delivered', MessageSid: 'SM1' };
    // Compute the authentic signature the same way Twilio does, then verify it round-trips.
    const { hmacSha1Base64 } = await import('./transport');
    const sig = await hmacSha1Base64('token', url + 'MessageSidSM1MessageStatusdelivered');
    expect(await twilio.verifyWebhook(url, params, sig)).toBe(true);
    expect(await twilio.verifyWebhook(url, params, 'wrong')).toBe(false);
  });
});

describe('S3 storage — authentic SigV4 presigned URL', () => {
  it('produces a deterministic SigV4 query-signed URL', async () => {
    const s3 = new S3Storage({ region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'secret' }, mockTransport([]));
    const url = await s3.signedUrl('my-bucket', 'path/file.txt', { method: 'GET', expiresSeconds: 900, now: 1_700_000_000_000 });
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/); // 64-hex HMAC-SHA256
    // Deterministic for a fixed time.
    const url2 = await s3.signedUrl('my-bucket', 'path/file.txt', { method: 'GET', expiresSeconds: 900, now: 1_700_000_000_000 });
    expect(url).toBe(url2);
  });
});

describe('secret providers (ISecretProvider)', () => {
  it('AWS Secrets Manager get/set round-trip', async () => {
    const http = mockTransport([
      { match: (r) => r.headers?.['X-Amz-Target']?.includes('PutSecretValue') ?? false, res: ok({ VersionId: '3' }) },
      { match: (r) => r.headers?.['X-Amz-Target']?.includes('GetSecretValue') ?? false, res: ok({ SecretString: 'topsecret' }) },
    ]);
    const sm = AwsSecretsManagerProvider.fromConfig({ AWS_REGION: 'us-east-1' }, http);
    expect((await sm.set('DB', 'topsecret')).version).toBe(3);
    expect(await sm.get('DB')).toBe('topsecret');
  });
  it('Vault KV v2 get', async () => {
    const http = mockTransport([{ match: (r) => r.url.includes('/data/db'), res: ok({ data: { data: { value: 'pw' } } }) }]);
    const vault = VaultSecretProvider.fromConfig({ VAULT_ADDR: 'https://vault', VAULT_TOKEN: 'tk' }, http);
    expect(await vault.get('db')).toBe('pw');
  });
});

describe('KMS envelope encryption (IKMSProvider)', () => {
  it('encrypts + decrypts through a real AES-GCM data key wrapped by the CMK', async () => {
    const kms = new LocalKMSProvider(crypto.getRandomValues(new Uint8Array(32)));
    const plaintext = new TextEncoder().encode('ledger-backup-blob');
    const env = await envelopeEncrypt(kms, 'cmk-1', plaintext);
    expect(env.ciphertext).not.toContain('ledger'); // opaque
    const decrypted = await envelopeDecrypt(kms, 'cmk-1', env);
    expect(new TextDecoder().decode(decrypted)).toBe('ledger-backup-blob');
  });
});

describe('SIEM forwarder (ISIEMForwarder)', () => {
  it('forwards events to Splunk HEC', async () => {
    const http = mockTransport([{ match: (r) => r.url.includes('/services/collector/event'), res: ok({ text: 'Success', code: 0 }) }]);
    const splunk = new SplunkHECForwarder('https://splunk:8088', 'hec-token', http);
    const res = await splunk.forward([{ id: 'e1', type: 'auth.failure' as never, severity: 'low' as never, at: 0 }]);
    expect(res.accepted).toBe(1);
    expect(http.calls[0]!.headers!.Authorization).toBe('Splunk hec-token');
  });
});

describe('WebAuthn server adapter (IWebAuthnProvider)', () => {
  it('issues a challenge on options and consumes it on verify', async () => {
    const verifier = { verifyRegistration: vi.fn(async () => ({ credentialId: 'c1', publicKey: 'pk', counter: 0 })), verifyAuthentication: vi.fn(async () => ({ ok: true, newCounter: 1 })) };
    const wa = new WebAuthnServerProvider({ rpId: 'x.com', rpName: 'X', origin: 'https://x.com' }, verifier, () => 'CHALLENGE');
    const opts = await wa.registrationOptions({ userId: 'u1', userName: 'u' });
    expect(opts.challenge).toBe('CHALLENGE');
    const reg = await wa.verifyRegistration({ userId: 'u1', response: {} });
    expect(reg.credentialId).toBe('c1');
    expect(verifier.verifyRegistration).toHaveBeenCalledWith(expect.objectContaining({ challenge: 'CHALLENGE', rpId: 'x.com' }));
  });
});

/* ------------------------------- fake redis ------------------------------- */

function fakeRedis(): RedisClient {
  const lists = new Map<string, string[]>();
  const l = (k: string) => lists.get(k) ?? (lists.set(k, []), lists.get(k)!);
  return {
    async rpush(k, v) { l(k).push(v); return l(k).length; },
    async lmove(src, dst, from, to) {
      const s = l(src);
      const v = from === 'LEFT' ? s.shift() : s.pop();
      if (v === undefined) return null;
      if (to === 'LEFT') l(dst).unshift(v); else l(dst).push(v);
      return v;
    },
    async lrem(k, _count, v) { const arr = l(k); const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); return i >= 0 ? 1 : 0; },
    async llen(k) { return l(k).length; },
    async ping() { return 'PONG'; },
  };
}

describe('Redis reliable queue + DLQ (STEP 8/9)', () => {
  it('reserves via processing list, acks, and dead-letters after max attempts', async () => {
    const redis = fakeRedis();
    const q = new RedisReliableQueue<{ n: number }>('jobs', redis, 2);
    await q.enqueue({ n: 1 });
    const m = await q.reserve();
    expect(m!.payload.n).toBe(1);
    expect(m!.attempts).toBe(1);
    await q.ack(m!);
    expect(await q.size()).toBe(0);

    // retry then dead-letter
    await q.enqueue({ n: 2 });
    let msg = await q.reserve(); // attempt 1
    await q.nack(msg!); // < maxAttempts → back to ready
    msg = await q.reserve(); // attempt 2 == maxAttempts
    await q.nack(msg!); // → DLQ
    expect(await q.size()).toBe(0);
    expect(await q.deadLetterSize()).toBe(1);
  });

  it('health probes report status', async () => {
    expect(await redisHealthProbe(fakeRedis())()).toMatchObject({ healthy: true });
    const pool = { query: async () => ({ rows: [{}] }), totalCount: 10, idleCount: 8, waitingCount: 0 };
    expect(await postgresHealthProbe(pool)()).toMatchObject({ healthy: true });
    const saturated = { query: async () => ({ rows: [] }), totalCount: 10, idleCount: 0, waitingCount: 50 };
    expect(await postgresHealthProbe(saturated, { maxWaiting: 10 })()).toMatchObject({ healthy: false });
  });
});
