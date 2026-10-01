export function userFacingError(
  error: unknown,
  defaultMessage = 'Something went wrong. Try again.',
): string {
  const e = error as {
    code?: number;
    shortMessage?: string;
    message?: string;
    cause?: unknown;
  } | null;
  const text = e?.shortMessage || e?.message || '';
  if (e?.code === 4001 || /user rejected|user denied|rejected the request/i.test(text))
    return 'Request cancelled in your wallet. Nothing was submitted.';
  if (
    /HTTP request failed|Failed to fetch|fetch failed|network|timed out|timeout|RPC Request failed/i.test(
      text,
    )
  )
    return 'Arc connection unavailable. Check your network, then retry the connection.';
  if (e?.cause) {
    const cause = userFacingError(e.cause, '');
    if (cause) return cause;
  }
  if (/bytecode differs|chain mismatch|Invalid .* address/i.test(text))
    return 'Contract verification failed. Trading is paused for your safety.';
  if (/execution reverted|reverted/i.test(text))
    return 'The contract could not complete this request. Check your balance, allowance, and sale status.';
  // Custom app errors are actionable; avoid displaying RPC payloads, URLs, or stack traces.
  if (
    error instanceof Error &&
    !('shortMessage' in error) &&
    !/https?:|Request body:|Version:/i.test(text)
  )
    return text.slice(0, 180);
  return defaultMessage;
}
