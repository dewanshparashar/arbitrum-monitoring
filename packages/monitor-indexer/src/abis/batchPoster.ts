export const sequencerInboxAbi = [
  'event SequencerBatchDelivered(uint256 indexed batchSequenceNumber, bytes32 indexed beforeAcc, bytes32 indexed afterAcc, bytes32 delayedAcc, uint256 afterDelayedMessagesRead, (uint64 minTimestamp, uint64 maxTimestamp, uint64 minBlockNumber, uint64 maxBlockNumber) timeBounds, uint8 dataLocation)',
] as const
