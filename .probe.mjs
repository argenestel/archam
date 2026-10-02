import fs from 'node:fs';
import { AppKit } from '@circle-fin/app-kit';
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2';
const kit = new AppKit();
const adapter = createViemAdapterFromPrivateKey({ privateKey: fs.readFileSync('/tmp/claude-1000/-home-arg-projects-hack-arcmicro-archam/14c071f7-db2c-45e6-aed4-5516cbb29a3c/scratchpad/e2e.key','utf8').trim() });
const tryit = async (label, fn) => { try { console.log(label, JSON.stringify(await fn(), (k,v)=>typeof v==='bigint'?v.toString():v).slice(0, 1500)); } catch (e) { console.log(label, 'ERR', e.message?.slice(0,300)); } };
await tryit('estimateSwap', () => kit.estimateSwap({ from: { adapter, chain: 'Arc_Testnet' }, tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '1.00' }));
await tryit('estimateSwap EURC->USDC', () => kit.estimateSwap({ from: { adapter, chain: 'Arc_Testnet' }, tokenIn: 'EURC', tokenOut: 'USDC', amountIn: '1.00' }));
await tryit('swapChains', () => kit.getSupportedChains('swap').filter(c=>/Arc/.test(c.name)).map(c=>c.name));
