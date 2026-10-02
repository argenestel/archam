import fs from 'node:fs';
import path from 'node:path';
import { keccak256 } from 'viem';

export function atomicJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', mode);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

export const spentGas = (journal) => journal.steps.reduce((sum, step) => sum + BigInt(step.gasCost || 0), 0n);

// Match compiler runtime exactly except immutable slots, whose values are checked by getters.
export function assertRuntime(code, deployed) {
  const expected = deployed.object.replace(/^0x/, '').toLowerCase();
  const actual = code.replace(/^0x/, '').toLowerCase();
  if (actual.length !== expected.length) throw new Error('Runtime length differs from release artifact');
  const mask = (hex) => {
    const chars = [...hex];
    for (const ranges of Object.values(deployed.immutableReferences || {})) {
      for (const { start, length } of ranges) {
        if (start < 0 || length < 0 || (start + length) * 2 > chars.length) throw new Error('Invalid immutable range');
        chars.fill('0', start * 2, (start + length) * 2);
      }
    }
    return chars.join('');
  };
  if (mask(actual) !== mask(expected)) throw new Error('Runtime differs from release artifact');
}

// Store the signed hash before sending: ambiguous submission can never cause a fresh tx.
export async function journaledSend({ rpc, account, journal, save, budget, reserve, label, transaction }) {
  if (await rpc.getChainId() !== journal.chainId) throw new Error('Wrong RPC chain');
  let step = journal.steps.find((s) => s.label === label);
  if (step?.status === 'reverted') throw new Error(`${label} previously reverted; reconcile manually`);
  if (!step) {
    if (journal.steps.some((s) => s.status !== 'success')) throw new Error('Unresolved submission; reconcile first');
    const nonce = journal.startNonce + journal.steps.length;
    const [latest, pending] = await Promise.all([
      rpc.getTransactionCount({ address: account.address }),
      rpc.getTransactionCount({ address: account.address, blockTag: 'pending' }),
    ]);
    if (latest !== nonce || pending !== nonce) throw new Error('Unexpected deployer nonce; refusing duplicate deployment');
    const gas = (await rpc.estimateGas({ account: account.address, ...transaction }) * 130n + 99n) / 100n;
    const gasPrice = await rpc.getGasPrice() * 2n;
    const maximumCost = gas * gasPrice;
    if (spentGas(journal) + maximumCost > budget) throw new Error('Pre-submission gas budget exceeded');
    if (maximumCost + reserve > await rpc.getBalance({ address: account.address })) throw new Error('Insufficient gas balance/reserve');
    const raw = await account.signTransaction({ ...transaction, chainId: journal.chainId, type: 'legacy', nonce, gas, gasPrice });
    step = { label, nonce, hash: keccak256(raw), raw, status: 'signed', gas: gas.toString(), gasPrice: gasPrice.toString() };
    journal.steps.push(step);
    save();
    // Failure here is uncertain: the durable hash remains locked for receipt reconciliation.
    const submitted = await rpc.sendRawTransaction({ serializedTransaction: raw });
    if (submitted.toLowerCase() !== step.hash.toLowerCase()) throw new Error('RPC returned a different transaction hash');
    step.status = 'submitted';
    save();
  }
  const receipt = await rpc.waitForTransactionReceipt({ hash: step.hash, timeout: 120_000, confirmations: 2 });
  if (receipt.transactionHash.toLowerCase() !== step.hash.toLowerCase()) throw new Error('Receipt hash mismatch');
  step.status = receipt.status;
  step.block = receipt.blockNumber.toString();
  step.gasCost = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
  step.gasUsed = receipt.gasUsed.toString();
  step.contractAddress = receipt.contractAddress;
  save();
  if (receipt.status !== 'success') throw new Error(`${label} reverted; no further transactions will be sent`);
  return receipt;
}
