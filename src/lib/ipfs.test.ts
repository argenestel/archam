import { expect, it } from 'vitest';
import { ipfsUrl } from './ipfs';
it('resolves IPFS URIs only to the configured Pinata gateway', () => {
  expect(ipfsUrl('ipfs://bafyExample/logo.png')).toBe(
    'https://gateway.pinata.cloud/ipfs/bafyExample/logo.png',
  );
  expect(ipfsUrl('javascript:alert(1)')).toBeUndefined();
  expect(ipfsUrl('https://example.com/logo.png')).toBeUndefined();
  expect(ipfsUrl('ipfs://evil.com?redirect=yes')).toBeUndefined();
  expect(ipfsUrl('')).toBeUndefined();
});
