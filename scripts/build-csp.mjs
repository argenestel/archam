import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CSP_PLACEHOLDER = '__NEXT_INLINE_SCRIPT_HASHES__';

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(option + ' requires a value');
  return value;
}

export function parseArgs(args = []) {
  const options = {
    outputDir: 'out',
    config: 'deploy/nginx.conf',
    output: '/tmp/nginx.conf',
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--output-dir' || arg === '--dir') {
      options.outputDir = valueAfter(args, index, arg);
      index++;
    } else if (arg.startsWith('--output-dir=') || arg.startsWith('--dir=')) {
      options.outputDir = arg.slice(arg.indexOf('=') + 1);
    } else if (arg === '--config') {
      options.config = valueAfter(args, index, arg);
      index++;
    } else if (arg.startsWith('--config=')) {
      options.config = arg.slice('--config='.length);
    } else if (arg === '--output') {
      options.output = valueAfter(args, index, arg);
      index++;
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else {
      throw new Error('Unknown option: ' + arg);
    }
  }

  return options;
}

function htmlFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && file.endsWith('.html')) files.push(file);
    }
  };
  visit(directory);
  return files.sort();
}

export function collectInlineScriptHashes(outputDir) {
  const hashes = new Set();
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  for (const file of htmlFiles(outputDir)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(scriptPattern)) {
      if (/\bsrc\s*=/i.test(match[1])) continue;
      const body = match[2];
      if (!body.trim()) continue;
      hashes.add("'sha256-" + crypto.createHash('sha256').update(body).digest('base64') + "'");
    }
  }

  return [...hashes].sort();
}

export function renderNginxConfig(template, hashes) {
  if (!template.includes(CSP_PLACEHOLDER)) {
    throw new Error('nginx config is missing ' + CSP_PLACEHOLDER);
  }
  return template.replace(CSP_PLACEHOLDER, hashes.join(' '));
}

export function buildCspConfig({ outputDir, config, output }) {
  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    throw new Error('static export directory does not exist: ' + outputDir);
  }
  if (!fs.existsSync(config) || !fs.statSync(config).isFile()) {
    throw new Error('nginx config does not exist: ' + config);
  }

  const hashes = collectInlineScriptHashes(outputDir);
  const rendered = renderNginxConfig(fs.readFileSync(config, 'utf8'), hashes);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, rendered);
  return { output, hashes };
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Usage: node scripts/build-csp.mjs [--output-dir out] [--config deploy/nginx.conf] [--output /tmp/nginx.conf]',
    );
    return;
  }

  const result = buildCspConfig(options);
  console.log(
    'Wrote ' + result.output + ' with ' + result.hashes.length + ' inline script hash(es)',
  );
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedFile) {
  try {
    runCli();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
