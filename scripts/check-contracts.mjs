import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
export function compile(extraSources = {}) {
  const own = [
    'contracts/src/FixedPriceLaunchpad.sol',
    'contracts/src/MofuLaunch.sol',
    'contracts/src/MofuTestnetOracle.sol',
  ];
  const input = {
    language: 'Solidity',
    sources: {
      ...Object.fromEntries(own.map((f) => [f, { content: fs.readFileSync(f, 'utf8') }])),
      ...extraSources,
    },
    settings: {
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (name) => {
        try {
          const file = name.startsWith('contracts/') ? name : path.join('node_modules', name);
          return { contents: fs.readFileSync(file, 'utf8') };
        } catch {
          return { error: `Missing import ${name}` };
        }
      },
    }),
  );
  for (const error of output.errors || []) {
    if (error.severity === 'error') throw new Error(error.formattedMessage);
    else console.warn(error.formattedMessage);
  }
  return output.contracts;
}
// Canonical Morpho Blue + AdaptiveCurveIrm, built with upstream foundry.toml settings.
// Source unit names mirror the upstream repositories so relative imports resolve unchanged.
const vendor = 'contracts/vendor';
function vendorPath(name) {
  if (name.startsWith('lib/morpho-blue/')) return path.join(vendor, 'morpho-blue', name.slice(16));
  if (name.startsWith('src/adaptive-curve-irm/'))
    return path.join(vendor, 'morpho-blue-irm', name.slice(4));
  if (name.startsWith('src/')) return path.join(vendor, 'morpho-blue', name);
  return null;
}
export async function compileMorpho() {
  const { default: solc0819 } = await import('solc-0.8.19');
  const sources = {};
  for (const name of ['src/Morpho.sol', 'src/adaptive-curve-irm/AdaptiveCurveIrm.sol'])
    sources[name] = { content: fs.readFileSync(vendorPath(name), 'utf8') };
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      viaIR: true,
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 999999 },
      metadata: { bytecodeHash: 'none' },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(
    solc0819.compile(JSON.stringify(input), {
      import: (name) => {
        const file = vendorPath(name);
        try {
          return { contents: fs.readFileSync(file, 'utf8') };
        } catch {
          return { error: `Missing import ${name}` };
        }
      },
    }),
  );
  for (const error of output.errors || [])
    if (error.severity === 'error') throw new Error(error.formattedMessage);
  return {
    Morpho: output.contracts['src/Morpho.sol'].Morpho,
    AdaptiveCurveIrm: output.contracts['src/adaptive-curve-irm/AdaptiveCurveIrm.sol'].AdaptiveCurveIrm,
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const output = compile();
  const morpho = await compileMorpho();
  for (const [name, c] of [
    ['MofuLaunch', output['contracts/src/MofuLaunch.sol'].MofuLaunch],
    ['MofuToken', output['contracts/src/MofuToken.sol'].MofuToken],
    ['MofuTestnetOracle', output['contracts/src/MofuTestnetOracle.sol'].MofuTestnetOracle],
    ['Morpho', morpho.Morpho],
    ['AdaptiveCurveIrm', morpho.AdaptiveCurveIrm],
  ]) {
    const size = c.evm.bytecode.object.length / 2;
    console.log(`${name}: ${size} bytes initcode`);
  }
  const contract = output['contracts/src/FixedPriceLaunchpad.sol'].FixedPriceLaunchpad;
  fs.mkdirSync('contracts/artifacts', { recursive: true });
  fs.writeFileSync(
    'contracts/artifacts/FixedPriceLaunchpad.json',
    JSON.stringify(contract, null, 2),
  );
  console.log(
    `FixedPriceLaunchpad compiled with solc ${solc.version()} (${contract.evm.bytecode.object.length / 2} bytes). NOT audited.`,
  );
}
