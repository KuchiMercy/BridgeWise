export type ChainType = 'evm' | 'soroban' | 'solana';

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
}
