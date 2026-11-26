/**
 * Export all 62 clean-room MIT procedural structural framing & Simpson-class connector 3D CAD models
 * to binary `.glb` files in `assets/cad/` plus `assets/cad/catalog.json` metadata.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, Vector3 } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { STRUCTURAL_CAD_CATALOG } from '../src/cad/catalog'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(rootDir, 'assets', 'cad')
fs.mkdirSync(outDir, { recursive: true })

if (typeof globalThis.FileReader === 'undefined') {
  // @ts-expect-error minimal FileReader polyfill for GLTFExporter under Bun/Node
  globalThis.FileReader = class {
    result: ArrayBuffer | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf
        this.onloadend?.()
      })
    }
  }
}

const exporter = new GLTFExporter()

const manifest: Array<{
  id: string
  name: string
  category: string
  codeRef: string
  description: string
  dimensionsMm: [number, number, number]
  glbBytes: number
  modelPath: string
  thumbnailPath: string
}> = []

let exported = 0
for (const part of STRUCTURAL_CAD_CATALOG) {
  const group = part.build()
  const box = new Box3().setFromObject(group)
  const size = new Vector3()
  box.getSize(size)
  const dimensionsMm: [number, number, number] = [
    Math.max(1, Math.round(size.x * 1000)),
    Math.max(1, Math.round(size.y * 1000)),
    Math.max(1, Math.round(size.z * 1000)),
  ]
  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      group,
      (res) => {
        if (res instanceof ArrayBuffer) resolve(res)
        else reject(new Error(`Expected binary ArrayBuffer for ${part.id}`))
      },
      (err) => reject(err),
      { binary: true },
    )
  })
  const buf = Buffer.from(glb)
  fs.writeFileSync(path.join(outDir, `${part.id}.glb`), buf)
  manifest.push({
    id: part.id,
    name: part.name,
    category: part.category,
    codeRef: part.codeRef,
    description: part.description,
    dimensionsMm,
    glbBytes: buf.byteLength,
    modelPath: `./${part.id}.glb`,
    thumbnailPath: `./thumbs/${part.id}.png`,
  })
  exported += 1
}

fs.writeFileSync(
  path.join(outDir, 'catalog.json'),
  `${JSON.stringify({ version: 1, license: 'MIT', count: manifest.length, items: manifest }, null, 2)}\n`,
)

const totalKb = Math.round(manifest.reduce((sum, item) => sum + item.glbBytes, 0) / 1024)
console.log(
  `Exported ${exported}/${STRUCTURAL_CAD_CATALOG.length} binary .glb structural CAD models (${totalKb} KB total) + catalog.json into assets/cad/.`,
)
