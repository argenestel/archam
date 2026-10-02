import { expect, it } from 'vitest';
import { catalogVaults, curate } from './appkit';
const address = '0x000000000000000000000000000000000000beef';
const good = {
  vaultAddress: address,
  name: 'Example USDC vault',
  protocol: 'MORPHO',
  asset: 'USDC',
  status: 'active',
  currentApy: 0.04,
  totalDeposits: '500000',
  liquidity: '1000',
};
it('preserves warnings and inactive vaults for position visibility, while filtering malformed entries', () => {
  const vaults = catalogVaults([
    {
      ...good,
      status: 'paused',
      riskSignals: { warnings: [{ type: 'not_whitelisted' }], earnKitWarnings: ['Low liquidity'] },
    },
    { ...good, vaultAddress: 'bad' },
    { ...good, asset: 'FAKE' },
  ]);
  expect(vaults).toHaveLength(1);
  expect(vaults[0].warnings).toEqual(['not_whitelisted', 'Low liquidity']);
  expect(vaults[0].status).toBe('paused');
});
it('curation is separate from the full position catalog', () => {
  expect(curate([good])).toHaveLength(1);
  expect(
    curate([{ ...good, riskSignals: { warnings: [{ type: 'not_whitelisted' }] } }]),
  ).toHaveLength(0);
  expect(curate([{ ...good, status: 'paused' }])).toHaveLength(0);
});
