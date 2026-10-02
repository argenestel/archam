import manifest from '../../deployments/arc-mainnet.json';
import { ArrowLeftRight, Landmark, ShieldAlert } from 'lucide-react';
import { Notice } from '../components/ui';
import { addressUrl, activeChain, client } from '../lib/arc';
import { signingEnabled } from '../lib/appkit';
import { useQuery } from '../lib/query';
import { useWallet } from '../lib/wallet';

export default function Mainnet() {
  const { address, gas } = useWallet();
  const network = useQuery(
    'mainnet:connection',
    async () => {
      const [id, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
      if (id !== activeChain.id) throw new Error('RPC chain mismatch. Do not transact.');
      return { block: block.toString() };
    },
    15_000,
  );
  const protocols = [
    {
      title: 'Swap',
      icon: ArrowLeftRight,
      href: '#/swap',
      description:
        'USDC, EURC and cirBTC through Circle App Kit. Live quotes, explicit review, wallet signing.',
    },
    {
      title: 'Earn',
      icon: Landmark,
      href: '#/lend',
      description:
        'Discover Morpho USDC/EURC vaults, compare variable yields, deposit and withdraw.',
    },
    {
      title: 'Borrow',
      icon: ShieldAlert,
      href: '#/borrow',
      description:
        'Discover Morpho markets. cirBTC-backed USDC/EURC borrowing, repayment and collateral management.',
    },
  ];
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Arc mainnet</h1>
          <p>
            Swap, earn and borrow from your wallet. Existing third-party protocols; no Orbit launch
            contracts.
          </p>
        </div>
        <span className="chip">Chain {activeChain.id}</span>
      </div>
      <Notice tone="warn">
        Mainnet beta — real funds. Integrations are not a safety endorsement. Keep USDC for gas,
        start small, and review every wallet request. Never send funds to Orbit or a router
        directly.
      </Notice>
      {network.error && <Notice tone="error">{network.error}</Notice>}
      <div className="row wrap">
        <span className="chip">
          {network.data ? `Live block ${network.data.block}` : 'Checking RPC…'}
        </span>
        <span className="chip">
          {signingEnabled ? 'Wallet execution enabled' : 'Read-only build'}
        </span>
        {address && gas !== undefined && <span className="chip">Wallet connected</span>}
        <a className="link" href="#/risks">
          Risks
        </a>
        <a className="link" href="#/portfolio">
          Your balances & activity
        </a>
      </div>
      <div className="protocol-grid">
        {protocols.map((p) => (
          <a className="card card-pad stack protocol-card" key={p.title} href={p.href}>
            <p.icon size={24} />
            <h2>{p.title}</h2>
            <p className="muted">{p.description}</p>
            <span className="link">Open {p.title.toLowerCase()} →</span>
          </a>
        ))}
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Deployment directory</h2>
            <p className="faint">
              Recorded verification: {manifest.verifiedAt}. Snapshots are not live liquidity checks.
            </p>
          </div>
        </div>
        <div className="card-pad">
          <p className="muted">
            Circle routes swaps; Uniswap v4’s PoolManager below is not a standalone router. Orbit
            has no mainnet V2 router or launch deployment. No verified Aave adapter is configured.
            Unintegrated contracts are listed for reference only.
          </p>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Address</th>
                <th>Recorded check</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(manifest.contracts).map(([name, c]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    <a
                      className="link mono"
                      href={addressUrl(c.address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.address}
                    </a>
                  </td>
                  <td>
                    {'runtimeCodeHash' in c ? 'Runtime hash recorded' : 'Token decimals checked'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="faint">
        Discovery covers Circle-supported markets and this recorded directory, not every contract on
        Arc. Availability depends on wallet capabilities, region, provider service, and liquidity.
        Vault funds stay in the chosen protocol, not in Orbit.
      </p>
    </div>
  );
}
