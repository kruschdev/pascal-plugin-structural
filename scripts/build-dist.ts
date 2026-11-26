/**
 * Build compiled ESM JavaScript bundles + TypeScript declarations (`dist/`) for all 6 subpath exports
 * so `@kruschdev/pascal-plugin-structural` works identically in Node 20/22 ESM, Bun, Next.js, Vite,
 * Webpack, and headless MCP servers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(rootDir, 'dist')

fs.rmSync(distDir, { recursive: true, force: true })

const entrypoints = [
  'src/index.ts',
  'src/render.ts',
  'src/irc/index.ts',
  'src/cad/index.ts',
  'src/agent-tools.ts',
  'src/agent-operations.ts',
].map((p) => path.join(rootDir, p))

const result = await Bun.build({
  entrypoints,
  root: path.join(rootDir, 'src'),
  outdir: distDir,
  target: 'browser',
  format: 'esm',
  splitting: true,
  sourcemap: 'none',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'three',
    'zod',
    'zustand',
    '@pascal-app/*',
  ],
  throw: false,
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const tscProc = Bun.spawnSync(
  [path.join(rootDir, 'node_modules', '.bin', 'tsc'), '-p', path.join(rootDir, 'tsconfig.build.json')],
  { cwd: rootDir, stdout: 'inherit', stderr: 'inherit' },
)
if (tscProc.exitCode !== 0) {
  process.exit(tscProc.exitCode ?? 1)
}

console.log(`Built ${result.outputs.length} ESM output(s) + .d.ts declarations into dist/.`)
