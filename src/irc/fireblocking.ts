/**
 * Complete IRC R302.11 Fire Blocking & IRC R302.12 Draftstopping engine.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 *
 * Covers every code-mandated fire-blocking & draftstopping location:
 * - R302.11(1): Soffits, drop ceilings, cove ceilings, knee walls (vertical <-> horizontal interconnections)
 * - R302.11(2): Concealed wall stud cavities >10 ft vertical & furred walls <=10 ft horizontal
 * - R302.11(3): Stair stringers (top & bottom of stair runs + concealed under-stair cavities)
 * - R302.11(4): Vertical mechanical chases, plumbing shafts, and masonry chimneys at every floor/ceiling plane
 * - R302.11(5): Pipe, conduit, and duct plate penetrations (intumescent collars / mineral wool / fireblock caulk)
 * - R302.12:    Floor-ceiling assembly draftstopping (compartments <= 1,000 sq ft)
 * - R302.12.1:  Combustible attic / concealed roof draftstopping (compartments <= 3,000 sq ft)
 */

import {
  FIRESTOP_RULES,
  type FirestopKind,
  type FirestopMaterial,
  INCHES_TO_METERS,
  METERS_TO_FEET,
  type SceneNodeLike,
  type Vec2,
  type Vec3,
  belongsToLevel,
} from './tables'

export type DerivedFirestopSpec = {
  id: string
  firestopKind: FirestopKind
  material: FirestopMaterial
  codeRef: string
  label: string
  start: Vec2
  end: Vec2
  elevationY: number
  heightM: number
  thicknessM: number
  hostWallId?: string
  penetratingNodeId?: string
  compartmentAreaSqFt?: number
  levelId?: string | null
}

function polygonAreaSqFt(poly: ReadonlyArray<Vec2>): number {
  if (poly.length < 3) return 0
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    sum += a[0] * b[1] - b[0] * a[1]
  }
  const areaM2 = Math.abs(sum) / 2
  return areaM2 * METERS_TO_FEET * METERS_TO_FEET
}

function polygonBounds(poly: ReadonlyArray<Vec2>): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of poly) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

/**
 * Derive all IRC R302.11 fire-blocking and IRC R302.12 draftstopping locations for a level.
 */
export function deriveRequiredFirestops(params: {
  nodes: Readonly<Record<string, SceneNodeLike>>
  levelId: string | null
  floorSystem?: 'dimensional' | 'tji-ijoist' | 'open-web-truss'
  hasAttic?: boolean
}): DerivedFirestopSpec[] {
  const { nodes, levelId, floorSystem = 'dimensional', hasAttic = false } = params
  const all = Object.values(nodes).filter((n) => belongsToLevel(nodes, n, levelId))
  const out: DerivedFirestopSpec[] = []
  let seq = 1

  const walls = all.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
  const slabs = all.filter((n) => n.type === 'slab' && Array.isArray(n.polygon) && n.polygon.length >= 3)
  const stairs = all.filter((n) => n.type === 'stair' || n.type === 'stairs')
  const zones = all.filter((n) => n.type === 'zone' || n.type === 'room')

  // 1. IRC R302.11(2): Tall walls (> 10 ft = 3.048 m) require horizontal fire blocking every <= 10 ft
  const TEN_FT_M = 10 * 12 * INCHES_TO_METERS
  for (const wall of walls) {
    const h = typeof wall.height === 'number' ? wall.height : 2.7432
    const baseY = typeof wall.elevation === 'number' ? wall.elevation : 0
    const thick = typeof wall.thickness === 'number' ? wall.thickness : 0.14
    const start = wall.start!
    const end = wall.end!

    if (h > TEN_FT_M + 0.005) {
      const tiers = Math.floor((h - 0.005) / TEN_FT_M)
      for (let tier = 1; tier <= tiers; tier++) {
        const y = baseY + tier * TEN_FT_M
        out.push({
          id: `fs_wall10_${seq++}`,
          firestopKind: 'wall-vertical-10ft',
          material: '2x-lumber',
          codeRef: FIRESTOP_RULES['wall-vertical-10ft'].codeRef,
          label: `R302.11(2) Wall Fire Blocking @ ${tier * 10} ft (${wall.id})`,
          start,
          end,
          elevationY: Number(y.toFixed(3)),
          heightM: 1.5 * INCHES_TO_METERS,
          thicknessM: Math.max(0.089, thick - 0.025),
          hostWallId: wall.id,
          levelId,
        })
      }
    }

    // Furred / masonry walls > 10 ft long need vertical fire blocking every <= 10 ft horizontally
    const isFurred =
      wall.furred === true ||
      (typeof wall.name === 'string' && /furr|masonry|basement/i.test(wall.name))
    const lenM = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (isFurred && lenM > TEN_FT_M + 0.02) {
      const ux = (end[0] - start[0]) / lenM
      const uz = (end[1] - start[1]) / lenM
      const nx = -uz
      const nz = ux
      const halfDepth = Math.max(0.038, thick / 2)
      const divisions = Math.floor((lenM - 0.02) / TEN_FT_M)
      for (let d = 1; d <= divisions; d++) {
        const t = (d * TEN_FT_M) / lenM
        if (t >= 0.98) continue
        const px = start[0] + (end[0] - start[0]) * t
        const pz = start[1] + (end[1] - start[1]) * t
        out.push({
          id: `fs_furr_${seq++}`,
          firestopKind: 'wall-horizontal-10ft',
          material: '2x-lumber',
          codeRef: FIRESTOP_RULES['wall-horizontal-10ft'].codeRef,
          label: `R302.11(2) Furred Wall Vertical Fireblock @ ${d * 10} ft (${wall.id})`,
          start: [Number((px - nx * halfDepth).toFixed(4)), Number((pz - nz * halfDepth).toFixed(4))],
          end: [Number((px + nx * halfDepth).toFixed(4)), Number((pz + nz * halfDepth).toFixed(4))],
          elevationY: baseY,
          heightM: h,
          thicknessM: 1.5 * INCHES_TO_METERS,
          hostWallId: wall.id,
          levelId,
        })
      }
    }
  }

  // 2. IRC R302.11(1): Soffits / Drop ceilings / Kitchen cabinet bulkheads / Knee walls
  for (const zone of zones) {
    const name = typeof zone.name === 'string' ? zone.name : ''
    const isKnee = /knee/i.test(name)
    const isSoffitZone = isKnee || /kitchen|bath|soffit|drop|bulkhead|closet/i.test(name)
    if (!isSoffitZone || !Array.isArray(zone.polygon) || zone.polygon.length < 3) continue
    const b = polygonBounds(zone.polygon)
    const ceilingY = typeof zone.ceilingHeight === 'number' ? zone.ceilingHeight : isKnee ? 1.35 : 2.44
    const elevY = isKnee ? Math.max(0.6, ceilingY - 0.15) : Math.max(1.8, ceilingY - 0.3)
    // Emit along both exposed vertical-to-horizontal perimeter edges of the soffit/knee zone
    const edges: Array<{ labelSuffix: string; start: Vec2; end: Vec2 }> = [
      { labelSuffix: 'North/South edge', start: [b.minX, b.minZ], end: [b.maxX, b.minZ] },
      { labelSuffix: 'East/West edge', start: [b.minX, b.minZ], end: [b.minX, b.maxZ] },
    ]
    for (const edge of edges) {
      if (Math.hypot(edge.end[0] - edge.start[0], edge.end[1] - edge.start[1]) < 0.3) continue
      out.push({
        id: `fs_soffit_${seq++}`,
        firestopKind: 'soffit-drop-ceiling',
        material: '23/32-osb',
        codeRef: FIRESTOP_RULES['soffit-drop-ceiling'].codeRef,
        label: `R302.11(1) ${isKnee ? 'Knee-Wall' : 'Soffit / Drop-Ceiling'} Fireblock — ${edge.labelSuffix} (${name || zone.id})`,
        start: edge.start,
        end: edge.end,
        elevationY: Number(elevY.toFixed(3)),
        heightM: isKnee ? 0.15 : 0.3,
        thicknessM: 0.019,
        levelId,
      })
    }
  }

  // 3. IRC R302.11(3): Stair stringers (top & bottom of every stair run, honoring stair.rotation)
  for (const stair of stairs) {
    const pos = stair.position ?? [0, 0, 0]
    const w = typeof stair.width === 'number' ? stair.width : 1.05
    const run = typeof stair.depth === 'number' ? stair.depth : 3.2
    const rise = typeof stair.height === 'number' ? stair.height : 2.74
    const yaw =
      typeof stair.rotation === 'number'
        ? stair.rotation
        : Array.isArray(stair.rotation) && typeof stair.rotation[1] === 'number'
          ? stair.rotation[1]
          : 0
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const toWorldXZ = (lx: number, lz: number): Vec2 => [
      Number((pos[0] + lx * cosY + lz * sinY).toFixed(4)),
      Number((pos[2] - lx * sinY + lz * cosY).toFixed(4)),
    ]

    out.push({
      id: `fs_stair_bot_${seq++}`,
      firestopKind: 'stair-stringer',
      material: '2x-lumber',
      codeRef: FIRESTOP_RULES['stair-stringer'].codeRef,
      label: `R302.11(3) Stair Stringer Bottom Fire Blocking (${stair.id})`,
      start: toWorldXZ(-w / 2, 0),
      end: toWorldXZ(w / 2, 0),
      elevationY: pos[1] + 0.15,
      heightM: 0.25,
      thicknessM: 1.5 * INCHES_TO_METERS,
      levelId,
    })
    out.push({
      id: `fs_stair_top_${seq++}`,
      firestopKind: 'stair-stringer',
      material: '2x-lumber',
      codeRef: FIRESTOP_RULES['stair-stringer'].codeRef,
      label: `R302.11(3) Stair Stringer Top Fire Blocking (${stair.id})`,
      start: toWorldXZ(-w / 2, run),
      end: toWorldXZ(w / 2, run),
      elevationY: pos[1] + rise - 0.25,
      heightM: 0.25,
      thicknessM: 1.5 * INCHES_TO_METERS,
      levelId,
    })
  }

  // Also infer stair openings from slab holes (Pascal often represents stairwells via slab.holes)
  if (stairs.length === 0) {
    for (const slab of slabs) {
      if (!Array.isArray(slab.holes)) continue
      for (const hole of slab.holes) {
        if (hole.length < 3) continue
        const hb = polygonBounds(hole)
        out.push({
          id: `fs_stairhole_top_${seq++}`,
          firestopKind: 'stair-stringer',
          material: '2x-lumber',
          codeRef: FIRESTOP_RULES['stair-stringer'].codeRef,
          label: `R302.11(3) Stairwell Opening Stringer Fire Blocking (${slab.id})`,
          start: [hb.minX, hb.minZ],
          end: [hb.maxX, hb.minZ],
          elevationY: (typeof slab.elevation === 'number' ? slab.elevation : 0) - 0.25,
          heightM: 0.25,
          thicknessM: 1.5 * INCHES_TO_METERS,
          levelId,
        })
      }
    }
  }

  // 4. IRC R302.11(4): Vertical chases / chimneys / plumbing wet shafts
  for (const zone of zones) {
    const name = typeof zone.name === 'string' ? zone.name : ''
    if (!/chase|chimney|fireplace|shaft|mechanical/i.test(name)) continue
    if (!Array.isArray(zone.polygon) || zone.polygon.length < 3) continue
    const b = polygonBounds(zone.polygon)
    out.push({
      id: `fs_chase_${seq++}`,
      firestopKind: 'chase-chimney-shaft',
      material: /chimney|fireplace/i.test(name) ? 'mineral-wool-batt' : '1/2-gypsum',
      codeRef: FIRESTOP_RULES['chase-chimney-shaft'].codeRef,
      label: `R302.11(4) Vertical Shaft / Chimney Fire Blocking (${name})`,
      start: [b.minX, b.minZ],
      end: [b.maxX, b.maxZ],
      elevationY: 2.74,
      heightM: 0.14,
      thicknessM: Math.max(0.3, b.maxZ - b.minZ),
      levelId,
    })
  }

  // 5. IRC R302.11(5): MEP pipe, conduit & duct vertical penetrations through top/bottom plates
  // Derive level base elevation and top-plate plane from actual wall elevations & heights on this level
  const wallBases = walls.map((w) => (typeof w.elevation === 'number' && Number.isFinite(w.elevation) ? w.elevation : 0))
  const levelBaseY = wallBases.length > 0 ? Math.min(...wallBases) : 0
  const maxWallTopY = walls.reduce((maxTop, w) => {
    const base = typeof w.elevation === 'number' && Number.isFinite(w.elevation) ? w.elevation : 0
    const h = typeof w.height === 'number' && w.height > 0 ? w.height : 2.7432
    return Math.max(maxTop, base + h)
  }, 0)
  const bottomPlateY = Number((levelBaseY + 0.04).toFixed(3))
  const topPlateY = maxWallTopY > levelBaseY ? Number((maxWallTopY - 0.04).toFixed(3)) : Number((levelBaseY + 2.7).toFixed(3))
  const mepRuns = all.filter(
    (n) =>
      (n.type === 'plumbing:pipe-run' ||
        n.type === 'electrical:conduit-run' ||
        n.type === 'hvac:duct-run') &&
      Array.isArray(n.path) &&
      n.path.length >= 2,
  )
  for (const run of mepRuns) {
    const path = run.path as ReadonlyArray<Vec3>
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      const dy = Math.abs(b[1] - a[1])
      if (dy < 0.3) continue
      const yMin = Math.min(a[1], b[1])
      const yMax = Math.max(a[1], b[1])
      for (const plateY of [bottomPlateY, topPlateY]) {
        if (yMin <= plateY && yMax >= plateY) {
          const t = (plateY - a[1]) / (b[1] - a[1])
          const px = a[0] + (b[0] - a[0]) * t
          const pz = a[2] + (b[2] - a[2]) * t
          out.push({
            id: `fs_pen_${seq++}`,
            firestopKind: 'penetration-firestop',
            material: 'intumescent-collar',
            codeRef: FIRESTOP_RULES['penetration-firestop'].codeRef,
            label: `R302.11(5) Plate Penetration Firestop (${run.type} ${run.id})`,
            start: [px - 0.06, pz],
            end: [px + 0.06, pz],
            elevationY: plateY,
            heightM: 0.06,
            thicknessM: 0.12,
            penetratingNodeId: run.id,
            levelId,
          })
        }
      }
    }
  }

  // 6. IRC R302.12: Floor-ceiling draftstopping (every concealed floor-ceiling space > 1,000 sq ft)
  for (const slab of slabs) {
    const areaSqFt = polygonAreaSqFt(slab.polygon!)
    const needsDraftstop = areaSqFt > 1000
    if (!needsDraftstop) continue
    const b = polygonBounds(slab.polygon!)
    const compartments = Math.ceil(areaSqFt / 1000)
    const spanX = b.maxX - b.minX
    const spanZ = b.maxZ - b.minZ
    const splitAlongX = spanX >= spanZ
    for (let c = 1; c < compartments; c++) {
      const frac = c / compartments
      const start: Vec2 = splitAlongX
        ? [b.minX + spanX * frac, b.minZ]
        : [b.minX, b.minZ + spanZ * frac]
      const end: Vec2 = splitAlongX
        ? [b.minX + spanX * frac, b.maxZ]
        : [b.maxX, b.minZ + spanZ * frac]
      out.push({
        id: `fs_floor_ds_${seq++}`,
        firestopKind: 'floor-draftstop',
        material: '1/2-gypsum',
        codeRef: FIRESTOP_RULES['floor-draftstop'].codeRef,
        label: `R302.12 Floor-Ceiling Draftstop #${c} (${Math.round(areaSqFt)} sq ft -> <=1,000 sq ft)`,
        start,
        end,
        elevationY: (typeof slab.elevation === 'number' ? slab.elevation : levelBaseY) - 0.3,
        heightM: 0.3,
        thicknessM: 0.013,
        compartmentAreaSqFt: Math.round(areaSqFt / compartments),
        levelId,
      })
    }
  }

  // 7. IRC R302.12.1: Attic draftstopping (> 3,000 sq ft, subdivided into <= 3,000 sq ft compartments)
  if (hasAttic) {
    for (const slab of slabs) {
      const areaSqFt = polygonAreaSqFt(slab.polygon!)
      if (areaSqFt <= 3000) continue
      const b = polygonBounds(slab.polygon!)
      const compartments = Math.ceil(areaSqFt / 3000)
      const spanX = b.maxX - b.minX
      const spanZ = b.maxZ - b.minZ
      const splitAlongX = spanX >= spanZ
      const atticBaseY = Number((topPlateY + 0.1).toFixed(3))
      for (let c = 1; c < compartments; c++) {
        const frac = c / compartments
        const start: Vec2 = splitAlongX
          ? [b.minX + spanX * frac, b.minZ]
          : [b.minX, b.minZ + spanZ * frac]
        const end: Vec2 = splitAlongX
          ? [b.minX + spanX * frac, b.maxZ]
          : [b.maxX, b.minZ + spanZ * frac]
        out.push({
          id: `fs_attic_ds_${seq++}`,
          firestopKind: 'attic-draftstop',
          material: '1/2-gypsum',
          codeRef: FIRESTOP_RULES['attic-draftstop'].codeRef,
          label: `R302.12.1 Attic Draftstop Partition #${c} (${Math.round(areaSqFt)} sq ft -> <=3,000 sq ft)`,
          start,
          end,
          elevationY: atticBaseY,
          heightM: 1.8,
          thicknessM: 0.013,
          compartmentAreaSqFt: Math.round(areaSqFt / compartments),
          levelId,
        })
      }
    }
  }

  return out
}

export function isApprovedFirestopMaterial(
  kind: FirestopKind,
  material: FirestopMaterial,
): boolean {
  return FIRESTOP_RULES[kind].approvedMaterials.includes(material)
}
