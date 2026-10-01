import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain } from 'viem';
import { compile } from '../scripts/check-contracts.mjs';
import { privateKeyToAccount } from 'viem/accounts';

const SCALE = 10n ** 18n;
let provider, publicClient, wallet, owner, buyer, compiled;
beforeAll(async () => {
  compiled = compile({
    'MockToken.sol': {
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockToken is ERC20 { constructor() ERC20("Mock", "MOCK") { _mint(msg.sender, 1000000 ether); } }
`,
    },
  });
  provider = ganache.provider({
    logging: { quiet: true },
    chain: { hardfork: 'shanghai' },
    wallet: { totalAccounts: 2 },
  });
  const chain = defineChain({
    id: 1337,
    name: 'Local EVM',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://localhost'] } },
  });
  publicClient = createPublicClient({ chain, transport: custom(provider), cacheTime: 0 });
  wallet = createWalletClient({ chain, transport: custom(provider) });
  [owner, buyer] = await wallet.getAddresses();
}, 30000);
afterAll(async () => {
  await provider?.disconnect();
});
async function deploy(artifact, args = []) {
  const hash = await wallet.deployContract({
    account: privateKeyToAccount(provider.getInitialAccounts()[owner.toLowerCase()].secretKey),
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe('success');
  return { address: receipt.contractAddress, abi: artifact.abi };
}
async function write(contract, functionName, args = [], account = owner) {
  const { request } = await publicClient.simulateContract({
    ...contract,
    functionName,
    args,
    account,
  });
  const hash = await wallet.writeContract({
    ...request,
    account: privateKeyToAccount(provider.getInitialAccounts()[account.toLowerCase()].secretKey),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe('success');
}
const read = (contract, functionName, args = []) =>
  publicClient.readContract({ ...contract, functionName, args });
async function advanceTo(timestamp) {
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  await provider.request({
    method: 'evm_increaseTime',
    params: [Number(timestamp - block.timestamp)],
  });
  await provider.request({ method: 'evm_mine', params: [] });
}
async function fixture() {
  const artifact = compiled['MockToken.sol'].MockToken;
  const payment = await deploy(artifact);
  const sale = await deploy(artifact);
  const { timestamp } = await publicClient.getBlock({ blockTag: 'latest' });
  const start = timestamp + 10n,
    end = timestamp + 1000n;
  const pad = await deploy(compiled['contracts/src/FixedPriceLaunchpad.sol'].FixedPriceLaunchpad, [
    owner,
    payment.address,
    sale.address,
    start,
    end,
    100n * SCALE,
    1000n * SCALE,
    2n * SCALE,
  ]);
  await write(payment, 'transfer', [buyer, 1000n * SCALE]);
  await write(payment, 'approve', [pad.address, 1000n * SCALE], buyer);
  return { pad, payment, sale, start, end };
}
describe('launchpad escrow on local EVM', () => {
  it('requires full inventory, rejects over-cap, and protects claims after proceeds/unsold withdrawal', async () => {
    const { pad, payment, sale, start, end } = await fixture();
    await advanceTo(start);
    await expect(write(pad, 'contribute', [100n * SCALE], buyer)).rejects.toThrow();
    await write(sale, 'transfer', [pad.address, 2000n * SCALE]);
    await expect(write(pad, 'contribute', [1001n * SCALE], buyer)).rejects.toThrow();
    await write(pad, 'contribute', [100n * SCALE], buyer);
    await expect(write(pad, 'claim', [], buyer)).rejects.toThrow();
    await expect(write(pad, 'withdrawProceeds', [], buyer)).rejects.toThrow();
    await advanceTo(end);
    await expect(write(pad, 'refund', [], buyer)).rejects.toThrow();
    await write(pad, 'withdrawProceeds');
    await write(pad, 'withdrawUnsold');
    expect(await read(sale, 'balanceOf', [pad.address])).toBe(200n * SCALE);
    await write(pad, 'claim', [], buyer);
    expect(await read(sale, 'balanceOf', [buyer])).toBe(200n * SCALE);
    expect(await read(payment, 'balanceOf', [pad.address])).toBe(0n);
    await expect(write(pad, 'claim', [], buyer)).rejects.toThrow();
    await expect(write(pad, 'withdrawProceeds')).rejects.toThrow();
  }, 30000);
  it('returns full payment when soft cap fails and prevents duplicate refunds', async () => {
    const { pad, payment, sale, start, end } = await fixture();
    await write(sale, 'transfer', [pad.address, 2000n * SCALE]);
    await advanceTo(start);
    await write(pad, 'contribute', [50n * SCALE], buyer);
    await advanceTo(end);
    await expect(write(pad, 'withdrawProceeds')).rejects.toThrow();
    await write(pad, 'refund', [], buyer);
    expect(await read(payment, 'balanceOf', [buyer])).toBe(1000n * SCALE);
    await expect(write(pad, 'refund', [], buyer)).rejects.toThrow();
    await write(pad, 'withdrawUnsold');
    expect(await read(sale, 'balanceOf', [pad.address])).toBe(0n);
  }, 30000);
  it('allows cancellation refunds without letting the owner take escrow', async () => {
    const { pad, payment, sale, start } = await fixture();
    await write(sale, 'transfer', [pad.address, 2000n * SCALE]);
    await advanceTo(start);
    await write(pad, 'contribute', [150n * SCALE], buyer);
    await expect(write(pad, 'cancel', [], buyer)).rejects.toThrow();
    await write(pad, 'cancel');
    await expect(write(pad, 'contribute', [1n * SCALE], buyer)).rejects.toThrow();
    await expect(write(pad, 'withdrawProceeds')).rejects.toThrow();
    await write(pad, 'refund', [], buyer);
    expect(await read(payment, 'balanceOf', [buyer])).toBe(1000n * SCALE);
  }, 30000);
});
