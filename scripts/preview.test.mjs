import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, test } from 'node:test';
import { createPreviewServer, parseArgs } from './preview.mjs';

const listen = (server) =>
  new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });

const startPreview = async (options) => {
  const server = createPreviewServer(options);
  await listen(server);
  return server;
};

const close = (server) =>
  new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
  });

const readRequest = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
};

const requestRaw = (baseUrl, path) =>
  new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const request = httpRequest(
      { hostname: url.hostname, path, port: url.port, method: 'GET' },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ body: Buffer.concat(chunks).toString(), response }));
      },
    );
    request.on('error', reject);
    request.end();
  });

describe('static export preview server', () => {
  let directory;
  let fixture;
  let fixtureBase;
  let preview;
  let base;
  let outsideDirectory;
  let lastFixtureRequest;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arc-preview-'));
    outsideDirectory = await mkdtemp(join(tmpdir(), 'arc-preview-outside-'));
    await mkdir(join(directory, '_next', 'static'), { recursive: true });
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'index.html'), '<!doctype html><main>preview shell</main>');
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("asset");');
    await writeFile(join(directory, '_next', 'static', 'chunk.js'), 'export default 1;');
    await writeFile(join(outsideDirectory, 'outside.txt'), 'outside secret');

    fixture = createServer(async (request, response) => {
      const body = await readRequest(request);
      lastFixtureRequest = {
        body,
        headers: request.headers,
        method: request.method,
        url: request.url,
      };
      if (request.url?.startsWith('/api/media')) {
        response.writeHead(201, {
          'Content-Type': 'application/vnd.preview+json',
          'X-Fixture': 'media',
        });
        response.end(JSON.stringify(lastFixtureRequest));
        return;
      }
      if (request.url?.startsWith('/')) {
        response.writeHead(202, {
          'Content-Type': 'application/vnd.preview-rpc+json',
          'X-Fixture': 'rpc',
        });
        response.end(JSON.stringify(lastFixtureRequest));
        return;
      }
      response.writeHead(404).end();
    });
    const fixturePort = await listen(fixture);
    fixtureBase = `http://127.0.0.1:${fixturePort}`;

    preview = await startPreview({
      directory,
      host: '127.0.0.1',
      mediaTarget: fixtureBase,
      port: 0,
      rpcTargets: { '/api/arc-rpc': fixtureBase },
    });
    base = `http://127.0.0.1:${preview.address().port}`;
  });

  after(async () => {
    await close(preview);
    await close(fixture);
    await rm(directory, { force: true, recursive: true });
    await rm(outsideDirectory, { force: true, recursive: true });
  });

  test('serves the shell, Next assets, and SPA routes with safe static behavior', async () => {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.equal(root.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await root.text(), /preview shell/);

    const asset = await fetch(`${base}/_next/static/chunk.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');

    const route = await fetch(`${base}/swap/0xabc?tab=pool`);
    assert.equal(route.status, 200);
    assert.match(await route.text(), /preview shell/);

    assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
    assert.equal(
      (await requestRaw(base, `/assets/%2e%2e/${basename(outsideDirectory)}/outside.txt`)).response
        .statusCode,
      404,
    );
    assert.equal(
      (await requestRaw(base, `/%2e%2e/${basename(outsideDirectory)}/outside.txt`)).response
        .statusCode,
      404,
    );
  });

  test('forwards media requests, query strings, headers, and streamed request bodies', async () => {
    const payload = JSON.stringify({ upload: 'fixture', bytes: [1, 2, 3] });
    const response = await fetch(`${base}/api/media/upload?mode=raw`, {
      body: payload,
      headers: { 'content-type': 'application/json', 'x-preview-test': 'kept' },
      method: 'POST',
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('content-type'), 'application/vnd.preview+json');
    assert.equal(response.headers.get('x-fixture'), 'media');
    const forwarded = JSON.parse(await response.text());
    assert.equal(forwarded.method, 'POST');
    assert.equal(forwarded.url, '/api/media/upload?mode=raw');
    assert.equal(forwarded.body, payload);
    assert.equal(forwarded.headers['x-preview-test'], 'kept');
  });

  test('rewrites each configured RPC route to the upstream root while preserving the query', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId' });
    const response = await fetch(`${base}/api/arc-rpc?source=test`, {
      body: payload,
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('content-type'), 'application/vnd.preview-rpc+json');
    const forwarded = JSON.parse(await response.text());
    assert.equal(forwarded.url, '/?source=test');
    assert.equal(forwarded.body, payload);
  });

  test('accepts the preserved CLI options', () => {
    assert.deepEqual(parseArgs(['--dir', 'out-mainnet', '--host=127.0.0.1', '--port', '5194']), {
      directory: 'out-mainnet',
      host: '127.0.0.1',
      port: 5194,
    });
  });

  test('returns 502 for an unavailable or timed-out upstream', async () => {
    const unavailable = createPreviewServer({
      directory,
      host: '127.0.0.1',
      mediaTarget: 'http://127.0.0.1:1',
      port: 0,
      timeout: 100,
    });
    await listen(unavailable);
    const unavailableBase = `http://127.0.0.1:${unavailable.address().port}`;
    const failed = await fetch(`${unavailableBase}/api/media/fail`);
    assert.equal(failed.status, 502);
    await close(unavailable);

    const hanging = createServer(() => {});
    const hangingPort = await listen(hanging);
    const timed = createPreviewServer({
      directory,
      host: '127.0.0.1',
      mediaTarget: `http://127.0.0.1:${hangingPort}`,
      port: 0,
      timeout: 40,
    });
    await listen(timed);
    const timedBase = `http://127.0.0.1:${timed.address().port}`;
    const timedOut = await fetch(`${timedBase}/api/media/slow`);
    assert.equal(timedOut.status, 502);
    await close(timed);
    await close(hanging);
  });
});
