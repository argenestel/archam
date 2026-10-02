import { activeChain, isTestnet } from '../lib/arc';

const risks: [string, string][] = [
  [
    'Launch tokens can go to zero',
    'Anyone can launch a token, including copies of real projects. Prices move only because people buy and sell; nobody guarantees a buyer. Only spend what you can lose entirely.',
  ],
  [
    'Mofu’s launch contract is unaudited',
    'It has automated tests and an internal review, but no independent audit yet. A bug could lock or lose the USDC held by a curve.',
  ],
  [
    'Graduation is permanent',
    'When a curve sells out, its USDC and remaining tokens become a Uniswap pool whose liquidity tokens are burned. Nobody, including Mofu, can withdraw that liquidity, and later trades happen at pool prices.',
  ],
  [
    'Lending carries liquidation and protocol risk',
    'Vault yields are variable and come from Morpho markets curated by third parties. Borrowers can be liquidated if collateral prices fall. Mofu does not control those vaults.',
  ],
  [
    'USDC is also your gas',
    'On Arc, the USDC you trade is the same balance that pays transaction fees. Keep a small amount back so you can always move your funds.',
  ],
  [
    'Circle’s USDC rules apply',
    'USDC and EURC can be frozen for addresses on Circle’s blocklist. Transfers to or from a blocked address fail.',
  ],
  [
    'Points have no value',
    'Points are computed from public trading volume. They are not a token, are not redeemable, and promise nothing.',
  ],
  [
    'Agents act with your authority',
    'If you connect an AI agent to a wallet through Mofu’s fund-manager server, it can move that wallet’s funds within the limits you set in its policy. Use a separate wallet with only what you are willing to delegate.',
  ],
];

export default function Risks() {
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>Risks</h1>
          <p>
            Read this before you trade on {activeChain.name}.
            {isTestnet && ' Everything here uses test assets with no value.'}
          </p>
        </div>
      </div>
      <dl style={{ margin: 0, display: 'grid', gap: 22 }}>
        {risks.map(([title, body]) => (
          <div key={title}>
            <dt style={{ fontWeight: 600, fontSize: 16 }}>{title}</dt>
            <dd style={{ margin: '4px 0 0', color: 'var(--ink-2)', maxWidth: '65ch' }}>{body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
