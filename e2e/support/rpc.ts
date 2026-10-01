import type { Route } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import codes from '../fixtures/runtime-code.json' with { type: 'json' };
import manifest from '../../deployments/arc-testnet.json' with { type: 'json' };
const abi = parseAbi([
  'function totalRaised() view returns (uint256)',
  'function successful() view returns (bool)',
  'function cancelled() view returns (bool)',
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function claimed(address) view returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
  'function contributions(address) view returns (uint256)',
  'function allocations(address) view returns (uint256)',
]);
export type RpcState = {
  allowance?: bigint;
  receipt?: 'success' | 'unavailable' | 'reverted';
  receiptTo?: string;
};
export async function mockRpc(route: Route, state: RpcState = {}) {
  const body = route.request().postDataJSON();
  let result: unknown;
  switch (body.method) {
    case 'eth_chainId':
      result = '0x4cef52';
      break;
    case 'eth_getCode':
      result = codes[body.params[0].toLowerCase() as keyof typeof codes] || '0x';
      break;
    case 'eth_blockNumber':
      result = '0x3df0000';
      break;
    case 'eth_getBalance':
      result = '0x8ac7230489e80000';
      break;
    case 'eth_getBlockByNumber':
      result = {
        number: '0x3df0000',
        timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
        hash: `0x${'1'.repeat(64)}`,
        parentHash: `0x${'0'.repeat(64)}`,
        gasLimit: '0x1c9c380',
        gasUsed: '0x0',
        size: '0x1',
        difficulty: '0x0',
        transactions: [],
        uncles: [],
        extraData: '0x',
      };
      break;
    case 'eth_getTransactionReceipt':
      if (state.receipt === 'unavailable')
        return route.fulfill({
          json: {
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32000, message: 'Gateway unavailable' },
          },
        });
      result = {
        transactionHash: body.params[0],
        blockHash: `0x${'1'.repeat(64)}`,
        blockNumber: '0x3df0000',
        transactionIndex: '0x0',
        from: `0x${'2'.repeat(40)}`,
        to: state.receiptTo || manifest.contracts.TestUSDC.address,
        cumulativeGasUsed: '0xa6c2',
        gasUsed: '0xa6c2',
        effectiveGasPrice: '0x1',
        logs: [],
        logsBloom: `0x${'0'.repeat(512)}`,
        status: state.receipt === 'reverted' ? '0x0' : '0x1',
        type: '0x0',
        contractAddress: null,
      };
      break;
    case 'eth_call': {
      const call = decodeFunctionData({ abi, data: body.params[0].data });
      if (call.functionName === 'getAmountsOut') {
        const amount = call.args![0] as bigint;
        result = encodeFunctionResult({
          abi,
          functionName: 'getAmountsOut',
          result: [amount, (amount * 100n * 10n ** 18n * 997n) / (268432n * 10n ** 6n * 1000n)],
        });
      } else if (call.functionName === 'getReserves')
        result = encodeFunctionResult({
          abi,
          functionName: 'getReserves',
          result: [268432000000n, 100n * 10n ** 18n, 0],
        });
      else if (call.functionName === 'token0')
        result = encodeFunctionResult({
          abi,
          functionName: 'token0',
          result: manifest.contracts.TestUSDC.address as `0x${string}`,
        });
      else if (call.functionName === 'totalRaised')
        result = encodeFunctionResult({ abi, functionName: 'totalRaised', result: 10000000n });
      else if (call.functionName === 'balanceOf')
        result = encodeFunctionResult({
          abi,
          functionName: 'balanceOf',
          result:
            body.params[0].to.toLowerCase() === manifest.contracts.TestUSDC.address.toLowerCase()
              ? 1000_000000n
              : 10n ** 18n,
        });
      else if (call.functionName === 'allowance')
        result = encodeFunctionResult({
          abi,
          functionName: 'allowance',
          result: state.allowance || 0n,
        });
      else if (call.functionName === 'swapExactTokensForTokens')
        result = encodeFunctionResult({
          abi,
          functionName: 'swapExactTokensForTokens',
          result: [call.args![0] as bigint, 37100000000000000n],
        });
      else if (call.functionName === 'approve')
        result = encodeFunctionResult({ abi, functionName: 'approve', result: true });
      else if (call.functionName === 'contributions' || call.functionName === 'allocations')
        result = encodeFunctionResult({ abi, functionName: call.functionName, result: 0n });
      else result = encodeFunctionResult({ abi, functionName: call.functionName, result: false });
      break;
    }
    default:
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Unexpected mocked RPC method: ' + body.method },
        },
      });
  }
  return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
}
