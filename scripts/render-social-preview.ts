/**
 * Renders a crisp 1280x640 OpenGraph / GitHub Social Preview / Launch Hero Card
 * (`assets/social-preview.png`) from the live-rendered Pascal Editor screenshots
 * and 4-panel 3D Structural Cutaways showcase.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const assetsDir = path.join(rootDir, 'assets')
const outImg = process.argv[2] ?? path.join(assetsDir, 'social-preview.png')

const toDataUri = (filePath: string): string => {
  if (!fs.existsSync(filePath)) return ''
  return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`
}

const houseImg = toDataUri(path.join(assetsDir, 'demo-stick-rafter.png'))
const cutawaysImg = toDataUri(path.join(assetsDir, 'demo-structural-cutaways.png'))
const schedImg = toDataUri(path.join(assetsDir, 'demo-structural-schedule.png'))

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: 1280px;
    height: 640px;
    background: radial-gradient(circle at 18% 20%, #1e293b 0%, #0b1220 62%, #060b16 100%);
    color: #f8fafc;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
    position: relative;
    padding: 36px 42px;
    display: grid;
    grid-template-columns: 1.02fr 1.18fr;
    gap: 28px;
    align-items: center;
  }
  .grid-bg {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(56,189,248,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(56,189,248,0.05) 1px, transparent 1px);
    background-size: 32px 32px;
    pointer-events: none;
  }
  .left {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    padding: 6px 13px;
    border-radius: 999px;
    background: rgba(245,158,11,0.14);
    border: 1px solid rgba(245,158,11,0.45);
    color: #fbbf24;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  h1 {
    margin: 0;
    font-size: 40px;
    line-height: 1.08;
    letter-spacing: -0.025em;
    font-weight: 800;
  }
  h1 span { color: #f59e0b; }
  .lead {
    margin: 0;
    font-size: 16px;
    line-height: 1.48;
    color: #cbd5e1;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 4px;
  }
  .stat {
    background: rgba(15,23,42,0.75);
    border: 1px solid rgba(148,163,184,0.22);
    border-radius: 10px;
    padding: 11px 12px;
  }
  .stat .num {
    font-size: 22px;
    font-weight: 800;
    color: #f8fafc;
    line-height: 1.1;
  }
  .stat .num.amber { color: #fbbf24; }
  .stat .num.emerald { color: #34d399; }
  .stat .num.sky { color: #38bdf8; }
  .stat .lbl {
    font-size: 11px;
    color: #94a3b8;
    margin-top: 3px;
    font-weight: 600;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 2px;
  }
  .tag {
    padding: 5px 10px;
    border-radius: 6px;
    background: rgba(30,41,59,0.85);
    border: 1px solid rgba(148,163,184,0.2);
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
  }
  .footer {
    font-size: 13px;
    color: #94a3b8;
    font-weight: 600;
    margin-top: 4px;
  }
  .footer strong { color: #f8fafc; }

  .right {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    justify-content: center;
  }
  .hero-frame {
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid rgba(245,158,11,0.42);
    box-shadow: 0 20px 44px rgba(0,0,0,0.55);
    background: #0f172a;
    position: relative;
  }
  .hero-frame img {
    width: 100%;
    height: 332px;
    object-fit: cover;
    object-position: center 48%;
    display: block;
  }
  .badge-cap {
    position: absolute;
    bottom: 8px;
    left: 10px;
    padding: 4px 9px;
    border-radius: 6px;
    background: rgba(10,15,28,0.86);
    border: 1px solid rgba(148,163,184,0.28);
    font-size: 11px;
    font-weight: 700;
    color: #f8fafc;
  }
  .sub-row {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 12px;
  }
  .sub-frame {
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid rgba(148,163,184,0.28);
    box-shadow: 0 14px 32px rgba(0,0,0,0.45);
    background: #0f172a;
    position: relative;
  }
  .sub-frame img {
    width: 100%;
    height: 204px;
    object-fit: cover;
    display: block;
  }
  .sub-frame.cutaway-crop img {
    object-position: 36% 42%;
    transform: scale(1.18);
    transform-origin: center 45%;
  }
  .sub-frame.sched-crop img {
    object-position: 100% 16%;
    transform: scale(1.28);
    transform-origin: right top;
  }
</style>
</head>
<body>
  <div class="grid-bg"></div>
  <div class="left">
    <div class="pill">MIT OPEN SOURCE · PASCAL PLUGIN API v1</div>
    <h1>Pascal Plugin <span>Structural</span></h1>
    <p class="lead">
      Residential &amp; light-commercial IRC / AWC NDS framing, engineered LVL / Glulam / PSL / steel beams,
      full-building 3D Framing X-Ray, IRC R302.11 fire blocking, continuous load paths, and priced BOM takeoffs.
    </p>
    <div class="stats">
      <div class="stat"><div class="num amber">62</div><div class="lbl">MIT 3D CAD .glb Models</div></div>
      <div class="stat"><div class="num sky">47</div><div class="lbl">Simpson-Class SKUs</div></div>
      <div class="stat"><div class="num emerald">55/55</div><div class="lbl">IRC &amp; NDS Tests</div></div>
    </div>
    <div class="tags">
      <span class="tag">Priority #1 MEP Right-of-Way</span>
      <span class="tag">Stick Rafters &amp; Fink Trusses</span>
      <span class="tag">IRC R302.11/R302.12 Firestops</span>
      <span class="tag">9 Pure Zod Agent Tools</span>
    </div>
    <div class="footer"><strong>github.com/kruschdev/pascal-plugin-structural</strong> · @kruschdev</div>
  </div>
  <div class="right">
    <div class="hero-frame">
      <img src="${houseImg}" />
      <div class="badge-cap">Live Pascal Editor · Full-Building 3D Framing X-Ray &amp; IRC Auto-Frame</div>
    </div>
    <div class="sub-row">
      <div class="sub-frame cutaway-crop">
        <img src="${cutawaysImg}" />
        <div class="badge-cap">3D Structural Cutaways · Walls, TJI, Trusses &amp; Shear</div>
      </div>
      <div class="sub-frame sched-crop">
        <img src="${schedImg}" />
        <div class="badge-cap">7-Tab Structural Schedule &amp; Priced BOM</div>
      </div>
    </div>
  </div>
</body>
</html>`

const tmpHtml = path.join(os.tmpdir(), 'pascal_structural_social_preview.html')
fs.writeFileSync(tmpHtml, html)

const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome'
const proc = Bun.spawn(
  [
    chromeBin,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--window-size=1280,640',
    `--screenshot=${outImg}`,
    `file://${tmpHtml}`,
  ],
  { stdout: 'ignore', stderr: 'pipe' },
)
const timeoutTimer = setTimeout(() => {
  try {
    proc.kill('SIGKILL')
  } catch {}
}, 45_000)

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
  fs.rmSync(tmpHtml, { force: true })
}
if (code !== 0 || !fs.existsSync(outImg)) {
  console.error('Social preview render failed:', stderr)
  process.exit(1)
}
console.log(`Rendered social preview (${Math.round(fs.statSync(outImg).size / 1024)} KB) at ${outImg}`)
