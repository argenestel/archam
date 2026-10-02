import { useState } from 'react';
import { formatUnits } from 'viem';
import Dialog from '../components/Dialog';
import { AmountBox, Empty, Notice, Skeleton } from '../components/ui';
import { activeChain, addressUrl, isTestnet } from '../lib/arc';
import {
  adapterFor,
  getKit,
  kitChain,
  signingEnabled,
  useVaultCatalog,
  verifyVault,
  type Vault,
} from '../lib/appkit';
import { baseTokens } from '../lib/contracts';
import { useBalances } from '../lib/data';
import { pct, tryParse, compact } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';

export default function Earn() {
  const vaults = useVaultCatalog();
  const { address, provider, onArc, switchNetwork } = useWallet();
  const [all, setAll] = useState(false);
  const [asset, setAsset] = useState('USDC');
  const [open, setOpen] = useState<{ vault: Vault; mode: 'deposit' | 'withdraw' }>();
  const positions = useQuery(
    address && provider && onArc && vaults.data
      ? `appkit:positions:${kitChain}:${address}:${vaults.data.map((v) => v.address).join(',')}`
      : null,
    async () => {
      const kit = await getKit();
      const adapter = await adapterFor(provider!);
      const entries = await Promise.all(
        vaults.data!.map(async (v) => {
          try {
            const p = await kit.earn.getPosition({
              from: { adapter, chain: kitChain },
              vaultAddress: v.address,
            });
            return [v.address.toLowerCase(), String(p.currentBalance)] as const;
          } catch {
            return [v.address.toLowerCase(), null] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    30_000,
  );
  const list = (vaults.data ?? []).filter(
    (v) =>
      v.asset === asset &&
      (all ||
        Number(positions.data?.[v.address.toLowerCase()]) > 0 ||
        (v.status === 'active' &&
          v.apy > 0 &&
          !v.warnings.length &&
          !/\btest\b/i.test(v.name) &&
          (isTestnet || v.tvl >= 250_000))),
  );
  return (
    <section className="card" aria-label="Earn vaults">
      <div className="card-head wrap">
        <div>
          <h2>Earn on {asset}</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            Live Morpho vault discovery via Circle App Kit. APYs are variable, not guaranteed.
          </p>
        </div>
        <div className="tabs" role="group" aria-label="Vault asset">
          {['USDC', 'EURC'].map((a) => (
            <button key={a} aria-pressed={asset === a} onClick={() => setAsset(a)}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="row wrap" style={{ padding: '12px 20px' }}>
        <button className="btn btn-quiet" aria-pressed={all} onClick={() => setAll(!all)}>
          {all ? 'Show filtered vaults' : 'Show all discovered vaults'}
        </button>
        <span className="faint">
          Filtered ≠ audited or risk-free. Your known positions remain visible.
        </span>
      </div>
      {!signingEnabled && (
        <div className="card-pad">
          <Notice tone="warn">Transactions disabled in this build.</Notice>
        </div>
      )}
      {vaults.loading ? (
        <div className="card-pad">
          <Skeleton h={90} />
        </div>
      ) : vaults.error && !vaults.data ? (
        <div className="card-pad">
          <Notice tone="error">{vaults.error}</Notice>
        </div>
      ) : list.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Vault</th>
                <th className="r">APY</th>
                <th className="r">Deposits ({asset})</th>
                <th className="r">Liquidity ({asset})</th>
                <th className="r">Yours ({asset})</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const mine = positions.data?.[v.address.toLowerCase()];
                return (
                  <tr key={v.address}>
                    <td>
                      <a
                        className="link"
                        href={addressUrl(v.address)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {v.name || 'Unnamed vault'}
                      </a>
                      <p className="faint">
                        {v.protocol} · {v.status}
                        {v.warnings.length ? ` · ${v.warnings.join(', ')}` : ''}
                      </p>
                    </td>
                    <td className="r">{pct(v.apy, 2)}</td>
                    <td className="r">{compact(v.tvl)}</td>
                    <td className="r">{compact(v.liquidity)}</td>
                    <td className="r">
                      {!address
                        ? '—'
                        : !onArc
                          ? 'Switch network'
                          : positions.loading
                            ? '…'
                            : mine === null || mine === undefined
                              ? 'Unavailable'
                              : compact(Number(mine), 6)}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={!signingEnabled || v.status !== 'active'}
                          onClick={() =>
                            !address
                              ? openConnect()
                              : !onArc
                                ? switchNetwork()
                                : setOpen({ vault: v, mode: 'deposit' })
                          }
                        >
                          Deposit
                        </button>
                        {Number(mine) > 0 && (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={!signingEnabled}
                            onClick={() => setOpen({ vault: v, mode: 'withdraw' })}
                          >
                            Withdraw
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No vaults match this filter">
          Try all discovered vaults. Provider availability is not a safety endorsement.
        </Empty>
      )}
      {open && (
        <EarnDialog
          key={`${address}:${open.vault.address}:${open.mode}`}
          vault={open.vault}
          mode={open.mode}
          position={positions.data?.[open.vault.address.toLowerCase()] || '0'}
          close={() => setOpen(undefined)}
        />
      )}
    </section>
  );
}
function EarnDialog({
  vault,
  mode,
  position,
  close,
}: {
  vault: Vault;
  mode: 'deposit' | 'withdraw';
  position: string;
  close: () => void;
}) {
  const { address, provider, gas, onArc } = useWallet();
  const { runExternal, busy, unresolved, externalPending } = useTx();
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState(false);
  const token = baseTokens.find((t) => t.kind === 'circle' && t.symbol === vault.asset)!;
  const balances = useBalances(address, [token]);
  const wallet = balances.data?.[token.address.toLowerCase()];
  const value = tryParse(amount, token.decimals);
  const exact = formatUnits(value, token.decimals);
  const max = mode === 'deposit' ? wallet : tryParse(position, token.decimals);
  const quote = useQuery(
    address && provider && onArc && value
      ? `appkit:earnquote:${kitChain}:${address}:${vault.address}:${mode}:${value}`
      : null,
    async () => {
      await verifyVault(vault, token.address);
      const kit = await getKit();
      const adapter = await adapterFor(provider!);
      const params = {
        from: { adapter, chain: kitChain },
        vaultAddress: vault.address,
        amount: exact,
      };
      const q =
        mode === 'deposit'
          ? await kit.earn.getDepositQuote(params)
          : await kit.earn.getWithdrawalQuote(params);
      return {
        at: Date.now(),
        fees: q.fees,
        gasFees: q.gasFees,
        maxWithdrawable: 'maxWithdrawable' in q ? q.maxWithdrawable.amount : undefined,
      };
    },
    15_000,
  );
  const problem = !signingEnabled
    ? 'Transactions disabled'
    : !onArc
      ? 'Switch to Arc'
      : unresolved || externalPending
        ? 'Resolve previous transaction'
        : !value
          ? 'Enter an amount'
          : max === undefined
            ? 'Loading balance…'
            : value > max
              ? 'Insufficient balance'
              : gas === undefined
                ? 'Loading gas balance…'
                : gas <
                    50_000_000_000_000_000n +
                      (mode === 'deposit' && token.symbol === 'USDC' ? value * 10n ** 12n : 0n)
                  ? 'Keep at least 0.05 USDC for gas'
                  : quote.error
                    ? 'Quote / verification unavailable'
                    : !quote.data
                      ? 'Fetching quote…'
                      : mode === 'withdraw' &&
                          quote.data.maxWithdrawable &&
                          value > tryParse(quote.data.maxWithdrawable, token.decimals)
                        ? 'Not enough withdrawal liquidity'
                        : undefined;
  return (
    <Dialog
      title={`${mode === 'deposit' ? 'Deposit into' : 'Withdraw from'} ${vault.name}`}
      close={close}
    >
      <div className="dialog-body">
        <AmountBox
          label={mode === 'deposit' ? 'You deposit' : 'You withdraw'}
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setReview(false);
          }}
          decimals={token.decimals}
          balance={max}
          onMax={
            max
              ? () => {
                  setAmount(
                    formatUnits(
                      mode === 'deposit' && token.symbol === 'USDC'
                        ? max > 50_000n
                          ? max - 50_000n
                          : 0n
                        : max,
                      token.decimals,
                    ),
                  );
                  setReview(false);
                }
              : undefined
          }
          token={<span className="token-tag">{token.symbol}</span>}
        />
        <dl className="kv">
          <div>
            <dt>Variable APY</dt>
            <dd>{pct(vault.apy, 2)}</dd>
          </div>
          <div>
            <dt>Vault</dt>
            <dd>
              <a className="link" href={addressUrl(vault.address)} target="_blank" rel="noreferrer">
                View contract
              </a>
            </dd>
          </div>
          {quote.data?.maxWithdrawable && (
            <div>
              <dt>Withdrawable now</dt>
              <dd>
                {quote.data.maxWithdrawable} {token.symbol}
              </dd>
            </div>
          )}
          {quote.data?.fees.map((f, i) => (
            <div key={i}>
              <dt>Provider fee</dt>
              <dd>
                {f.amount} {f.symbol}
              </dd>
            </div>
          ))}
        </dl>
        {quote.error && <Notice tone="error">{quote.error}</Notice>}
        <Notice tone="warn">
          {isTestnet
            ? 'Testnet funds.'
            : 'Real funds. Vaults may lose money or restrict withdrawals.'}{' '}
          {vault.warnings.length ? vault.warnings.join(', ') : 'Filtering is not an audit.'}
        </Notice>
        {review && (
          <p>
            Review {mode} of{' '}
            <b>
              {exact} {token.symbol}
            </b>
            . Your wallet may request an approval followed by the vault transaction.
          </p>
        )}
        <button
          className="btn btn-primary btn-block"
          disabled={busy || !!problem}
          onClick={async () => {
            if (!review) {
              setReview(true);
              return;
            }
            if (problem || !quote.data || Date.now() - quote.data.at > 30_000) {
              setReview(false);
              return;
            }
            const done = await runExternal(`${mode} ${exact} ${token.symbol}`, async (guarded) => {
              await verifyVault(vault, token.address);
              const kit = await getKit();
              const adapter = await adapterFor(guarded);
              const params = {
                from: { adapter, chain: kitChain },
                vaultAddress: vault.address,
                amount: exact,
              };
              return mode === 'deposit' ? kit.earn.deposit(params) : kit.earn.withdraw(params);
            });
            if (done) {
              invalidate('appkit:positions');
              close();
            } else setReview(false);
          }}
        >
          {busy ? 'Confirm in wallet' : problem || (review ? `Confirm ${mode}` : `Review ${mode}`)}
        </button>
      </div>
    </Dialog>
  );
}
