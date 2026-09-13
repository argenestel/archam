// Local-chain integration check. Never signs on a public RPC.
// Start: anvil --chain-id 5042002 --port 8547
import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { readFileSync } from 'node:fs';
const chain = defineChain({ id: 5042002, name: 'Local Arc simulation', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8547'] } } });
const transport = http('http://127.0.0.1:8547');
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport });
const [account] = await wallet.getAddresses();
const artifact = name => JSON.parse(readFileSync(new URL(`../../contracts/out/CurveLaunchpad.sol/${name}.json`, import.meta.url)));
const factoryArtifact = artifact('CurveLaunchpad');
const tokenArtifact = artifact('CurveToken');
const mined = async hash => { const r = await client.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw Error('Reverted'); return r; };
const factory = (await mined(await wallet.deployContract({ account, abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode.object }))).contractAddress;
for (const [name, symbol, description, icon, amount] of [
  ['Little Frog', 'FROG', 'Small frog. Big pond.', '/token-images/frog.svg', 85000n],
  ['Moon Cat', 'MCAT', 'A cat with nowhere to be but the moon.', '🐈', 150000n],
  ['Mofu', 'MOFU', 'Soft starts. Good company.', '/token-images/mofu.svg', 40000n],
]) {
  await mined(await wallet.writeContract({ account, address: factory, abi: factoryArtifact.abi, functionName: 'createToken', args: [name, symbol, description, icon] }));
  const count = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'tokenCount' });
  const token = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'tokens', args: [count - 1n] });
  const value = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'quoteBuy', args: [amount] });
  await mined(await wallet.writeContract({ account, address: token, abi: tokenArtifact.abi, functionName: 'buy', args: [amount, value, 9999999999n], value }));
  const sold = amount / 10n;
  const proceeds = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'quoteSell', args: [sold] });
  await mined(await wallet.writeContract({ account, address: token, abi: tokenArtifact.abi, functionName: 'sell', args: [sold, proceeds, 9999999999n] }));
  const supply = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'totalSupply' });
  if (supply !== (amount - sold) * 10n ** 18n) throw Error('Supply mismatch');
  const reserve = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'reserveAt', args: [amount - sold] });
  if (await client.getBalance({ address: token }) !== reserve) throw Error('Reserve mismatch');
}
console.log(JSON.stringify({ factory, account, result: 'PASS: created 3 coins, bought and sold each, verified supplies and reserves' }));
