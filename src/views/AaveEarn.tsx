import { useState } from 'react';
import { formatUnits } from 'viem';
import Dialog from '../components/Dialog';
import { ActionButton, AddressLink, AmountBox, Notice, Skeleton } from '../components/ui';
import { isTestnet } from '../lib/arc';
import { signingEnabled } from '../lib/appkit';
import { aaveRequests, useAaveVaults, type AaveVault } from '../lib/adapters/aave';
import { useBalances } from '../lib/data';
import { compact, formatAmount, pct, tryParse } from '../lib/format';
import { invalidate } from '../lib/query';
import { openConnect, useWallet } from '../lib/wallet';

/** Aave V4 (Arc Core Hub) through its ERC-4626 tokenization vaults. Mainnet only. */
export default function AaveEarn() {
  const { address } = useWallet();
  const vaults = useAaveVaults(address, !isTestnet);
  const [open, setOpen] = useState<{ v: AaveVault; mode: 'deposit' | 'withdraw' }>();
  if (isTestnet) return null;
  return (
    <section className="card" aria-label="Aave V4 vaults">
      <div className="card-head">
        <h2>Aave V4</h2>
      </div>
      {vaults.loading ? (
        <div style={{ padding: 20 }}>
          <Skeleton h={120} />
        </div>
      ) : vaults.error && !vaults.data ? (
        <div style={{ padding: 20 }}>
          <Notice tone="error">{vaults.error}</Notice>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="r">APY</th>
                <th className="r">Supplied</th>
                <th className="r">Yours</th>
                <th className="r">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(vaults.data ?? []).filter((v) => (v.apy ?? 0) > 0.0001 || v.shares > 0n).map((v) => (
                <tr key={v.vault}>
                  <td>
                    <AddressLink address={v.vault}>{v.symbol}</AddressLink>
                  </td>
                  <td className="r up">{v.apy === undefined ? '—' : pct(v.apy, 2)}</td>
                  <td className="r">
                    {compact(Number(formatUnits(v.tvl, v.token.decimals)))} {v.symbol}
                  </td>
                  <td className="r">{address ? `${formatAmount(v.assets, v.token.decimals, 4)} ${v.symbol}` : '—'}</td>
                  <td className="r">
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!signingEnabled || v.maxDeposit === 0n}
                        onClick={() => (address ? setOpen({ v, mode: 'deposit' }) : openConnect())}
                      >
                        Supply
                      </button>
                      {v.shares > 0n && (
                        <button className="btn btn-quiet btn-sm" onClick={() => setOpen({ v, mode: 'withdraw' })}>
                          Withdraw
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AaveDialog v={open.v} mode={open.mode} close={() => setOpen(undefined)} />}
    </section>
  );
}

function AaveDialog({ v, mode, close }: { v: AaveVault; mode: 'deposit' | 'withdraw'; close: () => void }) {
  const { address } = useWallet();
  const [amount, setAmount] = useState('');
  const balances = useBalances(address, [v.token]);
  const wallet = balances.data?.[v.token.address.toLowerCase()];
  const value = tryParse(amount, v.token.decimals);
  const max = mode === 'deposit' ? (wallet !== undefined && wallet < v.maxDeposit ? wallet : v.maxDeposit) : v.maxWithdraw;
  const full = mode === 'withdraw' && value > 0n && value >= v.maxWithdraw;
  // On Arc, USDC is also gas: never let a deposit take the last of it.
  const gasGuard = mode === 'deposit' && v.symbol === 'USDC' && wallet !== undefined && wallet - value < 50_000n;
  const reason = !value
    ? 'Enter an amount'
    : value > max && !full
      ? mode === 'deposit'
        ? `Insufficient ${v.symbol}`
        : 'More than you can withdraw'
      : gasGuard
        ? 'Leave about 0.05 USDC for gas'
        : undefined;
  return (
    <Dialog title={`${mode === 'deposit' ? 'Supply' : 'Withdraw'} ${v.symbol} ${mode === 'deposit' ? 'to' : 'from'} Aave V4`} close={close}>
      <div className="dialog-body">
        <AmountBox
          label={mode === 'deposit' ? 'You supply' : 'You withdraw'}
          value={amount}
          onChange={setAmount}
          decimals={v.token.decimals}
          balance={max}
          onMax={max ? () => setAmount(formatUnits(max, v.token.decimals)) : undefined}
          token={<span className="token-tag">{v.symbol}</span>}
        />
        <dl className="kv">
          <div>
            <dt>APY</dt>
            <dd className="up">{v.apy === undefined ? '—' : pct(v.apy, 2)}</dd>
          </div>
          <div>
            <dt>{mode === 'deposit' ? 'You receive' : 'Shares redeemed'}</dt>
            <dd>{mode === 'deposit' ? `waCore${v.symbol} vault shares` : full ? 'All of them' : 'Proportional to the amount'}</dd>
          </div>
        </dl>
        <ActionButton
          label={mode === 'deposit' ? `Supply ${v.symbol}` : `Withdraw ${v.symbol}`}
          onConnect={openConnect}
          disabledReason={reason}
          approve={mode === 'deposit' ? { token: v.token, spender: v.vault, amount: value } : undefined}
          request={
            address && value
              ? mode === 'deposit'
                ? aaveRequests.deposit(v.vault, value, address)
                : full
                  ? aaveRequests.redeemAll(v.vault, v.shares, address)
                  : aaveRequests.withdraw(v.vault, value, address)
              : undefined
          }
          onDone={() => {
            invalidate('aave:');
            invalidate('balances');
            close();
          }}
        />
      </div>
    </Dialog>
  );
}
