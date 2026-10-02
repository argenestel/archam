import { useState } from 'react';
import { formatUnits, isAddress } from 'viem';
import Dialog from '../components/Dialog';
import { AmountBox, Empty, Notice, Skeleton } from '../components/ui';
import { activeChain, addressUrl, isTestnet } from '../lib/arc';
import { adapterFor, getKit, kitChain, signingEnabled } from '../lib/appkit';
import { baseTokens } from '../lib/contracts';
import { useBalances } from '../lib/data';
import { compact, pct, tryParse } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';

type Kit = Awaited<ReturnType<typeof getKit>>;
type Market = Awaited<ReturnType<Kit['borrow']['getMarket']>>;
type Loan = Awaited<ReturnType<Kit['borrow']['getLoans']>>['loans'][number];
type Action = 'borrow' | 'repay' | 'close' | 'add' | 'withdraw';
const names: Record<Action, string> = {
  borrow: 'Borrow',
  repay: 'Repay',
  close: 'Close loan',
  add: 'Add collateral',
  withdraw: 'Withdraw collateral',
};
const knownToken = (address: string) =>
  baseTokens.find((t) => t.kind === 'circle' && t.address.toLowerCase() === address.toLowerCase());
function supported(m: Market) {
  return (
    ['USDC', 'EURC'].includes(knownToken(m.loanAsset.address)?.symbol || '') &&
    knownToken(m.collateralAsset.address)?.symbol === 'cirBTC'
  );
}
export default function Borrow() {
  const { address, onArc, switchNetwork } = useWallet();
  const [open, setOpen] = useState<{ market: Market; action: Action; loan?: Loan }>();
  const markets = useQuery(
    `appkit:borrow:markets:${kitChain}`,
    async () => {
      const kit = await getKit();
      const out: Market[] = [];
      for await (const m of kit.borrow.exploreMarketsIterator({ chain: kitChain, pageSize: 100 })) {
        if (m.chain === kitChain) out.push(m);
        if (out.length >= 500) break;
      }
      return out;
    },
    60_000,
  );
  const loans = useQuery(
    address ? `appkit:borrow:loans:${kitChain}:${address}` : null,
    async () => {
      const kit = await getKit();
      const out: Loan[] = [];
      let pageAfter: string | undefined;
      for (let i = 0; i < 20; i++) {
        const page = await kit.borrow.getLoans({
          chain: kitChain,
          walletAddress: address!,
          pageSize: 100,
          pageAfter,
        });
        out.push(...page.loans);
        pageAfter = page.pagination.pageAfter;
        if (!pageAfter) return out;
      }
      throw new Error(
        'Loan list exceeded page limit; use the provider directly to view remaining loans.',
      );
    },
    20_000,
  );
  const launch = (market: Market, action: Action, loan?: Loan) =>
    !address ? openConnect() : !onArc ? switchNetwork() : setOpen({ market, action, loan });
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Borrow</h1>
          <p>Compare collateralized markets and manage your loans on {activeChain.name}.</p>
        </div>
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Borrowing markets</h2>
            <p className="faint">
              Live Circle Borrow Kit discovery on {activeChain.name}. cirBTC-backed USDC/EURC flows
              are integrated; other markets are discovery-only.
            </p>
          </div>
        </div>
        <div className="card-pad">
          <Notice tone="warn">
            Borrowing creates debt and liquidation risk. These are third-party Morpho markets, not
            Orbit’s test market. Batch-capable wallet support may be required.
          </Notice>
        </div>
        {markets.loading ? (
          <div className="card-pad">
            <Skeleton h={100} />
          </div>
        ) : markets.error && !markets.data ? (
          <div className="card-pad">
            <Notice tone="error">{markets.error}</Notice>
          </div>
        ) : markets.data?.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Collateral → Loan</th>
                  <th className="r">Borrow APY</th>
                  <th className="r">Liquidation LTV</th>
                  <th className="r">Available</th>
                  <th>
                    <span className="sr-only">Borrow</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...markets.data]
                  .sort((a, b) => Number(supported(b)) - Number(supported(a)))
                  .map((m) => (
                    <tr key={m.marketId}>
                      <td>
                        <a
                          className="link"
                          href={addressUrl(m.collateralAsset.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {m.collateralAsset.symbol}
                        </a>{' '}
                        →{' '}
                        <a
                          className="link"
                          href={addressUrl(m.loanAsset.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {m.loanAsset.symbol}
                        </a>
                        <p className="faint">
                          {m.protocol} · {m.marketId.slice(0, 10)}…
                        </p>
                      </td>
                      <td className="r">
                        {m.borrowApy === null ? 'Unavailable' : pct(m.borrowApy, 2)}
                      </td>
                      <td className="r">{m.lltv === null ? 'Unavailable' : pct(m.lltv, 1)}</td>
                      <td className="r">
                        {m.liquidity
                          ? `${compact(Number(m.liquidity.amount))} ${m.liquidity.token}`
                          : 'Unavailable'}
                      </td>
                      <td>
                        {supported(m) ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={
                              !signingEnabled || !m.liquidity || Number(m.liquidity.amount) <= 0
                            }
                            onClick={() => launch(m, 'borrow')}
                          >
                            Borrow
                          </button>
                        ) : (
                          <span className="faint">Discovery only</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No markets returned by the provider" />
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Your loans</h2>
        </div>
        {!address ? (
          <Empty
            title="Connect to see loans"
            action={
              <button className="btn btn-primary" onClick={openConnect}>
                Connect wallet
              </button>
            }
          />
        ) : loans.loading ? (
          <div className="card-pad">
            <Skeleton h={70} />
          </div>
        ) : loans.error ? (
          <div className="card-pad">
            <Notice tone="error">{loans.error}</Notice>
          </div>
        ) : loans.data?.filter((l) => l.status === 'active').length ? (
          <div className="stack card-pad">
            {loans.data
              .filter((l) => l.status === 'active')
              .map((l) => {
                const market = markets.data?.find((m) => m.marketId === l.marketId);
                return (
                  <div className="card card-pad stack" key={l.loanId}>
                    <div className="row between wrap">
                      <h3>
                        {l.collateral?.token || 'Collateral'} → {l.borrowed?.token || 'Loan'}
                      </h3>
                      <span className="faint">{l.dataStatus}</span>
                    </div>
                    <dl className="kv">
                      <div>
                        <dt>Collateral</dt>
                        <dd>{l.collateral?.amount ?? 'Indexing…'}</dd>
                      </div>
                      <div>
                        <dt>Debt</dt>
                        <dd>{l.borrowed?.amount ?? 'Indexing…'}</dd>
                      </div>
                      <div>
                        <dt>Health factor</dt>
                        <dd
                          className={l.healthFactor !== null && l.healthFactor < 1.2 ? 'down' : ''}
                        >
                          {l.healthFactor?.toFixed(2) ?? 'Unavailable'}
                        </dd>
                      </div>
                    </dl>
                    <div className="row wrap">
                      {market && supported(market) && l.dataStatus === 'READY' ? (
                        (['borrow', 'repay', 'add', 'withdraw', 'close'] as Action[]).map(
                          (action) => (
                            <button
                              className="btn btn-ghost btn-sm"
                              key={action}
                              disabled={!signingEnabled}
                              onClick={() => launch(market, action, l)}
                            >
                              {names[action]}
                            </button>
                          ),
                        )
                      ) : (
                        <span className="faint">
                          Position is indexing or its market is not integrated.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <Empty title="No active Circle Borrow Kit loans">
            This is provider-indexed history, not every position opened directly on Morpho.
          </Empty>
        )}
      </section>
      {open && (
        <BorrowDialog
          key={`${address}:${open.loan?.loanId || open.market.marketId}:${open.action}`}
          {...open}
          close={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}
function BorrowDialog({
  market,
  action,
  loan,
  close,
}: {
  market: Market;
  action: Action;
  loan?: Loan;
  close: () => void;
}) {
  const { address, onArc, gas } = useWallet();
  const { runExternal, busy, unresolved, externalPending } = useTx();
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState(false);
  const [ack, setAck] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const loanToken = knownToken(market.loanAsset.address)!;
  const collToken = knownToken(market.collateralAsset.address)!;
  const token = action === 'add' || action === 'withdraw' ? collToken : loanToken;
  const input = tryParse(amount, token.decimals);
  const exact = formatUnits(input, token.decimals);
  const balances = useBalances(address, [loanToken, collToken]);
  const quote = useQuery(
    address && onArc && (input || action === 'close')
      ? `appkit:borrow:quote:${kitChain}:${address}:${market.marketId}:${loan?.loanId || 'new'}:${action}:${input}`
      : null,
    async () => {
      const kit = await getKit();
      const base = { chain: kitChain, loanId: loan?.loanId || '' };
      const q =
        action === 'borrow'
          ? await kit.borrow.getBorrowQuote(
              loan
                ? { loanId: loan.loanId, borrowAmount: exact, slippageBps: 50 }
                : {
                    walletAddress: address!,
                    chain: kitChain,
                    marketId: market.marketId,
                    borrowAmount: exact,
                    slippageBps: 50,
                  },
            )
          : action === 'repay'
            ? await kit.borrow.getRepayQuote({ ...base, repayAmount: exact })
            : action === 'close'
              ? await kit.borrow.getCloseLoanQuote({ ...base, slippageBps: 50 })
              : action === 'add'
                ? await kit.borrow.getAddCollateralQuote({ ...base, collateralAmount: exact })
                : await kit.borrow.getWithdrawCollateralRepayIfNeededQuote({
                    ...base,
                    collateralAmount: exact,
                    slippageBps: 50,
                  });
      const economics = q as {
        collateralAmount?: { amount: string; token: string };
        bundledRepayment?: { amount: string; token: string };
        repayAmount?: { amount: string; token: string };
      };
      const collateral = economics.collateralAmount;
      const repayment = economics.bundledRepayment || economics.repayAmount;
      return {
        at: Date.now(),
        collateral,
        repayment,
        health: q.resultingHealthFactor,
        ltv: q.resultingLtv,
        fees: q.fees,
        liquidation: q.liquidationPrice,
      };
    },
    15_000,
  );
  const q = quote.data;
  const pullColl =
    action === 'borrow' || action === 'add'
      ? tryParse(q?.collateral?.amount || '', collToken.decimals)
      : 0n;
  const pullLoan = tryParse(q?.repayment?.amount || '', loanToken.decimals);
  const collBalance = balances.data?.[collToken.address.toLowerCase()];
  const loanBalance = balances.data?.[loanToken.address.toLowerCase()];
  const problem = !signingEnabled
    ? 'Transactions disabled'
    : !onArc
      ? 'Switch to Arc'
      : unresolved || externalPending
        ? 'Resolve previous transaction'
        : action !== 'close' && !input
          ? 'Enter an amount'
          : quote.error
            ? 'Quote unavailable'
            : !q
              ? 'Fetching quote…'
              : !supported(market) || !isAddress(market.loanAsset.address)
                ? 'Market not integrated'
                : collBalance === undefined || loanBalance === undefined || gas === undefined
                  ? 'Loading balances…'
                  : pullColl > collBalance
                    ? `Insufficient ${collToken.symbol} collateral`
                    : pullLoan > loanBalance
                      ? `Insufficient ${loanToken.symbol} for repayment`
                      : gas <
                          50_000_000_000_000_000n +
                            (loanToken.symbol === 'USDC' ? pullLoan * 10n ** 12n : 0n)
                        ? 'Keep at least 0.05 USDC for gas'
                        : (action === 'borrow' || action === 'withdraw') &&
                            (q.health === null || q.health < 1.1)
                          ? 'Quoted health factor too low / unavailable'
                          : action === 'borrow' &&
                              input > tryParse(market.liquidity?.amount || '', loanToken.decimals)
                            ? 'Insufficient market liquidity'
                            : undefined;
  return (
    <Dialog title={`${names[action]} · ${collToken.symbol} → ${loanToken.symbol}`} close={close}>
      <div className="dialog-body">
        {action !== 'close' && (
          <AmountBox
            label={names[action]}
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setIdempotencyKey(crypto.randomUUID());
              setReview(false);
              setAck(false);
            }}
            decimals={token.decimals}
            token={<span className="token-tag">{token.symbol}</span>}
          />
        )}
        {q && (
          <dl className="kv">
            {q.collateral && (
              <div>
                <dt>
                  {action === 'borrow' || action === 'add'
                    ? 'Collateral pulled (quote)'
                    : 'Collateral released (quote)'}
                </dt>
                <dd>
                  {q.collateral.amount} {q.collateral.token}
                </dd>
              </div>
            )}
            {q.repayment && (
              <div>
                <dt>Repayment ceiling</dt>
                <dd>
                  {q.repayment.amount} {q.repayment.token}
                </dd>
              </div>
            )}
            <div>
              <dt>Resulting health factor</dt>
              <dd>{q.health?.toFixed(2) ?? 'No debt / unavailable'}</dd>
            </div>
            <div>
              <dt>Liquidation price</dt>
              <dd>
                {q.liquidation ? `${q.liquidation.amount} ${q.liquidation.token}` : 'Unavailable'}
              </dd>
            </div>
            {q.fees.map((f, i) => (
              <div key={i}>
                <dt>{f.type} fee</dt>
                <dd>
                  {f.amount.amount} {f.amount.token}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {quote.error && <Notice tone="error">{quote.error}</Notice>}
        <Notice tone="warn">
          {isTestnet ? 'Testnet.' : 'Arc mainnet: real collateral and debt.'} Liquidation can seize
          collateral. Withdrawal may also pull a repayment from your wallet. Execution obtains a
          fresh quote with 0.5% slippage; inspect every wallet request.
        </Notice>
        {review && (
          <label className="row">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
            understand the collateral, repayment, and liquidation risks.
          </label>
        )}
        <button
          className="btn btn-primary btn-block"
          disabled={busy || !!problem || (review && !ack)}
          onClick={async () => {
            if (!review) {
              setReview(true);
              return;
            }
            if (problem || !q || Date.now() - q.at > 30_000 || !ack) {
              setReview(false);
              return;
            }
            const done = await runExternal(
              `${names[action]} ${action === 'close' ? loan!.loanId : `${exact} ${token.symbol}`}`,
              async (guarded) => {
                const kit = await getKit();
                const adapter = await adapterFor(guarded);
                const from = { adapter, chain: kitChain };
                const base = { from, loanId: loan?.loanId || '', idempotencyKey };
                if (action === 'borrow')
                  return kit.borrow.borrow(
                    loan
                      ? {
                          from,
                          loanId: loan.loanId,
                          borrowAmount: exact,
                          slippageBps: 50,
                          idempotencyKey,
                        }
                      : {
                          from,
                          marketId: market.marketId,
                          borrowAmount: exact,
                          slippageBps: 50,
                          idempotencyKey,
                        },
                  );
                if (action === 'repay') return kit.borrow.repay({ ...base, repayAmount: exact });
                if (action === 'close') return kit.borrow.closeLoan({ ...base, slippageBps: 50 });
                if (action === 'add')
                  return kit.borrow.addCollateral({ ...base, collateralAmount: exact });
                return kit.borrow.withdrawCollateralRepayIfNeeded({
                  ...base,
                  collateralAmount: exact,
                  slippageBps: 50,
                });
              },
            );
            if (done) {
              invalidate('appkit:borrow');
              close();
            } else setReview(false);
          }}
        >
          {busy
            ? 'Confirm in wallet'
            : problem ||
              (review
                ? `Confirm ${names[action].toLowerCase()}`
                : `Review ${names[action].toLowerCase()}`)}
        </button>
      </div>
    </Dialog>
  );
}
