export type ChainType = 'evm' | 'soroban' | 'solana';

export interface MessageValidationOptions {
  /** Validate addresses against the format of the chain named on the message. */
  enforceAddressFormat: boolean;
  /** Upper bound on `id` length in characters. */
  maxIdLength: number;
  /** Upper bound on `payload` length in characters. */
  maxPayloadLength: number;
}

export interface MessageValidationStats {
  checked: number;
  accepted: number;
  rejected: number;
}

export interface CrossChainMessage {
  id: string;
  sourceChainId: string;
  destinationChainId: string;
  sourceTxHash: string;
  sourceBlockNumber: number;
  /** Position of the emitting event in the source transaction, when one transaction emits several messages. */
  sourceLogIndex?: number;
  messageType: string;
  payload: string;
  sender: string;
  recipient: string;
  tokenAddress?: string;
  amount?: string;
  maxGasLimit?: string;
  createdAt: number;
  status: MessageStatus;
  retryCount: number;
  lastError?: string;
}

export type MessageStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired';

export interface ChainNonce {
  chainId: string;
  nonce: number;
}

export interface ExecutionResult {
  messageId: string;
  success: boolean;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
  timestamp: number;
}

export interface GasRepriceConfig {
  initialGasPrice: string;
  maxGasPrice: string;
  bumpPercentage: number;
  bumpIntervalBlocks: number;
  maxBumps: number;
}

export interface ExecutorConfig {
  chainId: string;
  chainType: ChainType;
  rpcUrl: string;
  privateKey?: string;
  gasRepricing: GasRepriceConfig;
  confirmationBlocks: number;
  confirmationPollIntervalMs: number;
}

export interface QueueConfig {
  maxRetries: number;
  retryDelayMs: number;
  concurrency: number;
  pollIntervalMs: number;
  /** Duplicate message detection settings. Enabled by default; pass `false` to disable. */
  deduplication?: Partial<DuplicateDetectorConfig> | false;
  /**
   * Structural validation applied to every message on the way in. Enabled by
   * default; pass `false` to accept messages unvalidated, which is only safe
   * when every producer is already trusted and schema-checked.
   */
  validation?: Partial<MessageValidationOptions> | false;
}

export interface DuplicateDetectorConfig {
  /** How long a message is remembered after it is first accepted. Must exceed the longest time a message can stay in flight. */
  windowMs: number;
  /** Upper bound on remembered messages; the oldest are evicted first. */
  maxEntries: number;
}

export type DuplicateReason =
  /** Same message ID and same content: a benign re-delivery. */
  | 'message-id'
  /** New message ID, but the same source event and content as an earlier message. */
  | 'fingerprint'
  /** Same message ID with different content: a spoofed or mis-generated message. */
  | 'message-id-conflict';

export interface DuplicateCheckResult {
  duplicate: boolean;
  fingerprint: string;
  reason?: DuplicateReason;
  originalMessageId?: string;
  firstSeenAt?: number;
  occurrences?: number;
}

export interface DuplicateDetectorStats {
  tracked: number;
  checked: number;
  duplicates: number;
  conflicts: number;
  evicted: number;
}

export interface MessageQueueItem {
  message: CrossChainMessage;
  queuedAt: number;
  nextRetryAt: number;
  attempts: number;
  /** Wall-clock time the current delivery attempt started (when the message left the queue). */
  inflightAt?: number;
  /** Destination transaction hash once the message has been broadcast, if any. */
  submittedTxHash?: string;
  /** Wall-clock time the message entered the `submitted` state. */
  submittedAt?: number;
}

/** Read-only view of a message currently being delivered, for monitoring and reconciliation. */
export interface InflightMessageSnapshot {
  messageId: string;
  status: MessageStatus;
  attempts: number;
  queuedAt: number;
  inflightAt?: number;
  submittedAt?: number;
  submittedTxHash?: string;
  destinationChainId: string;
  message: CrossChainMessage;
}

/**
 * The actual state of a transaction on its destination chain.
 * `not-found` means no receipt exists at the queried state; `unknown` means the
 * provider could not reach the chain or could not answer.
 */
export type OnChainMessageStatus =
  | { kind: 'confirmed'; blockNumber?: number }
  | { kind: 'reverted'; error?: string }
  | { kind: 'not-found' }
  | { kind: 'unknown'; error?: string };

/**
 * Resolves whether a broadcast message actually landed on its destination
 * chain. Implementations are chain-specific: the relayer ships an EVM adapter
 * backed by `EvmExecutor.getTransactionStatus`, and adapters for other chains
 * can be built to the same shape.
 */
export interface MessageStatusProvider {
  /** Chain this provider answers for; matched against `CrossChainMessage.destinationChainId`. */
  chainId: string;
  getMessageStatus(messageId: string, txHash: string): Promise<OnChainMessageStatus>;
}

export interface ReconciliationConfig {
  /** An in-flight message older than this (measured from when it left the queue) is reconciled. */
  staleAfterMs: number;
  /** Automatic poll interval. `0` disables the timer; `start()` stays an explicit call. */
  intervalMs: number;
  /** Run one `reconcile()` pass when `start()` is called, before the first interval tick. */
  reconcileOnStart: boolean;
  /**
   * A run that only sees provider errors and makes no corrections increments a
   * consecutive counter. When the counter reaches this threshold the
   * reconciler emits `reconciler-degraded` (and `reconciler-recovered` once it
   * makes a correction again). Runs always keep trying, so a recovered
   * provider resumes reconciliation without operator action.
   */
  maxConsecutiveErrorRuns: number;
}

export type ReconciliationAction =
  /** The tracked status already matches the source of truth; nothing was moved. */
  | 'no-op'
  /** Moved back to `queued` for another delivery attempt. */
  | 'requeued'
  /** Marked `confirmed` because the destination receipt is final. */
  | 'confirmed'
  /** Marked `failed` and left alone until an operator intervenes. */
  | 'failed'
  /** Left in flight because the truth could not be established during this run. */
  | 'deferred';

export type ReconciliationReason =
  | 'not-stale'
  | 'stale-processing'
  | 'stale-submitted'
  | 'confirmed-on-chain'
  | 'reverted-on-chain'
  | 'not-found-on-chain'
  | 'provider-unavailable'
  | 'provider-error'
  | 'already-resolved';

export interface MessageReconciliation {
  messageId: string;
  destinationChainId: string;
  /** Tracked status before the reconciliation run. */
  before: MessageStatus;
  /** Tracked status afterwards; unchanged for `no-op` and `deferred`. */
  after: MessageStatus | null;
  action: ReconciliationAction;
  reason: ReconciliationReason;
  detail?: string;
}

export interface ReconciliationSummary {
  runId: number;
  startedAt: number;
  durationMs: number;
  scanned: number;
  transitions: MessageReconciliation[];
}

export interface ReconciliationStats {
  runs: number;
  scanned: number;
  /** Successful corrections: requeued, confirmed or failed transitions. */
  corrections: number;
  requeued: number;
  confirmed: number;
  failed: number;
  deferred: number;
  errors: number;
  providerUnavailable: number;
  consecutiveErrorRuns: number;
  lastRunAt: number | null;
  lastRunDurationMs: number | null;
}
