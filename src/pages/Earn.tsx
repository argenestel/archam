import { useState } from 'react';
import { formatUnits } from 'viem';
import Dialog from '../components/Dialog';
import { AmountBox, Empty, Notice, Skeleton } from '../components/ui';
import { activeChain, addressUrl } from '../lib/arc';
import { adapterFor, getKit, kitChain, signingEnabled, useVaults, type Vault } from '../lib/appkit';
import { USDC } from '../lib/contracts';
import { useBalances } from '../lib/data';
import { pct, tryParse, usd } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';
import { UsdcMark } from './TokenPage';

/** Arc Earn: Morpho-curated USDC/EURC vaults discovered and executed through Circle App Kit. */
export default function Earn() {
  const vaults = useVaults();
  const { address, provider } = useWallet();
  const [open, setOpen] = useState<{ vault: Vault; mode: 'deposit' | 'withdraw' }>();
  const positions = useQuery(
    address && provider && vaults.data ? `appkit:positions:${address}:${vaults.data.length}` : null,
    async () => {
      const kit = await getKit();
      const adapter = await adapterFor(provider!);
      const entries = await Promise.all(
        vaults.data!.map(async (v) => {
          const p = await kit.earn
            .getPosition({ from: { adapter, chain: kitChain as never }, vaultAddress: v.address })
            .catch(() => undefined);
          const bal = p as unknown as { currentBalance?: { amount?: string } | string } | undefined;
          const amount = typeof bal?.currentBalance === 'string' ? bal.currentBalance : bal?.currentBalance?.amount;
          return [v.address.toLowerCase(), Number(amount ?? 0)] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    30_000,
  );
  const list = (vaults.data ?? []).filter((v) => v.asset === 'USDC');
  return (
    <section className="card" aria-label="Earn vaults">
      <div className="card-head">
        <div>
          <h2>Earn on idle USDC</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
            Curated Morpho vaults on {activeChain.name}, through Circle’s App Kit. Rates are variable.
          </p>
        </div>
      </div>
      {!signingEnabled && (
        <div style={{ padding: '12px 20px 0' }}>
          <Notice tone="warn">Deposits are switched off in this build while the mainnet integration is reviewed.</Notice>
        </div>
      )}
      {vaults.loading ? (
        <div style={{ padding: 20 }}>
          <Skeleton h={90} />
        </div>
      ) : vaults.error && !vaults.data ? (
        <div style={{ padding: 20 }}>
          <Notice tone="error">{vaults.error}</Notice>
        </div>
      ) : list.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Vault</th>
                <th className="r">APY</th>
                <th className="r">Deposits</th>
                <th className="r">Yours</th>
                <th className="r">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const mine = positions.data?.[v.address.toLowerCase()] ?? 0;
                return (
                  <tr key={v.address}>
                    <td>
                      <a className="link" href={addressUrl(v.address)} target="_blank" rel="noreferrer">
                        {v.name}
                      </a>
                      <span className="muted" style={{ fontSize: 12.5, marginLeft: 6 }}>
                        {v.protocol.toLowerCase()}
                      </span>
                    </td>
                    <td className="r up">{pct(v.apy, 2)}</td>
                    <td className="r">{usd(v.tvl)}</td>
                    <td className="r">{address ? (positions.loading ? '…' : usd(mine)) : '—'}</td>
                    <td className="r">
                      <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={!signingEnabled}
                          onClick={() => (address ? setOpen({ vault: v, mode: 'deposit' }) : openConnect())}
                        >
                          Deposit
                        </button>
                        {mine > 0 && (
                          <button className="btn btn-quiet btn-sm" onClick={() => setOpen({ vault: v, mode: 'withdraw' })}>
                            Withdraw
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No vaults pass curation right now">
          Vaults appear here when they are active, carry no risk warnings and pay a positive rate.
        </Empty>
      )}
      {open && (
        <EarnDialog
          vault={open.vault}
          mode={open.mode}
          position={positions.data?.[open.vault.address.toLowerCase()] ?? 0}
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
  position: number;
  close: () => void;
}) {
  const { address, provider, gas } = useWallet();
  const { runExternal, busy } = useTx();
  const [amount, setAmount] = useState('');
  const balances = useBalances(address, [USDC]);
  const wallet = balances.data?.[USDC.address.toLowerCase()];
  const value = tryParse(amount, 6);
  const max = mode === 'deposit' ? wallet : BigInt(Math.floor(position * 1e6));
  // USDC is also gas on Arc: keep a little back so the deposit itself can be paid for.
  const gasLeft = gas !== undefined ? Number(formatUnits(gas, 18)) - Number(amount || 0) : Infinity;
  const problem = !value
    ? 'Enter an amount'
    : max !== undefined && value > max
      ? mode === 'deposit'
        ? 'Insufficient USDC'
        : 'More than your position'
      : mode === 'deposit' && gasLeft < 0.05
        ? 'Leave about 0.05 USDC for gas'
        : undefined;
  return (
    <Dialog title={`${mode === 'deposit' ? 'Deposit into' : 'Withdraw from'} ${vault.name}`} close={close}>
      <div className="dialog-body">
        <AmountBox
          label={mode === 'deposit' ? 'You deposit' : 'You withdraw'}
          value={amount}
          onChange={setAmount}
          decimals={6}
          balance={max}
          onMax={max ? () => setAmount(formatUnits(max, 6)) : undefined}
          token={
            <span className="token-tag">
              <UsdcMark /> USDC
            </span>
          }
        />
        <dl className="kv">
          <div>
            <dt>Current APY</dt>
            <dd className="up">{pct(vault.apy, 2)}</dd>
          </div>
          <div>
            <dt>Earns in a year at this rate</dt>
            <dd>{usd(Number(amount || 0) * vault.apy)}</dd>
          </div>
        </dl>
        <button
          className="btn btn-primary btn-block"
          disabled={!!problem || busy}
          onClick={async () => {
            const done = await runExternal(mode === 'deposit' ? `Deposit ${amount} USDC` : `Withdraw ${amount} USDC`, async () => {
              const kit = await getKit();
              const adapter = await adapterFor(provider!);
              const from = { adapter, chain: kitChain as never };
              return mode === 'deposit'
                ? kit.earn.deposit({ from, vaultAddress: vault.address, amount: Number(amount).toFixed(2) })
                : kit.earn.withdraw({ from, vaultAddress: vault.address, amount: Number(amount).toFixed(2) });
            });
            if (done) {
              invalidate('appkit:positions');
              close();
            }
          }}
        >
          {busy ? 'Confirm in your wallet' : problem || (mode === 'deposit' ? 'Deposit' : 'Withdraw')}
        </button>
        <p className="faint">
          Your wallet may ask for two signatures: an approval, then the deposit. Withdrawals redeem vault shares at the
          current share price.
        </p>
      </div>
    </Dialog>
  );
}
