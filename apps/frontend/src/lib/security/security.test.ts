import { describe, expect, it } from 'vitest';

import { ComplianceEvidenceRegistry, defaultControls } from './compliance-evidence';
import { defaultCSP, secureCookie, securityHeaders, serializeCSP } from './headers';
import { AccountLockout, base32Decode, checkPassword, hotp, MFAService, SessionManager, totp } from './identity';
import { IncidentManager, IncidentSeverity, IncidentStatus } from './incident';
import { SecurityEventType, SecurityMonitor, SecuritySeverity } from './monitoring';
import { InMemorySecretProvider, SecretManager } from './secrets';
import { SecurityAccessDeniedError, SecurityPlatform, SecurityRole } from './security-platform';
import { assertOutboundUrlSafe, csrf, encode, timingSafeEqual, V, validate, ValidationError } from './validation';

/**
 * Production security platform (Phase 8). Verifies security headers/CSP/cookies,
 * input validation + output encoding + CSRF/SSRF guards, MFA (RFC 6238 test vector),
 * password/lockout policy, session rotation + reuse detection, secret rotation +
 * audit, security monitoring/SIEM, compliance evidence + framework mappings, incident
 * response, and RBAC on the read-only security APIs. Wraps the platform — no money moves.
 */

describe('application security headers', () => {
  it('builds a strict CSP + the full header set + secure cookies', () => {
    const csp = serializeCSP(defaultCSP('abc123'));
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("'nonce-abc123'");
    const h = securityHeaders({ nonce: 'abc123', hstsPreload: true });
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Strict-Transport-Security']).toContain('preload');
    expect(h['Permissions-Policy']).toContain('geolocation=()');
    const cookie = secureCookie({ name: 'session', value: 'tok', hostPrefix: true, sameSite: 'Strict' });
    expect(cookie).toBe('__Host-session=tok; HttpOnly; Secure; SameSite=Strict; Path=/');
  });
});

describe('input validation + output encoding', () => {
  it('validates a schema and aggregates errors', () => {
    const ok = validate({ name: ' Alice ', age: '30', role: 'admin' }, {
      name: V.string({ min: 2, trim: true }),
      age: V.integer({ min: 0, max: 120 }),
      role: V.enum(['admin', 'user'] as const),
    });
    expect(ok).toEqual({ name: 'Alice', age: 30, role: 'admin' });
    expect(() => validate({ name: 'x', age: 'NaN', role: 'root' }, { name: V.string({ min: 2 }), age: V.integer(), role: V.enum(['admin'] as const) })).toThrow(ValidationError);
  });

  it('context-aware encoders neutralize XSS payloads', () => {
    expect(encode.html('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(encode.url('a b&c')).toBe('a%20b%26c');
    expect(encode.js('</script>')).not.toContain('<');
  });

  it('CSRF double-submit + constant-time compare', () => {
    const token = csrf.issue();
    expect(csrf.verify(token, token)).toBe(true);
    expect(csrf.verify(token, 'other')).toBe(false);
    expect(csrf.verify(undefined, token)).toBe(false);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('SSRF guard blocks private ranges + non-allow-listed hosts', () => {
    expect(assertOutboundUrlSafe('https://api.partner.com/hook', ['api.partner.com']).ok).toBe(true);
    expect(assertOutboundUrlSafe('http://api.partner.com', ['api.partner.com']).ok).toBe(false); // not https
    expect(assertOutboundUrlSafe('https://127.0.0.1/x', ['127.0.0.1']).ok).toBe(false); // loopback
    expect(assertOutboundUrlSafe('https://evil.com', ['api.partner.com']).ok).toBe(false); // not allow-listed
  });
});

describe('identity — MFA (RFC 6238)', () => {
  it('matches the RFC 6238 SHA-1 test vector', async () => {
    // secret "12345678901234567890" (ASCII), T=59s ⇒ counter 1, 8 digits ⇒ 94287082.
    const key = new TextEncoder().encode('12345678901234567890');
    expect(await hotp(key, 1, 8)).toBe('94287082');
    expect(await totp(key, 59_000, { digits: 8 })).toBe('94287082');
  });

  it('verifies a TOTP within the drift window', async () => {
    const secret = 'JBSWY3DPEHPK3PXP'; // base32
    const key = base32Decode(secret);
    let t = 1_700_000_000_000;
    const code = await totp(key, t);
    const mfa = new MFAService(() => t);
    expect(await mfa.verifyTotp(secret, code)).toBe(true);
    t += 90_000; // > window
    expect(await mfa.verifyTotp(secret, code)).toBe(false);
    expect(mfa.provisioningUri('user@x', secret)).toContain('otpauth://totp/');
  });
});

describe('identity — password + lockout + sessions', () => {
  it('enforces password policy', () => {
    expect(checkPassword('short').ok).toBe(false);
    expect(checkPassword('Sup3rSecret!Pass').ok).toBe(true);
    expect(checkPassword('password12345').ok).toBe(false); // denylisted
  });

  it('locks an account after repeated failures', () => {
    let t = 0;
    const lock = new AccountLockout({ maxAttempts: 3, windowMs: 1000, lockMs: 5000 }, () => t);
    lock.recordFailure('u');
    lock.recordFailure('u');
    expect(lock.recordFailure('u').locked).toBe(true);
    expect(lock.isLocked('u')).toBe(true);
    t = 6000;
    expect(lock.isLocked('u')).toBe(false);
  });

  it('rotates refresh tokens and detects reuse (theft) → revokes session', () => {
    const sm = new SessionManager(() => 0);
    const { session, refreshToken } = sm.create('user1');
    const r1 = sm.rotate(session.id, refreshToken);
    expect(r1.ok).toBe(true);
    // presenting the now-spent original token again = reuse → session revoked
    const reuse = sm.rotate(session.id, refreshToken);
    expect(reuse.ok).toBe(false);
    expect(sm.isActive(session.id)).toBe(false);
  });

  it('blacklists access tokens and revokes all user sessions', () => {
    const sm = new SessionManager(() => 0);
    const a = sm.create('u');
    sm.create('u');
    expect(sm.revokeAllForUser('u')).toBe(2);
    sm.blacklistToken('jti-1');
    expect(sm.isBlacklisted('jti-1')).toBe(true);
    expect(sm.isActive(a.session.id)).toBe(false);
  });
});

describe('secret management', () => {
  it('rotates versions, keeps old ones readable, and audits access', async () => {
    const sm = new SecretManager(new InMemorySecretProvider(() => 0), () => 0);
    await sm.set('DB_PASSWORD', 'v1', 'admin');
    const v2 = await sm.rotate('DB_PASSWORD', 'v2', 'admin');
    expect(v2.version).toBe(2);
    expect(await sm.get('DB_PASSWORD')).toBe('v2'); // primary = latest
    expect(await sm.get('DB_PASSWORD', { version: 1 })).toBe('v1'); // grace decryption
    const trail = sm.auditTrail('DB_PASSWORD').map((r) => r.action);
    expect(trail).toEqual(expect.arrayContaining(['set', 'rotate', 'get']));
  });
});

describe('security monitoring', () => {
  it('records events, forwards High/Critical to SIEM, and exports for SOC', async () => {
    const forwarded: number[] = [];
    const siem = { name: 'mock-siem', async forward(evts: unknown[]) { forwarded.push(evts.length); return { accepted: evts.length }; } };
    const mon = new SecurityMonitor(() => 0, siem);
    mon.record({ type: SecurityEventType.AuthFailure, severity: SecuritySeverity.Low, actor: 'u' });
    mon.record({ type: SecurityEventType.TokenReuse, severity: SecuritySeverity.Critical, actor: 'u' });
    expect(forwarded).toEqual([1]); // only the Critical auto-forwarded
    mon.addIndicator({ kind: 'ip', value: '1.2.3.4', confidence: 90, reason: 'bruteforce' });
    expect(mon.isIndicated('ip', '1.2.3.4')?.confidence).toBe(90);
    const soc = mon.socExport();
    expect(soc.bySeverity[SecuritySeverity.Critical]).toBe(1);
  });
});

describe('compliance evidence', () => {
  it('registers controls with framework mappings, attaches evidence, exports a matrix', () => {
    const reg = new ComplianceEvidenceRegistry(() => 0);
    for (const c of defaultControls()) reg.registerControl(c);
    expect(reg.controlsFor('pci').length).toBeGreaterThan(0);
    expect(reg.controlsFor('soc2').length).toBeGreaterThan(0);
    reg.attachEvidence({ controlId: 'IA-2', kind: 'test', reference: 'security.test.ts::MFA' });
    expect(reg.evidenceFor('IA-2')).toHaveLength(1);
    const cov = reg.coverage();
    expect(cov.total).toBe(defaultControls().length);
    expect(cov.percentImplemented).toBe(100);
    expect(reg.export().columns).toContain('frameworks');
  });
});

describe('incident response', () => {
  it('classifies severity, escalates, and blocks close without forensics', () => {
    const mgr = new IncidentManager(() => 0);
    const inc = mgr.declare({ title: 'Suspected token theft', severity: IncidentSeverity.SEV1, category: 'auth' });
    expect(mgr.escalation(inc.id)).toContain('security-lead');
    mgr.advance(inc.id, IncidentStatus.Triaged, 'ic');
    mgr.advance(inc.id, IncidentStatus.Contained, 'ic');
    mgr.advance(inc.id, IncidentStatus.Eradicated, 'ic');
    mgr.advance(inc.id, IncidentStatus.Recovered, 'ic');
    // SEV1 cannot close until the forensic checklist is complete
    expect(() => mgr.advance(inc.id, IncidentStatus.Closed, 'ic')).toThrow(/forensic/i);
    for (const item of ['preserve_logs', 'snapshot_affected_hosts', 'capture_memory_if_applicable', 'export_security_audit_stream', 'record_iocs', 'chain_of_custody_documented'] as const) {
      mgr.completeForensicItem(inc.id, item, 'forensics');
    }
    expect(mgr.advance(inc.id, IncidentStatus.Closed, 'ic').status).toBe(IncidentStatus.Closed);
  });
});

describe('security platform facade — RBAC read-only', () => {
  it('enforces permissions and audits allow + deny', () => {
    const platform = new SecurityPlatform({ clock: () => 0 });
    for (const c of defaultControls()) platform.evidence.registerControl(c);
    const auditor = { actor: 'aud', roles: [SecurityRole.ComplianceAuditor] };
    expect(platform.evidenceMatrix(auditor).rows.length).toBeGreaterThan(0);
    const readOnly = { actor: 'ro', roles: [SecurityRole.ReadOnly] };
    expect(() => platform.socExport(readOnly)).toThrow(SecurityAccessDeniedError); // no Export
    expect(platform.complianceCoverage(readOnly).total).toBeGreaterThan(0); // EvidenceView allowed
    expect(platform.auditTrail().some((r) => !r.allowed)).toBe(true);
    expect(platform.auditTrail().some((r) => r.allowed)).toBe(true);
  });
});
