import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRECTORY = 'out';
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 4173;
const DEFAULT_PROXY_TIMEOUT = 10_000;

const RPC_TARGETS = Object.freeze({
  '/api/arc-rpc': 'https://rpc.testnet.arc.io',
  '/api/arc-rpc-quicknode': 'https://rpc.quicknode.testnet.arc.io',
  '/api/arc-rpc-drpc': 'https://rpc.drpc.testnet.arc.io',
  '/api/arc-rpc-mainnet': 'https://rpc.mainnet.arc.io',
  '/api/arc-rpc-mainnet-quicknode': 'https://rpc.quicknode.mainnet.arc.io',
  '/api/arc-rpc-mainnet-drpc': 'https://rpc.drpc.mainnet.arc.io',
});

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function contentType(file) {
  return MIME_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
}

function resolveDirectory(directory) {
  const value = directory ?? DEFAULT_DIRECTORY;
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function normalizeTimeout(value) {
  if (value === undefined) return DEFAULT_PROXY_TIMEOUT;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout < 0)
    throw new TypeError('proxy timeout must be a non-negative number');
  return timeout;
}

function targetUrl(value) {
  if (value instanceof URL) return new URL(value.href);
  return new URL(String(value));
}

function proxyHeaders(headers, target) {
  const result = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || value === undefined) continue;
    result[name] = value;
  }
  result.host = target.host;
  return result;
}

function routePath(url, kind) {
  return kind === 'rpc' ? `/${url.search ? url.search : ''}` : `${url.pathname}${url.search}`;
}

function safeDecodedPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.startsWith('.')))
    return null;
  return decoded;
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isAssetPath(pathname) {
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return true;
  if (pathname === '/_next' || pathname.startsWith('/_next/')) return true;
  return Boolean(extname(pathname.split('/').at(-1) || ''));
}

function writeError(response, status, message) {
  if (response.destroyed) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = `${message}\n`;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(body);
}

function fileCandidates(directory, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const candidate = resolve(directory, relativePath);
  const root = resolve(directory);
  const outside = relative(root, candidate);
  if (outside === '..' || outside.startsWith(`..${sep}`) || isAbsolute(outside)) return [];
  return [
    candidate,
    candidate.endsWith(sep) ? `${candidate}index.html` : `${candidate}${sep}index.html`,
  ];
}

async function findStaticFile(directory, pathname) {
  const decoded = safeDecodedPath(pathname);
  if (!decoded) return { invalid: true };
  const candidates = fileCandidates(directory, decoded);
  if (!candidates.length) return { invalid: true };

  const root = await realpath(directory).catch(() => resolve(directory));
  for (const candidate of candidates) {
    let resolved;
    try {
      resolved = await realpath(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      return { invalid: true };
    }
    const outside = relative(root, resolved);
    if (outside === '..' || outside.startsWith(`..${sep}`) || isAbsolute(outside))
      return { invalid: true };
    let details;
    try {
      details = await stat(resolved);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      return { invalid: true };
    }
    if (details.isFile()) return { path: resolved, size: details.size };
  }
  return { missing: true };
}

async function serveFile(request, response, file) {
  response.writeHead(200, {
    'Content-Length': file.size,
    'Content-Type': contentType(file.path),
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(file.path);
  stream.on('error', () => {
    if (!response.headersSent) writeError(response, 404, 'Not Found');
    else response.destroy();
  });
  stream.pipe(response);
}

function requestClient(target) {
  return target.protocol === 'https:' ? httpsRequest : httpRequest;
}

function proxyRequest(request, response, targetValue, kind, timeout) {
  let target;
  try {
    target = targetUrl(targetValue);
  } catch {
    writeError(response, 502, 'Bad Gateway');
    request.resume();
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    writeError(response, 502, 'Bad Gateway');
    request.resume();
    return;
  }

  const parsedRequest = new URL(request.url || '/', 'http://localhost');
  const options = {
    headers: proxyHeaders(request.headers, target),
    hostname: target.hostname,
    method: request.method,
    path: routePath(parsedRequest, kind),
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
  };
  const client = requestClient(target);
  let settled = false;
  let responseStarted = false;
  let timedOut = false;
  let upstreamResponse;

  const fail = () => {
    if (settled) return;
    settled = true;
    clientRequest?.destroy();
    if (response.destroyed) return;
    if (response.headersSent) response.destroy();
    else writeError(response, 502, 'Bad Gateway');
  };

  let clientRequest;
  try {
    clientRequest = client(options, (upstream) => {
      upstreamResponse = upstream;
      responseStarted = true;
      if (timeout > 0) upstream.setTimeout(timeout, fail);
      const headers = {};
      for (const [name, value] of Object.entries(upstream.headers)) {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined)
          headers[name] = value;
      }
      response.writeHead(upstream.statusCode || 502, headers);
      if (request.method === 'HEAD') {
        upstream.resume();
        upstream.once('end', () => {
          settled = true;
          response.end();
        });
        return;
      }
      upstream.on('error', fail);
      upstream.pipe(response);
      upstream.once('end', () => {
        settled = true;
      });
    });
  } catch {
    fail();
    request.resume();
    return;
  }

  if (timeout > 0)
    clientRequest.setTimeout(timeout, () => {
      timedOut = true;
      fail();
    });
  clientRequest.once('error', () => {
    if (timedOut || !responseStarted) fail();
  });
  request.once('aborted', () => {
    if (!settled) clientRequest.destroy();
  });
  response.once('close', () => {
    if (!response.writableFinished && !settled) clientRequest.destroy();
  });
  request.pipe(clientRequest);
}

function normalizeOptions(options = {}) {
  const rpcTargets = { ...RPC_TARGETS, ...(options.rpcTargets || {}) };
  return {
    directory: resolveDirectory(options.directory),
    mediaTarget: options.mediaTarget ?? 'http://127.0.0.1:5192',
    rpcTargets,
    timeout: normalizeTimeout(options.timeout),
  };
}

function createPreviewHandler(options = {}) {
  const config = normalizeOptions(options);
  return async function previewHandler(request, response) {
    let url;
    try {
      url = new URL(request.url || '/', 'http://localhost');
    } catch {
      request.resume();
      writeError(response, 400, 'Bad Request');
      return;
    }
    const decodedPath = safeDecodedPath(url.pathname);
    if (!decodedPath) {
      request.resume();
      writeError(response, 404, 'Not Found');
      return;
    }

    const rpcTarget = config.rpcTargets[decodedPath];
    if (rpcTarget) {
      proxyRequest(request, response, rpcTarget, 'rpc', config.timeout);
      return;
    }
    if (decodedPath === '/api/media' || decodedPath.startsWith('/api/media/')) {
      proxyRequest(request, response, config.mediaTarget, 'media', config.timeout);
      return;
    }
    if (isApiPath(decodedPath)) {
      request.resume();
      writeError(response, 404, 'Not Found');
      return;
    }

    let file = await findStaticFile(config.directory, url.pathname);
    if (file.invalid) {
      request.resume();
      writeError(response, 404, 'Not Found');
      return;
    }
    if (!file.path && !isAssetPath(decodedPath)) file = await findStaticFile(config.directory, '/');
    if (!file.path) {
      request.resume();
      writeError(response, 404, 'Not Found');
      return;
    }
    await serveFile(request, response, file);
  };
}

export function createPreviewServer(options = {}) {
  return createHttpServer(createPreviewHandler(options));
}

function listenServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port === undefined ? DEFAULT_PORT : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new TypeError('port must be an integer from 0 to 65535');
  const server = createPreviewServer(options);
  return new Promise((resolveServer, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveServer(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function valueAfter(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseArgs(args = []) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dir') {
      options.directory = valueAfter(args, index, arg);
      index++;
    } else if (arg.startsWith('--dir=')) {
      options.directory = arg.slice('--dir='.length);
    } else if (arg === '--host') {
      options.host =
        args[index + 1] && !args[index + 1].startsWith('-') ? args[++index] : DEFAULT_HOST;
    } else if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length) || DEFAULT_HOST;
    } else if (arg === '--port') {
      options.port = Number(valueAfter(args, index, arg));
      index++;
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535)
  )
    throw new Error('--port must be an integer from 0 to 65535');
  return options;
}

async function ensureBuildOutput(directory) {
  const index = join(resolveDirectory(directory), 'index.html');
  try {
    const details = await stat(index);
    if (details.isFile()) return;
  } catch {
    // Report the same actionable message for a missing or inaccessible export.
  }
  throw new Error(`Preview output is missing ${index}; run pnpm build first.`);
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/preview.mjs [--dir out] [--host 0.0.0.0] [--port 4173]');
    return;
  }
  await ensureBuildOutput(options.directory);
  const server = await listenServer(options);
  const address = server.address();
  const shownAddress =
    typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address);
  console.log(`Preview server running at http://${shownAddress}`);
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedFile) {
  runCli().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
