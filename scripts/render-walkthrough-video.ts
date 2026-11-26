/**
 * Real Pascal Editor Walkthrough Video Recorder for `@kruschdev/pascal-plugin-structural`.
 *
 * Connects Puppeteer to a live running Pascal Editor host (`PASCAL_EDITOR_URL`, e.g.
 * `http://127.0.0.1:3210/project/structural-media-showcase`) with `@kruschdev/pascal-plugin-structural`
 * loaded, drives real clicks, dropdown switches, and 3D camera orbits across:
 *   1. One-Click IRC/NDS Auto-Frame (2x6 DF-L #2 walls, TJI I-joists, Stick Rafters, LVL headers & ridge)
 *   2. Live Roof & Floor System Switching (Open-Web Floor Truss + Prefab Fink W-Truss w/ gang-nail plates)
 *   3. Structural Layer Peeling (Walls & Headers close-up) + Quick-Place Engineered Beam, Column & Firestop
 *   4. Split-Pane 7-Tab Structural Engineering Schedule (Beams, Columns, Connectors, Fire Blocking)
 *   5. Continuous Load Path & IRC R602.10 Braced Wall Lines, Live IRC Audit (PASS), and Priced BOM Takeoff
 *
 * Encodes:
 *   - `assets/demo-walkthrough.mp4` (1280x720 H.264 +faststart)
 *   - `assets/demo-walkthrough.gif` (640px wide palette-optimized README preview)
 *   - Clean 1440x810 live screenshots:
 *     `assets/demo-stick-rafter.png`, `assets/demo-fink-truss.png`,
 *     `assets/demo-walls-headers.png`, `assets/demo-structural-schedule.png`
 *
 * Usage:
 *   PASCAL_EDITOR_URL=http://127.0.0.1:3210/project/structural-media-showcase bun run render:walkthrough
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type PuppeteerPageLike = {
  setViewport: (v: { width: number; height: number; deviceScaleFactor: number }) => Promise<void>
  goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<void>
  evaluate: <R = unknown, A = unknown>(fn: (arg: A) => R, arg?: A) => Promise<R>
  screenshot: (opts: { type: 'jpeg' | 'png'; quality?: number }) => Promise<Uint8Array>
  mouse: {
    move: (x: number, y: number, opts?: { steps?: number }) => Promise<void>
    down: (opts?: { button?: 'left' | 'right' | 'middle' }) => Promise<void>
    up: (opts?: { button?: 'left' | 'right' | 'middle' }) => Promise<void>
    click: (x: number, y: number) => Promise<void>
    wheel: (opts: { deltaY: number }) => Promise<void>
  }
  on: (event: string, cb: (arg: { message?: string }) => void) => void
}

type PuppeteerBrowserLike = {
  newPage: () => Promise<PuppeteerPageLike>
  close: () => Promise<void>
  process?: () => { kill: (signal?: NodeJS.Signals | number) => boolean | void } | null
}

type PuppeteerLike = {
  launch: (opts: Record<string, unknown>) => Promise<PuppeteerBrowserLike>
}

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const outMp4 = path.join(rootDir, 'assets', 'demo-walkthrough.mp4')
const outGif = path.join(rootDir, 'assets', 'demo-walkthrough.gif')
const keyframesDir = path.join(os.tmpdir(), 'pascal_structural_walkthrough_keyframes')
const mediaShotsDir = process.env.MEDIA_SHOTS_DIR ?? ''
const refreshRepoShots = process.env.REFRESH_REPO_SHOTS !== '0'
if (mediaShotsDir) fs.mkdirSync(mediaShotsDir, { recursive: true })

const targetUrl = process.env.PASCAL_EDITOR_URL
if (!targetUrl) {
  console.error(
    'Set PASCAL_EDITOR_URL=http://127.0.0.1:3210/project/structural-media-showcase before running render:walkthrough.',
  )
  process.exit(1)
}

const defaultPuppeteerCandidates = [
  process.env.PUPPETEER_MODULE,
  'puppeteer',
  '/home/krusch/homelab/lib/node_modules/puppeteer/lib/puppeteer/puppeteer.js',
].filter((x): x is string => Boolean(x))

let puppeteer: PuppeteerLike | null = null
for (const candidate of defaultPuppeteerCandidates) {
  try {
    const mod = (await import(candidate)) as { default?: PuppeteerLike } & PuppeteerLike
    puppeteer = mod.default ?? mod
    break
  } catch {}
}
if (!puppeteer) {
  console.error('Could not import puppeteer. Set PUPPETEER_MODULE=/path/to/puppeteer.')
  process.exit(1)
}

const chromeBin = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'
const angleBackend = process.env.CHROME_ANGLE ?? 'gl-egl'
const ffmpegBin = process.env.FFMPEG_BIN ?? 'ffmpeg'

fs.mkdirSync(keyframesDir, { recursive: true })

const VIEW_W = 1440
const VIEW_H = 810
const CAPTURE_FPS = 10

const browser = await puppeteer.launch({
  executablePath: chromeBin,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    `--use-angle=${angleBackend}`,
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    `--window-size=${VIEW_W},${VIEW_H}`,
  ],
})

let ffmpeg: Bun.Subprocess<'pipe', 'ignore', 'pipe'> | null = null
let ffmpegFinished = false
let mp4Code = -1
let ffmpegStderr = ''
let totalFrames = 0

try {
  const page = await browser.newPage()
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('PAGEERROR:', e.message))

  console.log(`Opening real Pascal Editor at ${targetUrl}...`)
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Wait until the 3D canvas AND the Structural plugin button (or Plugins rail) are mounted & hydrated
  let sceneReady = false
  for (let i = 0; i < 60; i++) {
    const state = await page
      .evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'))
        const hasCanvas = canvases.some((c) => c.getBoundingClientRect().width > 300)
        const btns = Array.from(document.querySelectorAll('button'))
        const hasStructural = btns.some(
          (b) => b.innerText.trim() === 'Structural' || b.getAttribute('aria-label') === 'Structural',
        )
        const hasPlugins = btns.some(
          (b) => b.innerText.trim() === 'Plugins' || b.getAttribute('aria-label') === 'Plugins',
        )
        return { hasCanvas, hasStructural, hasPlugins }
      })
      .catch(() => ({ hasCanvas: false, hasStructural: false, hasPlugins: false }))
    if (state.hasCanvas && (state.hasStructural || state.hasPlugins)) {
      sceneReady = true
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!sceneReady) {
    throw new Error('Timed out waiting for Pascal Editor 3D canvas and plugin rail to hydrate')
  }
  await new Promise((r) => setTimeout(r, 3500))

  // Dismiss the "Pan / Rotate / Zoom" hint pill if present (run AFTER canvas & rail finish hydrating)
  await page
    .evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'))
      const pill = divs.find((d) => {
        const t = d.innerText ?? ''
        return t.includes('Pan') && t.includes('Rotate') && t.includes('Zoom') && t.length < 150 && d.querySelector('button')
      })
      if (pill) {
        const btns = Array.from(pill.querySelectorAll('button'))
        const closeBtn = btns[btns.length - 1]
        if (closeBtn) closeBtn.click()
      }
    })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 500))

  // Open Structural rail panel
  let structuralPanelOpen = false
  for (let attempt = 0; attempt < 25; attempt++) {
    const hasAutoFrame = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('button')).some((b) => b.innerText.includes('Auto-Frame (IRC/NDS)')),
      )
      .catch(() => false)
    if (hasAutoFrame) {
      structuralPanelOpen = true
      break
    }
    await page
      .evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const structBtn = btns.find(
          (b) => b.innerText.trim() === 'Structural' || b.getAttribute('aria-label') === 'Structural',
        )
        if (structBtn) {
          structBtn.click()
          return
        }
        const plug = btns.find(
          (b) => b.innerText.trim() === 'Plugins' || b.getAttribute('aria-label') === 'Plugins',
        )
        if (plug) plug.click()
      })
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 700))
  }
  if (!structuralPanelOpen) {
    throw new Error('Structural plugin panel did not open (Auto-Frame (IRC/NDS) button not found)')
  }
  await new Promise((r) => setTimeout(r, 1500))

  // Ensure scene starts cleanly in Finished View with no leftover structural nodes
  await page
    .evaluate(() => {
      const clearBtn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Clear')
      if (clearBtn) clearBtn.click()
    })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 700))

  // Inject clean CSS hiding Next.js dev overlay badges, plus chapter banner & cursor ring
  await page.evaluate(() => {
    const hideDevStyle = document.createElement('style')
    hideDevStyle.textContent =
      'nextjs-portal, #__next-build-indicator, [data-nextjs-toast], [data-nextjs-dialog-overlay] {' +
      '  display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;' +
      '}'
    document.head.appendChild(hideDevStyle)

    const pill = document.createElement('div')
    pill.id = '__walkthrough_banner'
    pill.style.cssText =
      'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:99999;' +
      'padding:7px 16px;border-radius:999px;background:rgba(10,15,28,0.92);' +
      'border:1px solid rgba(245,158,11,0.6);color:#f8fafc;font:600 13px/1.2 system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.45);pointer-events:none;white-space:nowrap;'
    pill.textContent = '1 / 5 · Pascal Editor + Structural IRC/NDS Plugin (Ready)'
    document.body.appendChild(pill)

    const cursor = document.createElement('div')
    cursor.id = '__walkthrough_cursor'
    cursor.style.cssText =
      'position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-11px 0 0 -11px;' +
      'border-radius:999px;border:3px solid #f59e0b;background:rgba(245,158,11,0.28);' +
      'box-shadow:0 0 14px rgba(245,158,11,0.75);z-index:99999;pointer-events:none;' +
      'transition:transform 0.14s ease;'
    document.body.appendChild(cursor)
  })

  // Collapse narrow left icon menu before recording so the 32x24 Craftsman house fills the viewport
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.getAttribute('aria-label') === 'Hide menu' || x.innerText.trim() === 'Hide menu',
    )
    if (b) b.click()
  })
  await new Promise((r) => setTimeout(r, 600))

  // Pre-frame the Craftsman 32x24 House cleanly in a crisp full-building 3/4 architectural overview
  const initCanvasCenter = await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('canvas')).find((x) => x.getBoundingClientRect().width > 300)
    const r = c?.getBoundingClientRect()
    return r ? { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) } : { cx: 920, cy: 420 }
  })
  await page.mouse.move(initCanvasCenter.cx, initCanvasCenter.cy)
  await page.mouse.wheel({ deltaY: -45 })
  await new Promise((r) => setTimeout(r, 150))
  await page.mouse.down({ button: 'right' })
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(initCanvasCenter.cx - i * 14, initCanvasCenter.cy + i * 8)
    await new Promise((r) => setTimeout(r, 50))
  }
  await page.mouse.up({ button: 'right' })
  await new Promise((r) => setTimeout(r, 800))

  const ffmpegProc = Bun.spawn(
    [
      ffmpegBin,
      '-y',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-r',
      String(CAPTURE_FPS),
      '-i',
      '-',
      '-vf',
      'scale=1280:720:flags=lanczos',
      '-r',
      '24',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outMp4,
    ],
    { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
  )
  ffmpeg = ffmpegProc

  async function setBanner(text: string) {
    await page.evaluate((txt: string) => {
      const el = document.getElementById('__walkthrough_banner')
      if (el) el.textContent = txt
    }, text)
  }

  async function moveCursor(x: number, y: number) {
    await page.evaluate(
      ([cx, cy]: [number, number]) => {
        const el = document.getElementById('__walkthrough_cursor')
        if (el) {
          el.style.left = `${cx}px`
          el.style.top = `${cy}px`
        }
      },
      [x, y],
    )
  }

  async function pulseCursor(active: boolean) {
    await page.evaluate((on: boolean) => {
      const el = document.getElementById('__walkthrough_cursor')
      if (el) el.style.transform = on ? 'scale(1.55)' : 'scale(1)'
    }, active)
  }

  async function captureCleanShot(mediaFilename: string, repoAssetFilename?: string) {
    if (!mediaShotsDir && (!refreshRepoShots || !repoAssetFilename)) return
    await page.evaluate(() => {
      const b = document.getElementById('__walkthrough_banner')
      const c = document.getElementById('__walkthrough_cursor')
      if (b) b.style.display = 'none'
      if (c) c.style.display = 'none'
    })
    await new Promise((r) => setTimeout(r, 140))
    const png = await page.screenshot({ type: 'png' })
    if (mediaShotsDir) {
      fs.writeFileSync(path.join(mediaShotsDir, mediaFilename), png)
    }
    if (refreshRepoShots && repoAssetFilename) {
      fs.writeFileSync(path.join(rootDir, 'assets', repoAssetFilename), png)
    }
    await page.evaluate(() => {
      const b = document.getElementById('__walkthrough_banner')
      const c = document.getElementById('__walkthrough_cursor')
      if (b) b.style.display = ''
      if (c) c.style.display = ''
    })
  }

  async function captureFrames(count: number, delayMs = 80, saveKeyframeName?: string, staticHold = false) {
    if (staticHold && count > 2) {
      let lastJpeg: Uint8Array | null = null
      for (let i = 0; i < 2; i++) {
        lastJpeg = await page.screenshot({ type: 'jpeg', quality: 92 })
        ffmpegProc.stdin.write(lastJpeg)
        totalFrames += 1
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      }
      if (lastJpeg) {
        if (saveKeyframeName) {
          fs.writeFileSync(path.join(keyframesDir, `${saveKeyframeName}.jpg`), lastJpeg)
        }
        for (let i = 2; i < count; i++) {
          ffmpegProc.stdin.write(lastJpeg)
          totalFrames += 1
        }
      }
      return
    }
    for (let i = 0; i < count; i++) {
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 })
      ffmpegProc.stdin.write(jpeg)
      totalFrames += 1
      if (saveKeyframeName && i === Math.floor(count / 2)) {
        fs.writeFileSync(path.join(keyframesDir, `${saveKeyframeName}.jpg`), jpeg)
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  async function findButtonRect(needle: string, exact = false): Promise<{ x: number; y: number } | null> {
    return page.evaluate(
      ([txt, isExact]: [string, boolean]) => {
        const btns = Array.from(document.querySelectorAll('button'))
        const match = btns.find((b) => {
          const r = b.getBoundingClientRect()
          if (r.width <= 0 || r.height <= 0) return false
          const label = b.innerText.trim()
          const aria = b.getAttribute('aria-label') ?? ''
          if (isExact) return label === txt || aria === txt
          return label.includes(txt) || aria.includes(txt)
        })
        if (!match) return null
        match.scrollIntoView({ block: 'nearest' })
        const r = match.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      },
      [needle, exact],
    )
  }

  async function smoothClickButton(needle: string, exact = false, holdBefore = 5, holdAfter = 14, kf?: string) {
    const rect = await findButtonRect(needle, exact)
    if (!rect) {
      console.warn(`Button not found: "${needle}"`)
      return false
    }
    await moveCursor(rect.x, rect.y)
    await captureFrames(holdBefore, 70, undefined, true)
    await pulseCursor(true)
    await page.mouse.click(rect.x, rect.y)
    await captureFrames(3, 70)
    await pulseCursor(false)
    await captureFrames(holdAfter, 80, kf, true)
    return true
  }

  async function setSelectByLabel(labelText: string, value: string, selectIndex = 0) {
    const rect = await page.evaluate(
      ([lbl, val, idx]: [string, string, number]) => {
        const labels = Array.from(document.querySelectorAll('label'))
        const match = labels.find((l) => l.innerText.includes(lbl))
        if (!match) return null
        const selects = Array.from(match.querySelectorAll('select'))
        const sel = selects[idx]
        if (!sel) return null
        sel.scrollIntoView({ block: 'nearest' })
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
        setter?.call(sel, val)
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        const r = sel.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      },
      [labelText, value, selectIndex],
    )
    if (rect) {
      await moveCursor(rect.x, rect.y)
      await captureFrames(5, 70, undefined, true)
    }
  }

  async function dragOrbit(
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    steps: number,
    button: 'left' | 'right' = 'right',
    kf?: string,
  ) {
    await page.mouse.move(startX, startY)
    await moveCursor(startX, startY)
    await page.mouse.down({ button })
    for (let i = 1; i <= steps; i++) {
      const nx = Math.round(startX + (dx * i) / steps)
      const ny = Math.round(startY + (dy * i) / steps)
      await page.mouse.move(nx, ny)
      await moveCursor(nx, ny)
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 })
      ffmpegProc.stdin.write(jpeg)
      totalFrames += 1
      if (kf && i === Math.floor(steps / 2)) {
        fs.writeFileSync(path.join(keyframesDir, `${kf}.jpg`), jpeg)
      }
      await new Promise((r) => setTimeout(r, 65))
    }
    await page.mouse.up({ button })
  }

  // ─── CHAPTER 1: Craftsman 32x24 House -> One-Click IRC/NDS Auto-Frame (Stick Rafter) ──
  console.log('Recording Chapter 1: One-Click IRC/NDS Auto-Frame (2x6 DF-L #2, TJI I-Joist, Stick Rafter)...')
  await setBanner('1 / 5 · Craftsman 32x24 House · Ready for One-Click IRC / AWC NDS Auto-Frame')
  await captureFrames(16, 80, '01_before_autoframe', true)

  await setSelectByLabel('Wall Framing', '2x6', 0)
  await setSelectByLabel('Floor System', 'tji-ijoist', 0)
  await setSelectByLabel('Roof System', 'stick-rafter', 0)

  await setBanner('1 / 5 · One-Click Auto-Frame (IRC/NDS): 2x6 Studs, TJI I-Joists, Stick Rafters & LVL Headers')
  await smoothClickButton('Auto-Frame (IRC/NDS)', false, 5, 24, '02_stick_rafter')
  await captureCleanShot('01-demo-stick-rafter.png', 'demo-stick-rafter.png')

  await setBanner('1 / 5 · Live 3D Orbit: Full-Building InstancedMesh Framing Skeleton (0 Err · 0 Warn)')
  await dragOrbit(initCanvasCenter.cx + 50, initCanvasCenter.cy, -150, -10, 14, 'right', '02b_stick_orbit')
  await captureFrames(8, 80, undefined, true)

  // ─── CHAPTER 2: Switch to Prefab Fink W-Truss + Open-Web Floor Truss ────────
  console.log('Recording Chapter 2: Live Switch to Prefab Fink W-Truss + Open-Web Floor Truss...')
  await setBanner('2 / 5 · Switching Floor & Roof Systems -> Open-Web Floor Truss + Prefab Fink W-Truss')
  await setSelectByLabel('Floor System', 'open-web-truss', 0)
  await setSelectByLabel('Roof System', 'fink-truss', 0)
  await smoothClickButton('Auto-Frame (IRC/NDS)', false, 5, 24, '03_fink_truss')
  await captureCleanShot('02-demo-fink-truss.png', 'demo-fink-truss.png')

  await setBanner('2 / 5 · Prefab Fink W-Truss Roof: Galvanized Gang-Nail Gusset Plates & H2.5A Hurricane Ties')
  await dragOrbit(initCanvasCenter.cx - 80, initCanvasCenter.cy, 160, 14, 14, 'right', '03b_fink_orbit')
  await captureFrames(10, 80, undefined, true)

  // ─── CHAPTER 3: Peel Roof Layer -> Wall Framing Close-Up + Quick-Place Beam/Col/Firestop ──
  console.log('Recording Chapter 3: Structural Layer Peeling, Wall Framing Close-Up & Quick-Place...')
  await setBanner('3 / 5 · Structural Layers: Toggle Roof Off to Inspect Wall Framing, Headers & Window Openings')
  await smoothClickButton('Roof', true, 4, 18, '04_walls_headers')

  // Zoom in gently for crisp wall framing detail (PT mudsills, double top plates, 3-stud corners, LVL headers)
  await page.mouse.move(initCanvasCenter.cx, initCanvasCenter.cy)
  await moveCursor(initCanvasCenter.cx, initCanvasCenter.cy)
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel({ deltaY: -85 })
    await captureFrames(3, 70)
  }
  await dragOrbit(initCanvasCenter.cx + 40, initCanvasCenter.cy - 10, -110, 14, 12, 'right', '04b_walls_orbit')
  await captureFrames(10, 80, undefined, true)
  await captureCleanShot('03-demo-walls-headers.png', 'demo-walls-headers.png')

  // Quick-Place a Steel HSS Column (w/ spread pad footing), HDU5-SDS2.5 Hold-Down, and 3 visible IRC R302.11 Fire Blocking planes
  // (keeps Gravity Load Path INTACT and IRC Audit 0 Err / 0 Warn PASS!)
  await setBanner('3 / 5 · Quick-Place Steel HSS Column w/ Pad Footing & HDU5-SDS2.5 Seismic Hold-Down')
  await smoothClickButton('+ Steel HSS', true, 3, 8)
  await smoothClickButton('HDU5-SDS2.5', true, 3, 8)

  await setBanner('3 / 5 · Placing Live IRC R302.11 Fire Blocking: 10ft Wall, Mineral-Wool Chase & Soffit Baffle')
  await smoothClickButton('R302.11(2) 10ft Wall', false, 3, 10)
  await smoothClickButton('R302.11(4) Chase', false, 3, 10)
  await smoothClickButton('R302.11(1) Soffit', false, 3, 14, '04c_quick_placed')

  // Zoom slightly closer and orbit over the 3 fire-blocking assemblies, then toggle Firestop layer OFF -> ON to highlight them!
  await page.mouse.move(initCanvasCenter.cx, initCanvasCenter.cy)
  await moveCursor(initCanvasCenter.cx, initCanvasCenter.cy)
  await page.mouse.wheel({ deltaY: -85 })
  await captureFrames(3, 70)
  await dragOrbit(initCanvasCenter.cx - 40, initCanvasCenter.cy, 95, -8, 10, 'right', '04c_firestop_orbit')
  await captureCleanShot('03b-demo-fireblocking.png')
  await setBanner('3 / 5 · Highlighting IRC R302.11 Fire Blocking Layer (Red-Striped Wall Block, Chase & Soffit)')
  await smoothClickButton('Firestop', true, 3, 8)
  await smoothClickButton('Firestop', true, 3, 14, '04c_firestop_on')

  // Restore Roof layer and briefly show Finished View -> Framing X-Ray toggle
  await smoothClickButton('Roof', true, 3, 8)
  await setBanner('3 / 5 · One-Click Architectural Finished View <-> Engineering Framing X-Ray')
  await smoothClickButton('Finished View', true, 3, 10, '04d_finished_view')
  await smoothClickButton('Framing X-Ray', true, 3, 10)

  // Zoom cleanly back out before split pane so full house sits centered in left pane
  await page.mouse.move(initCanvasCenter.cx, initCanvasCenter.cy)
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel({ deltaY: 95 })
    await new Promise((r) => setTimeout(r, 90))
  }

  // ─── CHAPTER 4: Split-Pane 7-Tab Structural Engineering Schedule ────────────
  console.log('Recording Chapter 4: Split-Pane Structural Engineering Schedule...')
  await setBanner('4 / 5 · Opening Split-Pane Structural Engineering Schedule Beside 3D Framing X-Ray')
  await smoothClickButton('Schedule & Audit', false, 5, 14)

  // Collapse the Structural rail so 3D Framing X-Ray + 7-Tab Schedule fill the full widescreen
  const closeRailBtn = await findButtonRect('Close panel', true)
  if (closeRailBtn) {
    await page.mouse.click(closeRailBtn.x, closeRailBtn.y)
    await new Promise((r) => setTimeout(r, 600))
  }
  await moveCursor(-40, -40)

  await setBanner('4 / 5 · Beams & Headers Schedule: LVL / Glulam Marks, Spans, Bearing Lengths & Jack Studs')
  await captureFrames(20, 80, '05_schedule_beams', true)
  await captureCleanShot('04-demo-structural-schedule.png', 'demo-structural-schedule.png')

  await setBanner('4 / 5 · Columns & Footings Schedule: Axial Loads, TJI Squash Blocks & Concrete Pad Rebar')
  await smoothClickButton('Columns & Footings', false, 4, 16, '05b_schedule_cols')

  await setBanner('4 / 5 · 47-SKU Simpson-Class Connectors & Fasteners Schedule (Uplift, Download & Code Ref)')
  await smoothClickButton('Connectors & Fasteners', false, 4, 20, '05c_schedule_hw')

  await setBanner('4 / 5 · IRC R302.11 Fire Blocking & R302.12 Draftstopping Schedule')
  await smoothClickButton('Fire Blocking & Draftstopping', false, 4, 14, '05d_schedule_fire')

  // ─── CHAPTER 5: Load Path & Bracing, Live IRC Audit (PASS), Priced BOM ────
  console.log('Recording Chapter 5: Load Path & Bracing, IRC Audit, and Priced BOM...')
  await setBanner('5 / 5 · Continuous Gravity/Uplift Load Path & IRC R602.10 Braced Wall Lines')
  await smoothClickButton('Load Path & Bracing', false, 4, 22, '06_load_path')
  await captureCleanShot('05-demo-load-path.png')

  await setBanner('5 / 5 · Live IRC / AWC NDS Compliance Audit: 0 Errors · Priority #1 MEP Right-of-Way')
  await smoothClickButton('IRC Audit', false, 4, 18, '07_irc_audit')
  await captureCleanShot('06-demo-irc-audit.png')

  await setBanner('5 / 5 · Priced Contractor BOM Takeoff (Lumber, Engineered Beams, Hardware, Concrete · CSV/MD)')
  await smoothClickButton('Priced BOM', false, 4, 24, '08_priced_bom')
  await captureCleanShot('07-demo-priced-bom.png')

  // Finish encoding
  ffmpegProc.stdin.end()
  mp4Code = await ffmpegProc.exited
  ffmpegFinished = true
  if (mp4Code !== 0) {
    ffmpegStderr = await new Response(ffmpegProc.stderr).text()
  }
} finally {
  if (ffmpeg && !ffmpegFinished) {
    try {
      ffmpeg.stdin.end()
    } catch {}
    try {
      ffmpeg.kill('SIGTERM')
    } catch {}
    try {
      await Promise.race([ffmpeg.exited, new Promise((r) => setTimeout(r, 1500))])
    } catch {}
    try {
      ffmpeg.kill('SIGKILL')
    } catch {}
  }
  try {
    await browser.close()
  } catch {}
  try {
    browser.process?.()?.kill('SIGKILL')
  } catch {}
}

if (mp4Code !== 0 || !fs.existsSync(outMp4)) {
  console.error('FFmpeg MP4 encode failed:', ffmpegStderr)
  process.exit(1)
}
console.log(
  `Encoded REAL Pascal Editor walkthrough MP4: ${outMp4} (${Math.round(fs.statSync(outMp4).size / 1024)} KB, ${totalFrames} captured frames)`,
)

const gifProc = Bun.spawn(
  [
    ffmpegBin,
    '-y',
    '-i',
    outMp4,
    '-vf',
    'fps=5,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
    outGif,
  ],
  { stdout: 'ignore', stderr: 'pipe' },
)
const gifCode = await gifProc.exited
if (gifCode !== 0 || !fs.existsSync(outGif)) {
  console.error('FFmpeg GIF encode failed:', await new Response(gifProc.stderr).text())
  process.exit(1)
}
console.log(`Encoded REAL Pascal Editor GIF: ${outGif} (${Math.round(fs.statSync(outGif).size / 1024)} KB)`)
