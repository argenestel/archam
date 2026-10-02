import { createPublicClient, http, keccak256, encodeAbiParameters, getAddress } from 'viem';

/**
 * Uniswap V4 probe script for Arc mainnet (chain 5042)
 * Discovers pools and quotes across token pairs.
 */

// Chain config
const ARC_MAINNET = {
  id: 5042,
  name: 'Arc Mainnet',
  rpcUrl: 'https://rpc.mainnet.arc.io',
};

// Verified V4 addresses
const V4_ADDRESSES = {
  StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  V4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
};

// Token addresses (6 or 8 or 18 decimals)
const TOKENS = {
  USDC: { address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  EURC: { address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
  cirBTC: { address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
  WETH: { address: '0x128cC466B61f542da60c70e3aA11c10e19B84EDB', decimals: 18 },
};

// Standard Uniswap V4 fee tiers
const STANDARD_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
];

/**
 * Create a viem PublicClient for Arc mainnet.
 */
function createArcClient() {
  return createPublicClient({
    chain: ARC_MAINNET,
    transport: http(ARC_MAINNET.rpcUrl),
  });
}

/**
 * Sort two addresses numerically (lowercase compare).
 */
function sortAddresses(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

/**
 * Compute poolId as keccak256(abi.encode(PoolKey)).
 */
function computePoolId(currency0, currency1, fee, tickSpacing, hooks) {
  const encoded = encodeAbiParameters(
    [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
    [
      getAddress(currency0),
      getAddress(currency1),
      fee,
      tickSpacing,
      hooks,
    ]
  );
  return keccak256(encoded);
}

/**
 * Probe all standard tiers for a token pair.
 * Returns pool data: poolId, liquidity, sqrtPriceX96.
 */
async function probePoolsForPair(client, tokenAName, tokenAAddr, tokenBName, tokenBAddr) {
  console.log(`\n=== ${tokenAName} / ${tokenBName} ===`);

  const [currency0, currency1] = sortAddresses(tokenAAddr, tokenBAddr);

  for (const tier of STANDARD_TIERS) {
    const poolId = computePoolId(currency0, currency1, tier.fee, tier.tickSpacing, '0x' + '0'.repeat(40));

    // StateView ABI
    const getStateViewLiquidity = {
      inputs: [{ name: 'id', type: 'bytes32' }],
      name: 'getLiquidity',
      outputs: [{ type: 'uint128' }],
      stateMutability: 'view',
      type: 'function',
    };

    const getStateViewSlot0 = {
      inputs: [{ name: 'id', type: 'bytes32' }],
      name: 'getSlot0',
      outputs: [
        { name: 'sqrtPriceX96', type: 'uint160' },
        { name: 'tick', type: 'int24' },
        { name: 'protocolFee', type: 'uint24' },
        { name: 'hookFee', type: 'uint24' },
      ],
      stateMutability: 'view',
      type: 'function',
    };

    try {
      const liquidity = await client.readContract({
        address: V4_ADDRESSES.StateView,
        abi: [getStateViewLiquidity],
        functionName: 'getLiquidity',
        args: [poolId],
      });

      const slotData = await client.readContract({
        address: V4_ADDRESSES.StateView,
        abi: [getStateViewSlot0],
        functionName: 'getSlot0',
        args: [poolId],
      });

      const sqrtPriceX96 = slotData[0];

      console.log(
        `  Fee ${tier.fee.toString().padStart(5)}, TickSpacing ${tier.tickSpacing.toString().padStart(3)} | poolId: ${poolId} | liquidity: ${liquidity} | sqrtPriceX96: ${sqrtPriceX96}`
      );

      // Try to quote if pool has liquidity
      if (liquidity > 0n && sqrtPriceX96 > 0n) {
        await tryQuote(client, tokenAName, tokenAAddr, tokenBName, tokenBAddr, currency0, currency1, tier, poolId);
      }
    } catch (err) {
      console.log(`  Fee ${tier.fee.toString().padStart(5)}, TickSpacing ${tier.tickSpacing.toString().padStart(3)} | Error: ${err.shortMessage || err.message}`);
    }
  }
}

/**
 * Attempt to quote 1 unit of the input token on a discovered pool.
 */
async function tryQuote(
  client,
  tokenInName,
  tokenInAddr,
  tokenOutName,
  tokenOutAddr,
  currency0,
  currency1,
  tier,
  poolId
) {
  const zeroForOne = tokenInAddr.toLowerCase() < tokenOutAddr.toLowerCase();
  const tokenInDecimals = TOKENS[tokenInName].decimals;
  const amountIn = BigInt(10) ** BigInt(tokenInDecimals); // 1 unit

  const quoteABI = {
    inputs: [
      {
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
        name: 'poolKey',
        type: 'tuple',
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'exactAmount', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  };

  try {
    const result = await client.simulateContract({
      account: '0x0000000000000000000000000000000000000000',
      address: V4_ADDRESSES.V4Quoter,
      abi: [quoteABI],
      functionName: 'quoteExactInputSingle',
      args: [
        {
          currency0,
          currency1,
          fee: tier.fee,
          tickSpacing: tier.tickSpacing,
          hooks: '0x' + '0'.repeat(40),
        },
        zeroForOne,
        amountIn,
        '0x',
      ],
    });

    const amountOut = result.result[0];
    const gasEstimate = result.result[1];
    console.log(`    Quote: 1 ${tokenInName} -> ${(Number(amountOut) / 10 ** TOKENS[tokenOutName].decimals).toFixed(6)} ${tokenOutName} (gas: ${gasEstimate})`);
  } catch (err) {
    console.log(`    Quote failed: ${err.shortMessage || err.message}`);
  }
}

/**
 * Main: probe token pairs.
 */
async function main() {
  const client = createArcClient();

  console.log(`Arc Mainnet V4 Pool Probe`);
  console.log(`RPC: ${ARC_MAINNET.rpcUrl}`);

  // Probe token pairs
  const pairs = [
    ['USDC', TOKENS.USDC.address, 'EURC', TOKENS.EURC.address],
    ['USDC', TOKENS.USDC.address, 'cirBTC', TOKENS.cirBTC.address],
    ['USDC', TOKENS.USDC.address, 'WETH', TOKENS.WETH.address],
    ['EURC', TOKENS.EURC.address, 'cirBTC', TOKENS.cirBTC.address],
  ];

  for (const [tokenAName, tokenAAddr, tokenBName, tokenBAddr] of pairs) {
    await probePoolsForPair(client, tokenAName, tokenAAddr, tokenBName, tokenBAddr);
  }

  console.log('\nProbe complete.');
}

main().catch(console.error);
