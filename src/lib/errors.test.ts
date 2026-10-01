import { describe, expect, it } from 'vitest';
import { userFacingError } from './errors';
describe('user-facing errors', () => {
  it('hides raw RPC URLs and request bodies', () => {
    const result = userFacingError(
      new Error(
        'HTTP request failed. URL: https://rpc.testnet.arc.io/ Request body: eth_chainId Version: viem@2.57.1',
      ),
    );
    expect(result).toContain('Arc connection unavailable');
    expect(result).not.toContain('http');
    expect(result).not.toContain('eth_chainId');
  });
  it('recognizes nested fetch failures', () =>
    expect(
      userFacingError({
        shortMessage: 'Unknown RPC error',
        cause: new TypeError('Failed to fetch'),
      }),
    ).toContain('Arc connection unavailable'));
  it('explains wallet cancellation', () =>
    expect(userFacingError({ code: 4001 })).toContain('Request cancelled'));
  it('never promises that a submitted transaction did not happen on network errors', () =>
    expect(userFacingError(new Error('Failed to fetch'))).not.toContain('Nothing was submitted'));
  it('pauses for code integrity failures', () =>
    expect(
      userFacingError(new Error('TestUSDC bytecode differs from deployment manifest')),
    ).toContain('Trading is paused'));
});
