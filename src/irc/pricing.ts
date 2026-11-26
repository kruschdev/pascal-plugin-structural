/**
 * Priced Lumber, Engineered Wood, Steel, Simpson-Class Hardware, and Firestop BOM generator.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  BEAM_CATALOG,
  type BeamMaterialFamily,
  COLUMN_CATALOG,
  FIRESTOP_RULES,
  type FirestopKind,
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
  return Math.round(n * 100) / 100
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

  const species: LumberSpecies =
    (assemblies[0]?.species as LumberSpecies | undefined) ?? 'df-l-2'
  const speciesMult = SPECIES_PROPERTIES[species].priceMultiplier

  // 1. Wall Framing Lumber (Studs + 3x Plates per wall linear foot)
  let total2x4Studs = 0
  let total2x6Studs = 0
  let totalPlateLf = 0
  const spacingIn = Number(assemblies[0]?.studSpacingIn ?? 16)
  const overrides = (assemblies[0]?.wallOverrides as Record<string, { studSize?: string }> | undefined) ?? {}

  for (const w of walls) {
    const lenFt = Math.hypot(w.end![0] - w.start![0], w.end![1] - w.start![1]) * METERS_TO_FEET
    const studCount = Math.ceil((lenFt * 12) / spacingIn) + 3 // corners/kings allowance
    const sz = overrides[w.id]?.studSize ?? ((w.thickness ?? 0.14) >= 0.13 ? '2x6' : '2x4')
    if (sz === '2x6') total2x6Studs += studCount
    else total2x4Studs += studCount
    totalPlateLf += lenFt * 3
  }
  if (total2x6Studs > 0) {
    const unitCost = round2(9.2 * speciesMult)
    items.push({
      category: 'Framing Lumber',
      sku: `2X6-10-${species.toUpperCase()}`,
      description: `2x6x10' ${SPECIES_PROPERTIES[species].label} Wall Studs (@ ${spacingIn}" OC)`,
      quantity: total2x6Studs,
      unit: 'ea',
      unitCostUsd: unitCost,
      extendedCostUsd: round2(total2x6Studs * unitCost),
      codeRef: 'IRC R602.3(5)',
    })
  }
  if (total2x4Studs > 0) {
    const unitCost = round2(5.4 * speciesMult)
    items.push({
      category: 'Framing Lumber',
      sku: `2X4-10-${species.toUpperCase()}`,
      description: `2x4x10' ${SPECIES_PROPERTIES[species].label} Partition Studs (@ ${spacingIn}" OC)`,
      quantity: total2x4Studs,
      unit: 'ea',
      unitCostUsd: unitCost,
      extendedCostUsd: round2(total2x4Studs * unitCost),
      codeRef: 'IRC R602.3(5)',
    })
  }
  if (totalPlateLf > 0) {
    const lf = Math.ceil(totalPlateLf)
    const unitCost = round2(1.15 * speciesMult)
    items.push({
      category: 'Framing Lumber',
      sku: `PLATE-${species.toUpperCase()}`,
      description: `Bottom (PT) + Double Top Plates (${SPECIES_PROPERTIES[species].label})`,
      quantity: lf,
      unit: 'lf',
      unitCostUsd: unitCost,
      extendedCostUsd: round2(lf * unitCost),
      codeRef: 'IRC R602.3.2',
    })
  }

  // 2. Engineered Wood, Glulam, PSL, Flitch & Steel Beams (grouped by designation)
  const beamTotals = new Map<string, { lf: number; costPerLf: number; family: string }>()
  for (const b of beams) {
    const start = (b.start as Vec2 | undefined) ?? [0, 0]
    const end = (b.end as Vec2 | undefined) ?? [1, 0]
    const lf = Math.max(2, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) * METERS_TO_FEET))
    const des = String(b.designation ?? b.beamType ?? 'Engineered Beam')
    const cat =
      BEAM_CATALOG.find((c) => c.designation === des) ??
      BEAM_CATALOG.find((c) => c.family === (b.beamType as BeamMaterialFamily | undefined))
    const costPerLf = cat?.costPerLfUsd ?? 28.0
    const prev = beamTotals.get(des)
    beamTotals.set(des, {
      lf: (prev?.lf ?? 0) + lf,
      costPerLf,
      family: String(b.beamType ?? 'lvl'),
    })
  }
  for (const [des, info] of beamTotals.entries()) {
    items.push({
      category: 'Engineered Wood & Steel Beams',
      sku: `BEAM-${info.family.toUpperCase()}`,
      description: des,
      quantity: info.lf,
      unit: 'lf',
      unitCostUsd: info.costPerLf,
      extendedCostUsd: round2(info.lf * info.costPerLf),
      codeRef: 'AWC NDS / IRC R602.7',
    })
  }

  // 3. Columns & Concrete Pad Footings
  let totalConcreteCy = 0
  const colTotals = new Map<string, { lf: number; costPerLf: number }>()
  for (const c of columns) {
    const lf = Math.max(4, Math.ceil((typeof c.heightM === 'number' ? c.heightM : 2.74) * METERS_TO_FEET))
    const des = String(c.designation ?? '6x6 DF-L #2 Post')
    const cat = COLUMN_CATALOG.find((x) => x.designation === des)
    const costPerLf = cat?.costPerLfUsd ?? 12.0
    const prev = colTotals.get(des)
    colTotals.set(des, { lf: (prev?.lf ?? 0) + lf, costPerLf })

    const fw = typeof c.footingWidthIn === 'number' ? c.footingWidthIn : 0
    const fd = typeof c.footingDepthIn === 'number' ? c.footingDepthIn : 0
    if (fw > 0 && fd > 0) {
      totalConcreteCy += ((fw / 12) * (fw / 12) * (fd / 12)) / 27
    }
  }
  for (const [des, info] of colTotals.entries()) {
    items.push({
      category: 'Columns & Concrete Footings',
      sku: 'COL-POST',
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
      sku: 'CONC-3000PSI',
      description: '3,000 PSI Footing Concrete + #4 Rebar Mats (incl. 10% waste)',
      quantity: cy,
      unit: 'cy',
      unitCostUsd: 185.0,
      extendedCostUsd: round2(cy * 185.0),
      codeRef: 'IRC R403.1',
    })
  }

  // 4. Simpson-Class Connectors & Hardware (grouped by exact SKU)
  const conTotals = new Map<string, number>()
  for (const c of connectors) {
    const sku = String(c.sku ?? 'H2.5A')
    const qty = Math.max(1, Number(c.quantity ?? 1))
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

  // 5. Fire Blocking & Draftstopping (IRC R302.11 / R302.12)
  const fsTotals = new Map<string, { qty: number; kind: FirestopKind; mat: string }>()
  for (const f of firestops) {
    const kind = (f.firestopKind as FirestopKind | undefined) ?? 'wall-vertical-10ft'
    const mat = String(f.material ?? FIRESTOP_RULES[kind].defaultMaterial)
    const rule = FIRESTOP_RULES[kind]
    const start = (f.start as Vec2 | undefined) ?? [0, 0]
    const end = (f.end as Vec2 | undefined) ?? [1, 0]
    const lenFt = Math.max(1, Math.hypot(end[0] - start[0], end[1] - start[1]) * METERS_TO_FEET)
    const hFt = Math.max(0.5, (typeof f.heightM === 'number' ? f.heightM : 0.3) * METERS_TO_FEET)
    const qty = rule.unitKind === 'ea' ? 1 : rule.unitKind === 'sqft' ? Math.ceil(lenFt * hFt) : Math.ceil(lenFt)
    const key = `${kind}|${mat}`
    const prev = fsTotals.get(key)
    fsTotals.set(key, { qty: (prev?.qty ?? 0) + qty, kind, mat })
  }
  for (const info of fsTotals.values()) {
    const rule = FIRESTOP_RULES[info.kind]
    items.push({
      category: 'Fire Blocking & Draftstopping',
      sku: `FS-${info.kind.toUpperCase()}`,
      description: `${rule.title} (${info.mat})`,
      quantity: info.qty,
      unit: rule.unitKind,
      unitCostUsd: rule.unitCostPerLfOrEaUsd,
      extendedCostUsd: round2(info.qty * rule.unitCostPerLfOrEaUsd),
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
        `| ${i.category} | \`${i.sku}\` | ${i.description} | ${i.quantity} | ${i.unit} | $${i.unitCostUsd.toFixed(2)} | $${i.extendedCostUsd.toFixed(2)} | ${i.codeRef ?? ''} |`,
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
