import { describe, expect, test } from 'bun:test'
import { Box3, Mesh } from 'three'
import { STRUCTURAL_CAD_CATALOG, buildBeamCad, buildConnectorCad } from '../cad'

describe('Clean-Room Structural & Connector 3D CAD Catalog', () => {
  test('catalog ships >= 48 distinct structural & Simpson-class hardware CAD models with valid finite bounds', () => {
    expect(STRUCTURAL_CAD_CATALOG.length).toBeGreaterThanOrEqual(48)
    const ids = new Set<string>()
    for (const part of STRUCTURAL_CAD_CATALOG) {
      expect(ids.has(part.id)).toBe(false)
      ids.add(part.id)
      const group = part.build()
      let meshCount = 0
      group.traverse((obj) => {
        if (obj instanceof Mesh) meshCount += 1
      })
      expect(meshCount).toBeGreaterThan(0)
      const box = new Box3().setFromObject(group)
      expect(Number.isFinite(box.min.x)).toBe(true)
      expect(Number.isFinite(box.max.y)).toBe(true)
      expect(box.max.x - box.min.x).toBeGreaterThan(0)
    }
  })

  test('allocates fresh isolated PBR material pools per build call (disposal safety invariant)', () => {
    const a = buildBeamCad({ family: 'lvl', lengthM: 3.0 })
    const b = buildBeamCad({ family: 'lvl', lengthM: 3.0 })
    const matsA = new Set<unknown>()
    const matsB = new Set<unknown>()
    a.traverse((o) => {
      if (o instanceof Mesh) matsA.add(o.material)
    })
    b.traverse((o) => {
      if (o instanceof Mesh) matsB.add(o.material)
    })
    for (const m of matsA) {
      expect(matsB.has(m)).toBe(false)
    }

    const c1 = buildConnectorCad({ sku: 'H10A' })
    const c2 = buildConnectorCad({ sku: 'H10A' })
    const cMats1 = new Set<unknown>()
    const cMats2 = new Set<unknown>()
    c1.traverse((o) => {
      if (o instanceof Mesh) cMats1.add(o.material)
    })
    c2.traverse((o) => {
      if (o instanceof Mesh) cMats2.add(o.material)
    })
    for (const m of cMats1) {
      expect(cMats2.has(m)).toBe(false)
    }
  })
})
