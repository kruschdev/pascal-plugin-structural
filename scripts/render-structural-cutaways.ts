/**
 * Renders a high-resolution 4-panel studio showcase (`assets/demo-structural-cutaways.png`, 1920x760)
 * of the 4 flagship 3D Structural Assembly Cutaways (Wall Framing & Window Header, TJI I-Joist & LVL
 * Girder Floor System, Fink Roof Truss & H2.5A Hurricane-Tie Heel, and IRC R602.10 Seismic Braced Shear
 * Wall with Dual HDU5 Hold-Downs & BP3x3 Washers) via Three.js GLTFLoader in headless Chrome.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const cadDir = path.join(rootDir, 'assets', 'cad')
const outImg = path.join(rootDir, 'assets', 'demo-structural-cutaways.png')

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px;
    width: 1920px;
    height: 760px;
    overflow: hidden;
    background: #0b1220;
    color: #e2e8f0;
    font-family: system-ui, -apple-system, sans-serif;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(148,163,184,0.22);
  }
  h1 { margin: 0; font-size: 19px; }
  .sub { font-size: 12px; color: #94a3b8; }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }
  .panel {
    background: #111c32;
    border: 1px solid rgba(148,163,184,0.25);
    border-radius: 12px;
    overflow: hidden;
  }
  img {
    width: 100%;
    height: 586px;
    object-fit: cover;
    display: block;
    background: radial-gradient(circle at 50% 40%, #1c2c4a 0%, #0b1220 100%);
  }
  .cap { padding: 10px 14px; }
  .cap strong { display: block; font-size: 13px; color: #f8fafc; margin-bottom: 3px; }
  .cap span { font-size: 11px; color: #94a3b8; line-height: 1.3; display: block; }
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
    <h1>3D Structural Assembly Cutaways: Walls &amp; Headers, TJI Floor, Fink Roof Truss, and Seismic Shear Wall</h1>
    <div class="sub">Clean-room MIT Three.js PBR geometry from @kruschdev/pascal-plugin-structural/cad (62 binary .glb models · 47 Simpson-class connector SKUs)</div>
  </header>
  <div id="grid" class="grid"></div>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const shots = [
      {
        id: 'assembly-wall-framing',
        title: '1. Wall Framing & Window Header (IRC R602.7)',
        sub: '2x6 DF-L #2 studs @ 16" OC, PT mudsill, double 2x10 header w/ spacer, kings, jacks & fire blocking',
        dir: [0.54, 0.24, 1.08],
        fitScale: 1.15,
      },
      {
        id: 'assembly-floor-system',
        title: '2. TJI I-Joist & LVL Girder Floor (IRC R502)',
        sub: '2-ply 2.0E LVL carrying girder, TJI-230 I-joists on IUS hangers, rim board & OSB subfloor',
        dir: [0.80, 0.56, 0.88],
        fitScale: 1.32,
      },
      {
        id: 'assembly-roof-system',
        title: '3. Fink Roof Truss & H2.5A Ties (IRC R802.10)',
        sub: '6:12 pitched Fink W-web trusses @ 24" OC, galvanized gang-nail gusset plates & H2.5A uplift ties',
        dir: [0.72, 0.42, 0.96],
        fitScale: 1.22,
      },
      {
        id: 'assembly-braced-wall-line',
        title: '4. Seismic Braced Shear Wall (IRC R602.10)',
        sub: '48" braced wall panel on stemwall w/ dual HDU5 hold-downs, BP3x3 plate washers & OSB sheathing',
        dir: [0.66, 0.30, 1.02],
        fitScale: 1.14,
      },
    ];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(460, 586);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;

    const loader = new GLTFLoader();
    const grid = document.getElementById('grid');

    for (const s of shots) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xf8fafc, 0x475569, 1.65));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(2.4, 3.6, 3.2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x93c5fd, 1.05);
      fill.position.set(-2.6, 1.4, 2.2);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xfef3c7, 0.6);
      rim.position.set(-1.5, 2.0, -3.0);
      scene.add(rim);

      const gltf = await loader.loadAsync('/cad/' + s.id + '.glb');
      scene.add(gltf.scene);

      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const radius = box.getBoundingSphere(new THREE.Sphere()).radius;

      const fov = 36;
      const camera = new THREE.PerspectiveCamera(fov, 460 / 586, 0.01, Math.max(40, radius * 30));
      const dir = new THREE.Vector3(s.dir[0], s.dir[1], s.dir[2]).normalize();
      const dist = (radius * s.fitScale) / Math.sin(THREE.MathUtils.degToRad(fov * 0.5));
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.lookAt(center);
      renderer.render(scene, camera);

      const card = document.createElement('div');
      card.className = 'panel';
      card.innerHTML =
        '<img src="' + renderer.domElement.toDataURL('image/png') + '" />' +
        '<div class="cap"><strong>' + s.title + '</strong><span>' + s.sub + '</span></div>';
      grid.appendChild(card);
    }
    document.title = 'DONE';
  </script>
</body>
</html>`

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname.startsWith('/three/')) {
      const full = path.join(rootDir, 'node_modules', 'three', url.pathname.slice('/three/'.length))
      if (fs.existsSync(full)) {
        return new Response(Bun.file(full), { headers: { 'content-type': 'application/javascript; charset=utf-8' } })
      }
    }
    if (url.pathname.startsWith('/cad/')) {
      const full = path.join(cadDir, url.pathname.slice('/cad/'.length))
      if (fs.existsSync(full)) return new Response(Bun.file(full))
    }
    return new Response('Not found', { status: 404 })
  },
})

const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome'
const angleBackend = process.env.CHROME_ANGLE || 'gl-egl'
const proc = Bun.spawn(
  [
    chromeBin,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    `--use-angle=${angleBackend}`,
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--virtual-time-budget=25000',
    '--window-size=1920,760',
    `--screenshot=${outImg}`,
    `http://127.0.0.1:${server.port}/`,
  ],
  { stdout: 'ignore', stderr: 'pipe' },
)

const timeoutTimer = setTimeout(() => {
  try {
    proc.kill('SIGKILL')
  } catch {}
}, 60_000)

let code = -1
let stderr = ''
try {
  code = await proc.exited
  stderr = await new Response(proc.stderr).text()
} finally {
  clearTimeout(timeoutTimer)
  try {
    proc.kill('SIGKILL')
  } catch {}
  server.stop(true)
}

if (code !== 0 || !fs.existsSync(outImg)) {
  console.error('Structural cutaway render failed:', stderr)
  process.exit(1)
}
console.log(`Rendered structural 3D cutaways showcase (${Math.round(fs.statSync(outImg).size / 1024)} KB) at ${outImg}`)
