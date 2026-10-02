import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '../styles.css';

export const metadata: Metadata = {
  title: 'Mofu · Launch, trade & lend on Arc',
  description:
    'Mofu — launch, trade and lend on Arc. Fair-launch tokens on a USDC bonding curve, Uniswap V2 swaps and Morpho Blue lending.',
  icons: { icon: { url: '/mofu.svg', type: 'image/svg+xml' } },
  alternates: { canonical: 'https://mofu.lol/' },
};

export const viewport: Viewport = { themeColor: '#f5f6f4' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
