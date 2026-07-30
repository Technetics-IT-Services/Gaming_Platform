/**
 * Notification framework (Phase 6B, STEP 7).
 *
 * Template-driven multi-channel messaging (email / SMS / push / in-app) behind an
 * `INotificationProvider` abstraction, with variable interpolation, per-player
 * channel preferences (opt-out ⇒ suppressed), immediate + scheduled delivery, and a
 * communication-history log. Only mock providers ship here — no real credentials.
 */
import {
  Channel,
  type CommunicationRecord,
  type INotificationProvider,
  type NotificationTemplate,
  NotificationStatus,
  type PlayerPreferences,
} from './types';

/** Resolve a contact address for a channel (masked ids are fine for the mock). */
export type ContactResolver = (playerId: string, channel: Channel) => string | undefined;
/** Read a player's channel preferences (opt-in flags). */
export type PreferenceResolver = (playerId: string) => PlayerPreferences | undefined;

interface ScheduledJob {
  id: string;
  playerId: string;
  templateId: string;
  vars: Record<string, string>;
  sendAt: number;
}

export class NotificationService {
  private readonly templates = new Map<string, NotificationTemplate>();
  private readonly providers = new Map<Channel, INotificationProvider>();
  private readonly history: CommunicationRecord[] = [];
  private readonly queue: ScheduledJob[] = [];

  constructor(
    providers: INotificationProvider[] = [],
    private readonly opts: { contacts?: ContactResolver; preferences?: PreferenceResolver; clock?: () => number } = {},
  ) {
    for (const p of providers) this.providers.set(p.channel, p);
  }
  private get clock() {
    return this.opts.clock ?? (() => Date.now());
  }

  private id(prefix: string): string {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  registerTemplate(t: NotificationTemplate): void {
    this.templates.set(t.id, t);
  }
  registerProvider(p: INotificationProvider): void {
    this.providers.set(p.channel, p);
  }

  private render(body: string, vars: Record<string, string>): string {
    return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
  }

  private optedIn(playerId: string, channel: Channel): boolean {
    const prefs = this.opts.preferences?.(playerId);
    if (!prefs) return true; // no preferences on file ⇒ allowed
    switch (channel) {
      case Channel.Email:
        return prefs.email;
      case Channel.SMS:
        return prefs.sms;
      case Channel.Push:
        return prefs.push;
      case Channel.InApp:
        return prefs.inApp;
      default:
        return true;
    }
  }

  /** Send now via a template; respects opt-out and records to history. */
  async send(playerId: string, templateId: string, vars: Record<string, string> = {}): Promise<CommunicationRecord> {
    const template = this.templates.get(templateId);
    if (!template) throw new Error('no such template');
    const now = this.clock();
    const base: CommunicationRecord = { id: this.id('msg'), playerId, channel: template.channel, templateId, subject: template.subject, status: NotificationStatus.Queued, at: now };

    if (!this.optedIn(playerId, template.channel)) {
      const rec = { ...base, status: NotificationStatus.Suppressed, detail: 'opted out' };
      this.history.push(rec);
      return rec;
    }
    const to = this.opts.contacts?.(playerId, template.channel);
    const provider = this.providers.get(template.channel);
    if (!to || !provider) {
      const rec = { ...base, status: NotificationStatus.Failed, detail: to ? 'no provider' : 'no contact' };
      this.history.push(rec);
      return rec;
    }
    const result = await provider.send({ to, subject: template.subject, body: this.render(template.body, vars) });
    const rec: CommunicationRecord = { ...base, status: result.ok ? NotificationStatus.Sent : NotificationStatus.Failed, providerRef: result.providerRef, detail: result.reason };
    this.history.push(rec);
    return rec;
  }

  /** Schedule a template for future delivery. */
  schedule(playerId: string, templateId: string, sendAt: number, vars: Record<string, string> = {}): string {
    const job: ScheduledJob = { id: this.id('job'), playerId, templateId, vars, sendAt };
    this.queue.push(job);
    return job.id;
  }

  /** Dispatch all due scheduled jobs (scheduler tick). */
  async runDue(now: number = this.clock()): Promise<CommunicationRecord[]> {
    const due = this.queue.filter((j) => j.sendAt <= now);
    const remaining = this.queue.filter((j) => j.sendAt > now);
    this.queue.length = 0;
    this.queue.push(...remaining);
    const out: CommunicationRecord[] = [];
    for (const job of due) out.push(await this.send(job.playerId, job.templateId, job.vars));
    return out;
  }

  communicationHistory(playerId: string): CommunicationRecord[] {
    return this.history.filter((r) => r.playerId === playerId).sort((a, b) => b.at - a.at);
  }
  pendingCount(): number {
    return this.queue.length;
  }
}

/* ---------------------------- mock providers ------------------------------ */

/** A deterministic mock provider that "sends" successfully and returns a ref. */
export class MockNotificationProvider implements INotificationProvider {
  readonly sent: { to: string; body: string }[] = [];
  constructor(readonly channel: Channel) {}
  async send(input: { to: string; subject?: string; body: string }): Promise<{ ok: boolean; providerRef?: string }> {
    this.sent.push({ to: input.to, body: input.body });
    return { ok: true, providerRef: `mock_${this.channel}_${this.sent.length}` };
  }
}
