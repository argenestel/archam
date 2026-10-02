import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { formatUnits } from 'viem';
import {
  ActionButton,
  AddressLink,
  AmountBox,
  Avatar,
  Empty,
  Notice,
  Skeleton,
} from '../components/ui';
import { activeChain } from '../lib/arc';
import { baseTokens, deployments, lendingMarkets, morphoAbi } from '../lib/contracts';
import { useBalances, useMarket } from '../lib/data';
import { compact, formatAmount, pct, shortAddress, timeAgo, tryParse } from '../lib/format';
import { healthFactor, maxBorrow } from '../lib/math';
import { openConnect, useWallet } from '../lib/wallet';
import Earn from './Earn';
import AaveEarn from './AaveEarn';

type Action = 'supply' | 'withdraw' | 'collateral' | 'uncollateral' | 'borrow' | 'repay';
const earnActions: [Action, string][] = [
  ['supply', 'Supply'],
  ['withdraw', 'Withdraw'],
];
const borrowActions: [Action, string][] = [
  ['collateral', 'Add collateral'],
  ['borrow', 'Borrow'],
  ['repay', 'Repay'],
  ['uncollateral', 'Remove'],
];

export default function Lend() {
  const market = lendingMarkets[0];
  const { address } = useWallet();
  const m = useMarket(market?.id, market?.params, address);
  const loan = baseTokens.find(
    (t) => t.address.toLowerCase() === market?.params.loanToken.toLowerCase(),
  );
  const coll = baseTokens.find(
    (t) => t.address.toLowerCase() === market?.params.collateralToken.toLowerCase(),
  );
  const [mode, setMode] = useState<'earn' | 'borrow'>('earn');
  const [action, setAction] = useState<Action>('supply');
  const [amount, setAmount] = useState('');
  const balances = useBalances(address, loan && coll ? [loan, coll] : []);
  if (!market || !deployments.morpho || !loan || !coll)
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Earn</h1>
            <p>
              Discover USDC and EURC Morpho vaults on {activeChain.name}. Variable yield, real
              protocol risk.
            </p>
          </div>
        </div>
        <Earn />
        <div style={{ marginTop: 24 }}>
          <AaveEarn />
        </div>
      </>
    );
  const d = m.data;
  const lltv = market.params.lltv;
  const usesCollateral = action === 'collateral' || action === 'uncollateral';
  const token = usesCollateral ? coll : loan;
  const input = tryParse(amount, token.decimals);
  const walletLoan = balances.data?.[loan.address.toLowerCase()];
  const walletColl = balances.data?.[coll.address.toLowerCase()];
  const loanPrice = 1; // tUSDC is the unit of account for this market
  const collPrice = d ? Number(d.oraclePrice) / 1e36 / 10 ** (loan.decimals - coll.decimals) : 0;

  // Projected position after the action.
  let nextColl = d?.collateral ?? 0n,
    nextDebt = d?.borrowed ?? 0n;
  if (action === 'collateral') nextColl += input;
  if (action === 'uncollateral') nextColl = nextColl > input ? nextColl - input : 0n;
  if (action === 'borrow') nextDebt += input;
  if (action === 'repay') nextDebt = nextDebt > input ? nextDebt - input : 0n;
  const hfNow = d ? healthFactor(d.collateral, d.borrowed, d.oraclePrice, lltv) : Infinity;
  const hfNext = d ? healthFactor(nextColl, nextDebt, d.oraclePrice, lltv) : Infinity;
  const capacity = d ? maxBorrow(d.collateral, d.oraclePrice, lltv) : 0n;
  const available = d ? (capacity > d.borrowed ? capacity - d.borrowed : 0n) : 0n;
  const isMax = (value: bigint | undefined) => value !== undefined && value > 0n && input === value;

  const ceilings: Record<Action, bigint | undefined> = {
    supply: walletLoan,
    withdraw: d ? (d.supplied < d.liquidity ? d.supplied : d.liquidity) : undefined,
    collateral: walletColl,
    uncollateral: d?.collateral,
    borrow: d ? (available < d.liquidity ? available : d.liquidity) : undefined,
    repay: d
      ? walletLoan !== undefined && walletLoan < d.borrowed
        ? walletLoan
        : d.borrowed
      : undefined,
  };
  const ceiling = ceilings[action];
  const p = market.params;
  const me = address ?? '0x0000000000000000000000000000000000000000';
  const fullWithdraw = action === 'withdraw' && d && isMax(d.supplied) && d.supplied <= d.liquidity;
  const fullRepay = action === 'repay' && d && input >= d.borrowed && d.borrowed > 0n;
  const requests: Record<Action, { functionName: string; args: readonly unknown[] }> = {
    supply: { functionName: 'supply', args: [p, input, 0n, me, '0x'] },
    withdraw: fullWithdraw
      ? { functionName: 'withdraw', args: [p, 0n, d!.supplyShares, me, me] }
      : { functionName: 'withdraw', args: [p, input, 0n, me, me] },
    collateral: { functionName: 'supplyCollateral', args: [p, input, me, '0x'] },
    uncollateral: { functionName: 'withdrawCollateral', args: [p, input, me, me] },
    borrow: { functionName: 'borrow', args: [p, input, 0n, me, me] },
    // Repaying by shares clears the debt exactly even as interest accrues between quote and confirmation.
    repay: fullRepay
      ? { functionName: 'repay', args: [p, 0n, d!.borrowShares, me, '0x'] }
      : { functionName: 'repay', args: [p, input, 0n, me, '0x'] },
  };
  const approvalAmount =
    action === 'repay' && fullRepay ? d!.borrowed + d!.borrowed / 1000n + 1n : input;
  const needsApproval = action === 'supply' || action === 'collateral' || action === 'repay';
  const disabledReason = !d
    ? 'Loading market…'
    : !d.oracleFresh && (action === 'borrow' || action === 'uncollateral')
      ? 'Oracle price is stale'
      : !input
        ? 'Enter an amount'
        : ceiling !== undefined && input > ceiling && !fullRepay
          ? action === 'borrow'
            ? 'Exceeds borrow limit'
            : action === 'withdraw'
              ? 'Exceeds available'
              : `Insufficient ${token.symbol}`
          : (action === 'borrow' || action === 'uncollateral') && hfNext < 1.05
            ? 'Too close to liquidation'
            : action === 'repay' &&
                walletLoan !== undefined &&
                approvalAmount > walletLoan + 1n &&
                fullRepay
              ? `Insufficient ${loan.symbol}`
              : undefined;
  const actions = mode === 'earn' ? earnActions : borrowActions;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lend</h1>
          <p>
            Earn on USDC in curated Morpho vaults, or borrow against collateral in Mofu’s test
            market.
          </p>
        </div>
      </div>
      <div style={{ marginBottom: 32 }}>
        <Earn />
      </div>
      <h2 style={{ fontSize: 20, marginBottom: 6 }}>Borrow: Mofu test market</h2>
      <p className="muted" style={{ marginBottom: 16, maxWidth: '60ch' }}>
        An isolated Morpho Blue market for test assets. Supply {loan.symbol} to earn, or borrow it
        against {coll.symbol}. Rates move with utilization.
      </p>
      <div className="lend">
        <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
          <section className="card">
            <div className="card-head">
              <div className="row">
                <Avatar seed={coll.address} size={28} round />
                <h2>{market.label}</h2>
              </div>
              <span className="chip">LLTV {pct(Number(lltv) / 1e18, 0)}</span>
            </div>
            <div className="card-pad">
              {d ? (
                <dl className="stats">
                  <Stat label="Supply APY" value={pct(d.supplyApy, 2)} tone="up" />
                  <Stat label="Borrow APY" value={pct(d.borrowApy, 2)} />
                  <Stat label="Utilization" value={pct(d.utilization)} />
                  <Stat
                    label="Total supplied"
                    value={`${compact(Number(formatUnits(d.totalSupplyAssets, loan.decimals)))} ${loan.symbol}`}
                  />
                  <Stat
                    label="Total borrowed"
                    value={`${compact(Number(formatUnits(d.totalBorrowAssets, loan.decimals)))} ${loan.symbol}`}
                  />
                  <Stat
                    label="Available"
                    value={`${compact(Number(formatUnits(d.liquidity, loan.decimals)))} ${loan.symbol}`}
                  />
                </dl>
              ) : m.error ? (
                <Notice tone="error">{m.error}</Notice>
              ) : (
                <Skeleton h={110} />
              )}
            </div>
          </section>
          <section className="card card-pad" style={{ display: 'grid', gap: 14 }}>
            <h3 style={{ fontSize: 15 }}>How this market works</h3>
            <dl className="kv">
              <div>
                <dt>Protocol</dt>
                <dd>Morpho Blue (canonical source)</dd>
              </div>
              <div>
                <dt>Morpho contract</dt>
                <dd>
                  <AddressLink address={deployments.morpho}>
                    {shortAddress(deployments.morpho)}
                  </AddressLink>
                </dd>
              </div>
              <div>
                <dt>Oracle price</dt>
                <dd>
                  1 {coll.symbol} = {d ? compact(collPrice * loanPrice, 2) : '…'} {loan.symbol}
                </dd>
              </div>
              <div>
                <dt>Oracle updated</dt>
                <dd className={d && !d.oracleFresh ? 'down' : undefined}>
                  {d ? `${timeAgo(d.oracleUpdatedAt)} ago${d.oracleFresh ? '' : ', stale'}` : '…'}
                </dd>
              </div>
              <div>
                <dt>Liquidation</dt>
                <dd>When debt exceeds {pct(Number(lltv) / 1e18, 0)} of collateral value</dd>
              </div>
            </dl>
            <Notice tone="warn">
              <b>Liquidation risk.</b> If {coll.symbol}'s price falls far enough that your health
              factor drops below 1.0, anyone can repay your debt and seize collateral plus an
              incentive. The testnet oracle is posted by the Mofu deployer; mainnet markets must
              use an independent price feed.
            </Notice>
          </section>
        </div>
        <aside className="side">
          <section className="card card-pad" style={{ display: 'grid', gap: 14 }}>
            <h3 style={{ fontSize: 15 }}>Your position</h3>
            {!address ? (
              <button className="btn btn-ghost" onClick={openConnect}>
                Connect to see your position
              </button>
            ) : d ? (
              <>
                <dl className="kv">
                  <div>
                    <dt>Supplied</dt>
                    <dd>
                      {formatAmount(d.supplied, loan.decimals, 2)} {loan.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Collateral</dt>
                    <dd>
                      {formatAmount(d.collateral, coll.decimals, 4)} {coll.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Borrowed</dt>
                    <dd>
                      {formatAmount(d.borrowed, loan.decimals, 2)} {loan.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Can borrow</dt>
                    <dd>
                      {formatAmount(available, loan.decimals, 2)} {loan.symbol}
                    </dd>
                  </div>
                </dl>
                <Health value={hfNow} next={input && mode === 'borrow' ? hfNext : undefined} />
              </>
            ) : (
              <Skeleton h={120} />
            )}
          </section>
          <section className="card trade-panel">
            <div
              className="tabs"
              role="tablist"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}
            >
              {(['earn', 'borrow'] as const).map((x) => (
                <button
                  key={x}
                  role="tab"
                  aria-selected={mode === x}
                  onClick={() => {
                    setMode(x);
                    setAction(x === 'earn' ? 'supply' : 'collateral');
                    setAmount('');
                  }}
                >
                  {x === 'earn' ? 'Earn' : 'Borrow'}
                </button>
              ))}
            </div>
            <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Action">
              {actions.map(([id, label]) => (
                <button
                  key={id}
                  className={`btn btn-sm ${action === id ? 'btn-ghost' : 'btn-quiet'}`}
                  aria-pressed={action === id}
                  onClick={() => {
                    setAction(id);
                    setAmount('');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <AmountBox
              label={actions.find(([id]) => id === action)?.[1] ?? ''}
              value={amount}
              onChange={setAmount}
              decimals={token.decimals}
              balance={ceiling}
              onMax={ceiling ? () => setAmount(formatUnits(ceiling, token.decimals)) : undefined}
              footer={
                action === 'borrow'
                  ? 'Max = borrow limit'
                  : action === 'withdraw'
                    ? 'Max = withdrawable'
                    : undefined
              }
              token={
                <span className="token-tag">
                  <Avatar seed={token.address} size={24} round /> {token.symbol}
                </span>
              }
            />
            {mode === 'borrow' && input > 0n && d && (
              <p className="muted" style={{ fontSize: 13 }}>
                Health factor after: <b className={hfNext < 1.2 ? 'down' : 'up'}>{fmtHf(hfNext)}</b>
              </p>
            )}
            <ActionButton
              label={actions.find(([id]) => id === action)?.[1] ?? 'Submit'}
              onConnect={openConnect}
              disabledReason={disabledReason}
              approve={
                needsApproval
                  ? { token, spender: deployments.morpho, amount: approvalAmount }
                  : undefined
              }
              request={{ address: deployments.morpho, abi: morphoAbi, ...requests[action] }}
              onDone={() => setAmount('')}
            />
          </section>
        </aside>
      </div>
    </>
  );
}

const fmtHf = (v: number) => (v === Infinity ? '∞' : v.toFixed(2));
const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'up' }) => (
  <div className="stat">
    <dt>{label}</dt>
    <dd className={tone}>{value}</dd>
  </div>
);

function Health({ value, next }: { value: number; next?: number }) {
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((Math.min(v, 3) - 1) / 2) * 100))}%`;
  return (
    <div className="health">
      <div className="row between" style={{ fontSize: 13 }}>
        <span className="row" style={{ gap: 6 }}>
          <ShieldAlert size={14} /> Health factor
        </span>
        <b className={`mono ${value < 1.2 ? 'down' : 'up'}`}>
          {fmtHf(value)}
          {next !== undefined && ` → ${fmtHf(next)}`}
        </b>
      </div>
      <div className="health-bar" aria-hidden>
        <i style={{ left: pos(next ?? value) }} />
      </div>
      <div className="row between faint" style={{ fontSize: 11 }}>
        <span>1.0 liquidation</span>
        <span>3.0+</span>
      </div>
    </div>
  );
}
