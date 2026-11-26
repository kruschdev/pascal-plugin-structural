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

// Post-build Turbopack safety gate:
// 1. Zero dynamic `import("./chunk-...")` expressions (prevents file:///ROOT/... cold-load hang in Next.js 16 Turbopack)
// 2. Zero mid-file `'use client'` directives hoisted below imports by Bun.build splitting
const jsFiles: string[] = []
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.js')) jsFiles.push(full)
  }
}
walk(distDir)

const violations: string[] = []
for (const file of jsFiles) {
  const rel = path.relative(rootDir, file)
  const text = fs.readFileSync(file, 'utf8')
  if (/import\s*\(\s*["']\.\/chunk-/.test(text)) {
    violations.push(`${rel}: contains dynamic chunk import("./chunk-...") which breaks Turbopack resolution`)
  }
  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*['"]use client['"];?\s*$/.test(lines[i]!)) {
      violations.push(`${rel}:${i + 1}: mid-file "use client" directive below imports`)
    }
  }
}
if (violations.length > 0) {
  console.error('Post-build Turbopack safety gate FAILED:')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}

console.log(`Built ${result.outputs.length} ESM output(s) + .d.ts declarations into dist/ (Turbopack chunk gate PASSED).`)
