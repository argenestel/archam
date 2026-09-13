"use client";

import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import "./privacy.css";

export function PrivacyHub({ onNavigate }: { onNavigate: (tab: "Launch" | "Swap") => void }) {
  return (
    <section className="privacy-page" aria-labelledby="privacy-title">
      <div className="privacy-header">
        <span className="privacy-kicker">Arc Privacy / Preview</span>
        <h1 id="privacy-title">Private finance, onchain.</h1>
        <p>Arc Privacy is not live on this testnet yet. Mofu keeps this area honest until the network exposes a usable private execution layer.</p>
      </div>

      <div className="privacy-status" role="status">
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <span className="privacy-eyebrow">Current status</span>
          <h2>Preview only</h2>
          <p>No private transaction, hidden balance, or view key is created here.</p>
        </div>
        <a className="privacy-link" href="https://docs.arc.io/arc/concepts/opt-in-privacy" target="_blank" rel="noreferrer">
          Read the privacy model <ArrowRight size={14} />
        </a>
      </div>

      <div className="privacy-actions">
        <button className="btn-primary" onClick={() => onNavigate("Launch")}>
          Open public launchpad <ArrowRight size={15} />
        </button>
        <button className="btn-secondary" onClick={() => onNavigate("Swap")}>
          Open public swap <ArrowRight size={15} />
        </button>
      </div>

      <p className="privacy-footnote"><LockKeyhole size={14} /> Wallet-controlled public routes remain available on Arc Testnet.</p>
    </section>
  );
}
