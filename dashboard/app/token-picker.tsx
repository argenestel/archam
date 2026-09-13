"use client";

import { Fragment, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Check, LoaderCircle, Search, X } from "lucide-react";
import type { Address } from "viem";
import { FormDialog } from "./form-dialog";
import { TokenImage } from "./token-image";

export type PickerToken = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
  status?: "route" | "detected" | "quote";
  statusLabel?: string;
  disabled?: boolean;
};

type TokenPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  tokens: PickerToken[];
  selected?: Address;
  busy?: boolean;
  searchLabel?: string;
  networkLabel?: string;
  onSelect: (token: PickerToken) => void;
  onImport?: (address: string) => Promise<PickerToken>;
};

export function TokenPicker({
  open,
  onOpenChange,
  title,
  description,
  tokens,
  selected,
  busy = false,
  searchLabel = "Search by name, ticker, or address",
  networkLabel = "Arc Testnet",
  onSelect,
  onImport,
}: TokenPickerProps) {
  const [query, setQuery] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [imported, setImported] = useState<PickerToken>();

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return tokens;
    return tokens.filter(token =>
      `${token.name} ${token.symbol} ${token.address}`.toLowerCase().includes(value),
    );
  }, [query, tokens]);
  const routeTokens = filtered.filter(token => token.status !== "detected");
  const detectedTokens = filtered.filter(token => token.status === "detected");

  function close() {
    if (busy || importBusy) return;
    onOpenChange(false);
    setQuery("");
    setImportError("");
  }

  async function importToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onImport || importBusy) return;
    setImportBusy(true);
    setImportError("");
    try {
      const token = await onImport(addressInput);
      setImported(token);
      setAddressInput("");
      setQuery("");
      onSelect(token);
    } catch (error) {
    setImportError(error instanceof Error ? error.message : `Token could not be read from ${networkLabel}.`);
    } finally {
      setImportBusy(false);
    }
  }

  function renderToken(token: PickerToken) {
    const isSelected = selected?.toLowerCase() === token.address.toLowerCase();
    const label = token.statusLabel ?? (token.status === "detected" ? "Detected · no route" : "Route available");
    return (
      <button
        type="button"
        role="option"
        aria-label={`${token.name} (${token.symbol})`}
        aria-selected={isSelected}
        aria-disabled={token.disabled || undefined}
        className={`token-picker-item ${token.status === "detected" ? "token-picker-item-detected" : ""}`}
        disabled={busy || token.disabled}
        onClick={() => onSelect(token)}
      >
        <TokenImage src={token.image} name={token.name} size={40} />
        <span className="token-picker-item-copy">
          <strong>{token.name}</strong>
          <small>{token.symbol} · {token.address.slice(0, 6)}…{token.address.slice(-4)}</small>
        </span>
        <span className={`token-picker-status ${token.status === "detected" ? "muted" : ""}`}>
          {isSelected && <Check size={12} />}
          {label}
        </span>
        <ArrowRight size={15} className="token-picker-arrow" />
      </button>
    );
  }

  return (
    <FormDialog open={open} onOpenChange={value => value ? onOpenChange(true) : close()} busy={busy || importBusy} title={title} description={description}>
      <div className="token-picker-shell">
        <div className="token-picker-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label={searchLabel}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={searchLabel}
            autoComplete="off"
          />
          {query && <button type="button" className="token-picker-clear" aria-label="Clear token search" onClick={() => setQuery("")}><X size={14} /></button>}
        </div>

        {onImport && (
          <form className="token-picker-import" onSubmit={event => void importToken(event)}>
            <div>
              <span className="token-picker-import-label">Can&apos;t find a token?</span>
              <span className="token-picker-import-help">Paste an {networkLabel} ERC-20 address to read it live.</span>
            </div>
            <div className="token-picker-import-controls">
              <input
                aria-label="Import token address"
                value={addressInput}
                onChange={event => setAddressInput(event.target.value)}
                placeholder="0x…"
                inputMode="text"
                autoComplete="off"
              />
              <button type="submit" className="btn-secondary token-picker-import-button" disabled={importBusy || !addressInput.trim()}>
                {importBusy ? <LoaderCircle size={14} className="spin" /> : "Detect"}
              </button>
            </div>
            {importError && <p className="token-picker-feedback error"><AlertCircle size={14} />{importError}</p>}
            {imported && !importError && <p className="token-picker-feedback success"><Check size={14} />{imported.symbol} detected from {networkLabel} RPC.</p>}
          </form>
        )}

        <div className="token-picker-list" role="listbox" aria-label={`${networkLabel} tokens`}>
          {routeTokens.length > 0 && <p className="token-picker-section">Available routes</p>}
          {routeTokens.map(token => <Fragment key={`route-${token.address}`}>{renderToken(token)}</Fragment>)}
          {detectedTokens.length > 0 && <p className="token-picker-section">Detected on {networkLabel}</p>}
          {detectedTokens.map(token => <Fragment key={`detected-${token.address}`}>{renderToken(token)}</Fragment>)}
          {!routeTokens.length && !detectedTokens.length && <p className="token-picker-empty">No Arc tokens match that search.</p>}
        </div>
      </div>
    </FormDialog>
  );
}
