/**
 * Support tools (Phase 6A, STEP 5).
 *
 * Internal/case notes and operator comments per player, with escalation tags,
 * attachment reference hooks, full-text search and a note-derived timeline. Pure
 * back-office data — never touches gameplay or money.
 */
import { NoteKind, type SupportNote, type TimelineEvent } from './types';

export class SupportService {
  private readonly notes = new Map<string, SupportNote[]>();
  private seq = 0;

  constructor(private readonly clock: () => number = () => Date.now()) {}

  private secureId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `note_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  addNote(input: { playerId: string; kind?: NoteKind; body: string; author: string; tags?: string[]; escalation?: string; attachments?: string[] }): SupportNote {
    this.seq += 1;
    const note: SupportNote = {
      id: this.secureId(),
      playerId: input.playerId,
      kind: input.kind ?? NoteKind.Internal,
      body: input.body,
      author: input.author,
      tags: input.tags ?? [],
      escalation: input.escalation,
      attachments: input.attachments,
      createdAt: this.clock(),
    };
    const list = this.notes.get(input.playerId) ?? [];
    list.push(note);
    this.notes.set(input.playerId, list);
    return note;
  }

  listNotes(playerId: string): SupportNote[] {
    return [...(this.notes.get(playerId) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  }

  countNotes(playerId: string): number {
    return this.notes.get(playerId)?.length ?? 0;
  }

  /** Full-text search across notes (body/tags/escalation), optionally per player. */
  search(query: { playerId?: string; text?: string; kind?: NoteKind; escalation?: string; limit?: number }): SupportNote[] {
    const text = query.text?.trim().toLowerCase();
    let all: SupportNote[] = query.playerId ? [...(this.notes.get(query.playerId) ?? [])] : [...this.notes.values()].flat();
    all = all.filter((n) => {
      if (query.kind && n.kind !== query.kind) return false;
      if (query.escalation && n.escalation !== query.escalation) return false;
      if (text && !`${n.body} ${n.tags.join(' ')} ${n.escalation ?? ''}`.toLowerCase().includes(text)) return false;
      return true;
    });
    all = all.sort((a, b) => b.createdAt - a.createdAt);
    return query.limit ? all.slice(0, query.limit) : all;
  }

  /** Note-derived timeline slice (merged with other sources by the caller). */
  timeline(playerId: string): TimelineEvent[] {
    return this.listNotes(playerId).map((n) => ({ at: n.createdAt, source: 'support', type: n.kind, detail: n.body }));
  }
}
