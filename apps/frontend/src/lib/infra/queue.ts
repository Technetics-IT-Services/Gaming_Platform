/**
 * Queue abstraction (Phase 7, STEP 5 & 6).
 *
 * A transport-agnostic queue contract with an in-memory reference implementation and
 * a dead-letter queue. Production wires this to Redis/BullMQ/SQS behind the same
 * `IQueue` interface — the job framework depends only on the contract. Framework-
 * agnostic; moves no money and touches no frozen module.
 */

export interface QueueMessage<T> {
  id: string;
  payload: T;
  /** Delivery attempts so far (incremented on each dequeue). */
  attempts: number;
  enqueuedAt: number;
  /** Not visible for delivery until this time (delay / backoff). */
  availableAt: number;
}

export interface IQueue<T> {
  readonly name: string;
  enqueue(payload: T, opts?: { delayMs?: number }): QueueMessage<T>;
  /** Reserve the next available message (or undefined if none). */
  dequeue(now?: number): QueueMessage<T> | undefined;
  /** Acknowledge successful processing (removes the in-flight message). */
  ack(id: string): void;
  /** Return a message for retry after a delay, or route to DLQ if exhausted. */
  nack(id: string, opts?: { delayMs?: number; toDeadLetter?: boolean }): void;
  size(): number;
  inFlight(): number;
}

function secureId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class InMemoryQueue<T> implements IQueue<T> {
  private readonly ready: QueueMessage<T>[] = [];
  private readonly reserved = new Map<string, QueueMessage<T>>();

  constructor(
    readonly name: string,
    private readonly deadLetter?: InMemoryQueue<T>,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  enqueue(payload: T, opts: { delayMs?: number } = {}): QueueMessage<T> {
    const now = this.clock();
    const msg: QueueMessage<T> = { id: `msg_${secureId()}`, payload, attempts: 0, enqueuedAt: now, availableAt: now + (opts.delayMs ?? 0) };
    this.ready.push(msg);
    return msg;
  }

  dequeue(now: number = this.clock()): QueueMessage<T> | undefined {
    const idx = this.ready.findIndex((m) => m.availableAt <= now);
    if (idx < 0) return undefined;
    const [msg] = this.ready.splice(idx, 1);
    if (!msg) return undefined;
    msg.attempts += 1;
    this.reserved.set(msg.id, msg);
    return msg;
  }

  ack(id: string): void {
    this.reserved.delete(id);
  }

  nack(id: string, opts: { delayMs?: number; toDeadLetter?: boolean } = {}): void {
    const msg = this.reserved.get(id);
    if (!msg) return;
    this.reserved.delete(id);
    if (opts.toDeadLetter && this.deadLetter) {
      this.deadLetter.enqueue(msg.payload);
      return;
    }
    msg.availableAt = this.clock() + (opts.delayMs ?? 0);
    this.ready.push(msg);
  }

  size(): number {
    return this.ready.length;
  }
  inFlight(): number {
    return this.reserved.size;
  }
  /** The dead-letter queue backing this queue (if any). */
  dlq(): InMemoryQueue<T> | undefined {
    return this.deadLetter;
  }
}
