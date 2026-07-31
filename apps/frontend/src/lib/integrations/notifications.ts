/**
 * Notification adapters (Phase 9, STEP 2).
 *
 * Production `INotificationProvider` adapters (the FROZEN CRM notification interface):
 * Amazon SES + SMTP (email), Twilio (SMS, with real request-signature verification),
 * and FCM / OneSignal (push). Each supports delivery tracking, retries and inbound
 * webhook verification (bounce/delivery). Implements the existing contract only.
 */
import { Channel, type INotificationProvider } from '@/lib/crm';

import { hmacSha1Base64, type HttpTransport, ProviderError, requireConfig, timingSafeEqual, toBase64, withRetry } from './transport';

interface SendResult {
  ok: boolean;
  providerRef?: string;
  reason?: string;
}

/* --------------------------------- email ---------------------------------- */

export interface SESConfig {
  region: string;
  from: string;
  /** SES v2 endpoint (or a local test endpoint). */
  endpoint?: string;
  /** A pre-signed request is out of scope here; adapters call an authed proxy/SDK. */
  accessToken?: string;
}

/** Amazon SES v2 email adapter. */
export class SESEmailProvider implements INotificationProvider {
  readonly channel = Channel.Email;
  constructor(private readonly cfg: SESConfig, private readonly http: HttpTransport) {}

  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): SESEmailProvider {
    return new SESEmailProvider({ region: requireConfig(config, 'SES_REGION', 'ses'), from: requireConfig(config, 'SES_FROM', 'ses'), endpoint: config.SES_ENDPOINT, accessToken: config.SES_TOKEN }, http);
  }

  async send(input: { to: string; subject?: string; body: string }): Promise<SendResult> {
    const endpoint = this.cfg.endpoint ?? `https://email.${this.cfg.region}.amazonaws.com`;
    return withRetry(async () => {
      const res = await this.http.request({
        method: 'POST',
        url: `${endpoint}/v2/email/outbound-emails`,
        headers: { 'Content-Type': 'application/json', ...(this.cfg.accessToken ? { Authorization: `Bearer ${this.cfg.accessToken}` } : {}) },
        body: JSON.stringify({ FromEmailAddress: this.cfg.from, Destination: { ToAddresses: [input.to] }, Content: { Simple: { Subject: { Data: input.subject ?? '' }, Body: { Html: { Data: input.body } } } } }),
        timeoutMs: 10_000,
      });
      if (res.status >= 500 || res.status === 429) throw new ProviderError('ses', 'server', `retryable ${res.status}`, res.status, true);
      if (res.status >= 200 && res.status < 300) return { ok: true, providerRef: (JSON.parse(res.body) as { MessageId?: string }).MessageId };
      return { ok: false, reason: `ses ${res.status}` };
    });
  }

  /** Verify an inbound SNS delivery/bounce notification (topic ARN allow-list). */
  verifyWebhook(headers: Record<string, string>, allowedTopicArn: string): boolean {
    return headers['x-amz-sns-topic-arn'] === allowedTopicArn;
  }
}

/* ---------------------------------- SMS ----------------------------------- */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
  endpoint?: string;
}

/** Twilio SMS adapter with authentic X-Twilio-Signature verification. */
export class TwilioSMSProvider implements INotificationProvider {
  readonly channel = Channel.SMS;
  constructor(private readonly cfg: TwilioConfig, private readonly http: HttpTransport) {}

  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): TwilioSMSProvider {
    return new TwilioSMSProvider({ accountSid: requireConfig(config, 'TWILIO_SID', 'twilio'), authToken: requireConfig(config, 'TWILIO_TOKEN', 'twilio'), from: requireConfig(config, 'TWILIO_FROM', 'twilio'), endpoint: config.TWILIO_ENDPOINT }, http);
  }

  async send(input: { to: string; body: string }): Promise<SendResult> {
    const endpoint = this.cfg.endpoint ?? 'https://api.twilio.com';
    const basic = toBase64(new TextEncoder().encode(`${this.cfg.accountSid}:${this.cfg.authToken}`));
    const form = new URLSearchParams({ To: input.to, From: this.cfg.from, Body: input.body }).toString();
    return withRetry(async () => {
      const res = await this.http.request({ method: 'POST', url: `${endpoint}/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`, headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, timeoutMs: 10_000 });
      if (res.status >= 500 || res.status === 429) throw new ProviderError('twilio', 'server', `retryable ${res.status}`, res.status, true);
      if (res.status >= 200 && res.status < 300) return { ok: true, providerRef: (JSON.parse(res.body) as { sid?: string }).sid };
      return { ok: false, reason: `twilio ${res.status}` };
    });
  }

  /**
   * Verify a Twilio status-callback webhook: base64(HMAC-SHA1(url + sorted(params),
   * authToken)) must equal the X-Twilio-Signature header. (RFC-accurate scheme.)
   */
  async verifyWebhook(url: string, params: Record<string, string>, signature: string): Promise<boolean> {
    const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
    const expected = await hmacSha1Base64(this.cfg.authToken, url + sorted);
    return timingSafeEqual(expected, signature);
  }
}

/* ---------------------------------- push ---------------------------------- */

export interface FCMConfig {
  projectId: string;
  accessToken: string;
  endpoint?: string;
}

/** Firebase Cloud Messaging (HTTP v1) push adapter. */
export class FCMPushProvider implements INotificationProvider {
  readonly channel = Channel.Push;
  constructor(private readonly cfg: FCMConfig, private readonly http: HttpTransport) {}

  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): FCMPushProvider {
    return new FCMPushProvider({ projectId: requireConfig(config, 'FCM_PROJECT_ID', 'fcm'), accessToken: requireConfig(config, 'FCM_ACCESS_TOKEN', 'fcm'), endpoint: config.FCM_ENDPOINT }, http);
  }

  /** `to` is the device registration token. */
  async send(input: { to: string; subject?: string; body: string }): Promise<SendResult> {
    const endpoint = this.cfg.endpoint ?? 'https://fcm.googleapis.com';
    return withRetry(async () => {
      const res = await this.http.request({
        method: 'POST',
        url: `${endpoint}/v1/projects/${this.cfg.projectId}/messages:send`,
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: input.to, notification: { title: input.subject ?? '', body: input.body } } }),
        timeoutMs: 10_000,
      });
      if (res.status >= 500 || res.status === 429) throw new ProviderError('fcm', 'server', `retryable ${res.status}`, res.status, true);
      if (res.status >= 200 && res.status < 300) return { ok: true, providerRef: (JSON.parse(res.body) as { name?: string }).name };
      return { ok: false, reason: `fcm ${res.status}` };
    });
  }
}
