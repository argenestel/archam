import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { formatUnits, getAddress } from 'viem';
import { ActionButton, Avatar, Notice, Progress } from '../components/ui';
import { client } from '../lib/arc';
import { USDC, deployments, graduationQuote, launchAbi, launchConfig } from '../lib/contracts';
import { useBalances } from '../lib/data';
import { compact, tryParse, usd } from '../lib/format';
import { curvePrice, withSlippage } from '../lib/math';
import { invalidate, useQuery } from '../lib/query';
import { openConnect, useWallet } from '../lib/wallet';

const bytes = (s: string) => new TextEncoder().encode(s).length;

export default function CreateLaunch() {
  const { address } = useWallet();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [initial, setInitial] = useState('');
  const balances = useBalances(address, [USDC]);
  const usdc = balances.data?.[USDC.address.toLowerCase()];
  const buy = tryParse(initial, 6);
  // Initial buy on a fresh curve: tokensOut = T0 * net / (V0 + net).
  const net = buy - (buy * launchConfig.feeBps) / 10_000n;
  const expected = buy ? (launchConfig.virtualToken * net) / (launchConfig.virtualQuote + net) : 0n;
  const count = useQuery('launch-count', () =>
    client.readContract({ address: deployments.launch!, abi: launchAbi, functionName: 'tokenCount' }),
  );
  const problems = [
    !name.trim() && 'Enter a name',
    bytes(name) > 32 && 'Name is too long',
    !symbol.trim() && 'Enter a ticker',
    bytes(symbol) > 10 && 'Ticker is too long',
    bytes(description) > 280 && 'Description is too long',
    initial && !buy && 'Enter a valid first buy',
    usdc !== undefined && buy > usdc && 'Insufficient USDC',
  ].filter(Boolean) as string[];
  const startPrice = curvePrice(launchConfig.virtualQuote, launchConfig.virtualToken);
  if (!deployments.launch) return <Notice>Launches are not available on this network yet.</Notice>;
  return (
    <>
      <a className="btn-quiet row" href="#/" style={{ marginBottom: 16, width: 'fit-content' }}>
        <ArrowLeft size={15} /> Discover
      </a>
      <div className="create">
        <section className="card card-pad" style={{ display: 'grid', gap: 18 }}>
          <div>
            <h1 style={{ fontSize: 28 }}>Launch a token</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              One transaction. No presale, no team allocation: 1B supply, 793.1M sold on the curve and the rest
              reserved for locked liquidity at graduation.
            </p>
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sub Second" />
          </div>
          <div className="field">
            <label htmlFor="symbol">Ticker</label>
            <input
              id="symbol"
              className="input mono"
              maxLength={10}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="SUBSEC"
            />
            <span className="hint">Letters and numbers, up to 10.</span>
          </div>
          <div className="field">
            <label htmlFor="desc">Description</label>
            <textarea
              id="desc"
              className="input"
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the story?"
            />
            <span className="hint">{280 - bytes(description)} characters left. Stored on-chain.</span>
          </div>
          <div className="field">
            <label htmlFor="initial">First buy (optional)</label>
            <input
              id="initial"
              className="input mono"
              inputMode="decimal"
              value={initial}
              onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setInitial(e.target.value)}
              placeholder="0 USDC"
            />
            <span className="hint">
              Buying in the same transaction means nobody can buy before you.
              {expected > 0n && ` You get ≈ ${compact(Number(formatUnits(expected, 18)))} ${symbol || 'tokens'}.`}
            </span>
          </div>
          <ActionButton
            label="Launch token"
            onConnect={openConnect}
            disabledReason={problems[0]}
            approve={buy ? { token: USDC, spender: deployments.launch, amount: buy } : undefined}
            request={{
              address: deployments.launch,
              abi: launchAbi,
              functionName: 'launch',
              args: [name.trim(), symbol.trim(), '', description.trim(), buy, buy ? withSlippage(expected, 100) : 0n],
            }}
            onDone={async () => {
              invalidate('launch');
              const latest = await client.readContract({
                address: deployments.launch!,
                abi: launchAbi,
                functionName: 'tokensPage',
                args: [0n, 5n],
              });
              for (const token of latest) {
                const curve = await client.readContract({
                  address: deployments.launch!,
                  abi: launchAbi,
                  functionName: 'curves',
                  args: [token],
                });
                if (address && getAddress(curve[0]) === getAddress(address)) {
                  window.location.hash = `#/token/${token}`;
                  return;
                }
              }
              window.location.hash = '#/';
            }}
          />
          <p className="faint" style={{ fontSize: 12 }}>
            Launch contract is unaudited. Tokens are locked to the curve until graduation, so they can't be sent or
            paired elsewhere early. 1% trading fee.
          </p>
        </section>
        <aside style={{ display: 'grid', gap: 14 }}>
          <span className="eyebrow">Preview</span>
          <div className="card token-card" aria-hidden>
            <div className="token-card-top">
              <Avatar seed={`${name}${symbol}${count.data ?? ''}`} size={48} />
              <div className="grow">
                <div className="token-name">{name || 'Your token'}</div>
                <div className="token-sym">${symbol || 'TICKER'}</div>
              </div>
              <span className="chip accent">New</span>
            </div>
            <p className="token-desc">{description || 'Your description shows up here.'}</p>
            <Progress value={0} label="preview" />
          </div>
          <dl className="card card-pad kv">
            <div>
              <dt>Starting price</dt>
              <dd>${startPrice.toPrecision(3)}</dd>
            </div>
            <div>
              <dt>Starting market cap</dt>
              <dd>{usd(startPrice * 1e9)}</dd>
            </div>
            <div>
              <dt>Graduates at</dt>
              <dd>{usd(Number(graduationQuote) / 1e6, 0)} raised</dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd>Uniswap V2, LP burned</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}
