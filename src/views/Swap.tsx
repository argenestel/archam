import { type Address } from 'viem';
import { isTestnet } from '../lib/arc';
import { faucetAbi, faucetTokens } from '../lib/contracts';
import { useFaucetClaims } from '../lib/data';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';
import SmartSwap from './SmartSwap';

/** Candidate Uniswap V2 paths: direct, then through each hub asset. */
export function candidatePaths(from: Address, to: Address, hubs: Address[]): Address[][] {
  const paths: Address[][] = [[from, to]];
  for (const hub of hubs)
    if (hub.toLowerCase() !== from.toLowerCase() && hub.toLowerCase() !== to.toLowerCase()) paths.push([from, hub, to]);
  return paths;
}

export default function Swap() {
  return (
    <div className="center-col">
      <h1 style={{ font: '600 32px/1.1 var(--cond)' }}>Swap</h1>
      <SmartSwap />
      {isTestnet && <TestFunds />}
    </div>
  );
}

function TestFunds() {
  const { address, onArc } = useWallet();
  const claims = useFaucetClaims(address, faucetTokens);
  const { send, busy } = useTx();
  return (
    <section className="card card-pad" style={{ display: 'grid', gap: 12 }}>
      <div className="row between">
        <h3 style={{ fontSize: 15 }}>Test funds</h3>
        <a className="link" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
          USDC faucet
        </a>
      </div>
      <div className="row wrap">
        {faucetTokens.map((t) => (
          <button
            key={t.symbol}
            className="btn btn-ghost btn-sm"
            disabled={!address || !onArc || busy || claims.data?.[t.symbol] !== false}
            onClick={() => send(`Claim ${t.symbol}`, { address: t.address, abi: faucetAbi, functionName: 'faucet' })}
          >
            {claims.data?.[t.symbol] ? `${t.symbol} claimed` : `Claim ${t.symbol}`}
          </button>
        ))}
        {!address && (
          <button className="btn-quiet" onClick={openConnect}>
            Connect to claim
          </button>
        )}
      </div>
    </section>
  );
}
