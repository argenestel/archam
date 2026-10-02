import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, parseUnits, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile, compileMorpho } from '../scripts/check-contracts.mjs';

const artifact = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const USDC = (v) => parseUnits(String(v), 6);
const ETHER = (v) => parseUnits(String(v), 18);
let provider, pub, wallet, owner, alice, bob, compiled, morphoArtifacts;
let usdc, weth, factory, router, launch;

beforeAll(async () => {
  compiled = compile({
    'contracts/src/TestnetToken.sol': {
      content: fs.readFileSync('contracts/src/TestnetToken.sol', 'utf8'),
    },
  });
  morphoArtifacts = await compileMorpho();
  provider = ganache.provider({
    logging: { quiet: true },
    chain: { hardfork: 'shanghai', allowUnlimitedContractSize: false },
    miner: { blockGasLimit: 60_000_000 },
    wallet: { totalAccounts: 3, defaultBalance: 1000 },
  });
  const chain = defineChain({
    id: 1337,
    name: 'Local EVM',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://localhost'] } },
  });
  pub = createPublicClient({ chain, transport: custom(provider), cacheTime: 0 });
  wallet = createWalletClient({ chain, transport: custom(provider) });
  [owner, alice, bob] = await wallet.getAddresses();
  const token = compiled['contracts/src/TestnetToken.sol'].TestnetToken;
  usdc = await deploy(token, ['USD', 'USDC', 6, USDC(10_000_000), USDC(10_000)]);
  for (const who of [alice, bob]) await write(usdc, 'faucet', [], who);
  weth = await deploy(artifact('node_modules/@uniswap/v2-periphery/build/WETH9.json'));
  factory = await deploy(artifact('node_modules/@uniswap/v2-core/build/UniswapV2Factory.json'), [
    owner,
  ]);
  router = await deploy(
    artifact('node_modules/@uniswap/v2-periphery/build/UniswapV2Router02.json'),
    [factory.address, weth.address],
  );
  launch = await deploy(compiled['contracts/src/MofuLaunch.sol'].MofuLaunch, [
    usdc.address,
    router.address,
    USDC(20),
    100n,
    owner,
  ]);
  await write(launch, 'setLaunchesPaused', [false]);
}, 120000);
afterAll(async () => {
  await provider?.disconnect();
});

const key = (who) => privateKeyToAccount(provider.getInitialAccounts()[who.toLowerCase()].secretKey);
async function deploy(a, args = []) {
  const bytecode = a.bytecode ? a.bytecode : `0x${a.evm.bytecode.object}`;
  const hash = await wallet.deployContract({
    account: key(owner),
    abi: a.abi,
    bytecode: bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`,
    args,
    gas: 12_000_000n,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe('success');
  return { address: receipt.contractAddress, abi: a.abi };
}
async function write(contract, functionName, args = [], account = owner) {
  const { request, result } = await pub.simulateContract({ ...contract, functionName, args, account });
  const hash = await wallet.writeContract({ ...request, account: key(account), gas: 8_000_000n });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe('success');
  return result;
}
const read = (contract, functionName, args = []) => pub.readContract({ ...contract, functionName, args });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600);
const tokenAt = (address) => ({ address, abi: compiled['contracts/src/MofuToken.sol'].MofuToken.abi });

async function newToken(symbol, by = alice) {
  const address = await write(launch, 'launch', [`${symbol} coin`, symbol, '', 'test', 0n, 0n], by);
  return tokenAt(address);
}

describe('MofuLaunch curve', { timeout: 60000 }, () => {
  it('launches, buys and sells with fees, onchain feed and positions', async () => {
    const t = await newToken('ONE');
    expect(await read(launch, 'tokenCount')).toBe(1n);
    await write(usdc, 'approve', [launch.address, USDC(5)], alice);
    const [quoted] = await read(launch, 'quoteBuy', [t.address, USDC(5)]);
    await write(launch, 'buy', [t.address, USDC(5), quoted, deadline()], alice);
    const bal = await read(t, 'balanceOf', [alice]);
    expect(bal).toBe(quoted);
    // first 5 USDC (4.95 net) into a 20 USDC virtual reserve buys ~19.8% of 1.073B virtual tokens
    expect(bal > ETHER(210_000_000) && bal < ETHER(215_000_000)).toBe(true);
    const sellQuote = await read(launch, 'quoteSell', [t.address, bal]);
    await expect(
      write(launch, 'sell', [t.address, bal, sellQuote + 1n, deadline()], alice),
    ).rejects.toThrow();
    const before = await read(usdc, 'balanceOf', [alice]);
    await write(launch, 'sell', [t.address, bal, sellQuote, deadline()], alice);
    const got = (await read(usdc, 'balanceOf', [alice])) - before;
    expect(got).toBe(sellQuote);
    // two 1% fees: round trip returns ~98%
    expect(got >= USDC(4.89) && got < USDC(5)).toBe(true);
    const [page] = await read(launch, 'tradesPage', [t.address, 0n, 10n]);
    expect(page.map((x) => x.isBuy)).toEqual([false, true]);
    const stats = await read(launch, 'stats', [alice]);
    expect(stats[3]).toBe(2); // trades
    const [held, positions] = await read(launch, 'positionsOf', [alice]);
    expect(held).toEqual([t.address]);
    expect(positions[0].spent).toBe(USDC(5));
    // launcher keeps exactly the curve's real quote plus fees
    const curve = await read(launch, 'curves', [t.address]);
    expect(await read(usdc, 'balanceOf', [launch.address])).toBe(
      curve[6] + (await read(launch, 'feesAccrued')),
    );
  });

  it('locks transfers until graduation', async () => {
    const t = await newToken('LOCK');
    await write(usdc, 'approve', [launch.address, USDC(1)], alice);
    await write(launch, 'buy', [t.address, USDC(1), 1n, deadline()], alice);
    await expect(write(t, 'transfer', [bob, 1n], alice)).rejects.toThrow();
  });

  it('graduates into a burned Uniswap V2 pool even after a pair grief attempt', async () => {
    const t = await newToken('GRAD');
    // Attacker pre-creates the pair, donates quote and syncs reserves to (0, x).
    await write(factory, 'createPair', [t.address, usdc.address], bob);
    const pairAddress = await read(factory, 'getPair', [t.address, usdc.address]);
    const pairAbi = artifact('node_modules/@uniswap/v2-core/build/UniswapV2Pair.json').abi;
    const pair = { address: pairAddress, abi: pairAbi };
    await write(usdc, 'transfer', [pairAddress, USDC(1)], bob);
    await write(pair, 'sync', [], bob);
    await write(usdc, 'approve', [launch.address, USDC(1000)], bob);
    const [, charged] = await read(launch, 'quoteBuy', [t.address, USDC(1000)]);
    // Graduation threshold is ~2.83x the virtual quote reserve plus fee.
    expect(charged > USDC(56) && charged < USDC(58)).toBe(true);
    const before = await read(usdc, 'balanceOf', [bob]);
    await write(launch, 'buy', [t.address, USDC(1000), 1n, deadline()], bob);
    expect(before - (await read(usdc, 'balanceOf', [bob]))).toBe(charged);
    const curve = await read(launch, 'curves', [t.address]);
    expect(curve[3]).toBe(true); // graduated
    expect(curve[10]).toBe(pairAddress);
    expect(await read(t, 'graduated')).toBe(true);
    expect(await read(t, 'balanceOf', [launch.address])).toBe(0n);
    const dead = '0x000000000000000000000000000000000000dEaD';
    expect((await read(pair, 'balanceOf', [dead])) > 0n).toBe(true);
    // curve price and pool price match within 2%
    const [r0, r1] = await read(pair, 'getReserves');
    const token0 = await read(pair, 'token0');
    const [tok, q] = token0.toLowerCase() === t.address.toLowerCase() ? [r0, r1] : [r1, r0];
    const poolPrice = (q * 10n ** 30n) / tok;
    const curvePrice = (curve[4] * 10n ** 30n) / curve[5];
    const diff = poolPrice > curvePrice ? poolPrice - curvePrice : curvePrice - poolPrice;
    expect(diff * 100n < curvePrice * 2n).toBe(true);
    // trading moves to the AMM; tokens become transferable
    await write(t, 'transfer', [alice, 1n], bob);
    await expect(write(launch, 'buy', [t.address, USDC(1), 1n, deadline()], bob)).rejects.toThrow();
    await write(t, 'approve', [router.address, maxUint256], bob);
    await write(
      router,
      'swapExactTokensForTokens',
      [ETHER(1_000_000), 1n, [t.address, usdc.address], bob, deadline()],
      bob,
    );
  });

  it('rejects bad metadata, expired deadlines and unknown tokens', async () => {
    await expect(write(launch, 'launch', ['', 'X', '', '', 0n, 0n], alice)).rejects.toThrow();
    await expect(
      write(launch, 'launch', ['Name', 'TOOLONGSYMBOL', '', '', 0n, 0n], alice),
    ).rejects.toThrow();
    const t = await newToken('EXP');
    await expect(write(launch, 'buy', [t.address, USDC(1), 1n, 1n], alice)).rejects.toThrow();
    await expect(write(launch, 'buy', [bob, USDC(1), 1n, deadline()], alice)).rejects.toThrow();
  });

  it('pays fees only to the fee recipient', async () => {
    const fees = await read(launch, 'feesAccrued');
    const before = await read(usdc, 'balanceOf', [owner]);
    await write(launch, 'withdrawFees', [], bob);
    expect((await read(usdc, 'balanceOf', [owner])) - before).toBe(fees);
    await expect(write(launch, 'setFeeRecipient', [bob], bob)).rejects.toThrow();
  });
});

describe('Morpho Blue market with testnet oracle', { timeout: 120000 }, () => {
  it('supplies, borrows within LLTV, repays and withdraws', async () => {
    const token = compiled['contracts/src/TestnetToken.sol'].TestnetToken;
    const eth = await deploy(token, ['ETH', 'tETH', 18, ETHER(1000), ETHER(10)]);
    await write(eth, 'faucet', [], alice);
    const morpho = await deploy(morphoArtifacts.Morpho, [owner]);
    const irm = await deploy(morphoArtifacts.AdaptiveCurveIrm, [morpho.address]);
    // 1 tETH = 2,500 USDC: 2500 * 1e36 * 1e6 / 1e18
    const oracle = await deploy(
      compiled['contracts/src/MofuTestnetOracle.sol'].MofuTestnetOracle,
      [2500n * 10n ** 24n, 86400n, 'tETH/USDC'],
    );
    const lltv = 860000000000000000n;
    await write(morpho, 'enableIrm', [irm.address]);
    await write(morpho, 'enableLltv', [lltv]);
    const params = {
      loanToken: usdc.address,
      collateralToken: eth.address,
      oracle: oracle.address,
      irm: irm.address,
      lltv,
    };
    await write(morpho, 'createMarket', [params]);
    await write(usdc, 'approve', [morpho.address, USDC(100_000)]);
    await write(morpho, 'supply', [params, USDC(100_000), 0n, owner, '0x']);
    await write(eth, 'approve', [morpho.address, ETHER(1)], alice);
    await write(morpho, 'supplyCollateral', [params, ETHER(1), alice, '0x'], alice);
    // 86% of 2,500 = 2,150 max
    await expect(
      write(morpho, 'borrow', [params, USDC(2151), 0n, alice, alice], alice),
    ).rejects.toThrow();
    await write(morpho, 'borrow', [params, USDC(1500), 0n, alice, alice], alice);
    // price crash makes the position liquidatable
    await write(oracle, 'setPrice', [1000n * 10n ** 24n]);
    await expect(write(morpho, 'borrow', [params, USDC(1), 0n, alice, alice], alice)).rejects.toThrow();
    await write(oracle, 'setPrice', [2500n * 10n ** 24n]);
    await write(usdc, 'approve', [morpho.address, USDC(1600)], alice);
    const id = await marketId(params);
    const position = await read(morpho, 'position', [id, alice]);
    await write(morpho, 'repay', [params, 0n, position[1], alice, '0x'], alice);
    await write(morpho, 'withdrawCollateral', [params, ETHER(1), alice, alice], alice);
    expect(await read(eth, 'balanceOf', [alice])).toBe(ETHER(10));
    await expect(write(oracle, 'setPrice', [1n], bob)).rejects.toThrow();
  });
});

async function marketId(p) {
  const { keccak256, encodeAbiParameters } = await import('viem');
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv],
    ),
  );
}
