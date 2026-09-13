/** Curve quantities are whole tokens; native Arc USDC amounts use 18 decimals. */
export function wholeTokens(input: string): bigint | undefined {
  if (!/^\d{1,7}$/.test(input)) return undefined;
  const value = BigInt(input);
  return value > 0n && value <= 1_000_000n ? value : undefined;
}

export function protectedAmount(quote: bigint, side: "buy" | "sell"): bigint {
  if (quote < 0n) throw new Error("Quote cannot be negative.");
  return side === "buy" ? (quote * 101n + 99n) / 100n : quote * 99n / 100n;
}

export function withinProtection(fresh: bigint, limit: bigint, side: "buy" | "sell"): boolean {
  return side === "buy" ? fresh <= limit : fresh >= limit;
}

export function coinPage(count: bigint, index?: bigint, size = 20n): number {
  return index !== undefined && index >= 0n && index < count ? Number((count - 1n - index) / size) : 0;
}
