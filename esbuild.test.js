const esbuild = require('esbuild');
const { globSync } = require('glob');

// ── Build the test runner entry ──────────────────────────────────────────────
esbuild.build({
  entryPoints: ['src/test/runTests.ts'],
  bundle: true,
  outfile: 'out/test/runTests.js',
  external: ['vscode', '@vscode/test-electron'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
}).catch(() => process.exit(1));

// ── Bundle unit tests (no vscode API, plain Node) ────────────────────────────
const unitTestFiles = globSync('src/test/unit/**/*.test.ts');
if (unitTestFiles.length > 0) {
  esbuild.build({
    entryPoints: unitTestFiles,
    bundle: true,
    outdir: 'out/test/unit',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
  }).then(() => console.log('[esbuild] unit tests built'))
    .catch(() => process.exit(1));
}

// ── Bundle integration tests (uses vscode API) ───────────────────────────────
const intTestFiles = globSync('src/test/integration/**/*.test.ts');
if (intTestFiles.length > 0) {
  esbuild.build({
    entryPoints: [...intTestFiles, 'src/test/integration/index.ts'],
    bundle: true,
    outdir: 'out/test/integration',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
  }).catch(() => process.exit(1));
}
