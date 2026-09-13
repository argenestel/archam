"use client";

import { useState } from "react";
import { ArrowRight, ArrowRightLeft, LockKeyhole, Rocket, ShieldCheck, X } from "lucide-react";
import { Dialog } from "@radix-ui/themes";

type PrivacyModal = "launch" | "swap" | null;

export function PrivacyHub({ onNavigate }: { onNavigate: (tab: "Launch" | "Swap") => void }) {
  const [modal, setModal] = useState<PrivacyModal>(null);
  const [launchName, setLaunchName] = useState("");
  const [launchSymbol, setLaunchSymbol] = useState("");
  const [swapAmount, setSwapAmount] = useState("10");
  const [submitted, setSubmitted] = useState<PrivacyModal>(null);

  const closeModal = () => {
    setModal(null);
    setSubmitted(null);
  };

  return (
    <section className="privacy-page">
      <div className="privacy-hero">
        <div>
          <span className="privacy-kicker">Arc Privacy Sector / Preview</span>
          <h1>Private finance, onchain.</h1>
          <p>
            A focused workspace for launches and swaps that can protect sensitive amounts while keeping authorized review in reach.
          </p>
          <div className="privacy-pills" aria-label="Privacy capabilities">
            <span className="privacy-pill">Opt-in privacy</span>
            <span className="privacy-pill">Selective disclosure</span>
            <span className="privacy-pill">View-key ready</span>
          </div>
        </div>

        <aside className="privacy-status-card">
          <ShieldCheck className="privacy-status-icon" size={24} />
          <h2>Privacy preview</h2>
          <p>
            Arc Privacy is not live on this testnet yet. These flows are product previews; existing public launch and swap transactions are unchanged.
          </p>
          <a className="privacy-link" href="https://docs.arc.io/arc/concepts/opt-in-privacy" target="_blank" rel="noreferrer">
            Read Arc&apos;s privacy model <ArrowRight size={14} />
          </a>
        </aside>
      </div>

      <div className="privacy-products">
        <article className="privacy-product-card">
          <Rocket className="privacy-product-icon" size={22} />
          <span className="privacy-eyebrow">Private launchpad</span>
          <h2>Launch with a disclosure policy</h2>
          <p>
            Sketch a token launch with private-by-default amounts, a clear view-key owner, and an audit path for authorized reviewers.
          </p>
          <button className="btn-primary" onClick={() => setModal("launch")}>
            Preview private launch <ArrowRight size={15} />
          </button>
        </article>

        <article className="privacy-product-card">
          <ArrowRightLeft className="privacy-product-icon" size={22} />
          <span className="privacy-eyebrow">Private swap</span>
          <h2>Swap without broadcasting the amount</h2>
          <p>
            Review the future private route, slippage, and disclosure policy before a wallet signs. No private transaction is submitted from this preview.
          </p>
          <button className="btn-primary" onClick={() => setModal("swap")}>
            Preview private swap <ArrowRight size={15} />
          </button>
        </article>
      </div>

      <div className="privacy-note">
        <strong>Prototype boundary:</strong> Arc Testnet currently exposes the public flow. Do not enter production secrets or assume a preview form provides confidentiality.
      </div>

      <div className="privacy-public-links">
        <span>Need the live public flow?</span>
        <button className="btn-secondary" onClick={() => onNavigate("Launch")}>Open launchpad</button>
        <button className="btn-secondary" onClick={() => onNavigate("Swap")}>Open swap</button>
      </div>

      <Dialog.Root open={modal !== null} onOpenChange={open => { if (!open) closeModal(); }}>
        <Dialog.Content className="mofu-dialog privacy-dialog" maxWidth="520px">
          <Dialog.Close>
            <button className="modal-close" aria-label="Close privacy preview" type="button">
              <X size={17} />
            </button>
          </Dialog.Close>

          {modal === "launch" ? (
            <>
              <Dialog.Title>Preview a private launch</Dialog.Title>
              <Dialog.Description>
                Save a launch brief for Arc Privacy. This does not deploy a token or submit a transaction.
              </Dialog.Description>
              <form className="privacy-modal-form" onSubmit={e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "mofu-launch-draft.json"; link.click(); URL.revokeObjectURL(url); setSubmitted("launch"); }}>
                <div className="privacy-form-row">
                  <label>
                    Token name
                    <input name="name" value={launchName} onChange={e => setLaunchName(e.target.value)} placeholder="Confidential Club" required />
                  </label>
                  <label>
                    Ticker
                    <input name="symbol" value={launchSymbol} onChange={e => setLaunchSymbol(e.target.value.toUpperCase())} placeholder="CCLUB" maxLength={10} required />
                  </label>
                </div>
                <label>
                  Disclosure policy
                  <select name="disclosure" defaultValue="private">
                    <option value="private">Private by default</option>
                    <option value="public">Public amounts</option>
                    <option value="mixed">Mixed by pool policy</option>
                  </select>
                </label>
                <label>
                  View-key owner
                  <select name="reviewers" defaultValue="creator">
                    <option value="creator">Creator and authorized reviewers</option>
                    <option value="treasury">Treasury multisig</option>
                    <option value="custom">Configure later</option>
                  </select>
                </label>
                <button className="btn-primary" type="submit">Download launch draft</button>
                {submitted === "launch" && <p className="privacy-confirmation" role="status">Launch draft downloaded. No wallet prompt or transaction was created.</p>}
              </form>
            </>
          ) : (
            <>
              <Dialog.Title>Preview a private swap</Dialog.Title>
              <Dialog.Description>
                Review the intended privacy controls before the Arc Privacy execution layer is available.
              </Dialog.Description>
              <form className="privacy-modal-form" onSubmit={e => { e.preventDefault(); setSubmitted("swap"); }}>
                <div className="privacy-form-row">
                  <label>
                    From
                    <select defaultValue="usdc">
                      <option value="usdc">USDC · public balance</option>
                      <option value="eurc">EURC · public balance</option>
                    </select>
                  </label>
                  <label>
                    To
                    <select defaultValue="private-usdc">
                      <option value="private-usdc">Private USDC</option>
                      <option value="private-eurc">Private EURC</option>
                    </select>
                  </label>
                </div>
                <label>
                  Amount
                  <input inputMode="decimal" value={swapAmount} onChange={e => setSwapAmount(e.target.value)} placeholder="0.00" required />
                </label>
                <label>
                  Disclosure policy
                  <select defaultValue="view-key">
                    <option value="view-key">Share with a view key when needed</option>
                    <option value="private">Keep amount private</option>
                  </select>
                </label>
                <button className="btn-primary" type="submit">Review private route</button>
                {submitted === "swap" && <p className="privacy-confirmation" role="status">Preview ready for {swapAmount || "0"} units. No private swap was submitted.</p>}
              </form>
            </>
          )}

          <div className="privacy-modal-footnote">
            <LockKeyhole size={14} /> Privacy controls depend on Arc&apos;s eventual network and contract support.
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </section>
  );
}
