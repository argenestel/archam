"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { arcClient } from "./market-data";
import { curveToken } from "./generated/curveToken";

export const tokenArtwork = ["mofu", "cat", "frog", "orbit", "matcha", "arcade"];
export const tokenImagePath = (name: string) => `/token-images/${name}.svg`;
const fallback = tokenImagePath("default");

/** Only curated local files and explicit secure remote image URIs are accepted. */
export function resolveTokenImage(source?: string): string | undefined {
  const value = source?.trim();
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  if ([...tokenArtwork, "default", "usdc", "eurc"].some(name => value === tokenImagePath(name))) return value;
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)(\/[^?#]*)?$/.exec(value);
  if (ipfs) {
    const path = ipfs[2] ?? "";
    if (path.split("/").some(part => part === "." || part === "..") || /%/.test(path)) return undefined;
    return `https://ipfs.io/ipfs/${ipfs[1]}${path}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !value.startsWith("https://") || url.username || url.password || !url.hostname) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function tokenImageInputError(source: string): string | undefined {
  if (!resolveTokenImage(source)) return "Choose artwork or enter a valid HTTPS image URL.";
  if (new TextEncoder().encode(source.trim()).length > 32) return "Image URI exceeds the legacy contract limit of 32 UTF-8 bytes. Choose local artwork or a shorter HTTPS URL.";
}

type TokenImageProps = { src?: string; name?: string; alt?: string; size?: number; className?: string };

export function TokenImage({ src, name, alt = name ? `${name} artwork` : "", size = 40, className }: TokenImageProps) {
  const resolved = resolveTokenImage(src) ?? fallback;
  const [failed, setFailed] = useState<string>();
  return (
    // Browser loading supports user URLs without a server image proxy or remote allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img key={resolved} src={failed === resolved ? fallback : resolved} alt={alt}
      width={size} height={size} className={className} loading="lazy" decoding="async"
      referrerPolicy="no-referrer" style={{ width: size, height: size, objectFit: "cover", borderRadius: "25%", display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
      onError={() => { if (failed !== resolved) setFailed(resolved); }} />
  );
}

/** Read legacy image metadata without changing the shared market token type. */
export function OnchainTokenImage({ address, ...props }: TokenImageProps & { address: Address }) {
  const { data } = useQuery({
    queryKey: ["token-image", address], staleTime: Infinity, retry: false,
    queryFn: () => arcClient.readContract({ address, abi: curveToken.abi, functionName: "icon" }),
  });
  return <TokenImage {...props} src={data} />;
}
