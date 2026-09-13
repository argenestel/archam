import { formatUnits } from "viem";

/** Keep every onchain decimal; rounding can turn a valid one-wei price into zero. */
export function money(value: bigint) {
  const [whole, fraction] = formatUnits(value, 18).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export type FillContext = { factory: string; book: string; token: string; account: string };
export function sameFillContext(expected: FillContext, current: FillContext) {
  return (Object.keys(expected) as (keyof FillContext)[]).every(key => !!expected[key] && expected[key].toLowerCase() === current[key].toLowerCase());
}
