import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Wallet } from 'ethers';
import { createPublicClient, defineChain, formatUnits, http } from 'viem';

export const chain = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  testnet: true,
});
export const rpc = createPublicClient({ chain, transport: http(undefined, { timeout: 20000 }) });
export const walletDir = path.join(os.homedir(), '.local', 'share', 'orbit', 'arc-testnet');
const keystorePath = path.join(walletDir, 'deployer.keystore.json');
const passwordPath = path.join(walletDir, 'deployer.password');
function requirePrivateFile(file) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  ) {
    throw new Error(
      `Unsafe wallet file permissions/ownership: ${file}. Expected owned regular file with mode 0600.`,
    );
  }
}
export async function loadDeployer() {
  requirePrivateFile(keystorePath);
  requirePrivateFile(passwordPath);
  return Wallet.fromEncryptedJson(
    fs.readFileSync(keystorePath, 'utf8'),
    fs.readFileSync(passwordPath, 'utf8'),
  );
}
export async function walletStatus() {
  const json = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
  const address = `0x${json.address.replace(/^0x/, '')}`;
  if ((await rpc.getChainId()) !== chain.id) throw new Error('RPC returned the wrong chain');
  const balance = await rpc.getBalance({ address });
  console.log(
    JSON.stringify(
      {
        network: chain.name,
        chainId: chain.id,
        address,
        nativeUsdc: formatUnits(balance, 18),
        keystorePath,
        privateKeyPrinted: false,
      },
      null,
      2,
    ),
  );
  return { address, balance };
}
async function create() {
  if (fs.existsSync(keystorePath) || fs.existsSync(passwordPath))
    throw new Error('Wallet already exists; refusing to overwrite. Use wallet:status.');
  fs.mkdirSync(walletDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(walletDir, 0o700);
  const password = randomBytes(32).toString('base64url');
  const wallet = Wallet.createRandom();
  const encrypted = await wallet.encrypt(password);
  fs.writeFileSync(passwordPath, password, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(keystorePath, encrypted, { mode: 0o600, flag: 'wx' });
  console.log(
    'Dedicated testnet-only encrypted wallet created. Never send mainnet/real-value funds.',
  );
  await walletStatus();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'create') await create();
    else if (process.argv[2] === 'status') await walletStatus();
    else throw new Error('Usage: node scripts/testnet-wallet.mjs create|status');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
