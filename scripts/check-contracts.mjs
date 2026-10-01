import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
export function compile(extraSources = {}) {
  const file = 'contracts/src/FixedPriceLaunchpad.sol';
  const input = {
    language: 'Solidity',
    sources: { [file]: { content: fs.readFileSync(file, 'utf8') }, ...extraSources },
    settings: {
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (name) => {
        try {
          return { contents: fs.readFileSync(path.join('node_modules', name), 'utf8') };
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
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const output = compile();
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
