import { Component, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="page">
          <section className="card card-pad" style={{ maxWidth: 520, margin: '10vh auto', display: 'grid', gap: 14 }}>
            <h1>Mofu couldn’t load</h1>
            <p className="muted">
              Reload to reconnect. If you submitted a transaction, check your wallet or the explorer
              before sending it again.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
