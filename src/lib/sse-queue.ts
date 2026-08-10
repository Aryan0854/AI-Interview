/**
 * In-memory SSE progress queue.
 * Each resumeId gets its own queue with a 60-second keep-alive window.
 * Items pushed during processing are streamed to the connected consumer.
 */
type SSEItem = Record<string, unknown>;

export class SSEQueue {
  private items: SSEItem[] = [];
  private done = false;

  push(item: SSEItem): void {
    this.items.push(item);
  }

  drain(): SSEItem[] {
    const out = [...this.items];
    this.items = [];
    return out;
  }

  signalDone(): void {
    this.done = true;
  }

  isDone(): boolean {
    return this.done;
  }
}

const queues = new Map<string, SSEQueue>();
const QUEUE_TTL_MS = 60_000;

export function getQueue(resumeId: string): SSEQueue {
  let q = queues.get(resumeId);
  if (!q) {
    q = new SSEQueue();
    queues.set(resumeId, q);
  }
  return q;
}

export function pushProgress(resumeId: string, item: SSEItem): void {
  const q = getQueue(resumeId);
  q.push(item);
}

export function signalProcessingDone(resumeId: string): void {
  const q = getQueue(resumeId);
  q.signalDone();
  // GC the queue after TTL so it doesn't leak memory
  setTimeout(() => queues.delete(resumeId), QUEUE_TTL_MS);
}

export function getQueueOrWait(
  resumeId: string,
  timeoutMs = QUEUE_TTL_MS
): SSEQueue {
  return getQueue(resumeId);
}
