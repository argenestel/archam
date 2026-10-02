'use client';

import dynamic from 'next/dynamic';
import ErrorBoundary from '../components/ErrorBoundary';

// Hash routing and browser wallets must initialize only in the browser.
const App = dynamic(() => import('../App'), { ssr: false });

export default function Page() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
