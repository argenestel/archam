import { useEffect, useState } from 'react';
import { ArrowUpRight, Blocks, Check, ShieldCheck } from 'lucide-react';
import { formatUnits, parseAbi, type Address } from 'viem';
import { arcTestnet, client } from './lib/arc';
import { deployment, deployedTokens } from './lib/deployed';
const poolAbi = parseAbi([
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
]);
export default function PoolContext({ connected }: { connected: boolean }) {
  const [snapshot, setSnapshot] = useState<{
    usdc: string;
    eth: string;
    block: string;
    time: number;
  }>();
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!connected) {
        setStale(true);
        return;
      }
      try {
        const address = deployment.pool.address as Address;
        const [reserves, token0, block] = await Promise.all([
          client.readContract({ address, abi: poolAbi, functionName: 'getReserves' }),
          client.readContract({ address, abi: poolAbi, functionName: 'token0' }),
          client.getBlockNumber(),
        ]);
        const usdcFirst = token0.toLowerCase() === deployedTokens[0].address.toLowerCase();
        if (!ignore) {
          setSnapshot({
            usdc: formatUnits(reserves[usdcFirst ? 0 : 1], 6),
            eth: formatUnits(reserves[usdcFirst ? 1 : 0], 18),
            block: block.toString(),
            time: Date.now(),
          });
          setStale(false);
        }
      } catch {
        if (!ignore) setStale(true);
      }
    }
    load();
    const timer = setInterval(load, 15000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [connected]);
  const fmt = (value: string) =>
    Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
  const ratio =
    snapshot && Number(snapshot.eth) > 0 ? Number(snapshot.usdc) / Number(snapshot.eth) : undefined;
  return (
    <aside className="pool-context">
      <section className="pool-snapshot">
        <div className="context-heading">
          <h3>Inside the pool</h3>
          <span className={`data-state ${!connected || stale ? 'offline' : ''}`}>
            <i />
            {!connected || stale ? 'Awaiting data' : 'Onchain'}
          </span>
        </div>
        <div className="pool-symbols" aria-hidden="true">
          <span className="live-coin usdc">$</span>
          <div className="pool-bridge">
            <i />
            <i />
            <i />
          </div>
          <span className="live-coin eth">♦</span>
        </div>
        <h4>tETH / tUSDC</h4>
        <p className="pool-ratio">
          {ratio !== undefined ? ratio.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
          <span>tUSDC per tETH</span>
        </p>
        <div className="reserve-list">
          <div>
            <span>
              <i className="reserve-dot usdc" />
              tUSDC reserve
            </span>
            <strong>{snapshot ? fmt(snapshot.usdc) : '—'}</strong>
          </div>
          <div>
            <span>
              <i className="reserve-dot eth" />
              tETH reserve
            </span>
            <strong>{snapshot ? fmt(snapshot.eth) : '—'}</strong>
          </div>
          <div>
            <span>Pool fee</span>
            <strong>0.30%</strong>
          </div>
        </div>
        <a
          className="pool-explorer"
          href={`${arcTestnet.blockExplorers.default.url}/address/${deployment.pool.address}`}
          target="_blank"
          rel="noreferrer"
        >
          Inspect pool on explorer <ArrowUpRight size={16} />
        </a>
        <p className="pool-data-note">
          {snapshot
            ? `${stale || !connected ? 'Last snapshot' : 'Updated'} ${new Date(snapshot.time).toLocaleTimeString()} · block ${snapshot.block}`
            : 'Reserves will appear when Arc reconnects.'}
        </p>
      </section>
      <section className="trade-guide">
        <div className="context-heading">
          <h3>Before you trade</h3>
          <ShieldCheck size={18} />
        </div>
        <ul>
          <li>
            <Check size={15} />
            <span>
              Connect to <strong>Arc testnet</strong>.
            </span>
          </li>
          <li>
            <Check size={15} />
            <span>Claim free tUSDC or tETH. Keep native testnet USDC for gas.</span>
          </li>
          <li>
            <Check size={15} />
            <span>Approve an exact amount, then review your minimum received.</span>
          </li>
        </ul>
        <div className="guide-foot">
          <Blocks size={16} />
          <span>Real transactions. Test assets only.</span>
        </div>
      </section>
    </aside>
  );
}
