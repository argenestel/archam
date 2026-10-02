import { expect, it } from 'vitest';
import { externalOutcome } from './external';
const hash = `0x${'ab'.repeat(32)}`;
it('does not mistake arbitrary hashes or submitted batches for confirmations', () => {
  expect(externalOutcome({ calldata: hash }).status).toBe('pending');
  expect(externalOutcome({ status: 'submitted', batchId: 'batch-123' })).toEqual({
    hash: undefined,
    batchId: 'batch-123',
    status: 'pending',
  });
  expect(externalOutcome({ txHash: hash, progress: { status: 'PENDING' } }).status).toBe('pending');
  expect(externalOutcome({ txHash: hash, status: 'FAILED' }).status).toBe('failed');
  expect(externalOutcome({ txHash: hash, progress: { status: 'FAILED' } }).status).toBe('failed');
});
it('recognizes same-chain SDK outcomes but still requires receipt verification by the caller', () => {
  expect(externalOutcome({ txHash: hash, progress: { status: 'DONE' } }).status).toBe('confirmed');
  expect(externalOutcome({ status: 'confirmed-details-unavailable', txHash: hash }).status).toBe(
    'confirmed',
  );
  expect(externalOutcome({ txHash: '0xnot-a-hash' }).status).toBe('pending');
  expect(externalOutcome({ kind: 'cross-chain', txHash: hash }).status).toBe('pending');
});
