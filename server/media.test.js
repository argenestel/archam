import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(`0x${'12'.repeat(32)}`);
let server, directory, base;
const realFetch = globalThis.fetch;
beforeAll(async () => {
  directory = await mkdtemp(`${tmpdir()}/orbit-media-`);
  process.env.MEDIA_PORT = '0';
  process.env.MEDIA_DATA_DIR = directory;
  process.env.PINATA_JWT = 'test-not-a-secret';
  vi.stubGlobal('fetch', async (url, options) => {
    if (String(url).startsWith('https://uploads.pinata.cloud/'))
      return new Response(JSON.stringify({ data: { cid: 'bafyTestCid123' } }), { status: 200 });
    return realFetch(url, options);
  });
  ({ server } = await import('./media.mjs'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/media`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  delete process.env.PINATA_JWT;
  delete process.env.MEDIA_PORT;
  delete process.env.MEDIA_DATA_DIR;
});
async function post(path, body) {
  const r = await realFetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function authorize(action, payload) {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const { body } = await post('challenge', { address: account.address, action, digest });
  return {
    nonce: body.nonce,
    signature: await account.signMessage({ message: body.message }),
    payload,
  };
}
it('rejects unauthenticated upload and invalid address', async () => {
  expect((await post('upload', {})).status).toBe(400);
  expect((await post('challenge', { address: 'fake' })).status).toBe(400);
});
it('publishes signed profiles and exposes their IPFS pointer publicly', async () => {
  const payload = { name: 'Alice', bio: 'Arc trader', avatar: '', website: 'https://example.com' };
  const signed = await authorize('profile', payload);
  const result = await post('profile', signed);
  expect(result.status).toBe(200);
  expect(result.body.uri).toBe('ipfs://bafyTestCid123');
  const saved = await (await realFetch(`${base}/profiles/${account.address}`)).json();
  expect(saved.name).toBe('Alice');
  expect(saved.address).toBe(account.address.toLowerCase());
  expect((await post('profile', signed)).status).toBe(400);
});
it('binds signatures to the payload and action', async () => {
  const signed = await authorize('profile', { name: 'Alice', bio: '' });
  expect((await post('profile', { ...signed, payload: { name: 'Mallory', bio: '' } })).status).toBe(
    400,
  );
  expect(
    (await post('upload', await authorize('profile', { name: 'Alice', bio: '' }))).status,
  ).toBe(400);
});
it('rejects SVG and pins a signed PNG upload', async () => {
  expect(
    (
      await post(
        'upload',
        await authorize('upload', { data: Buffer.from('<svg/>').toString('base64') }),
      )
    ).status,
  ).toBe(400);
  const payload = { data: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64') };
  expect((await post('upload', await authorize('upload', payload))).body.uri).toBe(
    'ipfs://bafyTestCid123',
  );
});
it('rejects unsafe profile links', async () => {
  const result = await post(
    'profile',
    await authorize('profile', { name: 'Alice', bio: '', website: 'javascript:alert(1)' }),
  );
  expect(result.status).toBe(400);
});
