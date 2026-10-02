import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCspConfig, renderNginxConfig } from './build-csp.mjs';

test('deployment CSP hashes exact inline script bytes across exported pages', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mofu-csp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputDir = join(directory, 'out');
  await mkdir(join(outputDir, 'nested'), { recursive: true });
  const script = 'self.__next_f.push([1,"Mofu · Arc"]);\n';
  await writeFile(
    join(outputDir, 'index.html'),
    `<script src="/bundle.js">ignored</script><script>${script}</script>`,
  );
  await writeFile(
    join(outputDir, 'nested', 'index.html'),
    `<script>${script}</script><script> </script>`,
  );
  const config = join(directory, 'nginx.conf');
  const template = "script-src 'self' __NEXT_INLINE_SCRIPT_HASHES__; object-src 'none';";
  await writeFile(config, template);
  const output = join(directory, 'rendered.conf');
  const result = buildCspConfig({ outputDir, config, output });
  const expectedHash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
  assert.deepEqual(result.hashes, [expectedHash]);
  assert.equal(
    await readFile(output, 'utf8'),
    `script-src 'self' ${expectedHash}; object-src 'none';`,
  );
});

test('deployment CSP rejects a template that cannot receive the generated hashes', () => {
  assert.throws(() => renderNginxConfig("script-src 'self';", []), /missing/);
});
