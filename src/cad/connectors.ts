/**
 * Clean-Room MIT Procedural 3D CAD Builders for all 10 Simpson-Class Structural Connector
 * Categories & 47 Catalog SKUs from `src/irc/tables.ts`.
 *
 * Zero React, `@pascal-app/editor`, `@pascal-app/viewer`, or `next` imports.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
  Shape,
} from 'three'
import {
  type ConnectorCategory,
  getConnectorBySku,
  INCHES_TO_METERS,
} from '../irc/tables'
import { createStructuralMaterialPool, type StructuralMaterialPool } from './materials'

export type ConnectorCadOptions = {
  /** Catalog SKU (e.g. `'H1'`, `'H2.5A'`, `'LUS210'`, `'ABU66Z'`, `'HDU5-SDS2.5'`, `'BP3x3'`) */
  sku: string
  /** Optional explicit category override when using a non-catalog SKU */
  category?: ConnectorCategory
  /** Uniform visual scale factor (default 1.0 = true physical meters) */
  scale?: number
  /** Optional caller-owned material pool (otherwise a fresh pool is created per build call) */
  pool?: StructuralMaterialPool
}

function place(parent: Group, mesh: Mesh, x: number, y: number, z: number): Mesh {
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function makeTriGusset(width: number, height: number, thickness: number, mat: MeshStandardMaterial): Mesh {
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(width, 0)
  shape.lineTo(0, height)
  shape.closePath()
  const geo = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
  geo.translate(0, 0, -thickness / 2)
  return new Mesh(geo, mat)
}

function addFastenerGrid(
  parent: Group,
  opts: {
    rows: number
    cols: number
    x0: number
    x1: number
    y0: number
    y1: number
    z: number
    axis: 'x' | 'y' | 'z'
    normalSign: 1 | -1
    kind: 'nail' | 'sds'
    pool: StructuralMaterialPool
  },
): void {
  const { rows, cols, x0, x1, y0, y1, z, axis, normalSign, kind, pool } = opts
  const r = kind === 'sds' ? 0.0052 : 0.0032
  const h = kind === 'sds' ? 0.0055 : 0.0022
  const sides = kind === 'sds' ? 6 : 8
  const geo = new CylinderGeometry(r, r, h, sides)
  if (axis === 'z') geo.rotateX(Math.PI / 2)
  else if (axis === 'x') geo.rotateZ(Math.PI / 2)

  const mat = kind === 'sds' ? pool.steelFastener : pool.galvanizedAccent

  for (let row = 0; row < rows; row++) {
    const ty = rows > 1 ? row / (rows - 1) : 0.5
    const y = y0 + ty * (y1 - y0)
    for (let col = 0; col < cols; col++) {
      const tx = cols > 1 ? col / (cols - 1) : 0.5
      const x = x0 + tx * (x1 - x0)
      const offset = normalSign * (h / 2)
      if (axis === 'z') place(parent, new Mesh(geo, mat), x, y, z + offset)
      else if (axis === 'x') place(parent, new Mesh(geo, mat), z + offset, y, x)
      else place(parent, new Mesh(geo, mat), x, z + offset, y)
    }
  }
}

function resolveCategory(sku: string, explicit?: ConnectorCategory): ConnectorCategory {
  if (explicit) return explicit
  const entry = getConnectorBySku(sku)
  if (entry) return entry.category
  const upper = sku.toUpperCase()
  if (upper.startsWith('HDU') || upper.startsWith('STHD')) return 'hold-down'
  if (upper.startsWith('ABU') || upper.startsWith('CB')) return 'post-base'
  if (upper.startsWith('BC') || upper.startsWith('LPC') || upper.startsWith('CCQ')) return 'post-cap'
  if (upper.startsWith('HHUS') || upper.startsWith('HGUS') || upper.startsWith('HUCQ')) return 'beam-hanger'
  if (upper.startsWith('LUS') || upper.startsWith('HUS') || upper.startsWith('IUS') || upper.startsWith('MIT') || upper.startsWith('LSSU')) return 'joist-hanger'
  if (upper.startsWith('LSTA') || upper.startsWith('MSTA') || upper.startsWith('MSTC') || upper.startsWith('CS')) return 'tension-strap'
  if (upper.startsWith('BP')) return 'plate-washer'
  if (upper.startsWith('SSTB')) return 'anchor-bolt'
  if (upper.startsWith('A3') || upper.startsWith('LTP') || upper.startsWith('L50') || upper.startsWith('LS50')) return 'framing-angle'
  return 'hurricane-tie'
}

/**
 * Vertical distance (meters) from a post-cap connector's local origin (`y = 0`)
 * to the underside of its horizontal beam-bearing seat plate. Shifting a post-cap
 * mesh down by this offset seats the bearing plate flush on top of a column shaft.
 */
export function getPostCapSeatOffsetM(sku: string): number {
  const entry = getConnectorBySku(sku)
  const capH = (entry?.dimsIn[1] ?? 6.0) * INCHES_TO_METERS
  const gauge = sku.toUpperCase().startsWith('CCQ') ? 0.0052 : 0.0032
  const postLegH = capH * 0.52
  return postLegH - gauge / 2
}

/**
 * Procedural 3D CAD builder for Simpson-class structural steel connectors.
 * Supports all 10 categories and all 47 catalog SKUs with physically scaled meters (`y >= 0`).
 */
export function buildConnectorCad(options: ConnectorCadOptions): Group {
  const { sku, scale = 1 } = options
  const pool = options.pool ?? createStructuralMaterialPool()
  const entry = getConnectorBySku(sku)
  const category = resolveCategory(sku, options.category)
  const upper = sku.toUpperCase()

  const dims = entry?.dimsIn ?? [2.5, 6.0, 2.5]
  const W = dims[0] * INCHES_TO_METERS
  const H = dims[1] * INCHES_TO_METERS
  const D = dims[2] * INCHES_TO_METERS

  const g = new Group()
  g.name = `structural-connector-${sku.replace(/[^a-zA-Z0-9_-]/g, '_')}`

  const galv = pool.galvanizedSteel
  const darkSteel = pool.steelMillDark
  const fast = pool.steelFastener
  const t18 = 0.0022 // 18-16 ga sheet metal visual thickness
  const t14 = 0.0032 // 14-12 ga heavy sheet steel
  const t7 = 0.0052  // 7-ga welded structural steel

  switch (category) {
    case 'hurricane-tie': {
      if (upper.startsWith('MTS') || upper.startsWith('HTS')) {
        // Twisted uplift strap: lower flat strap + 90-deg helical twist middle + upper flat strap
        const strapW = Math.max(0.032, W)
        const strapT = upper.startsWith('HTS') ? 0.0032 : 0.0024
        const segBot = H * 0.38
        const segTwist = H * 0.24
        const segTop = H * 0.38

        // Bottom flat leg (facing Z)
        place(g, new Mesh(new BoxGeometry(strapW, segBot, strapT), galv), 0, segBot / 2, 0)
        addFastenerGrid(g, {
          rows: upper.startsWith('HTS') ? 6 : 4,
          cols: 2,
          x0: -strapW * 0.26,
          x1: strapW * 0.26,
          y0: 0.02,
          y1: segBot - 0.02,
          z: strapT / 2,
          axis: 'z',
          normalSign: 1,
          kind: 'nail',
          pool,
        })

        // Helical 90-degree mid-section twist built from smooth stepped segments
        const steps = 10
        const stepH = segTwist / steps + 0.0018
        for (let i = 0; i < steps; i++) {
          const frac = (i + 0.5) / steps
          const m = place(
            g,
            new Mesh(new BoxGeometry(strapW, stepH, strapT), galv),
            0,
            segBot + frac * segTwist,
            0,
          )
          m.rotation.y = frac * (Math.PI / 2)
        }

        // Top flat leg (rotated 90 deg, facing X)
        const topMesh = place(
          g,
          new Mesh(new BoxGeometry(strapW, segTop, strapT), galv),
          0,
          segBot + segTwist + segTop / 2,
          0,
        )
        topMesh.rotation.y = Math.PI / 2
        addFastenerGrid(g, {
          rows: upper.startsWith('HTS') ? 6 : 4,
          cols: 2,
          x0: -strapW * 0.26,
          x1: strapW * 0.26,
          y0: segBot + segTwist + 0.02,
          y1: H - 0.02,
          z: strapT / 2,
          axis: 'x',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
      } else if (upper.startsWith('HGA')) {
        // HGA10 Heavy Gusset Angle with dual triangular gussets + 1/4"x3" SDS screws
        const legW = W
        const legH = H
        const legD = D
        // Base flange (horizontal on top plate)
        place(g, new Mesh(new BoxGeometry(legW, t14, legD), galv), 0, t14 / 2, legD / 2)
        // Vertical backplate (against girder truss)
        place(g, new Mesh(new BoxGeometry(legW, legH, t14), galv), 0, legH / 2, t14 / 2)
        // Dual heavy triangular side stiffening gussets
        for (const sign of [-1, 1] as const) {
          const gus = makeTriGusset(legD * 0.85, legH * 0.72, t14, galv)
          gus.rotation.y = -Math.PI / 2
          place(g, gus, sign * (legW / 2 - t14 / 2), t14, t14)
        }
        // SDS hex washer screws on vertical face (4) & horizontal base (4)
        addFastenerGrid(g, {
          rows: 2,
          cols: 2,
          x0: -legW * 0.28,
          x1: legW * 0.28,
          y0: legH * 0.28,
          y1: legH * 0.78,
          z: t14,
          axis: 'z',
          normalSign: 1,
          kind: 'sds',
          pool,
        })
        addFastenerGrid(g, {
          rows: 2,
          cols: 2,
          x0: -legW * 0.28,
          x1: legW * 0.28,
          y0: legD * 0.28,
          y1: legD * 0.78,
          z: t14,
          axis: 'y',
          normalSign: 1,
          kind: 'sds',
          pool,
        })
      } else if (upper === 'H2.5A') {
        // H2.5A Asymmetric bent wrap hurricane tie
        const legW = Math.max(0.035, W)
        const lowerH = H * 0.48
        const upperH = H * 0.52
        const stepZ = 0.016
        // Lower vertical leg (top plate face)
        place(g, new Mesh(new BoxGeometry(legW, lowerH, t18), galv), 0, lowerH / 2, 0)
        // Horizontal jog / transition shelf
        place(g, new Mesh(new BoxGeometry(legW, t18, stepZ + t18), galv), 0, lowerH, stepZ / 2)
        // Upper leg rotated 90 deg perpendicular for rafter cheek
        place(g, new Mesh(new BoxGeometry(t18, upperH, legW), galv), legW / 2 - t18 / 2, lowerH + upperH / 2, stepZ + legW / 2)
        // Embossed stiffening rib along the transition
        place(g, new Mesh(new BoxGeometry(legW * 0.55, 0.022, 0.005), pool.galvanizedAccent), 0, lowerH - 0.012, t18)
        // Nail grids (5 lower + 5 upper)
        addFastenerGrid(g, {
          rows: 3,
          cols: 2,
          x0: -legW * 0.25,
          x1: legW * 0.25,
          y0: 0.014,
          y1: lowerH - 0.016,
          z: t18 / 2,
          axis: 'z',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
        addFastenerGrid(g, {
          rows: 3,
          cols: 2,
          x0: stepZ + legW * 0.22,
          x1: stepZ + legW * 0.78,
          y0: lowerH + 0.016,
          y1: H - 0.014,
          z: legW / 2,
          axis: 'x',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
      } else {
        // H1 (U-tie) and H10A (heavy double-gusset tie)
        const isHeavy = upper.startsWith('H10')
        const pocketW = 1.62 * INCHES_TO_METERS
        const cheekH = H * (isHeavy ? 0.58 : 0.52)
        const lowerH = H - cheekH
        const flangeW = isHeavy ? 0.032 : 0.024
        const gauge = isHeavy ? t14 : t18

        // Horizontal seat under rafter
        place(g, new Mesh(new BoxGeometry(pocketW + gauge * 2, gauge, D), galv), 0, lowerH, 0)
        // Twin upper U-cheeks gripping left & right faces of rafter/truss
        for (const sign of [-1, 1] as const) {
          place(
            g,
            new Mesh(new BoxGeometry(gauge, cheekH, D), galv),
            sign * (pocketW / 2 + gauge / 2),
            lowerH + cheekH / 2,
            0,
          )
          // Lower bent top-plate flanges
          place(
            g,
            new Mesh(new BoxGeometry(flangeW, lowerH, gauge), galv),
            sign * (pocketW / 2 + flangeW / 2),
            lowerH / 2,
            D / 2 - gauge / 2,
          )
          if (isHeavy) {
            // Double-sided back flanges & stiffening gussets on H10A
            place(
              g,
              new Mesh(new BoxGeometry(flangeW, lowerH, gauge), galv),
              sign * (pocketW / 2 + flangeW / 2),
              lowerH / 2,
              -D / 2 + gauge / 2,
            )
            const gus = makeTriGusset(flangeW * 0.85, cheekH * 0.42, gauge, galv)
            if (sign < 0) gus.rotation.y = Math.PI
            place(g, gus, sign * (pocketW / 2 + gauge), lowerH, D / 2 - gauge)
          }
          addFastenerGrid(g, {
            rows: isHeavy ? 4 : 3,
            cols: 2,
            x0: -D * 0.28,
            x1: D * 0.28,
            y0: lowerH + 0.015,
            y1: H - 0.015,
            z: sign * (pocketW / 2 + gauge),
            axis: 'x',
            normalSign: sign,
            kind: 'nail',
            pool,
          })
        }
      }
      break
    }

    case 'framing-angle': {
      if (upper.startsWith('LTP')) {
        // LTP4 Lateral Tie Plate: flat stamped steel plate with raised horizontal shear ribs
        place(g, new Mesh(new BoxGeometry(W, H, t18), galv), 0, H / 2, 0)
        // Embossed center stiffening ribs
        for (const yf of [0.46, 0.54]) {
          place(g, new Mesh(new BoxGeometry(W * 0.84, 0.005, 0.004), pool.galvanizedAccent), 0, H * yf, t18 / 2 + 0.0015)
        }
        // Upper rim-joist nail grid + lower top-plate nail grid
        addFastenerGrid(g, {
          rows: 2,
          cols: 3,
          x0: -W * 0.34,
          x1: W * 0.34,
          y0: H * 0.64,
          y1: H * 0.86,
          z: t18 / 2,
          axis: 'z',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
        addFastenerGrid(g, {
          rows: 2,
          cols: 3,
          x0: -W * 0.34,
          x1: W * 0.34,
          y0: H * 0.14,
          y1: H * 0.36,
          z: t18 / 2,
          axis: 'z',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
      } else if (upper.startsWith('A3')) {
        // A35 / A34 Bent 3-way shear framing clip with return lip
        const isCompact = upper === 'A34'
        const wingW = W
        const legH = H
        // Primary leg along X
        place(g, new Mesh(new BoxGeometry(wingW, legH, t18), galv), wingW / 2, legH / 2, 0)
        // Orthogonal leg along Z
        place(g, new Mesh(new BoxGeometry(t18, legH, D), galv), 0, legH / 2, D / 2)
        // 3rd-way bent return tab (bottom shelf on A35/A34)
        place(g, new Mesh(new BoxGeometry(wingW, t18, D * 0.65), galv), wingW / 2, t18 / 2, D * 0.325)
        // Bend-slot embossment at mid-height
        if (!isCompact) {
          place(g, new Mesh(new BoxGeometry(wingW * 0.6, 0.006, t18 + 0.002), pool.galvanizedAccent), wingW / 2, legH * 0.5, 0)
        }
        addFastenerGrid(g, {
          rows: isCompact ? 2 : 3,
          cols: 2,
          x0: wingW * 0.25,
          x1: wingW * 0.78,
          y0: legH * 0.18,
          y1: legH * 0.84,
          z: t18 / 2,
          axis: 'z',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
        addFastenerGrid(g, {
          rows: isCompact ? 2 : 3,
          cols: 2,
          x0: D * 0.25,
          x1: D * 0.78,
          y0: legH * 0.18,
          y1: legH * 0.84,
          z: t18 / 2,
          axis: 'x',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
      } else {
        // L50 (90 deg reinforcing L-angle) & LS50 (field-skewable angle with bend slot)
        const isSkewed = upper.startsWith('LS')
        place(g, new Mesh(new BoxGeometry(W, H, t14), galv), W / 2, H / 2, 0)
        const wing2 = new Group()
        wing2.position.set(0, 0, 0)
        wing2.rotation.y = isSkewed ? -Math.PI / 6 : 0 // 120-deg open skew preview for LS50
        place(wing2, new Mesh(new BoxGeometry(t14, H, D), galv), 0, H / 2, D / 2)
        g.add(wing2)

        // Central stiffening rib or skew hinge notches
        if (isSkewed) {
          for (const yf of [0.25, 0.5, 0.75]) {
            place(g, new Mesh(new BoxGeometry(0.007, 0.012, 0.007), pool.galvanizedAccent), 0, H * yf, 0)
          }
        } else {
          const gus = makeTriGusset(W * 0.5, H * 0.22, t14, galv)
          place(g, gus, t14 / 2, H * 0.39, t14 / 2)
        }
        addFastenerGrid(g, {
          rows: 3,
          cols: 1,
          x0: W * 0.55,
          x1: W * 0.55,
          y0: H * 0.18,
          y1: H * 0.82,
          z: t14 / 2,
          axis: 'z',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
      }
      break
    }

    case 'joist-hanger':
    case 'beam-hanger': {
      const isTopFlange = upper.startsWith('MIT')
      const isIJoistFace = upper.startsWith('IUS')
      const isSloped = upper.startsWith('LSSU')
      const isConcealed = upper.startsWith('HUCQ')
      const isHeavy =
        category === 'beam-hanger' ||
        upper.startsWith('HUS') ||
        upper.startsWith('HHUS') ||
        upper.startsWith('HGUS')
      const gauge = isHeavy ? t14 : t18
      const sideFlangeW = isHeavy ? 0.036 : 0.025

      // Stirrup group (tilted slightly on LSSU to depict sloped rafter pocket)
      const stirrup = new Group()
      if (isSloped) {
        stirrup.rotation.x = -0.28 // ~16 deg slope seat
        stirrup.position.y = 0.024
      }
      g.add(stirrup)

      // Bottom bearing seat
      place(stirrup, new Mesh(new BoxGeometry(W + gauge * 2, gauge, D), galv), 0, gauge / 2, D / 2)

      // Left & right U-stirrup side cheeks
      for (const sign of [-1, 1] as const) {
        const cheekX = sign * (W / 2 + gauge / 2)
        place(stirrup, new Mesh(new BoxGeometry(gauge, H, D), galv), cheekX, H / 2, D / 2)

        if (isConcealed) {
          // HUCQ concealed-flange: flanges turn INWARD behind beam end
          const innerFlangeW = Math.min(W * 0.42, 0.038)
          place(
            g,
            new Mesh(new BoxGeometry(innerFlangeW, H, gauge), galv),
            sign * (W / 2 - innerFlangeW / 2),
            H / 2,
            gauge / 2,
          )
          // Heavy hex SDS screws on side cheeks
          addFastenerGrid(stirrup, {
            rows: 3,
            cols: 2,
            x0: D * 0.25,
            x1: D * 0.78,
            y0: H * 0.16,
            y1: H * 0.84,
            z: sign * (W / 2 + gauge),
            axis: 'x',
            normalSign: sign,
            kind: 'sds',
            pool,
          })
        } else {
          // Standard outward face-mount header nailing flanges
          place(
            g,
            new Mesh(new BoxGeometry(sideFlangeW, H, gauge), galv),
            sign * (W / 2 + gauge + sideFlangeW / 2),
            H / 2,
            gauge / 2,
          )
          // Face flange nail array
          addFastenerGrid(g, {
            rows: isHeavy ? 6 : 4,
            cols: isHeavy ? 2 : 1,
            x0: sign * (W / 2 + gauge + sideFlangeW * 0.3),
            x1: sign * (W / 2 + gauge + sideFlangeW * 0.75),
            y0: H * 0.12,
            y1: H * 0.88,
            z: gauge,
            axis: 'z',
            normalSign: 1,
            kind: 'nail',
            pool,
          })

          // Double-shear slant-nail embossment tabs on LUS/HUS/HHUS/HGUS
          if (!isTopFlange && !isIJoistFace) {
            const tabRows = isHeavy ? 3 : 2
            for (let r = 0; r < tabRows; r++) {
              const ty = H * (0.24 + (tabRows > 1 ? (r / (tabRows - 1)) * 0.52 : 0))
              const tab = place(
                stirrup,
                new Mesh(new BoxGeometry(0.012, 0.018, 0.016), pool.galvanizedAccent),
                sign * (W / 2 + gauge + 0.004),
                ty,
                D * 0.45,
              )
              tab.rotation.y = sign * 0.55
            }
          }

          // Top-flange horizontal return tabs for MIT I-joist hangers
          if (isTopFlange) {
            const topDepth = 0.055
            place(
              g,
              new Mesh(new BoxGeometry(sideFlangeW, gauge, topDepth), galv),
              sign * (W / 2 + gauge + sideFlangeW / 2),
              H + gauge / 2,
              -topDepth / 2 + gauge,
            )
            addFastenerGrid(g, {
              rows: 1,
              cols: 2,
              x0: sign * (W / 2 + gauge + sideFlangeW * 0.28),
              x1: sign * (W / 2 + gauge + sideFlangeW * 0.72),
              y0: -topDepth * 0.55,
              y1: -topDepth * 0.25,
              z: H + gauge,
              axis: 'y',
              normalSign: 1,
              kind: 'nail',
              pool,
            })
          }

          // Diamond snap-in web locating tabs on IUS I-joist hangers
          if (isIJoistFace) {
            for (const yf of [0.35, 0.65]) {
              const tab = place(
                stirrup,
                new Mesh(new BoxGeometry(0.008, 0.014, 0.014), pool.galvanizedAccent),
                sign * (W / 2 - 0.003),
                H * yf,
                D * 0.55,
              )
              tab.rotation.x = Math.PI / 4
            }
          }
        }
      }
      break
    }

    case 'post-base': {
      const isEmbedded = upper.startsWith('CB')
      const baseW = W
      const baseD = D

      if (isEmbedded) {
        // CB44 / CB66 Cast-in-place embedded heavy column base
        const embedH = H * 0.46
        const strapH = H * 0.54
        const strapW = Math.min(baseD * 0.55, 0.068)

        // Bearing plate at concrete surface plane (y = embedH)
        place(g, new Mesh(new BoxGeometry(baseW + t7 * 2, t7, baseD), darkSteel), 0, embedH, 0)

        // Twin thick vertical post straps + downward concrete embedment anchor legs with bottom feet
        for (const sign of [-1, 1] as const) {
          const sx = sign * (baseW / 2 + t7 / 2)
          place(g, new Mesh(new BoxGeometry(t7, strapH, strapW), galv), sx, embedH + strapH / 2, 0)
          // Downward embedded steel legs
          place(g, new Mesh(new BoxGeometry(t7, embedH, strapW * 0.72), darkSteel), sx * 0.72, embedH / 2, 0)
          // Outward anchor foot hooks at bottom (resting at y = 0)
          place(g, new Mesh(new BoxGeometry(0.032, t7, strapW * 0.78), darkSteel), sx * 0.72 + sign * 0.014, t7 / 2, 0)
        }

        // Two 5/8" through machine bolts with hex heads & nuts across post straps
        const boltGeo = new CylinderGeometry(0.008, 0.008, baseW + 0.04, 12)
        boltGeo.rotateZ(Math.PI / 2)
        const hexGeo = new CylinderGeometry(0.013, 0.013, 0.012, 6)
        hexGeo.rotateZ(Math.PI / 2)
        for (const yf of [0.32, 0.72]) {
          const by = embedH + strapH * yf
          place(g, new Mesh(boltGeo, fast), 0, by, 0)
          for (const sign of [-1, 1] as const) {
            place(g, new Mesh(hexGeo, fast), sign * (baseW / 2 + t7 + 0.008), by, 0)
          }
        }
      } else {
        // ABU44Z / ABU46Z / ABU66Z 1"-moisture-standoff adjustable post base
        const standoffH = 1.0 * INCHES_TO_METERS
        const cheekH = Math.max(0.08, H - standoffH)

        // Lower slotted anchor plate resting on concrete at y = 0
        place(g, new Mesh(new BoxGeometry(baseW, t14, baseD), galv), 0, t14 / 2, 0)
        // Raised 1" moisture-standoff post-bearing platform spanning full width to connect both side cheeks flush (0 mm gap)
        place(g, new Mesh(new BoxGeometry(baseW + t14 * 2, t14, baseD * 0.94), galv), 0, standoffH, 0)
        // Twin standoff riser legs creating visible 1" drainage gap
        for (const sign of [-1, 1] as const) {
          place(
            g,
            new Mesh(new BoxGeometry(t14, standoffH, baseD * 0.78), galv),
            sign * (baseW * 0.45),
            standoffH / 2,
            0,
          )
          // Upper U-saddle post side cheeks seated flush into the standoff platform
          place(
            g,
            new Mesh(new BoxGeometry(t14, cheekH, baseD * 0.92), galv),
            sign * (baseW / 2 + t14 / 2),
            standoffH + cheekH / 2,
            0,
          )
          // Post side nail/bolt grid
          addFastenerGrid(g, {
            rows: 3,
            cols: 2,
            x0: -baseD * 0.28,
            x1: baseD * 0.28,
            y0: standoffH + cheekH * 0.2,
            y1: standoffH + cheekH * 0.82,
            z: sign * (baseW / 2 + t14),
            axis: 'x',
            normalSign: sign,
            kind: 'nail',
            pool,
          })
        }

        // Center 5/8" anchor bolt washer + heavy hex nut sitting inside standoff base
        place(g, new Mesh(new BoxGeometry(0.036, 0.005, 0.036), fast), 0, t14 + 0.0025, 0)
        place(g, new Mesh(new CylinderGeometry(0.013, 0.013, 0.014, 6), fast), 0, t14 + 0.012, 0)
        place(g, new Mesh(new CylinderGeometry(0.008, 0.008, 0.022, 10), fast), 0, t14 + 0.014, 0)
      }
      break
    }

    case 'post-cap': {
      const isHeavyCcq = upper.startsWith('CCQ')
      const isTwoPieceLpc = upper.startsWith('LPC')
      const gauge = isHeavyCcq ? t7 : t14
      const bodyMat = isHeavyCcq ? darkSteel : galv
      const saddleH = H * 0.48
      const postLegH = H * 0.52

      if (isTwoPieceLpc) {
        // LPC4Z / LPC6Z Two-piece adjustable retrofit L-cap pair
        for (const sign of [-1, 1] as const) {
          // Vertical clamping plate spanning post & beam face
          place(
            g,
            new Mesh(new BoxGeometry(gauge, H, D * 0.92), galv),
            sign * (W / 2 + gauge / 2),
            H / 2,
            0,
          )
          // Horizontal middle beam-seat shelf lip
          place(
            g,
            new Mesh(new BoxGeometry(W * 0.28, gauge, D * 0.92), galv),
            sign * (W / 2 - W * 0.14),
            postLegH,
            0,
          )
          addFastenerGrid(g, {
            rows: 4,
            cols: 2,
            x0: -D * 0.28,
            x1: D * 0.28,
            y0: H * 0.14,
            y1: H * 0.86,
            z: sign * (W / 2 + gauge),
            axis: 'x',
            normalSign: sign,
            kind: 'nail',
            pool,
          })
        }
      } else {
        // BC4 (stamped U-saddle) & CCQ46/CCQ66 (7-ga welded T-column cap with SDS screws)
        const beamSeatLen = isHeavyCcq ? Math.max(D * 1.45, 0.22) : D
        // Horizontal bearing seat plate dividing post below and beam saddle above
        place(g, new Mesh(new BoxGeometry(W + gauge * 2, gauge, beamSeatLen), bodyMat), 0, postLegH, 0)

        // Upper beam U-saddle side walls (running along Z = beamSeatLen)
        for (const sign of [-1, 1] as const) {
          place(
            g,
            new Mesh(new BoxGeometry(gauge, saddleH, beamSeatLen), bodyMat),
            sign * (W / 2 + gauge / 2),
            postLegH + saddleH / 2,
            0,
          )
          // Lower post-gripping side straps
          place(
            g,
            new Mesh(new BoxGeometry(gauge, postLegH, D * (isHeavyCcq ? 0.65 : 0.88)), bodyMat),
            sign * (W / 2 + gauge / 2),
            postLegH / 2,
            0,
          )
          // Fastener rows (SDS hex screws on CCQ, 16d nails on BC4)
          addFastenerGrid(g, {
            rows: 2,
            cols: isHeavyCcq ? 4 : 3,
            x0: -beamSeatLen * 0.36,
            x1: beamSeatLen * 0.36,
            y0: postLegH + saddleH * 0.28,
            y1: postLegH + saddleH * 0.74,
            z: sign * (W / 2 + gauge),
            axis: 'x',
            normalSign: sign,
            kind: isHeavyCcq ? 'sds' : 'nail',
            pool,
          })
          addFastenerGrid(g, {
            rows: isHeavyCcq ? 3 : 2,
            cols: 2,
            x0: -D * 0.2,
            x1: D * 0.2,
            y0: postLegH * 0.22,
            y1: postLegH * 0.78,
            z: sign * (W / 2 + gauge),
            axis: 'x',
            normalSign: sign,
            kind: isHeavyCcq ? 'sds' : 'nail',
            pool,
          })
        }
      }
      break
    }

    case 'hold-down': {
      if (upper.startsWith('STHD')) {
        // STHD14 Cast-in-place embedded strap-tie hold-down
        const embedH = H * 0.34
        const strapH = H * 0.66
        const strapW = Math.max(0.048, W)
        // Lower flared concrete embedment anchor base (y = 0 .. embedH)
        place(g, new Mesh(new BoxGeometry(strapW * 1.45, 0.032, t14), galv), 0, 0.016, 0)
        place(g, new Mesh(new BoxGeometry(strapW * 1.15, embedH, t14), galv), 0, embedH / 2, 0)
        // Transition bend at sill line
        place(g, new Mesh(new BoxGeometry(strapW, 0.018, 0.018), galv), 0, embedH, 0.008)
        // Upper tall nailing strap rising up exterior stud face
        place(g, new Mesh(new BoxGeometry(strapW, strapH, t14), galv), 0, embedH + strapH / 2, 0.016)
        addFastenerGrid(g, {
          rows: 10,
          cols: 2,
          x0: -strapW * 0.26,
          x1: strapW * 0.26,
          y0: embedH + 0.025,
          y1: H - 0.025,
          z: 0.016 + t14 / 2,
          axis: 'z',
          normalSign: 1,
          kind: 'nail',
          pool,
        })
      } else {
        // HDU2 / HDU4 / HDU5 / HDU8 / HDU11 / HDU14 Heavy Gusseted Bucket Hold-Down
        const sdsRows = upper.includes('14')
          ? 16
          : upper.includes('11')
            ? 14
            : upper.includes('8')
              ? 10
              : upper.includes('5')
                ? 7
                : upper.includes('4')
                  ? 5
                  : 3
        const bucketH = Math.min(0.11, H * 0.32)

        // Heavy vertical backplate against post/stud
        place(g, new Mesh(new BoxGeometry(W, H, t14), galv), 0, H / 2, t14 / 2)

        // Open-front bottom bearing bucket seat + thick internal square steel bearing block
        place(g, new Mesh(new BoxGeometry(W, t7, D), galv), 0, t7 / 2, D / 2)
        place(g, new Mesh(new BoxGeometry(W * 0.72, 0.014, D * 0.65), darkSteel), 0, t7 + 0.007, D * 0.52)

        // Tapered heavy side gusset cheeks running up from bucket seat
        for (const sign of [-1, 1] as const) {
          place(g, new Mesh(new BoxGeometry(t14, bucketH, D), galv), sign * (W / 2 - t14 / 2), bucketH / 2, D / 2)
          const gus = makeTriGusset(D * 0.92, Math.max(0.06, H * 0.52 - bucketH * 0.3), t14, galv)
          gus.rotation.y = -Math.PI / 2
          place(g, gus, sign * (W / 2 - t14 / 2), bucketH * 0.85, t14)
        }

        // Protruding threaded anchor rod + heavy hex nut inside bucket
        const rodR = upper.includes('11') || upper.includes('14') ? 0.012 : upper.includes('8') ? 0.0105 : 0.008
        place(g, new Mesh(new CylinderGeometry(rodR, rodR, bucketH * 0.95, 12), fast), 0, bucketH * 0.45, D * 0.54)
        place(g, new Mesh(new CylinderGeometry(rodR * 1.7, rodR * 1.7, 0.016, 6), fast), 0, t7 + 0.022, D * 0.54)

        // Paired columns of protruding hex-head 1/4"x2-1/2" SDS screws along vertical spine
        addFastenerGrid(g, {
          rows: sdsRows,
          cols: 2,
          x0: -W * 0.26,
          x1: W * 0.26,
          y0: bucketH + 0.018,
          y1: H - 0.018,
          z: t14,
          axis: 'z',
          normalSign: 1,
          kind: 'sds',
          pool,
        })
      }
      break
    }

    case 'tension-strap': {
      // LSTA24 / MSTA36 / MSTC40 / CS16 / CS-PF Perforated galvanized flat tension straps
      const strapT = Math.max(0.0022, D)
      const isWide = W >= 0.06
      place(g, new Mesh(new BoxGeometry(W, H, strapT), galv), 0, H / 2, 0)

      // Subtle rolled longitudinal edge stiffening bead
      for (const sign of [-1, 1] as const) {
        place(
          g,
          new Mesh(new BoxGeometry(0.0025, H - 0.01, strapT + 0.0012), pool.galvanizedAccent),
          sign * (W / 2 - 0.002),
          H / 2,
          0,
        )
      }

      // Staggered nail-hole / nail-head rows spanning full length
      const rows = Math.max(8, Math.min(20, Math.round(H / 0.055)))
      const cols = isWide ? 3 : 2
      addFastenerGrid(g, {
        rows,
        cols,
        x0: -W * 0.3,
        x1: W * 0.3,
        y0: 0.024,
        y1: H - 0.024,
        z: strapT / 2,
        axis: 'z',
        normalSign: 1,
        kind: 'nail',
        pool,
      })
      break
    }

    case 'plate-washer': {
      // BP3x3: Mandatory IRC R602.11.1 thick 3"x3"x0.229" square steel seismic plate washer + hex nut
      const plateT = Math.max(0.0058, H)
      place(g, new Mesh(new BoxGeometry(W, plateT, D), galv), 0, plateT / 2, 0)
      // Subtle stamped stiffening border collar
      place(g, new Mesh(new BoxGeometry(W * 0.84, 0.0015, D * 0.84), pool.galvanizedAccent), 0, plateT + 0.0006, 0)
      // Central threaded anchor bolt stub + heavy hex nut
      place(g, new Mesh(new CylinderGeometry(0.008, 0.008, 0.032, 12), fast), 0, plateT + 0.016, 0)
      place(g, new Mesh(new CylinderGeometry(0.014, 0.014, 0.013, 6), fast), 0, plateT + 0.0075, 0)
      break
    }

    case 'anchor-bolt': {
      // SSTB16: 5/8" x 17-5/8" cast-in-place high-capacity T-head anchor bolt + washer + hex nut
      const rodR = 0.008 // 5/8" dia
      const totalH = H
      // Forged bottom T-anchor bearing plate + stabilizing cross ears (resting at y = 0)
      place(g, new Mesh(new BoxGeometry(0.044, 0.01, 0.044), fast), 0, 0.005, 0)
      place(g, new Mesh(new BoxGeometry(0.054, 0.008, 0.014), fast), 0, 0.016, 0)
      // Main vertical steel anchor shaft
      place(g, new Mesh(new CylinderGeometry(rodR, rodR, totalH - 0.01, 14), fast), 0, totalH / 2 + 0.005, 0)
      // Upper threaded section rings + round washer + heavy hex nut near top sill elevation
      const nutY = totalH - 0.048
      place(g, new Mesh(new CylinderGeometry(0.018, 0.018, 0.0035, 16), galv), 0, nutY - 0.009, 0)
      place(g, new Mesh(new CylinderGeometry(0.0145, 0.0145, 0.014, 6), fast), 0, nutY, 0)
      // Subtle thread ridges on upper 3"
      for (let i = 0; i < 6; i++) {
        place(
          g,
          new Mesh(new CylinderGeometry(rodR + 0.0009, rodR + 0.0009, 0.002, 12), pool.galvanizedAccent),
          0,
          totalH - 0.012 - i * 0.012,
          0,
        )
      }
      break
    }
  }

  if (scale !== 1) {
    g.scale.setScalar(scale)
  }

  return g
}
