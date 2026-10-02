import { stringToHex, type Address, type EIP1193Provider } from 'viem';

export function ipfsUrl(uri?: string): string | undefined {
  if (!uri || !/^ipfs:\/\/[a-zA-Z0-9]+(?:\/[a-zA-Z0-9._/-]+)?$/.test(uri)) return undefined;
  return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
}
async function post(path: string, body: unknown) {
  const res = await fetch(`/api/media/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}
export async function mediaRequest(
  path: string,
  payload: unknown,
  address: Address,
  provider: EIP1193Provider,
) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const digest = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const { nonce, message } = await post('challenge', { address, action: path, digest });
  const signature = await provider.request({
    method: 'personal_sign',
    params: [stringToHex(message), address],
  });
  return post(path, { nonce, signature, payload });
}
export async function uploadImage(
  file: File,
  address: Address,
  provider: EIP1193Provider,
): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)
    throw new Error('Use a PNG, JPEG or WebP image under 2 MB');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
  return (await mediaRequest('upload', { data }, address, provider)).uri;
}
export type Profile = {
  address: Address;
  name: string;
  bio: string;
  avatar: string;
  website: string;
  uri: string;
};
