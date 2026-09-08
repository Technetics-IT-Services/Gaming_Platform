import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { kycApi, KYC_LEVELS } from './kyc-api';
import { supportApi, TICKET_CATEGORIES } from './support-api';

/**
 * Phase 2D.3 — KYC and support client contracts, plus structural proof that both surfaces are
 * server-backed and never fabricate a verified state or a ticket.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); });
afterEach(() => vi.clearAllMocks());

describe('kycApi — contract', () => {
  it('reads status from the server and never sends a userId', async () => {
    get.mockReturnValueOnce(ok({ status: 'NOT_STARTED', documents: [], unavailable: [] }));
    await kycApi.status();
    const url = get.mock.calls[0][0] as string;
    expect(url).toBe('/kyc');
    expect(url.toLowerCase()).not.toContain('userid');
  });

  it('submits ONLY a level and document metadata', async () => {
    post.mockReturnValueOnce(ok({}));
    await kycApi.submit({
      level: 'BASIC',
      documents: [{ type: 'PASSPORT', fileName: 'p.jpg', mimeType: 'image/jpeg', size: 1000 }],
    });
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/kyc');
    expect(Object.keys(body).sort()).toEqual(['documents', 'level']);
    // The client must never be able to propose a decision.
    for (const forbidden of ['status', 'reviewedBy', 'verified', 'verification', 'userId']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('exposes the levels the server supports', () => {
    expect([...KYC_LEVELS]).toEqual(['BASIC', 'INTERMEDIATE', 'ADVANCED']);
  });

  it('passes the server rejection reason through untouched', async () => {
    get.mockReturnValueOnce(ok({ status: 'REJECTED', rejectionReason: 'blurred image', documents: [], unavailable: [] }));
    expect((await kycApi.status()).rejectionReason).toBe('blurred image');
  });

  it('carries the server-declared unavailable capabilities', async () => {
    get.mockReturnValueOnce(ok({
      status: 'NOT_STARTED', documents: [],
      unavailable: [{ capability: 'documentFileUpload', reason: 'NOT AVAILABLE — NO STORAGE CONFIGURED' }],
    }));
    const v = await kycApi.status();
    expect(v.unavailable[0]!.capability).toBe('documentFileUpload');
  });
});

describe('supportApi — contract', () => {
  it('creates a ticket with only subject, category and message', async () => {
    post.mockReturnValueOnce(ok({}));
    await supportApi.create({ subject: 'Help', category: 'ACCOUNT', message: 'hi' });
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/support/tickets');
    expect(Object.keys(body).sort()).toEqual(['category', 'message', 'subject']);
    // A player must not be able to self-escalate or post as an agent.
    for (const forbidden of ['priority', 'status', 'userId', 'isFromAgent', 'assignedToUserId']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('lists only via the caller-scoped route', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 20 }));
    await supportApi.list();
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain('/support/tickets');
    expect(url.toLowerCase()).not.toContain('userid');
  });

  it('reply, close and reopen hit the caller-scoped routes', async () => {
    post.mockReturnValue(ok({}));
    await supportApi.reply('t1', 'hello');
    await supportApi.close('t1');
    await supportApi.reopen('t1');
    const urls = post.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['/support/tickets/t1/reply', '/support/tickets/t1/close', '/support/tickets/t1/reopen']);
    // Never the admin surface.
    expect(urls.some((u) => String(u).includes('/admin/'))).toBe(false);
  });

  it('exposes the categories the server supports', () => {
    expect(TICKET_CATEGORIES).toContain('WITHDRAWAL');
    expect(TICKET_CATEGORIES).toContain('RESPONSIBLE_GAMING');
  });
});

describe('the KYC UI never fabricates a verified state', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const KYC = 'components/account/kyc-submission.tsx';

  it('renders status from the API', () => {
    expect(strip(read(KYC))).toContain('kycApi.status');
    expect(strip(read(KYC))).toContain('kycApi.submit');
  });

  it('never sets a status client-side', () => {
    const src = strip(read(KYC));
    expect(src).not.toContain("status: 'APPROVED'");
    expect(src).not.toContain('setVerified');
    expect(src).not.toContain('localStorage');
  });

  it('tells the player the decision is made by a reviewer', () => {
    expect(read(KYC)).toContain('never mark you verified automatically');
  });

  it('shows the rejection reason when the server supplies one', () => {
    const src = read(KYC);
    expect(src).toContain('kyc-rejection');
    expect(src).toContain('rejectionReason');
  });

  it('surfaces the server-declared upload limitation instead of a fake file picker', () => {
    const src = read(KYC);
    expect(src).toContain('kyc-unavailable');
    expect(src).toContain('What we cannot do yet');
    // No file input: a picker that discards the file would be a lie.
    expect(src).not.toContain('type="file"');
  });

  it('says a failed submission was NOT sent', () => {
    expect(read(KYC)).toContain('Nothing was sent');
  });

  it('has loading and error states and >=44px targets', () => {
    const src = read(KYC);
    expect(src).toContain('kyc-loading');
    expect(src).toContain('kyc-error');
    expect(src.match(/minHeight: 44/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe('the support UI is server-backed', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const PAGE = 'app/(dashboard)/support/tickets/page.tsx';
  const ADMIN = 'app/admin/support/page.tsx';
  const HELP = 'app/(dashboard)/support/page.tsx';

  it('uses the real API for every action', () => {
    const src = strip(read(PAGE));
    for (const fn of ['supportApi.list', 'supportApi.create', 'supportApi.get', 'supportApi.reply', 'supportApi.close', 'supportApi.reopen']) {
      expect(src).toContain(fn);
    }
  });

  it('holds no fake tickets or hardcoded counts', () => {
    const src = strip(read(PAGE));
    expect(src).not.toContain('mockTickets');
    expect(src).not.toContain('FAKE');
    expect(src).not.toContain('localStorage');
    expect(src).not.toContain('useDemoWallet');
  });

  it('has loading, error and empty states', () => {
    const src = read(PAGE);
    expect(src).toContain('support-loading');
    expect(src).toContain('support-error');
    expect(src).toContain('support-empty');
  });

  it('says a failed create was NOT sent', () => {
    expect(read(PAGE)).toContain('NOT sent');
  });

  it('wraps long message bodies rather than widening the page', () => {
    const src = read(PAGE);
    expect(src).toContain("overflowWrap: 'anywhere'");
    expect(src).toContain('minWidth: 0');
  });

  it('the help page now links to real tickets and drops the "no ticket backend" claim', () => {
    const src = read(HELP);
    expect(src).toContain('support-tickets-link');
    expect(src).toContain('/support/tickets');
    expect(src).not.toContain('There is no ticket backend');
  });

  it('the admin queue states that the backend is the authority, not the screen', () => {
    const src = read(ADMIN);
    expect(src).toContain('authorized by the backend');
    expect(src).toContain('/admin/support/tickets');
  });

  it('the admin queue can mark a note internal and labels it as never shown to the player', () => {
    const src = read(ADMIN);
    expect(src).toContain('admin-support-internal');
    expect(src).toContain('never shown to the player');
  });

  it('admin tables scroll inside their own container', () => {
    const src = read(ADMIN);
    expect(src).toContain("overflowX: 'auto'");
    expect(src).toContain('minWidth: 0');
  });
});
