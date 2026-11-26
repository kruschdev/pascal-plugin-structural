/**
 * Priced Lumber, Engineered Wood, Steel, Simpson-Class Hardware, and Firestop BOM generator.
 * Hardened against unknown catalog keys, NaN/Infinity poisoning, colliding SKUs, and Markdown injection.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { resolveBeamCatalogEntry, resolveColumnCatalogEntry } from './sizing'
import {
  type BeamMaterialFamily,
  type ColumnType,
  FIRESTOP_RULES,
  type FirestopKind,
  type FirestopMaterial,
  METERS_TO_FEET,
  SPECIES_PROPERTIES,
  type LumberSpecies,
  type SceneNodeLike,
  type Vec2,
  getConnectorBySku,
} from './tables'

export type StructuralBomCategory =
  | 'Framing Lumber'
  | 'Engineered Wood & Steel Beams'
  | 'Columns & Concrete Footings'
  | 'Connectors & Fasteners'
  | 'Fire Blocking & Draftstopping'

export type StructuralBomLineItem = {
  category: StructuralBomCategory
  sku: string
  description: string
  quantity: number
  unit: 'ea' | 'lf' | 'sqft' | 'cy'
  unitCostUsd: number
  extendedCostUsd: number
  codeRef?: string
}

export type StructuralBomSummary = {
  items: StructuralBomLineItem[]
  subtotalByCategory: Record<StructuralBomCategory, number>
  totalMaterialCostUsd: number
  csv: string
  markdown: string
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function safePosNum(val: unknown, fallback: number): number {
  const n = Number(val)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function slugSku(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key)

function resolveSpecies(raw: unknown): LumberSpecies {
  if (typeof raw === 'string' && hasOwn(SPECIES_PROPERTIES, raw)) {
    return raw as LumberSpecies
  }
  return 'df-l-2'
}

function stockStudLengthFt(heightM: number): 8 | 9 | 10 | 12 | 14 | 16 {
  const ft = safePosNum(heightM, 2.7432) * METERS_TO_FEET
  if (ft <= 8.15) return 8
  if (ft <= 9.15) return 9
  if (ft <= 10.15) return 10
  if (ft <= 12.15) return 12
  if (ft <= 14.15) return 14
  return 16
}

const FIRESTOP_MATERIAL_MULTIPLIER: Record<FirestopMaterial, number> = {
  '2x-lumber': 1.0,
  'double-1x': 1.15,
  '23/32-osb': 1.05,
  '1/2-gypsum': 0.9,
  'mineral-wool-batt': 1.45,
  'intumescent-collar': 1.8,
}

export function generateStructuralBom(
  nodes: Readonly<Record<string, SceneNodeLike>>,
): StructuralBomSummary {
  const all = Object.values(nodes)
  const items: StructuralBomLineItem[] = []

  const assemblies = all.filter((n) => n.type === 'structural:assembly')
  const walls = all.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
  const beams = all.filter((n) => n.type === 'structural:beam')
  const columns = all.filter((n) => n.type === 'structural:column')
  const connectors = all.filter((n) => n.type === 'structural:connector')
  const firestops = all.filter((n) => n.type === 'structural:firestop')

  // Index assemblies by parent level so multi-storey projects use each level's own species & wallOverrides
  const assemblyForLevel = (parentId?: string | null): SceneNodeLike | undefined =>
    assemblies.find((a) => a.parentId && parentId && a.parentId === parentId) ?? assemblies[0]

  // 1. Wall Framing Lumber (Studs grouped by size + stock length + species; 2x4 vs 2x6 plates separated)
  const studBuckets = new Map<string, { size: '2x4' | '2x6'; stockFt: 8 | 9 | 10 | 12 | 14 | 16; species: LumberSpecies; spacingIn: number; qty: number }>()
  const plateBuckets = new Map<string, { size: '2x4' | '2x6'; species: LumberSpecies; lf: number }>()

  for (const w of walls) {
    const asm = assemblyForLevel(w.parentId)
    const species = resolveSpecies(asm?.species)
    const overrides = (asm?.wallOverrides as Record<string, { studSize?: string; studSpacingIn?: number; construction?: string }> | undefined) ?? {}
    const rule = hasOwn(overrides, w.id) ? overrides[w.id] : undefined
    if (rule?.construction === 'cmu' || rule?.construction === 'skip') continue

    const spacingIn = safePosNum(rule?.studSpacingIn ?? asm?.studSpacingIn, 16)
    const lenFt = Math.hypot(w.end![0] - w.start![0], w.end![1] - w.start![1]) * METERS_TO_FEET
    if (!Number.isFinite(lenFt) || lenFt <= 0) continue

    const studCount = Math.ceil((lenFt * 12) / spacingIn) + 3
    const sz: '2x4' | '2x6' =
      rule?.studSize === '2x4' || rule?.studSize === '2x6'
        ? rule.studSize
        : safePosNum(w.thickness, 0.14) >= 0.13
          ? '2x6'
          : '2x4'
    const stockFt = stockStudLengthFt(safePosNum(w.height, 2.7432))

    const sKey = `${sz}|${stockFt}|${species}|${spacingIn}`
    const prevS = studBuckets.get(sKey)
    studBuckets.set(sKey, { size: sz, stockFt, species, spacingIn, qty: (prevS?.qty ?? 0) + studCount })

    const pKey = `${sz}|${species}`
    const prevP = plateBuckets.get(pKey)
    plateBuckets.set(pKey, { size: sz, species, lf: (prevP?.lf ?? 0) + lenFt * 3.1 }) // 3 plates + 10% lap/waste
  }

  for (const b of studBuckets.values()) {
    const mult = SPECIES_PROPERTIES[b.species].priceMultiplier
    const basePerFt = b.size === '2x6' ? 0.92 : 0.54
    const unitCost = round2(basePerFt * b.stockFt * mult)
    items.push({
      category: 'Framing Lumber',
      sku: `${b.size.toUpperCase()}-${b.stockFt}FT-${b.species.toUpperCase()}`,
      description: `${b.size}x${b.stockFt}' ${SPECIES_PROPERTIES[b.species].label} Wall Studs (@ ${b.spacingIn}" OC)`,
      quantity: b.qty,
      unit: 'ea',
      unitCostUsd: unitCost,
      extendedCostUsd: round2(b.qty * unitCost),
      codeRef: 'IRC R602.3(5)',
    })
  }
  for (const p of plateBuckets.values()) {
    const mult = SPECIES_PROPERTIES[p.species].priceMultiplier
    const lf = Math.ceil(p.lf)
    const unitCost = round2((p.size === '2x6' ? 1.48 : 0.92) * mult)
    items.push({
      category: 'Framing Lumber',
      sku: `PLATE-${p.size.toUpperCase()}-${p.species.toUpperCase()}`,
      description: `${p.size} Bottom (PT) + Double Top Plates w/ Lap Allowance (${SPECIES_PROPERTIES[p.species].label})`,
      quantity: lf,
      unit: 'lf',
      unitCostUsd: unitCost,
      extendedCostUsd: round2(lf * unitCost),
      codeRef: 'IRC R602.3.2 / R317.1',
    })
  }

  // 2. Engineered Wood, Glulam, PSL, Flitch & Steel Beams (unique SKU per designation)
  const beamTotals = new Map<string, { sku: string; lf: number; costPerLf: number }>()
  for (const b of beams) {
    const hasCoords = Array.isArray(b.start) && b.start.length >= 2 && Array.isArray(b.end) && b.end.length >= 2
    const rawLenM = safePosNum(
      hasCoords
        ? Math.hypot((b.end as Vec2)[0] - (b.start as Vec2)[0], (b.end as Vec2)[1] - (b.start as Vec2)[1])
        : b.lengthM,
      2.4384,
    )
    const lf = Math.max(2, Math.ceil(rawLenM * METERS_TO_FEET))
    const resolved = resolveBeamCatalogEntry({
      designation: typeof b.designation === 'string' ? b.designation : undefined,
      family: b.beamType as BeamMaterialFamily | undefined,
      widthIn: typeof b.widthIn === 'number' ? b.widthIn : undefined,
      depthIn: typeof b.depthIn === 'number' ? b.depthIn : undefined,
      plyCount: typeof b.plyCount === 'number' ? b.plyCount : undefined,
    })
    const des = typeof b.designation === 'string' && b.designation.trim() ? b.designation : resolved.designation
    const prev = beamTotals.get(des)
    beamTotals.set(des, {
      sku: `BEAM-${slugSku(resolved.id || des)}`,
      lf: (prev?.lf ?? 0) + lf,
      costPerLf: resolved.costPerLfUsd,
    })
  }
  for (const [des, info] of beamTotals.entries()) {
    items.push({
      category: 'Engineered Wood & Steel Beams',
      sku: info.sku,
      description: des,
      quantity: info.lf,
      unit: 'lf',
      unitCostUsd: info.costPerLf,
      extendedCostUsd: round2(info.lf * info.costPerLf),
      codeRef: 'AWC NDS / IRC R602.7',
    })
  }

  // 3. Columns & Concrete Pad Footings (unique SKU per column designation)
  let totalConcreteCy = 0
  const colTotals = new Map<string, { sku: string; lf: number; costPerLf: number }>()
  for (const c of columns) {
    const lf = Math.max(4, Math.ceil(safePosNum(c.heightM, 2.7432) * METERS_TO_FEET))
    const resolved = resolveColumnCatalogEntry({
      designation: typeof c.designation === 'string' ? c.designation : undefined,
      columnType: c.columnType as ColumnType | undefined,
      widthIn: typeof c.widthIn === 'number' ? c.widthIn : undefined,
      depthIn: typeof c.depthIn === 'number' ? c.depthIn : undefined,
    })
    const des = typeof c.designation === 'string' && c.designation.trim() ? c.designation : resolved.designation
    const prev = colTotals.get(des)
    colTotals.set(des, {
      sku: `COL-${slugSku(resolved.id || des)}`,
      lf: (prev?.lf ?? 0) + lf,
      costPerLf: resolved.costPerLfUsd,
    })

    const fw = safePosNum(c.footingWidthIn, 0)
    const fd = safePosNum(c.footingDepthIn, 0)
    if (fw > 0 && fd > 0) {
      totalConcreteCy += ((fw / 12) * (fw / 12) * (fd / 12)) / 27
    }
  }
  for (const [des, info] of colTotals.entries()) {
    items.push({
      category: 'Columns & Concrete Footings',
      sku: info.sku,
      description: des,
      quantity: info.lf,
      unit: 'lf',
      unitCostUsd: info.costPerLf,
      extendedCostUsd: round2(info.lf * info.costPerLf),
      codeRef: 'AWC NDS 3.7',
    })
  }
  if (totalConcreteCy > 0) {
    const cy = round2(Math.max(0.5, totalConcreteCy * 1.1))
    items.push({
      category: 'Columns & Concrete Footings',
      sku: 'CONC-3000PSI-PAD',
      description: '3,000 PSI Spread Pad Footing Concrete + #4 Rebar Mats (incl. 10% waste)',
      quantity: cy,
      unit: 'cy',
      unitCostUsd: 185.0,
      extendedCostUsd: round2(cy * 185.0),
      codeRef: 'IRC R403.1',
    })
  }

  // 4. Simpson-Class Connectors & Hardware (grouped by exact SKU, NaN-safe)
  const conTotals = new Map<string, number>()
  for (const c of connectors) {
    const sku = typeof c.sku === 'string' && c.sku.trim() ? c.sku.trim() : 'H2.5A'
    const qty = Math.max(1, Math.round(safePosNum(c.quantity, 1)))
    conTotals.set(sku, (conTotals.get(sku) ?? 0) + qty)
  }
  for (const [sku, qty] of conTotals.entries()) {
    const cat = getConnectorBySku(sku)
    const unitCost = cat?.unitCostUsd ?? 5.0
    items.push({
      category: 'Connectors & Fasteners',
      sku,
      description: cat ? `${cat.name} [${cat.fastenerSpec}]` : sku,
      quantity: qty,
      unit: 'ea',
      unitCostUsd: unitCost,
      extendedCostUsd: round2(qty * unitCost),
      codeRef: cat?.codeRef ?? 'IRC R802.11',
    })
  }

  // 5. Fire Blocking & Draftstopping (guarded kind lookup, material-specific pricing, honors f.quantity on 'ea')
  const fsTotals = new Map<string, { kind: FirestopKind; mat: FirestopMaterial; qty: number }>()
  for (const f of firestops) {
    const rawKind = typeof f.firestopKind === 'string' && hasOwn(FIRESTOP_RULES, f.firestopKind)
      ? (f.firestopKind as FirestopKind)
      : 'wall-vertical-10ft'
    const rule = FIRESTOP_RULES[rawKind]
    const mat: FirestopMaterial =
      typeof f.material === 'string' && hasOwn(FIRESTOP_MATERIAL_MULTIPLIER, f.material)
        ? (f.material as FirestopMaterial)
        : rule.defaultMaterial
    const hasCoords = Array.isArray(f.start) && f.start.length >= 2 && Array.isArray(f.end) && f.end.length >= 2
    const rawLenM = safePosNum(
      hasCoords
        ? Math.hypot((f.end as Vec2)[0] - (f.start as Vec2)[0], (f.end as Vec2)[1] - (f.start as Vec2)[1])
        : f.lengthM,
      2.4384,
    )
    const lenFt = Math.max(1, rawLenM * METERS_TO_FEET)
    const hFt = Math.max(0.5, safePosNum(f.heightM, 0.3) * METERS_TO_FEET)
    const qty =
      rule.unitKind === 'ea'
        ? Math.max(1, Math.round(safePosNum(f.quantity, 1)))
        : rule.unitKind === 'sqft'
          ? Math.ceil(lenFt * hFt)
          : Math.ceil(lenFt)
    const key = `${rawKind}|${mat}`
    const prev = fsTotals.get(key)
    fsTotals.set(key, { kind: rawKind, mat, qty: (prev?.qty ?? 0) + qty })
  }
  for (const info of fsTotals.values()) {
    const rule = FIRESTOP_RULES[info.kind]
    const unitCost = round2(rule.unitCostPerLfOrEaUsd * FIRESTOP_MATERIAL_MULTIPLIER[info.mat])
    items.push({
      category: 'Fire Blocking & Draftstopping',
      sku: `FS-${slugSku(info.kind)}-${slugSku(info.mat)}`,
      description: `${rule.title} (${info.mat})`,
      quantity: info.qty,
      unit: rule.unitKind,
      unitCostUsd: unitCost,
      extendedCostUsd: round2(info.qty * unitCost),
      codeRef: rule.codeRef,
    })
  }

  const subtotalByCategory: Record<StructuralBomCategory, number> = {
    'Framing Lumber': 0,
    'Engineered Wood & Steel Beams': 0,
    'Columns & Concrete Footings': 0,
    'Connectors & Fasteners': 0,
    'Fire Blocking & Draftstopping': 0,
  }
  for (const item of items) {
    subtotalByCategory[item.category] = round2(subtotalByCategory[item.category] + item.extendedCostUsd)
  }
  const totalMaterialCostUsd = round2(
    Object.values(subtotalByCategory).reduce((a, b) => a + b, 0),
  )

  const csvLines = [
    'Category,SKU,Description,Quantity,Unit,UnitCostUSD,ExtendedCostUSD,CodeRef',
    ...items.map(
      (i) =>
        `"${i.category}","${i.sku}","${i.description.replace(/"/g, '""')}",${i.quantity},${i.unit},${i.unitCostUsd.toFixed(2)},${i.extendedCostUsd.toFixed(2)},"${i.codeRef ?? ''}"`,
    ),
    `"TOTAL","","",0,"",0.00,${totalMaterialCostUsd.toFixed(2)},""`,
  ]

  const mdLines = [
    '| Category | SKU | Description | Qty | Unit | Unit Cost | Extended | Code |',
    '|---|---|---|---:|---|---:|---:|---|',
    ...items.map(
      (i) =>
        `| ${escapeMd(i.category)} | \`${escapeMd(i.sku)}\` | ${escapeMd(i.description)} | ${i.quantity} | ${i.unit} | $${i.unitCostUsd.toFixed(2)} | $${i.extendedCostUsd.toFixed(2)} | ${escapeMd(i.codeRef ?? '')} |`,
    ),
    `| **TOTAL** | | | | | | **$${totalMaterialCostUsd.toFixed(2)}** | |`,
  ]

  return {
    items,
    subtotalByCategory,
    totalMaterialCostUsd,
    csv: csvLines.join('\n'),
    markdown: mdLines.join('\n'),
  }
}
