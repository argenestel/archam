import { Component, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="product-main">
          <section className="activity-panel">
            <h1>The terminal couldn’t load</h1>
            <p className="dialog-note">
              Reload to reconnect. If you submitted a transaction, check your wallet or the explorer
              before sending it again.
            </p>
            <button className="primary-action" onClick={() => window.location.reload()}>
              Reload terminal
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
