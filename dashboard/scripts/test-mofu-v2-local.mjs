// Local-chain integration check for Mofu v2. Never signs on a public RPC.
// Start: anvil --chain-id 5042002 --port 8547
import { createPublicClient, createWalletClient, defineChain, http, parseUnits, parseEventLogs } from 'viem';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rpc = process.env.MOFU_LOCAL_RPC || 'http://127.0.0.1:8547';
const url = new URL(rpc);
assert(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', '[::1]'].includes(url.hostname)
  && !url.username && !url.password, 'RPC must use a literal loopback address without credentials');
const chain = defineChain({ id: 5042002, name: 'Local Arc simulation', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { fetchOptions: { redirect: 'error' } }) });
// Validate before creating a wallet or requesting any transaction. Disable redirects
// so a loopback endpoint cannot redirect signing requests to another host.
const guardedTransport = http(rpc, { fetchOptions: { redirect: 'error' } });
const guard = createPublicClient({ transport: guardedTransport });
const version = await guard.request({ method: 'web3_clientVersion' });
assert(/^anvil\b/i.test(version), 'RPC client must be Anvil');
assert.equal(await guard.getChainId(), chain.id, 'Unexpected local chain ID');
const wallet = createWalletClient({ chain, transport: guardedTransport });
const [account, trader] = await wallet.getAddresses();
assert(account && trader, 'Two unlocked Anvil accounts required');
const artifact = name => JSON.parse(readFileSync(new URL(`../../contracts/out/MofuV2.sol/${name}.json`, import.meta.url)));
const factoryArtifact = artifact('MofuFactoryV2');
const tokenArtifact = artifact('MofuTokenV2');
const poolArtifact = artifact('MofuPool');
// MockQuote uses 6 decimals here, matching the intended quote asset.
const erc20Artifact = JSON.parse(readFileSync(new URL('../../contracts/out/MofuV2.t.sol/MockQuote.json', import.meta.url)));
const mined = async hash => { const r = await client.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw Error('Reverted'); return r; };

const quote = (await mined(await wallet.deployContract({ account, abi: erc20Artifact.abi, bytecode: erc20Artifact.bytecode.object, args: [6] }))).contractAddress;
// Fund only local unlocked test accounts.
await mined(await wallet.writeContract({ account, address: quote, abi: erc20Artifact.abi, functionName: 'mint', args: [account, parseUnits('1000000', 6)] }));

const factory = (await mined(await wallet.deployContract({ account, abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode.object, args: [account] }))).contractAddress;
// startPrice 1 raw = 0.000001 quote per whole token; reward launch.
await mined(await wallet.writeContract({ account, address: factory, abi: factoryArtifact.abi, functionName: 'createToken', args: ['Soft Bun', 'SOFT', 'ipfs://soft.png', 'A soft local launch', quote, 1n, true] }));
const token = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'tokens', args: [0n] });
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const tr = (name, args = []) => read(token, tokenArtifact.abi, name, args);
const write = async (address, abi, functionName, args = [], sender = trader) => mined(await wallet.writeContract({ account: sender, address, abi, functionName, args }));
const balances = async () => Promise.all([read(quote, erc20Artifact.abi, 'balanceOf', [trader]), tr('balanceOf', [trader])]);
const reject = async (address, abi, functionName, args, reason) => assert.rejects(
  client.simulateContract({ account: trader, address, abi, functionName, args }),
  error => error.message.includes(reason), `${functionName} must reject with ${reason}`);
assert.equal(await read(factory, factoryArtifact.abi, 'tokenCount'), 1n);
assert.equal((await tr('creator')).toLowerCase(), account.toLowerCase());
assert.equal(await tr('totalSupply'), parseUnits('1000000', 18));
assert.equal(await tr('rewardMode'), true);
assert.equal(await tr('graduated'), false);
assert.equal(await tr('quoteDecimals'), 6);
await write(quote, erc20Artifact.abi, 'mint', [trader, parseUnits('1000000', 6)]);
await write(quote, erc20Artifact.abi, 'approve', [token, 2n ** 256n - 1n]);
await reject(token, tokenArtifact.abi, 'buy', [10000n, 0n], 'slippage');
const initialCost = await tr('buyCost', [10000n]);
let before = await balances();
await write(token, tokenArtifact.abi, 'buy', [10000n, initialCost]);
let after = await balances();
assert.deepEqual(after, [before[0] - initialCost, before[1] + parseUnits('10000', 18)]);
assert.equal(await tr('soldWhole'), 10000n);
await reject(token, tokenArtifact.abi, 'sell', [1000n, 2n ** 256n - 1n], 'slippage');
const gross = await tr('quoteSell', [1000n]);
const net = gross - gross / 100n;
before = await balances();
await write(token, tokenArtifact.abi, 'sell', [1000n, net]);
after = await balances();
assert.deepEqual(after, [before[0] + net, before[1] - parseUnits('1000', 18)]);
assert.equal(await tr('soldWhole'), 9000n);

const curve = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'curveSupplyWhole' });
const remaining = curve - await tr('soldWhole');
const seed = await tr('curveRaised') + await tr('quoteBuy', [remaining]);
const cost = await tr('buyCost', [remaining]);
const graduation = await write(token, tokenArtifact.abi, 'buy', [remaining, cost]);
if (!await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'graduated' })) throw Error('Not graduated');
const pool = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'pool' });
const [q, t] = await client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'reserves' });
if (q === 0n || t === 0n) throw Error('Pool not seeded');
assert.equal(q, seed);
assert.equal(t, await tr('liquidityReserveWhole') * 10n ** 18n);
assert.equal(await read(pool, poolArtifact.abi, 'locked'), true);
assert.equal(await tr('curveRaised'), 0n);
const events = parseEventLogs({ abi: tokenArtifact.abi, logs: graduation.logs.filter(log => log.address.toLowerCase() === token.toLowerCase()), eventName: 'Graduated' });
assert.equal(events.length, 1);
assert.deepEqual(events[0].args, { pool, quoteSeed: q, tokenSeed: t });
const lockedEvents = parseEventLogs({ abi: poolArtifact.abi, logs: graduation.logs.filter(log => log.address.toLowerCase() === pool.toLowerCase()), eventName: 'Locked' });
assert.equal(lockedEvents.length, 1);
assert.deepEqual(lockedEvents[0].args, { quoteAmount: q, tokenAmount: t });
assert.equal(await tr('balanceOf', [token]), 0n);
for (const [name, args] of [['quoteBuy', [1n]], ['quoteSell', [1n]], ['buyCost', [1n]], ['buy', [1n, cost]], ['sell', [1n, 0n]]]) {
  await reject(token, tokenArtifact.abi, name, args, 'graduated');
}
await reject(pool, poolArtifact.abi, 'sync', [], 'locked');

// Swap both ways through the locked pool, as the main widget will.
await write(quote, erc20Artifact.abi, 'approve', [pool, 2n ** 256n - 1n]);
await write(token, tokenArtifact.abi, 'approve', [pool, 2n ** 256n - 1n]);
const buy = await client.simulateContract({ account: trader, address: pool, abi: poolArtifact.abi, functionName: 'swapQuoteForToken', args: [parseUnits('1', 6), 0n] });
await reject(pool, poolArtifact.abi, 'swapQuoteForToken', [parseUnits('1', 6), buy.result + 1n], 'slippage');
before = await balances();
await mined(await wallet.writeContract(buy.request));
const out = buy.result;
assert.deepEqual(await balances(), [before[0] - parseUnits('1', 6), before[1] + out]);
assert.deepEqual(await read(pool, poolArtifact.abi, 'reserves'), [q + 990000n, t - out]);
const sell = await client.simulateContract({ account: trader, address: pool, abi: poolArtifact.abi, functionName: 'swapTokenForQuote', args: [out, 0n] });
await reject(pool, poolArtifact.abi, 'swapTokenForQuote', [out, sell.result + 1n], 'slippage');
before = await balances();
await mined(await wallet.writeContract(sell.request));
const back = sell.result;
assert.deepEqual(await balances(), [before[0] + back, before[1] - out]);
const sellGross = (q + 990000n) - ((q + 990000n) * (t - out)) / t;
assert.deepEqual(await read(pool, poolArtifact.abi, 'reserves'), [q + 990000n - sellGross, t]);
if (back === 0n) throw Error('Pool sell failed');

// A reward launch accrues claimable fees for holders.
// claim() settles lazy accrual, unlike the withdrawable mapping getter.
const claim = await client.simulateContract({ account: trader, address: token, abi: tokenArtifact.abi, functionName: 'claim' });
const waiting = claim.result;
assert(waiting > 0n);
before = await balances();
const rewardPoolBefore = await tr('rewardPool');
await mined(await wallet.writeContract(claim.request));
assert.deepEqual(await balances(), [before[0] + waiting, before[1]]);
assert.equal(await tr('withdrawable', [trader]), 0n);
assert.equal(await tr('rewardPool'), rewardPoolBefore - waiting);
await reject(token, tokenArtifact.abi, 'claim', [], 'nothing');
console.log(JSON.stringify({ rpc, client: version, chainId: chain.id, signer: 'local unlocked Anvil test account only; actual deployment signer missing', quote, factory, token, pool, curve: curve.toString(), poolSeed: { quote: q.toString(), token: t.toString() }, swapOut: out.toString(), swapBack: back.toString(), claimed: waiting.toString(), result: 'PASS: launch, curve buy/sell, graduation event, locked seeded pool, swap balances/reserves, slippage, curve closure, reward claim' }));
