import { launchConfig } from '../lib/contracts';

// The real bonding curve: price(x) ∝ 1 / (T0 − x)², for x tokens sold out of the sale supply S.
// Drawn with x as the share of the sale sold and y as price, scaled to the graduation price.
const S = Number(launchConfig.saleSupply / 10n ** 18n);
const T0 = Number(launchConfig.virtualToken / 10n ** 18n);
const priceAt = (f: number) => 1 / (1 - (f * S) / T0) ** 2;
const top = priceAt(1);
const yAt = (f: number) => (priceAt(f) - 1) / (top - 1);

export function Curve({
  progress,
  variant = 'mini',
  graduated = false,
  label,
}: {
  progress: number;
  variant?: 'mini' | 'hero';
  graduated?: boolean;
  label: string;
}) {
  const W = variant === 'hero' ? 640 : 120;
  const H = variant === 'hero' ? 220 : 32;
  const pad = variant === 'hero' ? 8 : 3;
  const p = Math.max(0, Math.min(1, graduated ? 1 : progress));
  const x = (f: number) => pad + f * (W - pad * 2);
  const y = (f: number) => H - pad - yAt(f) * (H - pad * 2);
  const steps = variant === 'hero' ? 80 : 30;
  const path = (to: number) =>
    Array.from({ length: steps + 1 }, (_, i) => (i / steps) * to)
      .map((f, i) => `${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(f).toFixed(1)}`)
      .join('');
  const filled = `${path(p)}L${x(p)},${H - pad}L${x(0)},${H - pad}Z`;
  return (
    <svg
      className={`curve curve-${variant}${graduated ? ' is-graduated' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
    >
      <path className="curve-fill" d={filled} />
      <path className="curve-track" d={path(1)} />
      <path className="curve-done" d={path(p)} />
      {variant === 'hero' && <line className="curve-goal" x1={x(1)} x2={x(1)} y1={pad} y2={H - pad} />}
      <circle className="curve-dot" cx={x(p)} cy={y(p)} r={variant === 'hero' ? 6 : 3} />
    </svg>
  );
}
