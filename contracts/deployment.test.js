import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { keccak256 } from 'viem';
import { assertRuntime, atomicJson, journaledSend, spentGas } from '../scripts/lib/deployment-journal.mjs';

const raw = '0x1234';
const hash = keccak256(raw);
function fixture() {
  const journal = { chainId: 5042, startNonce: 0, steps: [] };
  const snapshots = [];
  const account = { address: '0x0000000000000000000000000000000000000001', signTransaction: vi.fn(async () => raw) };
  const receipt = { transactionHash: hash, status: 'success', blockNumber: 10n, gasUsed: 10n, effectiveGasPrice: 4n, contractAddress: account.address };
  const rpc = {
    getChainId: vi.fn(async () => 5042),
    getTransactionCount: vi.fn(async () => journal.steps.length),
    estimateGas: vi.fn(async () => 10n), getGasPrice: vi.fn(async () => 2n),
    getBalance: vi.fn(async () => 10_000n),
    sendRawTransaction: vi.fn(async () => {
      expect(snapshots.at(-1).steps[0]).toMatchObject({ hash, raw, status: 'signed' });
      return hash;
    }),
    waitForTransactionReceipt: vi.fn(async () => receipt),
  };
  const options = { rpc, account, journal, save: () => snapshots.push(structuredClone(journal)), budget: 1000n, reserve: 10n, label: 'Deploy', transaction: { data: '0x00' } };
  return { ...options, options, receipt, snapshots };
}

describe('mainnet deployment safety', () => {
  it('persists a known signed hash before broadcast and bounds the signed gas cost', async () => {
    const f = fixture();
    await journaledSend(f.options);
    expect(f.account.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ chainId: 5042, nonce: 0, gas: 13n, gasPrice: 4n, type: 'legacy' }));
    expect(f.journal.steps[0].status).toBe('success');
    expect(spentGas(f.journal)).toBe(40n);
  });
  it('refuses an over-budget tx before signing or broadcasting', async () => {
    const f = fixture(); f.options.budget = 51n;
    await expect(journaledSend(f.options)).rejects.toThrow('budget');
    expect(f.account.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(f.journal.steps).toHaveLength(0);
  });
  it('retains a hash on ambiguous submission and reconciles without resending', async () => {
    const f = fixture(); f.rpc.sendRawTransaction.mockRejectedValueOnce(new Error('connection lost'));
    await expect(journaledSend(f.options)).rejects.toThrow('connection lost');
    expect(f.journal.steps[0]).toMatchObject({ hash, raw, status: 'signed' });
    await journaledSend(f.options);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(f.account.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.journal.steps[0].status).toBe('success');
  });
  it('blocks later deployment while an earlier submission is unresolved', async () => {
    const f = fixture(); f.rpc.sendRawTransaction.mockRejectedValueOnce(new Error('uncertain'));
    await expect(journaledSend(f.options)).rejects.toThrow();
    await expect(journaledSend({ ...f.options, label: 'Next' })).rejects.toThrow('Unresolved');
    expect(f.account.signTransaction).toHaveBeenCalledTimes(1);
  });
  it('reconciles receipt timeouts without signing duplicates', async () => {
    const f = fixture(); f.rpc.waitForTransactionReceipt.mockRejectedValueOnce(new Error('timeout'));
    await expect(journaledSend(f.options)).rejects.toThrow('timeout');
    expect(f.journal.steps[0].status).toBe('submitted');
    await journaledSend(f.options);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(f.account.signTransaction).toHaveBeenCalledTimes(1);
  });
  it('refuses unrelated nonce activity', async () => {
    const f = fixture(); f.rpc.getTransactionCount.mockResolvedValue(1);
    await expect(journaledSend(f.options)).rejects.toThrow('nonce');
    expect(f.account.signTransaction).not.toHaveBeenCalled();
  });
  it('refuses the wrong RPC chain', async () => {
    const f = fixture(); f.rpc.getChainId.mockResolvedValue(5042002);
    await expect(journaledSend(f.options)).rejects.toThrow('chain');
    expect(f.account.signTransaction).not.toHaveBeenCalled();
  });
  it('preserves the gas reserve before signing', async () => {
    const f = fixture(); f.rpc.getBalance.mockResolvedValue(61n);
    await expect(journaledSend(f.options)).rejects.toThrow('reserve');
    expect(f.account.signTransaction).not.toHaveBeenCalled();
  });
  it('persists a revert and refuses to replay it', async () => {
    const f = fixture(); f.receipt.status = 'reverted';
    await expect(journaledSend(f.options)).rejects.toThrow('reverted');
    expect(f.journal.steps[0].gasCost).toBe('40');
    await expect(journaledSend(f.options)).rejects.toThrow('previously reverted');
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it('counts earlier spending against the lifetime cap', async () => {
    const f = fixture(); await journaledSend(f.options);
    await expect(journaledSend({ ...f.options, label: 'Next', budget: 91n })).rejects.toThrow('budget');
    expect(f.account.signTransaction).toHaveBeenCalledTimes(1);
  });
  it('rejects a differing RPC submission hash while retaining its own known hash', async () => {
    const f = fixture(); f.rpc.sendRawTransaction.mockResolvedValue('0x00');
    await expect(journaledSend(f.options)).rejects.toThrow('different transaction hash');
    expect(f.journal.steps[0].hash).toBe(hash);
  });
  it('writes a complete private journal atomically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mofu-journal-'));
    try {
      const file = path.join(dir, 'journal.json');
      atomicJson(file, { state: 'intent' }); atomicJson(file, { state: 'confirmed' });
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ state: 'confirmed' });
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(dir)).toEqual(['journal.json']);
    } finally { fs.rmSync(dir, { recursive: true }); }
  });
  it('matches runtime except declared immutable slots and rejects other changes', () => {
    const deployed = { object: '6100006102', immutableReferences: { x: [{ start: 1, length: 2 }] } };
    expect(() => assertRuntime('0x61aabb6102', deployed)).not.toThrow();
    expect(() => assertRuntime('0x62aabb6102', deployed)).toThrow('differs');
    expect(() => assertRuntime('0x61', deployed)).toThrow('length');
  });
});
