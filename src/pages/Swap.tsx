import { useMemo, useState } from 'react';
import { ArrowDownUp, ChevronDown, Droplets, Settings2 } from 'lucide-react';
import { formatUnits, type Address } from 'viem';
import Dialog from '../components/Dialog';
import { ActionButton, AmountBox, Avatar, Notice } from '../components/ui';
import { activeChain, client, isTestnet } from '../lib/arc';
import {
  USDC,
  baseTokens,
  deployments,
  faucetAbi,
  faucetTokens,
  routerAbi,
  type Token,
} from '../lib/contracts';
import { useBalances, useFaucetClaims, useLaunches } from '../lib/data';
import { deadline, formatAmount, tryParse } from '../lib/format';
import { withSlippage } from '../lib/math';
import { useQuery } from '../lib/query';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';
import { UsdcMark } from './TokenPage';
import StableSwap from './StableSwap';
import SmartSwap from './SmartSwap';

const TokenIcon = ({ token, size = 24 }: { token: Token; size?: number }) =>
  token.kind === 'circle' && token.symbol === 'USDC' ? (
    <UsdcMark />
  ) : (
    <Avatar seed={token.address} size={size} round />
  );

/** Candidate Uniswap V2 paths: direct, then through each hub asset. */
export function candidatePaths(from: Address, to: Address, hubs: Address[]): Address[][] {
  const paths: Address[][] = [[from, to]];
  for (const hub of hubs)
    if (hub.toLowerCase() !== from.toLowerCase() && hub.toLowerCase() !== to.toLowerCase())
      paths.push([from, hub, to]);
  return paths;
}

export default function Swap() {
  const { address } = useWallet();
  const launches = useLaunches();
  const tokens = useMemo<Token[]>(
    () => [
      ...baseTokens,
      ...(launches.data ?? [])
        .filter((l) => l.graduated)
        .map((l) => ({
          symbol: l.symbol,
          name: l.name,
          address: l.address,
          decimals: 18,
          kind: 'launch' as const,
        })),
    ],
    [launches.data],
  );
  const [fromSym, setFrom] = useState(isTestnet ? 'tUSDC' : 'USDC');
  const [toSym, setTo] = useState(isTestnet ? 'tETH' : 'EURC');
  const from = tokens.find((t) => t.symbol === fromSym) ?? tokens[0];
  const to = tokens.find((t) => t.symbol === toSym) ?? tokens[1] ?? tokens[0];
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const [picker, setPicker] = useState<'from' | 'to'>();
  const [settings, setSettings] = useState(false);
  const [mode, setMode] = useState<'best' | 'stable' | 'pools'>('best');
  const balances = useBalances(address, tokens);
  const input = tryParse(amount, from.decimals);
  const router = deployments.router;
  const quote = useQuery(
    router && input && from.address !== to.address
      ? `swap:${from.address}:${to.address}:${input}`
      : null,
    async () => {
      const hubs = baseTokens.filter((t) => t.kind !== 'launch').map((t) => t.address);
      const results = await Promise.all(
        candidatePaths(from.address, to.address, hubs).map((path) =>
          client
            .readContract({
              address: router!,
              abi: routerAbi,
              functionName: 'getAmountsOut',
              args: [input, path],
            })
            .then((amounts) => ({ path, out: amounts.at(-1)! }))
            .catch(() => undefined),
        ),
      );
      const best = results.filter(Boolean).sort((a, b) => (b!.out > a!.out ? 1 : -1))[0];
      if (!best || best.out === 0n) throw new Error('No liquidity route between these tokens.');
      return { ...best, quotedAt: Date.now() };
    },
    10_000,
  );
  const fromBalance = balances.data?.[from.address.toLowerCase()];
  const toBalance = balances.data?.[to.address.toLowerCase()];
  const q = quote.data;
  const min = q ? withSlippage(q.out, slippage) : 0n;
  if (!router)
    return (
      <div className="center-col">
        <h1 style={{ font: '600 32px/1.1 var(--cond)' }}>Swap</h1>
        <SmartSwap />
      </div>
    );
  return (
    <div className="center-col">
      <div className="row between">
        <h1 style={{ font: '600 32px/1.1 var(--cond)' }}>Swap</h1>
        {mode === 'pools' && (
          <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Swap settings">
            <Settings2 size={18} />
          </button>
        )}
      </div>
      <div className="tabs" role="group" aria-label="Swap venue" style={{ width: 'fit-content' }}>
        <button aria-pressed={mode === 'best'} onClick={() => setMode('best')}>
          Best price
        </button>
        <button aria-pressed={mode === 'stable'} onClick={() => setMode('stable')}>
          USDC and EURC
        </button>
        <button aria-pressed={mode === 'pools'} onClick={() => setMode('pools')}>
          Mofu pools
        </button>
      </div>
      {mode === 'best' ? (
        <SmartSwap />
      ) : mode === 'stable' ? (
        <StableSwap />
      ) : (
        <>
          <section className="card trade-panel">
            <AmountBox
              label="You pay"
              value={amount}
              onChange={setAmount}
              decimals={from.decimals}
              balance={fromBalance}
              onMax={
                fromBalance ? () => setAmount(formatUnits(fromBalance, from.decimals)) : undefined
              }
              token={
                <button
                  className="token-tag"
                  onClick={() => setPicker('from')}
                  aria-label={`Pay with ${from.symbol}. Change token`}
                >
                  <TokenIcon token={from} /> {from.symbol} <ChevronDown size={14} />
                </button>
              }
            />
            <div className="swap-flip">
              <button
                aria-label="Reverse direction"
                onClick={() => {
                  setFrom(to.symbol);
                  setTo(from.symbol);
                  setAmount('');
                }}
              >
                <ArrowDownUp size={16} />
              </button>
            </div>
            <AmountBox
              label="You receive"
              value={q ? formatAmount(q.out, to.decimals, 6) : ''}
              readOnly
              decimals={to.decimals}
              balance={toBalance}
              token={
                <button
                  className="token-tag"
                  onClick={() => setPicker('to')}
                  aria-label={`Receive ${to.symbol}. Change token`}
                >
                  <TokenIcon token={to} /> {to.symbol} <ChevronDown size={14} />
                </button>
              }
            />
            {q && (
              <dl className="kv">
                <div>
                  <dt>Route</dt>
                  <dd>
                    {q.path
                      .map(
                        (a) =>
                          tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ??
                          '?',
                      )
                      .join(' → ')}
                  </dd>
                </div>
                <div>
                  <dt>Minimum received</dt>
                  <dd>
                    {formatAmount(min, to.decimals, 6)} {to.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Slippage tolerance</dt>
                  <dd>{slippage / 100}%</dd>
                </div>
                <div>
                  <dt>Pool fee</dt>
                  <dd>0.3% per hop</dd>
                </div>
              </dl>
            )}
            {quote.error && (
              <p className="down" style={{ fontSize: 13 }}>
                {quote.error}
              </p>
            )}
            <ActionButton
              label="Swap"
              onConnect={openConnect}
              disabledReason={
                from.address === to.address
                  ? 'Select two different tokens'
                  : !input
                    ? 'Enter an amount'
                    : fromBalance !== undefined && input > fromBalance
                      ? `Insufficient ${from.symbol}`
                      : !q
                        ? quote.error
                          ? 'No route'
                          : 'Fetching quote…'
                        : undefined
              }
              approve={{ token: from, spender: router, amount: input }}
              request={
                q && address
                  ? {
                      address: router,
                      abi: routerAbi,
                      functionName: 'swapExactTokensForTokens',
                      args: [input, min, q.path, address, deadline(600)],
                    }
                  : undefined
              }
              onDone={() => setAmount('')}
            />
          </section>
        </>
      )}
      {isTestnet && <TestFunds />}
      {picker && (
        <Dialog title="Select a token" close={() => setPicker(undefined)}>
          <div className="dialog-body" style={{ gap: 2 }}>
            {tokens.map((t) => (
              <button
                key={t.address}
                className="option"
                onClick={() => {
                  if (picker === 'from') {
                    if (t.symbol === to.symbol) setTo(from.symbol);
                    setFrom(t.symbol);
                  } else {
                    if (t.symbol === from.symbol) setFrom(to.symbol);
                    setTo(t.symbol);
                  }
                  setAmount('');
                  setPicker(undefined);
                }}
              >
                <TokenIcon token={t} size={32} />
                <span className="grow">
                  <b>{t.symbol}</b>
                  <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                    {t.name}
                    {t.kind === 'test'
                      ? ', test asset'
                      : t.kind === 'launch'
                        ? ', graduated launch'
                        : ''}
                  </span>
                </span>
                <span className="mono muted" style={{ fontSize: 13 }}>
                  {balances.data
                    ? formatAmount(balances.data[t.address.toLowerCase()] ?? 0n, t.decimals, 4)
                    : ''}
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {settings && (
        <Dialog title="Slippage tolerance" close={() => setSettings(false)}>
          <div className="dialog-body">
            <div className="tabs" style={{ width: 'fit-content' }}>
              {[10, 50, 100, 300].map((b) => (
                <button key={b} aria-pressed={slippage === b} onClick={() => setSlippage(b)}>
                  {b / 100}%
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              The swap reverts if the price moves against you by more than this before it confirms.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function TestFunds() {
  const { address, onArc } = useWallet();
  const claims = useFaucetClaims(address, faucetTokens);
  const { send, busy } = useTx();
  return (
    <section className="card card-pad" style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <Droplets size={16} color="var(--info)" />
        <h3 style={{ fontSize: 15 }}>Test funds</h3>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Get <b>USDC</b> (gas + launch trading) from the{' '}
        <a className="link" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
          Circle faucet
        </a>
        . tUSDC and tETH are valueless legacy Orbit test assets for the swap pool and lending market — one
        claim each.
      </p>
      <div className="row wrap">
        {faucetTokens.map((t) => (
          <button
            key={t.symbol}
            className="btn btn-ghost btn-sm"
            disabled={!address || !onArc || busy || claims.data?.[t.symbol] !== false}
            onClick={() =>
              send(`Claim ${t.symbol}`, {
                address: t.address,
                abi: faucetAbi,
                functionName: 'faucet',
              })
            }
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
      <p className="faint" style={{ fontSize: 12 }}>
        USDC: <span className="mono">{USDC.address.slice(0, 10)}…</span> is Circle's ERC-20
        interface to Arc's native gas token.
      </p>
    </section>
  );
}
