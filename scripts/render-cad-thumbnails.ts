/**
 * Renders a studio-lit 62-item WebGL contact sheet (`assets/cad-material-catalog.png`)
 * plus 62 individual studio thumbnails (`assets/cad/thumbs/<id>.png`) by loading every
 * exported `.glb` via Three.js `GLTFLoader` in headless Chrome, proving all 62 GLBs
 * parse and render cleanly in a real browser.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const cadDir = path.join(rootDir, 'assets', 'cad')
const thumbsDir = path.join(cadDir, 'thumbs')
fs.mkdirSync(thumbsDir, { recursive: true })

const catalogPath = path.join(cadDir, 'catalog.json')
if (!fs.existsSync(catalogPath)) {
  console.error('Missing assets/cad/catalog.json. Run `bun run export:cad` first.')
  process.exit(1)
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
  items: Array<{
    id: string
    name: string
    category: string
    codeRef: string
    dimensionsMm: [number, number, number]
    glbBytes: number
  }>
}

// 6 columns x 11 rows cleanly fits 62 models in a tall studio contact sheet
const COLS = 6
const ROWS = Math.ceil(catalog.items.length / COLS)
const SHEET_W = 1920
const SHEET_H = 110 + ROWS * 244

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px;
    background: #0f172a;
    color: #e2e8f0;
    font-family: system-ui, -apple-system, sans-serif;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14px;
    border-bottom: 1px solid rgba(148,163,184,0.22);
    padding-bottom: 10px;
  }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .sub { font-size: 12px; color: #94a3b8; }
  .grid {
    display: grid;
    grid-template-columns: repeat(${COLS}, 1fr);
    gap: 12px;
  }
  .card {
    background: #1e293b;
    border: 1px solid rgba(148,163,184,0.2);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .thumb {
    width: 100%;
    height: 164px;
    background: radial-gradient(circle at 50% 35%, #334155 0%, #0f172a 100%);
    display: block;
    object-fit: contain;
  }
  .meta { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .title { font-size: 11px; font-weight: 700; color: #f8fafc; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; gap: 6px; }
  .badge { color: #fbbf24; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
<script type="importmap">
{
  "imports": {
    "three": "/three/build/three.module.js",
    "three/addons/": "/three/examples/jsm/"
  }
}
</script>
</head>
<body>
  <header>
    <h1>@kruschdev/pascal-plugin-structural: ${catalog.items.length} Clean-Room MIT Structural CAD Models (.glb)</h1>
    <div class="sub">LVL / Glulam / PSL / Flitch / Steel W-Beams · TJI &amp; Prefab Trusses · Columns &amp; Footings · 47-SKU Simpson-Class Hardware · IRC R302.11/R302.12 Firestops &amp; Cutaways</div>
  </header>
  <div id="grid" class="grid"></div>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const catalog = await (await fetch('/cad/catalog.json')).json();
    const grid = document.getElementById('grid');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(320, 220);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.32;

    const loader = new GLTFLoader();
    let rendered = 0;

    for (const item of catalog.items) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xf8fafc, 0x475569, 1.75));
      const key = new THREE.DirectionalLight(0xffffff, 2.3);
      key.position.set(2.8, 4.2, 3.6);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x93c5fd, 1.15);
      fill.position.set(-3.2, 1.8, 2.0);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xfef3c7, 0.65);
      rim.position.set(0.5, -1.2, -3.0);
      scene.add(rim);

      const gltf = await loader.loadAsync('/cad/' + item.id + '.glb');
      const root = gltf.scene;
      scene.add(root);

      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
      const fov = 34;
      const camera = new THREE.PerspectiveCamera(fov, 320 / 220, Math.max(0.002, radius * 0.01), Math.max(50, radius * 40));

      const isLongSpan = item.id.startsWith('beam-') || item.id.startsWith('ijoist-') || item.id.startsWith('truss-');
      const isTruss = item.id.startsWith('truss-');
      const isCol = item.id.startsWith('col-');
      const isAssembly = item.id.startsWith('assembly-');

      let dir;
      let fitScale = 1.25;
      if (isTruss) {
        dir = new THREE.Vector3(0.24, 0.22, 1.0).normalize();
        fitScale = 1.06;
      } else if (isLongSpan) {
        dir = new THREE.Vector3(0.42, 0.34, 0.92).normalize();
        fitScale = 1.06;
      } else if (isCol) {
        dir = new THREE.Vector3(0.62, 0.34, 0.88).normalize();
        fitScale = 1.24;
      } else if (isAssembly) {
        dir = new THREE.Vector3(0.76, 0.46, 0.90).normalize();
        fitScale = 1.20;
      } else {
        // Connectors & firestops
        dir = new THREE.Vector3(0.72, 0.54, 0.92).normalize();
        fitScale = 1.24;
      }

      const dist = Math.max(radius, 0.03) * fitScale / Math.sin(THREE.MathUtils.degToRad(fov * 0.5));
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.lookAt(center);

      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');

      await fetch('/save-thumb/' + item.id, {
        method: 'POST',
        body: dataUrl,
      });

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<img class="thumb" src="' + dataUrl + '" />' +
        '<div class="meta">' +
          '<div class="title" title="' + item.name + '">' + item.name + '</div>' +
          '<div class="row"><span class="badge">' + item.codeRef + '</span><span>' + (item.glbBytes / 1024).toFixed(1) + ' KB</span></div>' +
          '<div class="row"><span>' + item.id + '</span><span>' + item.dimensionsMm.join('x') + 'mm</span></div>' +
        '</div>';
      grid.appendChild(card);
      rendered += 1;
    }

    document.title = 'READY:' + rendered;
    await fetch('/done');
  </script>
</body>
</html>`

let resolveDone: () => void = () => {}
let doneReceived = false
const donePromise = new Promise<void>((r) => {
  resolveDone = r
})
let savedCount = 0

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname.startsWith('/three/')) {
      const rel = url.pathname.slice('/three/'.length)
      const full = path.join(rootDir, 'node_modules', 'three', rel)
      if (fs.existsSync(full)) {
        return new Response(Bun.file(full), {
          headers: { 'content-type': 'application/javascript; charset=utf-8' },
        })
      }
    }
    if (url.pathname.startsWith('/cad/')) {
      const rel = url.pathname.slice('/cad/'.length)
      const full = path.join(cadDir, rel)
      if (fs.existsSync(full)) {
        return new Response(Bun.file(full))
      }
    }
    if (url.pathname.startsWith('/save-thumb/') && req.method === 'POST') {
      const id = url.pathname.slice('/save-thumb/'.length).replace(/[^a-z0-9.-]/gi, '')
      const dataUrl = await req.text()
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(thumbsDir, `${id}.png`), Buffer.from(b64, 'base64'))
      savedCount += 1
      return new Response('ok')
    }
    if (url.pathname === '/done') {
      doneReceived = true
      resolveDone()
      return new Response('ok')
    }
    return new Response('Not found', { status: 404 })
  },
})

const outSheet = path.join(rootDir, 'assets', 'cad-material-catalog.png')
const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome'
const angleBackend = process.env.CHROME_ANGLE || 'gl-egl'
const chromeArgs = [
  chromeBin,
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--use-gl=angle',
  `--use-angle=${angleBackend}`,
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--virtual-time-budget=45000',
  `--window-size=${SHEET_W},${SHEET_H}`,
  `--screenshot=${outSheet}`,
  `http://127.0.0.1:${server.port}/`,
]

const proc = Bun.spawn(chromeArgs, {
  stdout: 'ignore',
  stderr: 'pipe',
})
const timeoutTimer = setTimeout(() => {
  try {
    proc.kill('SIGKILL')
  } catch {}
}, 90_000)

let exitCode = -1
let stderrText = ''
try {
  exitCode = await proc.exited
  stderrText = await new Response(proc.stderr).text()
} finally {
  clearTimeout(timeoutTimer)
  try {
    proc.kill('SIGKILL')
  } catch {}
  server.stop(true)
}

if (exitCode !== 0 || !fs.existsSync(outSheet)) {
  console.error('Chrome render failed:', stderrText)
  process.exit(1)
}

if (doneReceived) {
  await donePromise
}
if (savedCount !== catalog.items.length) {
  throw new Error(
    `Incomplete CAD thumbnail render: saved ${savedCount}/${catalog.items.length} thumbnails (done signal ${doneReceived ? 'received' : 'not received'}).`,
  )
}
console.log(
  `Rendered ${savedCount}/${catalog.items.length} individual thumbnails + contact sheet (${SHEET_W}x${SHEET_H}, ${Math.round(fs.statSync(outSheet).size / 1024)} KB) at ${outSheet}`,
)
