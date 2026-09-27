import { EventEmitter } from 'events';
import {
  CrossChainMessage,
  MessageStatus,
  MessageQueueItem,
  QueueConfig,
  ExecutionResult,
  DuplicateCheckResult,
  DuplicateDetectorStats,
} from '../types';
import { DuplicateMessageDetector, computeMessageFingerprint } from '../dedup/duplicate-message-detector';

const DEFAULT_CONFIG: QueueConfig = {
  maxRetries: 5,
  retryDelayMs: 5000,
  concurrency: 10,
  pollIntervalMs: 1000,
};

export class MessageQueue extends EventEmitter {
  private config: QueueConfig;
  private queue: Map<string, MessageQueueItem> = new Map();
  private processing: Map<string, MessageQueueItem> = new Map();
  private failed: Map<string, MessageQueueItem> = new Map();
  private completed: Map<string, ExecutionResult> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private detector: DuplicateMessageDetector | null;

  constructor(config?: Partial<QueueConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.detector =
      this.config.deduplication === false ? null : new DuplicateMessageDetector(this.config.deduplication);
  }

  /** Returns false when the message was rejected as a duplicate. */
  enqueue(message: CrossChainMessage): boolean {
    const check = this.checkDuplicate(message);
    if (check.duplicate) {
      const event = {
        messageId: message.id,
        reason: check.reason,
        originalMessageId: check.originalMessageId,
        fingerprint: check.fingerprint,
        occurrences: check.occurrences,
      };
      this.emit('duplicate-message', event);
      if (check.reason === 'message-id-conflict') {
        this.emit('message-id-conflict', event);
      }
      return false;
    }

    const item: MessageQueueItem = {
      message: { ...message, status: 'queued' },
      queuedAt: Date.now(),
      nextRetryAt: Date.now(),
      attempts: 0,
    };
    this.queue.set(message.id, item);
    this.emit('message-enqueued', { messageId: message.id, destinationChainId: message.destinationChainId });
    return true;
  }

  dequeue(): CrossChainMessage | null {
    if (this.processing.size >= this.config.concurrency) return null;

    const now = Date.now();
    let oldest: MessageQueueItem | null = null;

    for (const item of this.queue.values()) {
      if (item.nextRetryAt <= now) {
        if (!oldest || item.queuedAt < oldest.queuedAt) {
          oldest = item;
        }
      }
    }

    if (!oldest) return null;

    this.queue.delete(oldest.message.id);
    this.processing.set(oldest.message.id, oldest);
    oldest.message.status = 'processing';

    this.emit('message-dequeued', { messageId: oldest.message.id });
    return oldest.message;
  }

  async complete(result: ExecutionResult): Promise<void> {
    const item = this.processing.get(result.messageId) ?? null;
    this.processing.delete(result.messageId);
    this.completed.set(result.messageId, result);

    if (result.success) {
      this.emit('message-completed', result);
    } else {
      if (item) {
        item.attempts++;
        if (item.attempts <= this.config.maxRetries) {
          item.nextRetryAt = Date.now() + this.config.retryDelayMs * Math.pow(2, item.attempts - 1);
          item.message.status = 'queued';
          item.message.lastError = result.error;
          this.queue.set(result.messageId, item);
          this.emit('message-retrying', {
            messageId: result.messageId,
            attempt: item.attempts,
            maxRetries: this.config.maxRetries,
            nextRetryAt: item.nextRetryAt,
            error: result.error,
          });
        } else {
          item.message.status = 'failed';
          this.failed.set(result.messageId, item);
          this.emit('message-failed', {
            messageId: result.messageId,
            attempts: item.attempts,
            lastError: result.error,
          });
        }
      }
    }
  }

  getPendingCount(): number {
    return this.queue.size;
  }

  getProcessingCount(): number {
    return this.processing.size;
  }

  getCompletedCount(): number {
    return this.completed.size;
  }

  getFailedCount(): number {
    return this.failed.size;
  }

  getFailedMessages(): CrossChainMessage[] {
    return Array.from(this.failed.values()).map((item) => item.message);
  }

  getCompletedMessages(): ExecutionResult[] {
    return Array.from(this.completed.values());
  }

  retryFailed(messageId: string): boolean {
    const item = this.failed.get(messageId);
    if (!item) return false;

    this.failed.delete(messageId);
    item.attempts = 0;
    item.nextRetryAt = Date.now();
    item.message.status = 'queued';
    this.queue.set(messageId, item);
    this.emit('message-retry-queued', { messageId });
    return true;
  }

  retryAllFailed(): number {
    let count = 0;
    for (const [id, item] of this.failed.entries()) {
      this.failed.delete(id);
      item.attempts = 0;
      item.nextRetryAt = Date.now();
      item.message.status = 'queued';
      this.queue.set(id, item);
      count++;
    }
    if (count > 0) {
      this.emit('all-failed-retry-queued', { count });
    }
    return count;
  }

  getDuplicateStats(): DuplicateDetectorStats | null {
    return this.detector ? this.detector.getStats() : null;
  }

  clear(): void {
    this.queue.clear();
    this.processing.clear();
    this.failed.clear();
    this.completed.clear();
    this.detector?.clear();
    this.emit('queue-cleared');
  }

  /**
   * The detector catches content re-deliveries within its window; the
   * lifecycle maps catch ID re-deliveries for as long as the queue holds the
   * message, including after it has left the detector window.
   */
  private checkDuplicate(message: CrossChainMessage): DuplicateCheckResult {
    const detected = this.detector?.register(message);
    if (detected?.duplicate) return detected;

    const known = this.queue.get(message.id) ?? this.processing.get(message.id) ?? this.failed.get(message.id);
    if (known || this.completed.has(message.id)) {
      // Aged out of the detector window: don't let the rejected copy be recorded as new.
      this.detector?.release(message.id);
      const fingerprint = detected?.fingerprint ?? computeMessageFingerprint(message);
      const conflict = known !== undefined && computeMessageFingerprint(known.message) !== fingerprint;
      return {
        duplicate: true,
        reason: conflict ? 'message-id-conflict' : 'message-id',
        fingerprint,
        originalMessageId: message.id,
      };
    }

    return detected ?? { duplicate: false, fingerprint: computeMessageFingerprint(message) };
  }
}
