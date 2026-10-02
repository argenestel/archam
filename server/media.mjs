import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { isAddress, verifyMessage } from 'viem';

const port = Number(process.env.MEDIA_PORT || 5192);
const directory = process.env.MEDIA_DATA_DIR || './storage';
await mkdir(directory, { recursive: true });
let profiles = {};
try {
  profiles = JSON.parse(await readFile(`${directory}/profiles.json`, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const challenges = new Map();
const rates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
  rates.clear();
}, 60_000).unref();
const fail = (message) => {
  throw new Error(message);
};
async function pin(file) {
  if (!process.env.PINATA_JWT) fail('Pinata uploads are not configured');
  const form = new FormData();
  form.append('file', file);
  form.append('network', 'public');
  const response = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail('Pinata upload failed; try again later');
  const result = await response.json();
  if (!/^[a-zA-Z0-9]+$/.test(result.data?.cid || '')) fail('Invalid Pinata response');
  return `ipfs://${result.data.cid}`;
}
function image(payload) {
  const data = Buffer.from(payload.data || '', 'base64');
  if (!data.length || data.length > 2 * 1024 * 1024) fail('Image must be under 2 MB');
  const png = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  const webp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  const type = png
    ? 'image/png'
    : jpeg
      ? 'image/jpeg'
      : webp
        ? 'image/webp'
        : fail('Use PNG, JPEG or WebP');
  return new File([data], `logo.${png ? 'png' : jpeg ? 'jpg' : 'webp'}`, { type });
}
let saveQueue = Promise.resolve();
export const server = createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname.startsWith('/api/media/profiles/')) {
      const address = url.pathname.split('/').at(-1);
      if (!isAddress(address)) return reply(400, { error: 'Invalid address' });
      return reply(200, profiles[address.toLowerCase()] || null);
    }
    if (
      req.method !== 'POST' ||
      !['/api/media/challenge', '/api/media/upload', '/api/media/profile'].includes(url.pathname)
    )
      return reply(404, { error: 'Not found' });
    const ip = req.socket.remoteAddress;
    rates.set(ip, (rates.get(ip) || 0) + 1);
    if (rates.get(ip) > 30)
      return reply(429, { error: 'Too many requests; try again in a minute' });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024) {
        reply(413, { error: 'Request too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (url.pathname.endsWith('/challenge')) {
      if (!isAddress(body.address)) fail('Invalid wallet');
      if (!['upload', 'profile'].includes(body.action) || !/^[a-f0-9]{64}$/.test(body.digest || ''))
        fail('Invalid authorization request');
      const nonce = randomBytes(24).toString('hex');
      const message = `Mofu media authorization\nWallet: ${body.address.toLowerCase()}\nAction: ${body.action}\nPayload SHA-256: ${body.digest}\nNonce: ${nonce}\nExpires: ${Date.now() + 300_000}`;
      challenges.set(nonce, {
        address: body.address.toLowerCase(),
        message,
        action: body.action,
        digest: body.digest,
        expires: Date.now() + 300_000,
      });
      return reply(200, { nonce, message });
    }
    const challenge = challenges.get(body.nonce);
    challenges.delete(body.nonce);
    if (
      !challenge ||
      challenge.action !== url.pathname.split('/').at(-1) ||
      challenge.digest !==
        createHash('sha256').update(JSON.stringify(body.payload)).digest('hex') ||
      challenge.expires < Date.now() ||
      !(await verifyMessage({
        address: challenge.address,
        message: challenge.message,
        signature: body.signature,
      }))
    )
      fail('Wallet authorization expired or invalid');
    if (url.pathname.endsWith('/upload'))
      return reply(200, { uri: await pin(image(body.payload)) });
    const p = body.payload;
    if (
      typeof p.name !== 'string' ||
      p.name.length > 40 ||
      typeof p.bio !== 'string' ||
      p.bio.length > 280
    )
      fail('Invalid profile');
    if (p.avatar && !/^ipfs:\/\/[a-zA-Z0-9]+$/.test(p.avatar)) fail('Avatar must be an IPFS image');
    if (
      p.website &&
      (typeof p.website !== 'string' || p.website.length > 200 || !/^https:\/\//.test(p.website))
    )
      fail('Website must use HTTPS');
    const profile = {
      version: 1,
      address: challenge.address,
      name: p.name.trim(),
      bio: p.bio.trim(),
      avatar: p.avatar || '',
      website: p.website || '',
    };
    const uri = await pin(
      new File([JSON.stringify(profile)], 'profile.json', { type: 'application/json' }),
    );
    const record = { ...profile, uri };
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        const next = { ...profiles, [challenge.address]: record };
        await writeFile(`${directory}/profiles.tmp`, JSON.stringify(next));
        await rename(`${directory}/profiles.tmp`, `${directory}/profiles.json`);
        profiles = next;
      });
    await saveQueue;
    reply(200, record);
  } catch (e) {
    reply(400, { error: e.message || 'Media request failed' });
  }
}).listen(port, '127.0.0.1', () => console.log(`Mofu media API on ${port}`));
