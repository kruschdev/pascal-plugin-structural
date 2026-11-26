/**
 * Deterministic IRC 2021/2024, AWC NDS 2024, and AISC structural member sizing engine.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  BEAM_CATALOG,
  type BeamCatalogEntry,
  type BeamMaterialFamily,
  type BeamRole,
  CEILING_JOIST_SPANS_FT,
  COLUMN_CATALOG,
  type ColumnCatalogEntry,
  type ColumnType,
  CONNECTOR_CATALOG,
  type ConnectorCatalogEntry,
  DEFAULT_DESIGN_PARAMS,
  DRESSED_LUMBER_IN,
  FLOOR_JOIST_SPANS_FT,
  type FloorSystemKind,
  type LumberSpecies,
  type NominalLumberSize,
  RAFTER_SPANS_FT,
  type RoofSystemKind,
  SPECIES_PROPERTIES,
  type SeismicCategory,
  type StructuralDesignParams,
  type StudSpacingIn,
  TJI_IJOIST_CATALOG,
  type TjiIJoistEntry,
  getConnectorBySku,
} from './tables'

export type BeamSizingInput = {
  spanFt: number
  tributaryWidthFt: number
  role: BeamRole
  preferredFamily?: BeamMaterialFamily
  maxDepthIn?: number
  liveLoadPsf?: number
  deadLoadPsf?: number
  snowLoadPsf?: number
  pointLoadLbs?: number
  species?: LumberSpecies
  bearingMaterial?: 'wood' | 'masonry'
  storiesSupported?: 0 | 1 | 2
}

export type BeamCheckResult = {
  entry: BeamCatalogEntry
  spanFt: number
  uniformLoadPlf: number
  liveLoadPlf: number
  momentFtLbs: number
  shearLbs: number
  bendingUtilization: number
  shearUtilization: number
  liveDeflectionIn: number
  liveDeflectionRatio: number
  totalDeflectionIn: number
  totalDeflectionRatio: number
  requiredBearingIn: number
  jackStudsEachEnd: 1 | 2 | 3 | 4
  recommendedHangerSku: string
  passes: boolean
  governingCheck: 'bending' | 'shear' | 'deflection-live' | 'deflection-total'
  warnings: string[]
}

/**
 * Evaluate a specific beam entry under uniform + mid-span point loads (ASD).
 */
export function checkBeamEntry(
  entry: BeamCatalogEntry,
  input: BeamSizingInput,
): BeamCheckResult {
  const spanFt = Math.max(1, input.spanFt)
  const spanIn = spanFt * 12
  const species = input.species ?? DEFAULT_DESIGN_PARAMS.species
  const sp = SPECIES_PROPERTIES[species]

  // Adjust dimensional built-up catalog values (baselined to DF-L #2) for selected species
  const isDim = entry.family === 'dimensional-built-up'
  const dfl = SPECIES_PROPERTIES['df-l-2']
  const fbScale = isDim ? sp.fbPsi / dfl.fbPsi : 1
  const fvScale = isDim ? sp.fvPsi / dfl.fvPsi : 1
  const eScale = isDim ? sp.ePsi / dfl.ePsi : 1

  const isRoof =
    input.role === 'ridge-beam' ||
    input.role === 'hip-beam' ||
    input.role === 'valley-beam' ||
    input.role === 'porch-beam'
  const livePsf = input.liveLoadPsf ?? (isRoof ? Math.max(20, input.snowLoadPsf ?? 30) : 40)
  const deadPsf = input.deadLoadPsf ?? (isRoof ? 12 : 10)
  const tribFt = Math.max(1, input.tributaryWidthFt)
  const storiesMultiplier = 1 + (input.storiesSupported ?? 0) * 0.85

  const liveLoadPlf = livePsf * tribFt * storiesMultiplier
  const deadLoadPlf = deadPsf * tribFt * storiesMultiplier + entry.weightPlf
  const uniformLoadPlf = liveLoadPlf + deadLoadPlf
  const pointLoadLbs = Math.max(0, input.pointLoadLbs ?? 0)

  // Snow load duration factor Cd = 1.15 for wood roofs with snow >= 20 psf
  const cdFactor = entry.family === 'steel-w' ? 1.0 : isRoof && (input.snowLoadPsf ?? 0) >= 20 ? 1.15 : 1.0

  const momentFtLbs = (uniformLoadPlf * spanFt * spanFt) / 8 + (pointLoadLbs * spanFt) / 4
  const shearLbs = (uniformLoadPlf * spanFt) / 2 + pointLoadLbs / 2

  const allowMoment = entry.allowableMomentFtLbs * fbScale * cdFactor
  const allowShear = entry.allowableShearLbs * fvScale * cdFactor
  const ei = entry.eiLbIn2 * eScale

  const bendingUtilization = momentFtLbs / Math.max(1, allowMoment)
  const shearUtilization = shearLbs / Math.max(1, allowShear)

  // Deflection: 5wL^4 / (384EI) + PL^3 / (48EI)
  const wLiveLbIn = liveLoadPlf / 12
  const wTotalLbIn = uniformLoadPlf / 12
  const livePointLbs = pointLoadLbs * 0.7
  const liveDeflectionIn =
    (5 * wLiveLbIn * Math.pow(spanIn, 4)) / (384 * ei) +
    (livePointLbs * Math.pow(spanIn, 3)) / (48 * ei)
  const totalDeflectionIn =
    (5 * wTotalLbIn * Math.pow(spanIn, 4)) / (384 * ei) +
    (pointLoadLbs * Math.pow(spanIn, 3)) / (48 * ei)

  const liveLimitRatio = isRoof ? 240 : 360
  const totalLimitRatio = isRoof ? 180 : 240
  const liveDeflectionRatio = liveDeflectionIn > 1e-6 ? spanIn / liveDeflectionIn : 9999
  const totalDeflectionRatio = totalDeflectionIn > 1e-6 ? spanIn / totalDeflectionIn : 9999

  const liveDeflUtil = (spanIn / liveLimitRatio > 0) ? liveDeflectionIn / (spanIn / liveLimitRatio) : 0
  const totalDeflUtil = (spanIn / totalLimitRatio > 0) ? totalDeflectionIn / (spanIn / totalLimitRatio) : 0

  // Bearing length per IRC R502.6 (min 1.5" on wood, 3.0" on masonry/concrete)
  const bearingStressPsi = input.bearingMaterial === 'masonry' ? 500 : Math.min(sp.fcPerpPsi, entry.bearingPsi)
  const minCodeBearing = input.bearingMaterial === 'masonry' ? 3.0 : 1.5
  const calcBearingIn = shearLbs / Math.max(1, entry.widthIn * bearingStressPsi)
  const requiredBearingIn = Number(Math.max(minCodeBearing, calcBearingIn).toFixed(2))

  // Jack stud count per IRC Table R602.7(1)/(2)/(3) + reaction bearing check
  // Each 2x4/2x6 DF-L jack stud offers ~1.5" bearing width; heavy reactions require 2–4 jacks
  const rawJacks = Math.max(
    Math.ceil(requiredBearingIn / 1.5),
    spanFt > 12 ? 3 : spanFt > 8 ? 2 : spanFt > 5.5 && (input.storiesSupported ?? 0) >= 1 ? 2 : 1,
  )
  const jackStudsEachEnd = Math.min(4, Math.max(1, rawJacks)) as 1 | 2 | 3 | 4

  const warnings: string[] = []
  if (bendingUtilization > 1.0) {
    warnings.push(`Bending overstressed (${Math.round(bendingUtilization * 100)}% of ASD Fb capacity)`)
  }
  if (shearUtilization > 1.0) {
    warnings.push(`Shear overstressed (${Math.round(shearUtilization * 100)}% of ASD Fv capacity)`)
  }
  if (liveDeflUtil > 1.0) {
    warnings.push(`Live-load deflection L/${Math.round(liveDeflectionRatio)} exceeds L/${liveLimitRatio} limit`)
  }
  if (totalDeflUtil > 1.0) {
    warnings.push(`Total-load deflection L/${Math.round(totalDeflectionRatio)} exceeds L/${totalLimitRatio} limit`)
  }
  if (entry.family === 'dimensional-built-up' && spanFt > 10) {
    warnings.push('Exceeds 10 ft prescriptive built-up header range — consider LVL, Glulam, or PSL')
  }

  const maxUtil = Math.max(bendingUtilization, shearUtilization, liveDeflUtil, totalDeflUtil)
  let governingCheck: BeamCheckResult['governingCheck'] = 'bending'
  if (maxUtil === shearUtilization) governingCheck = 'shear'
  else if (maxUtil === liveDeflUtil) governingCheck = 'deflection-live'
  else if (maxUtil === totalDeflUtil) governingCheck = 'deflection-total'

  const recommendedHangerSku = selectBeamHangerSku(entry, shearLbs)

  return {
    entry,
    spanFt,
    uniformLoadPlf: Math.round(uniformLoadPlf),
    liveLoadPlf: Math.round(liveLoadPlf),
    momentFtLbs: Math.round(momentFtLbs),
    shearLbs: Math.round(shearLbs),
    bendingUtilization: Number(bendingUtilization.toFixed(3)),
    shearUtilization: Number(shearUtilization.toFixed(3)),
    liveDeflectionIn: Number(liveDeflectionIn.toFixed(3)),
    liveDeflectionRatio: Math.round(liveDeflectionRatio),
    totalDeflectionIn: Number(totalDeflectionIn.toFixed(3)),
    totalDeflectionRatio: Math.round(totalDeflectionRatio),
    requiredBearingIn,
    jackStudsEachEnd,
    recommendedHangerSku,
    passes: bendingUtilization <= 1.0 && shearUtilization <= 1.0 && liveDeflUtil <= 1.0 && totalDeflUtil <= 1.0,
    governingCheck,
    warnings,
  }
}

export function selectBeamHangerSku(entry: BeamCatalogEntry, reactionLbs: number): string {
  if (entry.family === 'glulam' && entry.widthIn <= 3.75 && reactionLbs <= 5900) return 'HUCQ410-SDS'
  if (entry.widthIn >= 5.0) {
    return reactionLbs > 7500 ? 'HGUS5.50/12' : 'HHUS5.50/10'
  }
  if (entry.widthIn >= 3.25) {
    return reactionLbs > 5400 ? 'HHUS410' : 'HHUS210-2'
  }
  return reactionLbs > 1800 ? 'HUS210' : 'LUS210'
}

/**
 * Automatically size the most economical passing beam/header/girder across dimensional,
 * LVL, LSL, PSL, Glulam, Flitch, and A992 Steel W-beam families.
 */
export function sizeBeamOrHeader(input: BeamSizingInput): BeamCheckResult {
  let candidates = [...BEAM_CATALOG]
  if (input.preferredFamily) {
    const filtered = candidates.filter((c) => c.family === input.preferredFamily)
    if (filtered.length > 0) candidates = filtered
  }
  if (input.maxDepthIn !== undefined) {
    const depthFit = candidates.filter((c) => c.depthIn <= input.maxDepthIn! + 0.05)
    if (depthFit.length > 0) candidates = depthFit
  }

  // Sort by cost per linear foot ascending so we pick the leanest passing member
  candidates.sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)

  for (const cand of candidates) {
    const check = checkBeamEntry(cand, input)
    if (check.passes) return check
  }

  // If preferred family exhausted, escalate across full catalog (LVL -> PSL -> Steel)
  if (input.preferredFamily) {
    const full = [...BEAM_CATALOG].sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)
    for (const cand of full) {
      const check = checkBeamEntry(cand, input)
      if (check.passes) return check
    }
  }

  // Return strongest candidate with overstress warnings
  const strongest = [...BEAM_CATALOG].sort((a, b) => b.allowableMomentFtLbs - a.allowableMomentFtLbs)[0]!
  return checkBeamEntry(strongest, input)
}

// ============================================================================
// FLOOR & ROOF FRAMING SIZING
// ============================================================================

export type FloorSystemSizingResult = {
  system: FloorSystemKind
  memberLabel: string
  depthIn: number
  spacingIn: StudSpacingIn
  maxAllowableSpanFt: number
  clearSpanFt: number
  girderLinesNeeded: number
  effectiveSpanFt: number
  joistHangerSku: string
  recommendedGirder?: BeamCheckResult
  tjiEntry?: TjiIJoistEntry
  codeRef: string
}

export function sizeFloorSystem(params: {
  clearSpanFt: number
  crossLengthFt: number
  system: FloorSystemKind
  species?: LumberSpecies
  spacingIn?: StudSpacingIn
  liveLoadPsf?: number
  deadLoadPsf?: number
}): FloorSystemSizingResult {
  const {
    clearSpanFt,
    crossLengthFt,
    system,
    species = 'df-l-2',
    spacingIn = 16,
    liveLoadPsf = 40,
    deadLoadPsf = 10,
  } = params

  if (system === 'open-web-truss') {
    const depthIn = clearSpanFt > 26 ? 24 : clearSpanFt > 20 ? 18 : clearSpanFt > 15 ? 14 : 12
    const maxSpan = depthIn === 24 ? 32 : depthIn === 18 ? 26 : depthIn === 14 ? 21 : 17
    const girderLinesNeeded = clearSpanFt > maxSpan ? Math.ceil(clearSpanFt / maxSpan) - 1 : 0
    const effectiveSpanFt = clearSpanFt / (girderLinesNeeded + 1)
    const recommendedGirder =
      girderLinesNeeded > 0
        ? sizeBeamOrHeader({
            spanFt: Math.min(crossLengthFt, 16),
            tributaryWidthFt: effectiveSpanFt,
            role: 'floor-girder',
            preferredFamily: 'lvl',
            liveLoadPsf,
            deadLoadPsf,
            species,
          })
        : undefined
    return {
      system,
      memberLabel: `${depthIn}" Open-Web Floor Truss @ ${spacingIn}" OC`,
      depthIn,
      spacingIn,
      maxAllowableSpanFt: maxSpan,
      clearSpanFt,
      girderLinesNeeded,
      effectiveSpanFt: Number(effectiveSpanFt.toFixed(2)),
      joistHangerSku: 'MIT411.88',
      recommendedGirder,
      codeRef: 'IRC R502.11 / TPI 1',
    }
  }

  if (system === 'tji-ijoist') {
    const pickTji = (span: number) =>
      TJI_IJOIST_CATALOG.find((t) => t.maxSpanFt[spacingIn] >= span)
    let girderLinesNeeded = 0
    let tji = pickTji(clearSpanFt)
    while (!tji && girderLinesNeeded < 3) {
      girderLinesNeeded += 1
      tji = pickTji(clearSpanFt / (girderLinesNeeded + 1))
    }
    const chosen = tji ?? TJI_IJOIST_CATALOG[TJI_IJOIST_CATALOG.length - 1]!
    const effectiveSpanFt = clearSpanFt / (girderLinesNeeded + 1)
    const recommendedGirder =
      girderLinesNeeded > 0
        ? sizeBeamOrHeader({
            spanFt: Math.min(crossLengthFt, 16),
            tributaryWidthFt: effectiveSpanFt,
            role: 'floor-girder',
            preferredFamily: 'lvl',
            liveLoadPsf,
            deadLoadPsf,
            species,
          })
        : undefined
    return {
      system,
      memberLabel: `${chosen.series} ${chosen.depthIn}" I-Joist @ ${spacingIn}" OC`,
      depthIn: chosen.depthIn,
      spacingIn,
      maxAllowableSpanFt: chosen.maxSpanFt[spacingIn],
      clearSpanFt,
      girderLinesNeeded,
      effectiveSpanFt: Number(effectiveSpanFt.toFixed(2)),
      joistHangerSku: chosen.depthIn >= 14 ? 'MIT411.88' : 'IUS2.56/11.88',
      recommendedGirder,
      tjiEntry: chosen,
      codeRef: 'IRC R502.1.2 / PRI-400',
    }
  }

  // Dimensional lumber multi-species lookup (IRC Table R502.3.1(2))
  const sizes: Array<'2x6' | '2x8' | '2x10' | '2x12'> = ['2x8', '2x10', '2x12']
  const table = FLOOR_JOIST_SPANS_FT[species]
  const pickDim = (span: number) => sizes.find((s) => table[s][spacingIn] >= span)

  let girderLinesNeeded = 0
  let chosenSize = pickDim(clearSpanFt)
  while (!chosenSize && girderLinesNeeded < 3) {
    girderLinesNeeded += 1
    chosenSize = pickDim(clearSpanFt / (girderLinesNeeded + 1))
  }
  const finalSize = chosenSize ?? '2x12'
  const effectiveSpanFt = clearSpanFt / (girderLinesNeeded + 1)
  const depthIn = DRESSED_LUMBER_IN[finalSize][1]
  const hangerSku =
    finalSize === '2x12' ? 'LUS212' : finalSize === '2x10' ? 'LUS210' : finalSize === '2x8' ? 'LUS28' : 'LUS26'

  const recommendedGirder =
    girderLinesNeeded > 0
      ? sizeBeamOrHeader({
          spanFt: Math.min(crossLengthFt, 14),
          tributaryWidthFt: effectiveSpanFt,
          role: 'floor-girder',
          liveLoadPsf,
          deadLoadPsf,
          species,
        })
      : undefined

  return {
    system: 'dimensional',
    memberLabel: `${finalSize} ${SPECIES_PROPERTIES[species].label} @ ${spacingIn}" OC`,
    depthIn,
    spacingIn,
    maxAllowableSpanFt: table[finalSize][spacingIn],
    clearSpanFt,
    girderLinesNeeded,
    effectiveSpanFt: Number(effectiveSpanFt.toFixed(2)),
    joistHangerSku: hangerSku,
    recommendedGirder,
    codeRef: 'IRC Table R502.3.1(2)',
  }
}

export type RoofSystemSizingResult = {
  system: RoofSystemKind
  memberLabel: string
  rafterOrChordSize: NominalLumberSize
  ceilingJoistSize: NominalLumberSize
  spacingIn: StudSpacingIn
  maxHorizontalRunFt: number
  actualHorizontalRunFt: number
  needsPurlinAndStruts: boolean
  needsStructuralRidgeBeam: boolean
  recommendedRidgeBeam?: BeamCheckResult
  hurricaneTieSku: string
  gableClipSku: string
  codeRef: string
}

export function sizeRoofSystem(params: {
  buildingSpanFt: number
  ridgeLengthFt: number
  pitchRiseOver12: number
  system: RoofSystemKind
  design?: Partial<StructuralDesignParams>
  spacingIn?: StudSpacingIn
}): RoofSystemSizingResult {
  const design = { ...DEFAULT_DESIGN_PARAMS, ...params.design }
  const spacingIn: StudSpacingIn = params.spacingIn ?? (params.system === 'stick-rafter' ? 16 : 24)
  const halfSpanFt = Math.max(2, params.buildingSpanFt / 2)
  const snowBand: 'snow20' | 'snow30' | 'snow50' | 'snow70' =
    design.groundSnowPsf >= 60
      ? 'snow70'
      : design.groundSnowPsf >= 45
        ? 'snow50'
        : design.groundSnowPsf >= 25
          ? 'snow30'
          : 'snow20'

  const hurricaneTieSku = selectHurricaneTieSku({
    windMph: design.windMph,
    exposure: design.exposure,
    seismicCategory: design.seismicCategory,
    isGirderTruss: false,
  })

  if (params.system === 'fink-truss' || params.system === 'scissor-truss' || params.system === 'attic-truss') {
    const labelMap: Record<'fink-truss' | 'scissor-truss' | 'attic-truss', string> = {
      'fink-truss': `Prefab Fink Roof Truss (${params.buildingSpanFt.toFixed(0)}' span @ 24" OC, 2x4/2x6 chords)`,
      'scissor-truss': `Prefab Scissor Vault Truss (${params.buildingSpanFt.toFixed(0)}' span @ 24" OC)`,
      'attic-truss': `Prefab Habitable Attic Truss (${params.buildingSpanFt.toFixed(0)}' span @ 24" OC, 2x10 bottom chord)`,
    }
    return {
      system: params.system,
      memberLabel: labelMap[params.system],
      rafterOrChordSize: params.system === 'attic-truss' ? '2x8' : '2x6',
      ceilingJoistSize: params.system === 'attic-truss' ? '2x10' : '2x4',
      spacingIn: 24,
      maxHorizontalRunFt: 48,
      actualHorizontalRunFt: halfSpanFt,
      needsPurlinAndStruts: false,
      needsStructuralRidgeBeam: false,
      hurricaneTieSku,
      gableClipSku: 'A35',
      codeRef: 'IRC R802.10 / TPI 1',
    }
  }

  const rafterTable = RAFTER_SPANS_FT[snowBand][design.species]
  const cjTable = CEILING_JOIST_SPANS_FT[design.species]
  const sizes: Array<'2x6' | '2x8' | '2x10' | '2x12'> = ['2x6', '2x8', '2x10', '2x12']
  const chosenRafter = sizes.find((s) => rafterTable[s][spacingIn] >= halfSpanFt) ?? '2x12'
  const maxRunFt = rafterTable[chosenRafter][spacingIn]
  const chosenCj = sizes.find((s) => cjTable[s][16] >= halfSpanFt) ?? '2x12'

  const needsStructuralRidgeBeam =
    params.system === 'ridge-beam-cathedral' || params.pitchRiseOver12 < 3
  const needsPurlinAndStruts = !needsStructuralRidgeBeam && halfSpanFt > maxRunFt

  const recommendedRidgeBeam = needsStructuralRidgeBeam
    ? sizeBeamOrHeader({
        spanFt: Math.min(params.ridgeLengthFt, 20),
        tributaryWidthFt: halfSpanFt,
        role: 'ridge-beam',
        preferredFamily: params.ridgeLengthFt > 14 ? 'glulam' : 'lvl',
        snowLoadPsf: design.groundSnowPsf,
        deadLoadPsf: design.roofDeadLoadPsf,
        species: design.species,
      })
    : undefined

  return {
    system: params.system,
    memberLabel: `${chosenRafter} ${SPECIES_PROPERTIES[design.species].label} Rafters @ ${spacingIn}" OC`,
    rafterOrChordSize: chosenRafter,
    ceilingJoistSize: chosenCj,
    spacingIn,
    maxHorizontalRunFt: maxRunFt,
    actualHorizontalRunFt: Number(halfSpanFt.toFixed(2)),
    needsPurlinAndStruts,
    needsStructuralRidgeBeam,
    recommendedRidgeBeam,
    hurricaneTieSku,
    gableClipSku: design.windMph >= 130 ? 'HGA10' : 'A35',
    codeRef: needsStructuralRidgeBeam ? 'IRC R802.4.3 / R802.4.1' : 'IRC Table R802.4.1(1)/(5)',
  }
}

// ============================================================================
// COLUMN & FOOTING SIZING (NDS Cp BUCKLING + IRC R403.1 SPREAD FOOTINGS)
// ============================================================================

export type ColumnSizingResult = {
  entry: ColumnCatalogEntry
  unbracedHeightFt: number
  axialLoadLbs: number
  allowableAxialLbs: number
  utilization: number
  passes: boolean
  footingWidthIn: number
  footingDepthIn: number
  footingRebar: string
  recommendedBaseSku: string
  recommendedCapSku: string
  codeRef: string
}

export function sizeColumnAndFooting(params: {
  axialLoadLbs: number
  unbracedHeightFt: number
  preferredType?: ColumnType
  soilBearingPsf?: number
  frostDepthIn?: number
}): ColumnSizingResult {
  const {
    axialLoadLbs,
    unbracedHeightFt,
    preferredType,
    soilBearingPsf = 1500,
    frostDepthIn = 36,
  } = params

  const calcCapacity = (col: ColumnCatalogEntry): number => {
    if (col.columnType === 'steel-hss' || col.columnType === 'steel-lally') {
      const slendernessScale = Math.min(1, Math.pow(9 / Math.max(6, unbracedHeightFt), 0.7))
      return Math.round(col.allowableAxial9FtLbs * slendernessScale)
    }
    // NDS Euler buckling approximation (Cp factor)
    const dMin = Math.min(col.widthIn, col.depthIn)
    const leOverD = (unbracedHeightFt * 12) / dMin
    if (leOverD > 50) return 0
    const fcStar = col.fcPsi
    const fcE = (0.822 * col.eMinPsi) / (leOverD * leOverD)
    const ratio = fcE / fcStar
    const c = col.columnType === 'psl' || col.columnType === 'glulam' ? 0.9 : 0.8
    const term = (1 + ratio) / (2 * c)
    const cp = term - Math.sqrt(Math.max(0, term * term - ratio / c))
    return Math.round(fcStar * cp * col.areaIn2)
  }

  let pool = [...COLUMN_CATALOG]
  if (preferredType) {
    const f = pool.filter((c) => c.columnType === preferredType)
    if (f.length > 0) pool = f
  }
  pool.sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)

  let chosen = pool.find((c) => calcCapacity(c) >= axialLoadLbs)
  if (!chosen && preferredType) {
    chosen = [...COLUMN_CATALOG]
      .sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)
      .find((c) => calcCapacity(c) >= axialLoadLbs)
  }
  const entry = chosen ?? COLUMN_CATALOG[COLUMN_CATALOG.length - 1]!
  const allowableAxialLbs = Math.max(1, calcCapacity(entry))
  const utilization = Number((axialLoadLbs / allowableAxialLbs).toFixed(3))

  // Spread/pad footing area = P / soilBearingPsf (min 24"x24"x10" per IRC R403.1)
  const reqAreaSqFt = Math.max(4, axialLoadLbs / Math.max(1000, soilBearingPsf))
  const sideIn = Math.max(24, Math.ceil((Math.sqrt(reqAreaSqFt) * 12) / 6) * 6)
  const footingDepthIn = Math.max(10, Math.ceil(sideIn / 3), frostDepthIn > 0 ? 12 : 10)
  const barCount = Math.max(3, Math.ceil(sideIn / 8))
  const footingRebar = `(${barCount}) #4 EW @ bottom (3" clear cover)`

  return {
    entry,
    unbracedHeightFt,
    axialLoadLbs: Math.round(axialLoadLbs),
    allowableAxialLbs,
    utilization,
    passes: utilization <= 1.0,
    footingWidthIn: sideIn,
    footingDepthIn,
    footingRebar,
    recommendedBaseSku: entry.recommendedBaseSku,
    recommendedCapSku: entry.recommendedCapSku,
    codeRef: 'AWC NDS 3.7 / IRC R403.1 / R407.3',
  }
}

// ============================================================================
// CONNECTOR & HARDWARE SELECTION (SIMPSON-CLASS SKUs)
// ============================================================================

export function selectHurricaneTieSku(params: {
  windMph: number
  exposure: 'B' | 'C' | 'D'
  seismicCategory: SeismicCategory
  isGirderTruss?: boolean
  upliftDemandLbs?: number
}): string {
  const { windMph, exposure, isGirderTruss = false, upliftDemandLbs = 0 } = params
  if (isGirderTruss || upliftDemandLbs > 1600) return 'HGA10'
  if (windMph >= 150 || (windMph >= 140 && exposure === 'D') || upliftDemandLbs > 1300) return 'HTS20'
  if (windMph >= 130 || (windMph >= 120 && exposure !== 'B') || upliftDemandLbs > 600) return 'H10A'
  if (windMph >= 115) return 'H2.5A'
  return 'H1'
}

export function selectHoldDownSku(upliftDemandLbs: number): ConnectorCatalogEntry {
  const holdDowns = CONNECTOR_CATALOG.filter((c) => c.category === 'hold-down').sort(
    (a, b) => a.upliftLbs - b.upliftLbs,
  )
  return (
    holdDowns.find((h) => h.upliftLbs >= upliftDemandLbs) ??
    getConnectorBySku('HDU11-SDS2.5') ??
    holdDowns[holdDowns.length - 1]!
  )
}
