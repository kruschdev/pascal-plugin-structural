/**
 * Pure IRC 2021/2024, AWC NDS 2024, WFCM, and AISC structural reference tables.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 *
 * Covers:
 * - Multi-species dimensional lumber (DF-L #2, SPF #2, SYP #2, Hem-Fir #2)
 * - IRC R502.3.1(2) floor joists, R802.4.1(1)/(5) rafters, R802.5.1(2) ceiling joists
 * - IRC R602.7(1)/(2)/(3) exterior, interior-bearing, and porch headers + exact jack-stud counts
 * - Engineered wood & steel catalogs: LVL 2.0E, PSL 2.0E, LSL 1.55E, Glulam 24F-V4/V8,
 *   TJI I-joists (with web knockout rules), open-web floor & roof trusses, A992 Steel W-beams, A36 Flitch plates
 * - Simpson-class connector catalog (47 SKUs): hurricane ties, framing angles, face/top/sloped/heavy hangers,
 *   post bases, post caps, hold-downs, straps, seismic plate washers, and anchor bolts
 * - IRC R302.11 fire blocking & R302.12 draftstopping rules and approved materials
 */

export const INCHES_TO_METERS = 0.0254
export const FEET_TO_METERS = 0.3048
export const METERS_TO_INCHES = 1 / INCHES_TO_METERS
export const METERS_TO_FEET = 1 / FEET_TO_METERS

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export type SceneNodeLike = {
  id: string
  type: string
  name?: string
  parentId?: string | null
  position?: Vec3
  rotation?: number | Vec3
  start?: Vec2
  end?: Vec2
  height?: number
  thickness?: number
  width?: number
  depth?: number
  elevation?: number
  pitch?: number
  roofType?: string
  polygon?: ReadonlyArray<Vec2>
  holes?: ReadonlyArray<ReadonlyArray<Vec2>>
  path?: ReadonlyArray<Vec3>
  children?: readonly string[]
  [key: string]: unknown
}

export type LumberSpecies = 'df-l-2' | 'spf-2' | 'syp-2' | 'hem-fir-2'
export type StudSize = '2x4' | '2x6'
export type StudSpacingIn = 12 | 16 | 24
export type FloorSystemKind = 'dimensional' | 'tji-ijoist' | 'open-web-truss'
export type RoofSystemKind =
  | 'stick-rafter'
  | 'fink-truss'
  | 'scissor-truss'
  | 'attic-truss'
  | 'ridge-beam-cathedral'
export type ExposureCategory = 'B' | 'C' | 'D'
export type SeismicCategory = 'A' | 'B' | 'C' | 'D0' | 'D1' | 'D2'
export type AssemblyKind =
  | 'wall-framing'
  | 'floor-system'
  | 'roof-system'
  | 'braced-wall-line'
  | 'foundation-system'

export type WallConstructionKind = 'wood-framed' | 'lgs' | 'cmu' | 'shear-wall' | 'skip'

export type WallOverrideRule = {
  construction: WallConstructionKind
  studSize?: StudSize
  studSpacingIn?: StudSpacingIn
  isLoadBearing?: boolean
  isShearWall?: boolean
  isWetWall?: boolean
  sheathingEdgeNailIn?: 2 | 3 | 4 | 6
}

export type StructuralDesignParams = {
  codeEdition: 'IRC-2021' | 'IRC-2024'
  species: LumberSpecies
  groundSnowPsf: number
  windMph: number
  exposure: ExposureCategory
  seismicCategory: SeismicCategory
  frostDepthIn: number
  soilBearingPsf: number
  floorLiveLoadPsf: number
  floorDeadLoadPsf: number
  roofLiveLoadPsf: number
  roofDeadLoadPsf: number
  buildingWidthFt: number
  storiesAbove: 0 | 1 | 2
}

export const DEFAULT_DESIGN_PARAMS: StructuralDesignParams = {
  codeEdition: 'IRC-2021',
  species: 'df-l-2',
  groundSnowPsf: 30,
  windMph: 115,
  exposure: 'B',
  seismicCategory: 'C',
  frostDepthIn: 36,
  soilBearingPsf: 1500,
  floorLiveLoadPsf: 40,
  floorDeadLoadPsf: 10,
  roofLiveLoadPsf: 20,
  roofDeadLoadPsf: 10,
  buildingWidthFt: 28,
  storiesAbove: 0,
}

export type NominalLumberSize =
  | '2x4'
  | '2x6'
  | '2x8'
  | '2x10'
  | '2x12'
  | '4x4'
  | '4x6'
  | '4x8'
  | '4x10'
  | '4x12'
  | '6x6'
  | '8x8'

/** Actual dressed cross-section [thicknessIn, depthIn] per US PS 20. */
export const DRESSED_LUMBER_IN: Readonly<Record<NominalLumberSize, readonly [number, number]>> = {
  '2x4': [1.5, 3.5],
  '2x6': [1.5, 5.5],
  '2x8': [1.5, 7.25],
  '2x10': [1.5, 9.25],
  '2x12': [1.5, 11.25],
  '4x4': [3.5, 3.5],
  '4x6': [3.5, 5.5],
  '4x8': [3.5, 7.25],
  '4x10': [3.5, 9.25],
  '4x12': [3.5, 11.25],
  '6x6': [5.5, 5.5],
  '8x8': [7.25, 7.25],
}

export type SpeciesProperties = {
  id: LumberSpecies
  label: string
  /** Base bending stress Fb (psi), repetitive member factor Cr = 1.15 applied in sizing when >=3 plies/joists */
  fbPsi: number
  /** Horizontal shear Fv (psi) */
  fvPsi: number
  /** Compression parallel to grain Fc (psi) */
  fcPsi: number
  /** Compression perpendicular to grain Fc_perp (psi) — governs bearing length */
  fcPerpPsi: number
  /** Modulus of elasticity E (psi) */
  ePsi: number
  /** Minimum modulus Emin (psi) — governs column buckling */
  eMinPsi: number
  /** Specific gravity G (governs fastener withdrawal/lateral capacity) */
  specificGravity: number
  /** Price multiplier vs SPF #2 baseline */
  priceMultiplier: number
}

/** NDS 2024 Supplement Table 4A reference design values for No. 2 dimension lumber. */
export const SPECIES_PROPERTIES: Readonly<Record<LumberSpecies, SpeciesProperties>> = {
  'df-l-2': {
    id: 'df-l-2',
    label: 'Douglas Fir-Larch #2',
    fbPsi: 900,
    fvPsi: 180,
    fcPsi: 1350,
    fcPerpPsi: 625,
    ePsi: 1_600_000,
    eMinPsi: 580_000,
    specificGravity: 0.5,
    priceMultiplier: 1.12,
  },
  'spf-2': {
    id: 'spf-2',
    label: 'Spruce-Pine-Fir #2',
    fbPsi: 875,
    fvPsi: 135,
    fcPsi: 1150,
    fcPerpPsi: 425,
    ePsi: 1_400_000,
    eMinPsi: 510_000,
    specificGravity: 0.42,
    priceMultiplier: 1.0,
  },
  'syp-2': {
    id: 'syp-2',
    label: 'Southern Yellow Pine #2',
    fbPsi: 1100,
    fvPsi: 175,
    fcPsi: 1450,
    fcPerpPsi: 565,
    ePsi: 1_400_000,
    eMinPsi: 510_000,
    specificGravity: 0.55,
    priceMultiplier: 1.08,
  },
  'hem-fir-2': {
    id: 'hem-fir-2',
    label: 'Hem-Fir #2',
    fbPsi: 850,
    fvPsi: 150,
    fcPsi: 1300,
    fcPerpPsi: 405,
    ePsi: 1_300_000,
    eMinPsi: 470_000,
    specificGravity: 0.43,
    priceMultiplier: 1.04,
  },
}

/**
 * NDS 2024 Supplement Table 4B size-specific Fb values (psi) for Southern Yellow Pine #2.
 * Unlike Table 4A species (DF-L, SPF, Hem-Fir), SYP Table 4B already incorporates size adjustments
 * so no separate Cf multiplier is applied on top.
 */
export const SYP_NO2_FB_BY_DEPTH_IN: Readonly<Record<'2x4' | '2x6' | '2x8' | '2x10' | '2x12', number>> = {
  '2x4': 1100,
  '2x6': 1000,
  '2x8': 925,
  '2x10': 800,
  '2x12': 750,
}

/** NDS Table 4A bending size factor Cf for DF-L / SPF / Hem-Fir No. 2 dimension lumber. */
export function getDimensionalCf(depthIn: number): number {
  if (depthIn <= 4.0) return 1.5
  if (depthIn <= 6.0) return 1.3
  if (depthIn <= 8.0) return 1.2
  if (depthIn <= 10.0) return 1.1
  return 1.0
}

/** Resolve true size-specific NDS Table 4B Fb (psi) for Southern Yellow Pine #2 by dressed depth. */
export function getSypNo2FbPsi(depthIn: number): number {
  if (depthIn <= 4.0) return SYP_NO2_FB_BY_DEPTH_IN['2x4']
  if (depthIn <= 6.0) return SYP_NO2_FB_BY_DEPTH_IN['2x6']
  if (depthIn <= 8.0) return SYP_NO2_FB_BY_DEPTH_IN['2x8']
  if (depthIn <= 10.0) return SYP_NO2_FB_BY_DEPTH_IN['2x10']
  return SYP_NO2_FB_BY_DEPTH_IN['2x12']
}

/**
 * IRC 2021/2024 Table R502.3.1(2) — Floor joist maximum spans (feet) for 40 psf live / 10 psf dead, L/360.
 * Keyed by species -> nominal size -> spacing (12 | 16 | 24 in OC).
 */
export const FLOOR_JOIST_SPANS_FT: Readonly<
  Record<LumberSpecies, Readonly<Record<'2x6' | '2x8' | '2x10' | '2x12', Readonly<Record<StudSpacingIn, number>>>>>
> = {
  'df-l-2': {
    '2x6': { 12: 10.75, 16: 9.75, 24: 8.5 },
    '2x8': { 12: 14.17, 16: 12.92, 24: 11.08 },
    '2x10': { 12: 18.0, 16: 16.42, 24: 13.58 },
    '2x12': { 12: 21.92, 16: 19.83, 24: 15.75 },
  },
  'spf-2': {
    '2x6': { 12: 10.25, 16: 9.33, 24: 8.08 },
    '2x8': { 12: 13.5, 16: 12.25, 24: 10.25 },
    '2x10': { 12: 17.25, 16: 15.17, 24: 12.42 },
    '2x12': { 12: 20.58, 16: 17.58, 24: 14.33 },
  },
  'syp-2': {
    '2x6': { 12: 10.25, 16: 9.33, 24: 8.17 },
    '2x8': { 12: 13.5, 16: 12.25, 24: 10.75 },
    '2x10': { 12: 17.25, 16: 15.67, 24: 13.67 },
    '2x12': { 12: 21.0, 16: 19.08, 24: 16.08 },
  },
  'hem-fir-2': {
    '2x6': { 12: 10.0, 16: 9.08, 24: 7.92 },
    '2x8': { 12: 13.17, 16: 12.0, 24: 10.17 },
    '2x10': { 12: 16.83, 16: 15.0, 24: 12.25 },
    '2x12': { 12: 20.33, 16: 17.42, 24: 14.25 },
  },
}

/**
 * IRC 2021/2024 Table R802.4.1(1) & (5) — Rafter horizontal projection max spans (feet), L/180, 10 psf dead.
 */
export const RAFTER_SPANS_FT: Readonly<
  Record<
    'snow20' | 'snow30' | 'snow50' | 'snow70',
    Readonly<Record<LumberSpecies, Readonly<Record<'2x6' | '2x8' | '2x10' | '2x12', Readonly<Record<StudSpacingIn, number>>>>>>
  >
> = {
  snow20: {
    'df-l-2': {
      '2x6': { 12: 15.5, 16: 14.08, 24: 11.75 },
      '2x8': { 12: 20.42, 16: 18.08, 24: 14.75 },
      '2x10': { 12: 26.0, 16: 22.08, 24: 18.0 },
      '2x12': { 12: 26.0, 16: 25.58, 24: 20.92 },
    },
    'spf-2': {
      '2x6': { 12: 14.83, 16: 13.5, 24: 11.25 },
      '2x8': { 12: 19.5, 16: 17.5, 24: 14.25 },
      '2x10': { 12: 24.92, 16: 21.33, 24: 17.42 },
      '2x12': { 12: 26.0, 16: 24.75, 24: 20.25 },
    },
    'syp-2': {
      '2x6': { 12: 14.83, 16: 13.5, 24: 11.75 },
      '2x8': { 12: 19.5, 16: 17.75, 24: 15.5 },
      '2x10': { 12: 24.92, 16: 22.67, 24: 19.0 },
      '2x12': { 12: 26.0, 16: 26.0, 24: 22.33 },
    },
    'hem-fir-2': {
      '2x6': { 12: 14.42, 16: 13.08, 24: 11.08 },
      '2x8': { 12: 19.08, 16: 17.25, 24: 14.08 },
      '2x10': { 12: 24.33, 16: 21.08, 24: 17.17 },
      '2x12': { 12: 26.0, 16: 24.42, 24: 20.0 },
    },
  },
  snow30: {
    'df-l-2': {
      '2x6': { 12: 13.75, 16: 12.17, 24: 9.92 },
      '2x8': { 12: 18.08, 16: 15.42, 24: 12.58 },
      '2x10': { 12: 22.67, 16: 18.83, 24: 15.42 },
      '2x12': { 12: 26.0, 16: 21.83, 24: 17.83 },
    },
    'spf-2': {
      '2x6': { 12: 13.17, 16: 11.75, 24: 9.58 },
      '2x8': { 12: 17.33, 16: 14.92, 24: 12.17 },
      '2x10': { 12: 21.83, 16: 18.17, 24: 14.83 },
      '2x12': { 12: 25.42, 16: 21.08, 24: 17.25 },
    },
    'syp-2': {
      '2x6': { 12: 13.17, 16: 12.0, 24: 10.42 },
      '2x8': { 12: 17.33, 16: 15.75, 24: 13.33 },
      '2x10': { 12: 22.17, 16: 19.75, 24: 16.17 },
      '2x12': { 12: 26.0, 16: 23.17, 24: 18.92 },
    },
    'hem-fir-2': {
      '2x6': { 12: 12.83, 16: 11.58, 24: 9.42 },
      '2x8': { 12: 16.92, 16: 14.67, 24: 12.0 },
      '2x10': { 12: 21.5, 16: 18.0, 24: 14.67 },
      '2x12': { 12: 25.0, 16: 20.83, 24: 17.0 },
    },
  },
  snow50: {
    'df-l-2': {
      '2x6': { 12: 11.58, 16: 10.0, 24: 8.17 },
      '2x8': { 12: 14.75, 16: 12.75, 24: 10.42 },
      '2x10': { 12: 18.0, 16: 15.58, 24: 12.75 },
      '2x12': { 12: 20.92, 16: 18.08, 24: 14.75 },
    },
    'spf-2': {
      '2x6': { 12: 11.25, 16: 9.75, 24: 7.92 },
      '2x8': { 12: 14.25, 16: 12.33, 24: 10.08 },
      '2x10': { 12: 17.42, 16: 15.08, 24: 12.33 },
      '2x12': { 12: 20.25, 16: 17.5, 24: 14.25 },
    },
    'syp-2': {
      '2x6': { 12: 11.58, 16: 10.5, 24: 8.67 },
      '2x8': { 12: 15.25, 16: 13.5, 24: 11.08 },
      '2x10': { 12: 19.0, 16: 16.42, 24: 13.42 },
      '2x12': { 12: 22.33, 16: 19.33, 24: 15.75 },
    },
    'hem-fir-2': {
      '2x6': { 12: 11.08, 16: 9.58, 24: 7.83 },
      '2x8': { 12: 14.08, 16: 12.17, 24: 9.92 },
      '2x10': { 12: 17.17, 16: 14.92, 24: 12.17 },
      '2x12': { 12: 20.0, 16: 17.25, 24: 14.08 },
    },
  },
  snow70: {
    'df-l-2': {
      '2x6': { 12: 10.0, 16: 8.67, 24: 7.08 },
      '2x8': { 12: 12.75, 16: 11.08, 24: 9.0 },
      '2x10': { 12: 15.58, 16: 13.5, 24: 11.0 },
      '2x12': { 12: 18.08, 16: 15.67, 24: 12.83 },
    },
    'spf-2': {
      '2x6': { 12: 9.75, 16: 8.42, 24: 6.83 },
      '2x8': { 12: 12.33, 16: 10.67, 24: 8.75 },
      '2x10': { 12: 15.08, 16: 13.08, 24: 10.67 },
      '2x12': { 12: 17.5, 16: 15.17, 24: 12.33 },
    },
    'syp-2': {
      '2x6': { 12: 10.5, 16: 9.17, 24: 7.5 },
      '2x8': { 12: 13.5, 16: 11.75, 24: 9.58 },
      '2x10': { 12: 16.42, 16: 14.25, 24: 11.67 },
      '2x12': { 12: 19.33, 16: 16.75, 24: 13.67 },
    },
    'hem-fir-2': {
      '2x6': { 12: 9.58, 16: 8.33, 24: 6.75 },
      '2x8': { 12: 12.17, 16: 10.58, 24: 8.58 },
      '2x10': { 12: 14.92, 16: 12.92, 24: 10.5 },
      '2x12': { 12: 17.25, 16: 15.0, 24: 12.17 },
    },
  },
}

/** IRC R802.5.1(2) — Ceiling joist max spans (feet), 20 psf live / 10 psf dead, L/240. */
export const CEILING_JOIST_SPANS_FT: Readonly<
  Record<LumberSpecies, Readonly<Record<'2x6' | '2x8' | '2x10' | '2x12', Readonly<Record<StudSpacingIn, number>>>>>
> = {
  'df-l-2': {
    '2x6': { 12: 14.83, 16: 13.5, 24: 11.25 },
    '2x8': { 12: 19.5, 16: 17.75, 24: 14.25 },
    '2x10': { 12: 24.92, 16: 21.33, 24: 17.42 },
    '2x12': { 12: 26.0, 16: 24.75, 24: 20.25 },
  },
  'spf-2': {
    '2x6': { 12: 14.17, 16: 12.92, 24: 10.92 },
    '2x8': { 12: 18.67, 16: 16.92, 24: 13.83 },
    '2x10': { 12: 23.83, 16: 20.67, 24: 16.83 },
    '2x12': { 12: 26.0, 16: 24.0, 24: 19.58 },
  },
  'syp-2': {
    '2x6': { 12: 14.17, 16: 12.92, 24: 11.25 },
    '2x8': { 12: 18.67, 16: 17.0, 24: 14.83 },
    '2x10': { 12: 23.83, 16: 21.67, 24: 18.42 },
    '2x12': { 12: 26.0, 16: 26.0, 24: 21.58 },
  },
  'hem-fir-2': {
    '2x6': { 12: 13.83, 16: 12.58, 24: 10.75 },
    '2x8': { 12: 18.25, 16: 16.67, 24: 13.58 },
    '2x10': { 12: 23.33, 16: 20.33, 24: 16.58 },
    '2x12': { 12: 26.0, 16: 23.67, 24: 19.33 },
  },
}

// ============================================================================
// ENGINEERED WOOD, LAMINATED BEAMS, STEEL W-BEAMS & FLITCH PLATES
// ============================================================================

export type BeamMaterialFamily =
  | 'dimensional-built-up'
  | 'lvl'
  | 'psl'
  | 'lsl'
  | 'glulam'
  | 'steel-w'
  | 'flitch'

export type BeamRole =
  | 'header'
  | 'floor-girder'
  | 'ridge-beam'
  | 'hip-beam'
  | 'valley-beam'
  | 'porch-beam'
  | 'transfer-beam'

export type BeamCatalogEntry = {
  id: string
  family: BeamMaterialFamily
  designation: string
  plyCount: number
  widthIn: number
  depthIn: number
  /** Allowable bending moment capacity Mr (ft-lbs) — ASD */
  allowableMomentFtLbs: number
  /** Allowable vertical shear capacity Vr (lbs) — ASD */
  allowableShearLbs: number
  /** Flexural stiffness EI (lb-in^2) for deflection checks */
  eiLbIn2: number
  /** Allowable bearing stress Fc_perp (psi) */
  bearingPsi: number
  /** Approximate self-weight (plf) */
  weightPlf: number
  /** Installed contractor cost per linear foot (USD, 2026) */
  costPerLfUsd: number
}

function woodBeamEntry(params: {
  id: string
  family: BeamMaterialFamily
  designation: string
  plyCount: number
  widthIn: number
  depthIn: number
  fbPsi: number
  fvPsi: number
  ePsi: number
  fcPerpPsi: number
  densityPcf: number
  costPerLfUsd: number
}): BeamCatalogEntry {
  const { widthIn: b, depthIn: d, fbPsi, fvPsi, ePsi, fcPerpPsi, densityPcf } = params
  const sIn3 = (b * d * d) / 6
  const iIn4 = (b * d * d * d) / 12
  const aIn2 = b * d
  return {
    id: params.id,
    family: params.family,
    designation: params.designation,
    plyCount: params.plyCount,
    widthIn: b,
    depthIn: d,
    allowableMomentFtLbs: Math.round((fbPsi * sIn3) / 12),
    allowableShearLbs: Math.round((2 / 3) * fvPsi * aIn2),
    eiLbIn2: Math.round(ePsi * iIn4),
    bearingPsi: fcPerpPsi,
    weightPlf: Number(((aIn2 / 144) * densityPcf).toFixed(1)),
    costPerLfUsd: params.costPerLfUsd,
  }
}

/** Comprehensive builder beam catalog: dimensional built-up, LVL 2.0E, PSL 2.0E, LSL 1.55E, Glulam 24F-V4/V8, Flitch, and A992 Steel W-beams. */
export const BEAM_CATALOG: readonly BeamCatalogEntry[] = [
  // --- Dimensional Built-up (DF-L #2 baseline; species adjusted dynamically in sizing.ts) ---
  woodBeamEntry({ id: 'dim-2-2x8', family: 'dimensional-built-up', designation: '(2) 2x8 Built-Up Header', plyCount: 2, widthIn: 3.0, depthIn: 7.25, fbPsi: 1080, fvPsi: 180, ePsi: 1_600_000, fcPerpPsi: 625, densityPcf: 35, costPerLfUsd: 5.5 }),
  woodBeamEntry({ id: 'dim-2-2x10', family: 'dimensional-built-up', designation: '(2) 2x10 Built-Up Header', plyCount: 2, widthIn: 3.0, depthIn: 9.25, fbPsi: 990, fvPsi: 180, ePsi: 1_600_000, fcPerpPsi: 625, densityPcf: 35, costPerLfUsd: 7.0 }),
  woodBeamEntry({ id: 'dim-2-2x12', family: 'dimensional-built-up', designation: '(2) 2x12 Built-Up Header', plyCount: 2, widthIn: 3.0, depthIn: 11.25, fbPsi: 900, fvPsi: 180, ePsi: 1_600_000, fcPerpPsi: 625, densityPcf: 35, costPerLfUsd: 9.2 }),
  woodBeamEntry({ id: 'dim-3-2x10', family: 'dimensional-built-up', designation: '(3) 2x10 Built-Up Girder', plyCount: 3, widthIn: 4.5, depthIn: 9.25, fbPsi: 1138, fvPsi: 180, ePsi: 1_600_000, fcPerpPsi: 625, densityPcf: 35, costPerLfUsd: 10.5 }),
  woodBeamEntry({ id: 'dim-3-2x12', family: 'dimensional-built-up', designation: '(3) 2x12 Built-Up Girder', plyCount: 3, widthIn: 4.5, depthIn: 11.25, fbPsi: 1035, fvPsi: 180, ePsi: 1_600_000, fcPerpPsi: 625, densityPcf: 35, costPerLfUsd: 13.8 }),
  woodBeamEntry({ id: 'dim-4-2x12', family: 'dimensional-built-up', designation: '(4) 2x12 Built-Up Girder', plyCount: 4, widthIn: 6.0, depthIn: 11.25, fbPsi: 1035, fvPsi: 180, ePsi: 1_600_000, fcPerpPsi: 625, densityPcf: 35, costPerLfUsd: 18.4 }),

  // --- LSL 1.55E (TimberStrand headers & beams) ---
  woodBeamEntry({ id: 'lsl-3.5x9.5', family: 'lsl', designation: '3-1/2"x9-1/2" 1.55E LSL Header', plyCount: 1, widthIn: 3.5, depthIn: 9.5, fbPsi: 2325, fvPsi: 310, ePsi: 1_550_000, fcPerpPsi: 900, densityPcf: 44, costPerLfUsd: 14.5 }),
  woodBeamEntry({ id: 'lsl-3.5x11.875', family: 'lsl', designation: '3-1/2"x11-7/8" 1.55E LSL Header', plyCount: 1, widthIn: 3.5, depthIn: 11.875, fbPsi: 2325, fvPsi: 310, ePsi: 1_550_000, fcPerpPsi: 900, densityPcf: 44, costPerLfUsd: 18.0 }),

  // --- LVL 2.0E 2600Fb (Microllam / Versa-Lam laminated veneer lumber) ---
  woodBeamEntry({ id: 'lvl-2-9.5', family: 'lvl', designation: '(2) 1-3/4"x9-1/2" 2.0E LVL', plyCount: 2, widthIn: 3.5, depthIn: 9.5, fbPsi: 2600, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 19.0 }),
  woodBeamEntry({ id: 'lvl-2-11.875', family: 'lvl', designation: '(2) 1-3/4"x11-7/8" 2.0E LVL', plyCount: 2, widthIn: 3.5, depthIn: 11.875, fbPsi: 2600, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 24.0 }),
  woodBeamEntry({ id: 'lvl-3-11.875', family: 'lvl', designation: '(3) 1-3/4"x11-7/8" 2.0E LVL', plyCount: 3, widthIn: 5.25, depthIn: 11.875, fbPsi: 2600, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 36.0 }),
  woodBeamEntry({ id: 'lvl-2-14', family: 'lvl', designation: '(2) 1-3/4"x14" 2.0E LVL', plyCount: 2, widthIn: 3.5, depthIn: 14.0, fbPsi: 2560, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 29.0 }),
  woodBeamEntry({ id: 'lvl-3-14', family: 'lvl', designation: '(3) 1-3/4"x14" 2.0E LVL', plyCount: 3, widthIn: 5.25, depthIn: 14.0, fbPsi: 2560, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 43.5 }),
  woodBeamEntry({ id: 'lvl-3-16', family: 'lvl', designation: '(3) 1-3/4"x16" 2.0E LVL', plyCount: 3, widthIn: 5.25, depthIn: 16.0, fbPsi: 2510, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 51.0 }),
  woodBeamEntry({ id: 'lvl-3-18', family: 'lvl', designation: '(3) 1-3/4"x18" 2.0E LVL', plyCount: 3, widthIn: 5.25, depthIn: 18.0, fbPsi: 2470, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 58.0 }),
  woodBeamEntry({ id: 'lvl-4-18', family: 'lvl', designation: '(4) 1-3/4"x18" 2.0E LVL', plyCount: 4, widthIn: 7.0, depthIn: 18.0, fbPsi: 2470, fvPsi: 285, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 42, costPerLfUsd: 78.0 }),

  // --- PSL 2.0E 2900Fb (Parallam heavy girder / transfer beams) ---
  woodBeamEntry({ id: 'psl-3.5x11.875', family: 'psl', designation: '3-1/2"x11-7/8" 2.0E PSL', plyCount: 1, widthIn: 3.5, depthIn: 11.875, fbPsi: 2900, fvPsi: 290, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 45, costPerLfUsd: 32.0 }),
  woodBeamEntry({ id: 'psl-5.25x14', family: 'psl', designation: '5-1/4"x14" 2.0E PSL', plyCount: 1, widthIn: 5.25, depthIn: 14.0, fbPsi: 2850, fvPsi: 290, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 45, costPerLfUsd: 54.0 }),
  woodBeamEntry({ id: 'psl-5.25x18', family: 'psl', designation: '5-1/4"x18" 2.0E PSL', plyCount: 1, widthIn: 5.25, depthIn: 18.0, fbPsi: 2780, fvPsi: 290, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 45, costPerLfUsd: 72.0 }),
  woodBeamEntry({ id: 'psl-7x18', family: 'psl', designation: '7"x18" 2.0E PSL Transfer Beam', plyCount: 1, widthIn: 7.0, depthIn: 18.0, fbPsi: 2780, fvPsi: 290, ePsi: 2_000_000, fcPerpPsi: 750, densityPcf: 45, costPerLfUsd: 96.0 }),

  // --- Glulam 24F-V4 DF & 24F-V8 SYP (laminated timber beams for ridges, porches, exposed girders) ---
  woodBeamEntry({ id: 'glulam-3.5x11.875', family: 'glulam', designation: '3-1/2"x11-7/8" 24F-V4 Glulam', plyCount: 1, widthIn: 3.5, depthIn: 11.875, fbPsi: 2400, fvPsi: 265, ePsi: 1_800_000, fcPerpPsi: 650, densityPcf: 36, costPerLfUsd: 27.0 }),
  woodBeamEntry({ id: 'glulam-5.125x12', family: 'glulam', designation: '5-1/8"x12" 24F-V4 Glulam', plyCount: 1, widthIn: 5.125, depthIn: 12.0, fbPsi: 2400, fvPsi: 265, ePsi: 1_800_000, fcPerpPsi: 650, densityPcf: 36, costPerLfUsd: 38.0 }),
  woodBeamEntry({ id: 'glulam-5.125x15', family: 'glulam', designation: '5-1/8"x15" 24F-V4 Glulam', plyCount: 1, widthIn: 5.125, depthIn: 15.0, fbPsi: 2340, fvPsi: 265, ePsi: 1_800_000, fcPerpPsi: 650, densityPcf: 36, costPerLfUsd: 49.0 }),
  woodBeamEntry({ id: 'glulam-5.5x18', family: 'glulam', designation: '5-1/2"x18" 24F-V8 Glulam', plyCount: 1, widthIn: 5.5, depthIn: 18.0, fbPsi: 2300, fvPsi: 265, ePsi: 1_800_000, fcPerpPsi: 650, densityPcf: 38, costPerLfUsd: 64.0 }),
  woodBeamEntry({ id: 'glulam-6.75x21', family: 'glulam', designation: '6-3/4"x21" 24F-V4 Glulam Ridge', plyCount: 1, widthIn: 6.75, depthIn: 21.0, fbPsi: 2240, fvPsi: 265, ePsi: 1_800_000, fcPerpPsi: 650, densityPcf: 36, costPerLfUsd: 88.0 }),

  // --- Flitch Beams (2x lumber + A36 steel center plate w/ staggered through-bolts) ---
  {
    id: 'flitch-2x10-375',
    family: 'flitch',
    designation: '(2) 2x10 + 3/8"x9" A36 Flitch Beam',
    plyCount: 3,
    widthIn: 3.375,
    depthIn: 9.25,
    allowableMomentFtLbs: 17_800,
    allowableShearLbs: 11_400,
    eiLbIn2: 1_120_000_000,
    bearingPsi: 625,
    weightPlf: 18.5,
    costPerLfUsd: 44.0,
  },
  {
    id: 'flitch-2x12-500',
    family: 'flitch',
    designation: '(2) 2x12 + 1/2"x11" A36 Flitch Beam',
    plyCount: 3,
    widthIn: 3.5,
    depthIn: 11.25,
    allowableMomentFtLbs: 32_500,
    allowableShearLbs: 18_200,
    eiLbIn2: 2_380_000_000,
    bearingPsi: 625,
    weightPlf: 27.4,
    costPerLfUsd: 62.0,
  },

  // --- A992 Structural Steel W-Beams (Fy = 50 ksi, ASD Fb = 30 ksi, E = 29,000 ksi) ---
  {
    id: 'steel-w8x18',
    family: 'steel-w',
    designation: 'W8x18 A992 Steel Beam',
    plyCount: 1,
    widthIn: 5.25,
    depthIn: 8.14,
    allowableMomentFtLbs: 38_000,
    allowableShearLbs: 28_000,
    eiLbIn2: 1_795_100_000,
    bearingPsi: 20_000,
    weightPlf: 18.0,
    costPerLfUsd: 54.0,
  },
  {
    id: 'steel-w10x22',
    family: 'steel-w',
    designation: 'W10x22 A992 Steel Beam',
    plyCount: 1,
    widthIn: 5.75,
    depthIn: 10.2,
    allowableMomentFtLbs: 58_000,
    allowableShearLbs: 36_500,
    eiLbIn2: 3_422_000_000,
    bearingPsi: 20_000,
    weightPlf: 22.0,
    costPerLfUsd: 66.0,
  },
  {
    id: 'steel-w12x26',
    family: 'steel-w',
    designation: 'W12x26 A992 Steel Beam',
    plyCount: 1,
    widthIn: 6.49,
    depthIn: 12.2,
    allowableMomentFtLbs: 83_500,
    allowableShearLbs: 42_100,
    eiLbIn2: 5_916_000_000,
    bearingPsi: 20_000,
    weightPlf: 26.0,
    costPerLfUsd: 78.0,
  },
  {
    id: 'steel-w12x40',
    family: 'steel-w',
    designation: 'W12x40 A992 Steel Beam',
    plyCount: 1,
    widthIn: 8.01,
    depthIn: 11.9,
    allowableMomentFtLbs: 129_750,
    allowableShearLbs: 52_800,
    eiLbIn2: 8_990_000_000,
    bearingPsi: 20_000,
    weightPlf: 40.0,
    costPerLfUsd: 118.0,
  },
  {
    id: 'steel-w14x30',
    family: 'steel-w',
    designation: 'W14x30 A992 Steel Beam',
    plyCount: 1,
    widthIn: 6.73,
    depthIn: 13.8,
    allowableMomentFtLbs: 105_000,
    allowableShearLbs: 55_900,
    eiLbIn2: 8_439_000_000,
    bearingPsi: 20_000,
    weightPlf: 30.0,
    costPerLfUsd: 92.0,
  },
]

// ============================================================================
// TJI I-JOISTS & OPEN-WEB FLOOR/ROOF TRUSSES
// ============================================================================

export type TjiIJoistEntry = {
  id: string
  series: 'TJI-110' | 'TJI-210' | 'TJI-230' | 'TJI-360' | 'TJI-560'
  depthIn: 9.5 | 11.875 | 14 | 16
  flangeWidthIn: number
  flangeDepthIn: number
  webThicknessIn: number
  /** Allowable residential floor span (40/10 psf, L/480) in feet by OC spacing */
  maxSpanFt: Readonly<Record<StudSpacingIn, number>>
  /** Pre-punched web knockout diameter (in) & max field-cut round hole diameter (in) */
  knockoutDiaIn: number
  maxFieldRoundHoleIn: number
  /** Minimum distance from interior face of support to field-cut web hole (in) */
  minSupportClearanceIn: number
  costPerLfUsd: number
}

export const TJI_IJOIST_CATALOG: readonly TjiIJoistEntry[] = [
  { id: 'tji-110-9.5', series: 'TJI-110', depthIn: 9.5, flangeWidthIn: 1.75, flangeDepthIn: 1.375, webThicknessIn: 0.375, maxSpanFt: { 12: 16.0, 16: 14.5, 24: 12.75 }, knockoutDiaIn: 1.5, maxFieldRoundHoleIn: 6.5, minSupportClearanceIn: 12, costPerLfUsd: 4.1 },
  { id: 'tji-210-11.875', series: 'TJI-210', depthIn: 11.875, flangeWidthIn: 2.0625, flangeDepthIn: 1.375, webThicknessIn: 0.375, maxSpanFt: { 12: 19.75, 16: 18.0, 24: 15.75 }, knockoutDiaIn: 1.5, maxFieldRoundHoleIn: 8.875, minSupportClearanceIn: 14, costPerLfUsd: 5.2 },
  { id: 'tji-230-11.875', series: 'TJI-230', depthIn: 11.875, flangeWidthIn: 2.3125, flangeDepthIn: 1.375, webThicknessIn: 0.375, maxSpanFt: { 12: 20.5, 16: 18.75, 24: 16.4 }, knockoutDiaIn: 1.5, maxFieldRoundHoleIn: 8.875, minSupportClearanceIn: 14, costPerLfUsd: 5.8 },
  { id: 'tji-360-14', series: 'TJI-360', depthIn: 14, flangeWidthIn: 2.3125, flangeDepthIn: 1.375, webThicknessIn: 0.375, maxSpanFt: { 12: 24.5, 16: 22.3, 24: 19.4 }, knockoutDiaIn: 1.5, maxFieldRoundHoleIn: 11.0, minSupportClearanceIn: 18, costPerLfUsd: 6.9 },
  { id: 'tji-560-16', series: 'TJI-560', depthIn: 16, flangeWidthIn: 3.5, flangeDepthIn: 1.375, webThicknessIn: 0.4375, maxSpanFt: { 12: 28.5, 16: 26.0, 24: 22.5 }, knockoutDiaIn: 1.5, maxFieldRoundHoleIn: 13.0, minSupportClearanceIn: 20, costPerLfUsd: 9.2 },
]

export type ColumnType =
  | 'wood-solid'
  | 'wood-built-up'
  | 'psl'
  | 'glulam'
  | 'steel-hss'
  | 'steel-lally'

export type ColumnCatalogEntry = {
  id: string
  columnType: ColumnType
  designation: string
  widthIn: number
  depthIn: number
  areaIn2: number
  /** Reference compression parallel Fc (psi) or steel Fa baseline */
  fcPsi: number
  eMinPsi: number
  /** Nominal safe axial capacity at 9 ft unbraced height (lbs) */
  allowableAxial9FtLbs: number
  recommendedBaseSku: string
  recommendedCapSku: string
  costPerLfUsd: number
}

export const COLUMN_CATALOG: readonly ColumnCatalogEntry[] = [
  { id: 'col-4x4-dfl', columnType: 'wood-solid', designation: '4x4 DF-L #2 Post', widthIn: 3.5, depthIn: 3.5, areaIn2: 12.25, fcPsi: 1350, eMinPsi: 580_000, allowableAxial9FtLbs: 5_800, recommendedBaseSku: 'ABU44Z', recommendedCapSku: 'BC4', costPerLfUsd: 4.5 },
  { id: 'col-3-2x4', columnType: 'wood-built-up', designation: '(3) 2x4 Built-Up King Post', widthIn: 4.5, depthIn: 3.5, areaIn2: 15.75, fcPsi: 1350, eMinPsi: 580_000, allowableAxial9FtLbs: 7_200, recommendedBaseSku: 'ABU44Z', recommendedCapSku: 'LPC4Z', costPerLfUsd: 4.2 },
  { id: 'col-4x6-dfl', columnType: 'wood-solid', designation: '4x6 DF-L #2 Post', widthIn: 3.5, depthIn: 5.5, areaIn2: 19.25, fcPsi: 1350, eMinPsi: 580_000, allowableAxial9FtLbs: 9_100, recommendedBaseSku: 'ABU46Z', recommendedCapSku: 'CCQ46', costPerLfUsd: 6.8 },
  { id: 'col-3-2x6', columnType: 'wood-built-up', designation: '(3) 2x6 Built-Up King Post', widthIn: 4.5, depthIn: 5.5, areaIn2: 24.75, fcPsi: 1350, eMinPsi: 580_000, allowableAxial9FtLbs: 12_800, recommendedBaseSku: 'ABU66Z', recommendedCapSku: 'LPC6Z', costPerLfUsd: 6.6 },
  { id: 'col-6x6-dfl', columnType: 'wood-solid', designation: '6x6 DF-L #2 Post', widthIn: 5.5, depthIn: 5.5, areaIn2: 30.25, fcPsi: 1350, eMinPsi: 580_000, allowableAxial9FtLbs: 24_500, recommendedBaseSku: 'ABU66Z', recommendedCapSku: 'CCQ66', costPerLfUsd: 10.5 },
  { id: 'col-psl-5.25', columnType: 'psl', designation: '5-1/4"x5-1/4" 1.8E PSL Column', widthIn: 5.25, depthIn: 5.25, areaIn2: 27.56, fcPsi: 2500, eMinPsi: 910_000, allowableAxial9FtLbs: 38_500, recommendedBaseSku: 'CB66', recommendedCapSku: 'CCQ66', costPerLfUsd: 26.0 },
  { id: 'col-glulam-5.5', columnType: 'glulam', designation: '5-1/2"x5-1/2" Glulam Column', widthIn: 5.5, depthIn: 5.5, areaIn2: 30.25, fcPsi: 1900, eMinPsi: 850_000, allowableAxial9FtLbs: 34_000, recommendedBaseSku: 'CB66', recommendedCapSku: 'CCQ66', costPerLfUsd: 22.0 },
  { id: 'col-steel-lally-3.5', columnType: 'steel-lally', designation: '3-1/2" Sch 40 Concrete-Filled Steel Lally', widthIn: 3.5, depthIn: 3.5, areaIn2: 2.23, fcPsi: 22_000, eMinPsi: 29_000_000, allowableAxial9FtLbs: 28_000, recommendedBaseSku: 'CB44', recommendedCapSku: 'CCQ46', costPerLfUsd: 24.0 },
  { id: 'col-steel-hss-4x4', columnType: 'steel-hss', designation: 'HSS 4x4x1/4 A500 Gr C Steel Column', widthIn: 4.0, depthIn: 4.0, areaIn2: 3.37, fcPsi: 30_000, eMinPsi: 29_000_000, allowableAxial9FtLbs: 62_000, recommendedBaseSku: 'CB44', recommendedCapSku: 'CCQ46', costPerLfUsd: 34.0 },
  { id: 'col-steel-hss-6x6', columnType: 'steel-hss', designation: 'HSS 6x6x1/4 A500 Gr C Steel Column', widthIn: 6.0, depthIn: 6.0, areaIn2: 5.24, fcPsi: 30_000, eMinPsi: 29_000_000, allowableAxial9FtLbs: 118_000, recommendedBaseSku: 'CB66', recommendedCapSku: 'CCQ66', costPerLfUsd: 48.0 },
]

// ============================================================================
// SIMPSON-CLASS METAL CONNECTOR & FASTENER CATALOG (47 SKUs)
// ============================================================================

export type ConnectorCategory =
  | 'hurricane-tie'
  | 'framing-angle'
  | 'joist-hanger'
  | 'beam-hanger'
  | 'post-base'
  | 'post-cap'
  | 'hold-down'
  | 'tension-strap'
  | 'plate-washer'
  | 'anchor-bolt'

export type ConnectorCatalogEntry = {
  sku: string
  category: ConnectorCategory
  name: string
  description: string
  /** Typical bounding dims [widthIn, heightIn, depthIn] for 3D CAD & clash checks */
  dimsIn: readonly [number, number, number]
  /** Allowable DF-L uplift capacity (lbs, Cd=1.6) */
  upliftLbs: number
  /** Allowable DF-L download capacity (lbs, Cd=1.0) */
  downloadLbs: number
  /** Allowable lateral shear capacity (lbs, Cd=1.6) */
  lateralLbs: number
  fastenerSpec: string
  codeRef: string
  unitCostUsd: number
}

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = [
  // --- Hurricane Ties & Roof-to-Wall Uplift Clips ---
  { sku: 'H1', category: 'hurricane-tie', name: 'H1 Gusseted Hurricane Tie', description: 'U-shaped rafter/truss-to-double-top-plate hurricane tie', dimsIn: [2.0, 5.25, 2.0], upliftLbs: 585, downloadLbs: 0, lateralLbs: 510, fastenerSpec: '(10) 8d x 1-1/2" nails', codeRef: 'IRC R802.11', unitCostUsd: 1.65 },
  { sku: 'H2.5A', category: 'hurricane-tie', name: 'H2.5A Hurricane Tie', description: 'Standard seismic & coastal rafter-to-top-plate tie', dimsIn: [1.375, 6.0, 1.375], upliftLbs: 600, downloadLbs: 0, lateralLbs: 110, fastenerSpec: '(10) 8d x 1-1/2" nails', codeRef: 'IRC R802.11', unitCostUsd: 1.45 },
  { sku: 'H10A', category: 'hurricane-tie', name: 'H10A High-Uplift Hurricane Tie', description: 'Heavy double-sided gusseted tie for >=130 mph high-wind roofs', dimsIn: [2.25, 8.25, 2.25], upliftLbs: 1340, downloadLbs: 0, lateralLbs: 575, fastenerSpec: '(18) 8d x 1-1/2" nails', codeRef: 'IRC R802.11 / WFCM', unitCostUsd: 3.9 },
  { sku: 'HGA10', category: 'hurricane-tie', name: 'HGA10 Gusset Angle', description: 'Heavy screw-fastened gusset angle for hip/girder truss uplift', dimsIn: [3.25, 7.25, 2.75], upliftLbs: 3055, downloadLbs: 0, lateralLbs: 1200, fastenerSpec: '(8) 1/4"x3" SDS screws', codeRef: 'IRC R802.11 / WFCM', unitCostUsd: 16.5 },
  { sku: 'MTS16', category: 'hurricane-tie', name: 'MTS16 Medium Twist Strap', description: '16" twisted uplift strap tying rafter/truss to stud below', dimsIn: [1.25, 16.0, 0.125], upliftLbs: 1150, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(14) 10d x 1-1/2" nails', codeRef: 'IRC R802.11', unitCostUsd: 4.8 },
  { sku: 'HTS20', category: 'hurricane-tie', name: 'HTS20 Heavy Twist Strap', description: '20" heavy-gauge twisted uplift strap for coastal/HVHZ zones', dimsIn: [1.25, 20.0, 0.125], upliftLbs: 1625, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(24) 10d x 1-1/2" nails', codeRef: 'WFCM / HVHZ', unitCostUsd: 6.75 },

  // --- Framing Angles, Clips & Lateral Tie Plates ---
  { sku: 'A35', category: 'framing-angle', name: 'A35 Framing Angle', description: 'Multi-purpose 3-way shear/blocking/rim-to-plate framing clip', dimsIn: [1.5, 4.5, 1.5], upliftLbs: 365, downloadLbs: 0, lateralLbs: 560, fastenerSpec: '(12) 8d x 1-1/2" nails', codeRef: 'IRC R602.10 / Shear Transfer', unitCostUsd: 1.55 },
  { sku: 'A34', category: 'framing-angle', name: 'A34 Compact Framing Clip', description: 'Compact 90-degree framing clip for blocking and partition ties', dimsIn: [1.5, 2.5, 1.5], upliftLbs: 280, downloadLbs: 0, lateralLbs: 390, fastenerSpec: '(8) 8d x 1-1/2" nails', codeRef: 'IRC R602.3', unitCostUsd: 1.25 },
  { sku: 'LTP4', category: 'framing-angle', name: 'LTP4 Lateral Tie Plate', description: 'Shear transfer tie plate connecting rim joist to wall top plate', dimsIn: [2.875, 4.5, 0.125], upliftLbs: 0, downloadLbs: 0, lateralLbs: 660, fastenerSpec: '(12) 8d x 1-1/2" nails', codeRef: 'IRC R602.10.8', unitCostUsd: 1.75 },
  { sku: 'L50', category: 'framing-angle', name: 'L50 Reinforcing Angle', description: '5" reinforcing L-angle for header/beam/rim lateral stabilization', dimsIn: [1.5, 5.0, 1.5], upliftLbs: 0, downloadLbs: 580, lateralLbs: 520, fastenerSpec: '(6) 10d x 1-1/2" nails', codeRef: 'IRC R502.7', unitCostUsd: 2.1 },
  { sku: 'LS50', category: 'framing-angle', name: 'LS50 Field-Skewable Angle', description: 'Adjustable 0–135 degree skewed framing angle for hips/valleys/gables', dimsIn: [1.5, 4.875, 1.5], upliftLbs: 410, downloadLbs: 495, lateralLbs: 440, fastenerSpec: '(10) 10d x 1-1/2" nails', codeRef: 'IRC R802.3', unitCostUsd: 2.9 },

  // --- Tension Straps & Continuous Uplift / Collector Straps ---
  { sku: 'LSTA24', category: 'tension-strap', name: 'LSTA24 Light Strap Tie', description: '24" 20-ga strap tie for header-to-king or top-plate splice', dimsIn: [1.25, 24.0, 0.06], upliftLbs: 1125, downloadLbs: 0, lateralLbs: 1125, fastenerSpec: '(18) 10d nails', codeRef: 'IRC R602.3.2', unitCostUsd: 4.1 },
  { sku: 'MSTA36', category: 'tension-strap', name: 'MSTA36 Medium Strap Tie', description: '36" 18-ga floor-to-floor uplift & shear wall collector strap', dimsIn: [1.25, 36.0, 0.08], upliftLbs: 2145, downloadLbs: 0, lateralLbs: 2145, fastenerSpec: '(26) 10d nails', codeRef: 'IRC R602.10.6.4 / WFCM', unitCostUsd: 8.4 },
  { sku: 'MSTC40', category: 'tension-strap', name: 'MSTC40 Heavy Strap Tie', description: '40" 16-ga continuous load-path multi-storey tie strap', dimsIn: [3.0, 40.0, 0.1], upliftLbs: 4185, downloadLbs: 0, lateralLbs: 4185, fastenerSpec: '(36) 16d sinkers', codeRef: 'WFCM / SDC D0-D2', unitCostUsd: 19.5 },
  { sku: 'CS16', category: 'tension-strap', name: 'CS16 16-Ga Coiled Strap (36" cut)', description: 'Field-cut 16-ga coiled tension strap for continuous uplift/chord ties', dimsIn: [1.25, 36.0, 0.08], upliftLbs: 1955, downloadLbs: 0, lateralLbs: 1955, fastenerSpec: '(22) 10d nails', codeRef: 'IRC R802.11 / WFCM', unitCostUsd: 6.2 },
  { sku: 'CS-PF', category: 'tension-strap', name: 'CS-PF Portal Frame Strap (1000 lb)', description: 'IRC Fig R602.10.6.4 1000-lb header-to-jack portal tension strap', dimsIn: [1.25, 24.0, 0.08], upliftLbs: 1000, downloadLbs: 0, lateralLbs: 1000, fastenerSpec: '(12) 10d nails', codeRef: 'IRC R602.10.6.4', unitCostUsd: 5.5 },

  // --- Dimensional Joist Hangers (LUS / HUS) ---
  { sku: 'LUS26', category: 'joist-hanger', name: 'LUS26 Face-Mount Joist Hanger', description: 'Double-shear face-mount hanger for 2x6/2x8 joists', dimsIn: [1.56, 4.75, 1.75], upliftLbs: 1120, downloadLbs: 1140, lateralLbs: 0, fastenerSpec: '(4) 10d face + (4) 10d slant', codeRef: 'IRC R502.6.2', unitCostUsd: 2.35 },
  { sku: 'LUS28', category: 'joist-hanger', name: 'LUS28 Face-Mount Joist Hanger', description: 'Double-shear face-mount hanger for 2x8/2x10 joists', dimsIn: [1.56, 6.625, 1.75], upliftLbs: 1120, downloadLbs: 1415, lateralLbs: 0, fastenerSpec: '(6) 10d face + (4) 10d slant', codeRef: 'IRC R502.6.2', unitCostUsd: 2.85 },
  { sku: 'LUS210', category: 'joist-hanger', name: 'LUS210 Face-Mount Joist Hanger', description: 'Double-shear face-mount hanger for 2x10/2x12 joists', dimsIn: [1.56, 7.875, 1.75], upliftLbs: 1365, downloadLbs: 1715, lateralLbs: 0, fastenerSpec: '(8) 10d face + (4) 10d slant', codeRef: 'IRC R502.6.2', unitCostUsd: 3.45 },
  { sku: 'LUS212', category: 'joist-hanger', name: 'LUS212 Face-Mount Joist Hanger', description: 'Double-shear face-mount hanger for 2x12/2x14 joists', dimsIn: [1.56, 9.75, 1.75], upliftLbs: 1450, downloadLbs: 1965, lateralLbs: 0, fastenerSpec: '(10) 10d face + (4) 10d slant', codeRef: 'IRC R502.6.2', unitCostUsd: 4.15 },
  { sku: 'HUS210', category: 'joist-hanger', name: 'HUS210 Heavy Face-Mount Hanger', description: 'Heavy-duty double-shear hanger for high-load 2x10/2x12 joists', dimsIn: [1.625, 9.0, 3.0], upliftLbs: 2890, downloadLbs: 3825, lateralLbs: 0, fastenerSpec: '(22) 16d face + (8) 16d slant', codeRef: 'IRC R502.6.2', unitCostUsd: 9.8 },
  { sku: 'LSSU210', category: 'joist-hanger', name: 'LSSU210 Sloped/Skewed Hanger', description: 'Field-adjustable sloped & skewed hanger for hip/valley rafters & jack joists', dimsIn: [1.625, 8.5, 3.25], upliftLbs: 720, downloadLbs: 1485, lateralLbs: 0, fastenerSpec: '(10) 10d face + (7) 10d joist', codeRef: 'IRC R802.3', unitCostUsd: 11.4 },

  // --- I-Joist & Heavy Engineered Beam / Girder Hangers (IUS / MIT / HHUS / HGUS / HUCQ) ---
  { sku: 'IUS2.56/11.88', category: 'joist-hanger', name: 'IUS2.56/11.88 I-Joist Face Hanger', description: 'Snap-in face-mount hanger for 11-7/8" TJI I-joists (no web stiffeners)', dimsIn: [2.625, 11.875, 2.0], upliftLbs: 515, downloadLbs: 1585, lateralLbs: 0, fastenerSpec: '(10) 10d face nails', codeRef: 'IRC R502.1.2', unitCostUsd: 6.5 },
  { sku: 'MIT411.88', category: 'joist-hanger', name: 'MIT411.88 Top-Flange I-Joist Hanger', description: 'Top-flange hanger for 11-7/8" TJI I-joists onto LVL/Glulam girders', dimsIn: [2.625, 11.875, 2.5], upliftLbs: 490, downloadLbs: 2340, lateralLbs: 0, fastenerSpec: '(6) 10d top/face + (2) 10d joist', codeRef: 'IRC R502.1.2', unitCostUsd: 8.9 },
  { sku: 'HHUS210-2', category: 'beam-hanger', name: 'HHUS210-2 Double-Ply Girder Hanger', description: 'Heavy double-shear hanger for 2-ply 2x10/2x12 headers & stair headers', dimsIn: [3.3125, 9.125, 3.25], upliftLbs: 3110, downloadLbs: 5475, lateralLbs: 0, fastenerSpec: '(22) 16d face + (8) 16d slant', codeRef: 'IRC R502.10', unitCostUsd: 21.0 },
  { sku: 'HHUS410', category: 'beam-hanger', name: 'HHUS410 3.5" LVL/Glulam Hanger', description: 'Heavy 14-ga face hanger for 2-ply 1-3/4" LVL or 3-1/2" PSL/Glulam beams', dimsIn: [3.625, 9.125, 3.25], upliftLbs: 3315, downloadLbs: 6250, lateralLbs: 0, fastenerSpec: '(24) 16d face + (10) 16d slant', codeRef: 'IRC R502.6.2', unitCostUsd: 28.5 },
  { sku: 'HHUS5.50/10', category: 'beam-hanger', name: 'HHUS5.50/10 5-1/4"–5-1/2" Beam Hanger', description: 'Heavy 14-ga girder hanger for 3-ply LVL or 5-1/8"–5-1/2" Glulam/PSL', dimsIn: [5.5625, 9.25, 3.5], upliftLbs: 3420, downloadLbs: 7800, lateralLbs: 0, fastenerSpec: '(30) 16d face + (10) 16d slant', codeRef: 'IRC R502.6.2', unitCostUsd: 38.0 },
  { sku: 'HGUS5.50/12', category: 'beam-hanger', name: 'HGUS5.50/12 Extra-Heavy Glulam/LVL Hanger', description: '12-ga extra-heavy double-shear girder hanger (up to 10,800 lb download)', dimsIn: [5.625, 11.75, 4.0], upliftLbs: 4860, downloadLbs: 10850, lateralLbs: 0, fastenerSpec: '(46) 16d face + (16) 16d slant', codeRef: 'AWC NDS / Heavy Girder', unitCostUsd: 64.0 },
  { sku: 'HUCQ410-SDS', category: 'beam-hanger', name: 'HUCQ410-SDS Concealed-Flange Beam Hanger', description: 'Concealed-flange SDS screw hanger for exposed architectural Glulam beams', dimsIn: [3.625, 9.0, 3.5], upliftLbs: 2890, downloadLbs: 5980, lateralLbs: 0, fastenerSpec: '(12) 1/4"x2-1/2" SDS screws', codeRef: 'AWC NDS', unitCostUsd: 49.0 },

  // --- Post Bases & Post-to-Beam Caps ---
  { sku: 'ABU44Z', category: 'post-base', name: 'ABU44Z 4x4 Standoff Post Base', description: '1" moisture-standoff adjustable post base for 4x4 wood posts on concrete', dimsIn: [3.625, 5.5, 3.625], upliftLbs: 2200, downloadLbs: 6665, lateralLbs: 850, fastenerSpec: '(1) 5/8" anchor bolt + (12) 16d nails', codeRef: 'IRC R407.3 / R317.1', unitCostUsd: 19.5 },
  { sku: 'ABU46Z', category: 'post-base', name: 'ABU46Z 4x6 Standoff Post Base', description: '1" standoff adjustable post base for 4x6 posts on concrete footings', dimsIn: [3.625, 5.5, 5.625], upliftLbs: 2560, downloadLbs: 9400, lateralLbs: 980, fastenerSpec: '(1) 5/8" anchor bolt + (12) 16d nails', codeRef: 'IRC R407.3', unitCostUsd: 26.0 },
  { sku: 'ABU66Z', category: 'post-base', name: 'ABU66Z 6x6 Standoff Post Base', description: '1" moisture-standoff adjustable post base for 6x6 wood/built-up posts', dimsIn: [5.625, 6.25, 5.625], upliftLbs: 2785, downloadLbs: 10945, lateralLbs: 1120, fastenerSpec: '(1) 5/8" anchor bolt + (12) 16d nails', codeRef: 'IRC R407.3 / R317.1', unitCostUsd: 34.0 },
  { sku: 'CB44', category: 'post-base', name: 'CB44 Embedded Heavy Column Base', description: 'Cast-in-place heavy column base for high-load 4x4/PSL/steel columns', dimsIn: [3.75, 8.0, 3.75], upliftLbs: 3250, downloadLbs: 15800, lateralLbs: 1650, fastenerSpec: '(2) 5/8" machine bolts', codeRef: 'IRC R407.3 / Heavy Point Load', unitCostUsd: 42.0 },
  { sku: 'CB66', category: 'post-base', name: 'CB66 Embedded Heavy 6x6 Column Base', description: 'Cast-in-place heavy column base for 6x6/PSL/Glulam/HSS columns', dimsIn: [5.75, 8.5, 5.75], upliftLbs: 4820, downloadLbs: 28500, lateralLbs: 2400, fastenerSpec: '(2) 5/8" machine bolts', codeRef: 'IRC R407.3 / Heavy Point Load', unitCostUsd: 58.0 },
  { sku: 'BC4', category: 'post-cap', name: 'BC4 4x4 Post-to-Beam Cap', description: 'Stamped 18-ga post cap tying 4x beam to 4x4 post against uplift/lateral', dimsIn: [3.625, 5.5, 3.625], upliftLbs: 980, downloadLbs: 5400, lateralLbs: 920, fastenerSpec: '(12) 16d nails', codeRef: 'IRC R502.9', unitCostUsd: 12.5 },
  { sku: 'LPC4Z', category: 'post-cap', name: 'LPC4Z 4x Adjustable Post Cap (Pair)', description: 'Two-piece retrofit post cap for 4x/3-ply beams over 4x posts', dimsIn: [3.625, 6.0, 3.625], upliftLbs: 1380, downloadLbs: 7200, lateralLbs: 1100, fastenerSpec: '(16) 10d nails', codeRef: 'IRC R502.9', unitCostUsd: 16.0 },
  { sku: 'LPC6Z', category: 'post-cap', name: 'LPC6Z 6x Adjustable Post Cap (Pair)', description: 'Two-piece retrofit post cap for 5-1/4"–6x beams over 6x posts', dimsIn: [5.625, 6.5, 5.625], upliftLbs: 1750, downloadLbs: 11200, lateralLbs: 1350, fastenerSpec: '(16) 10d nails', codeRef: 'IRC R502.9', unitCostUsd: 21.5 },
  { sku: 'CCQ46', category: 'post-cap', name: 'CCQ46 Heavy SDS Column Cap (4x beam / 6x post)', description: '7-ga welded steel column cap with 1/4" SDS screws for heavy girders', dimsIn: [3.75, 9.0, 6.0], upliftLbs: 4120, downloadLbs: 22400, lateralLbs: 3100, fastenerSpec: '(14) 1/4"x2-1/2" SDS screws', codeRef: 'AWC NDS / Heavy Girder', unitCostUsd: 78.0 },
  { sku: 'CCQ66', category: 'post-cap', name: 'CCQ66 Heavy SDS Column Cap (6x beam / 6x post)', description: '7-ga welded steel column cap for 5-1/4"–5-1/2" LVL/PSL/Glulam girders', dimsIn: [5.75, 9.5, 6.0], upliftLbs: 5650, downloadLbs: 34200, lateralLbs: 3800, fastenerSpec: '(16) 1/4"x2-1/2" SDS screws', codeRef: 'AWC NDS / Heavy Girder', unitCostUsd: 94.0 },

  // --- Seismic / High-Wind Hold-Downs & Foundation Anchorage ---
  { sku: 'HDU2-SDS2.5', category: 'hold-down', name: 'HDU2-SDS2.5 Hold-Down', description: 'Light shear wall / braced panel overturning hold-down (3,075 lb)', dimsIn: [3.0, 8.75, 3.25], upliftLbs: 3075, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(6) 1/4"x2-1/2" SDS + 5/8" anchor', codeRef: 'IRC R602.10.6.2', unitCostUsd: 32.0 },
  { sku: 'HDU4-SDS2.5', category: 'hold-down', name: 'HDU4-SDS2.5 Hold-Down', description: 'Medium shear wall hold-down (4,565 lb DF-L)', dimsIn: [3.0, 11.0, 3.25], upliftLbs: 4565, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(10) 1/4"x2-1/2" SDS + 5/8" anchor', codeRef: 'IRC R602.10.6.4 / SDC D', unitCostUsd: 44.0 },
  { sku: 'HDU5-SDS2.5', category: 'hold-down', name: 'HDU5-SDS2.5 Hold-Down', description: 'Standard seismic SDC D0-D2 shear wall hold-down (5,645 lb)', dimsIn: [3.0, 13.125, 3.25], upliftLbs: 5645, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(14) 1/4"x2-1/2" SDS + 5/8" anchor', codeRef: 'IRC R602.10 / SDC D0-D2', unitCostUsd: 52.0 },
  { sku: 'HDU8-SDS2.5', category: 'hold-down', name: 'HDU8-SDS2.5 Heavy Hold-Down', description: 'Heavy 2-storey shear wall hold-down (7,870 lb DF-L)', dimsIn: [3.0, 16.625, 3.5], upliftLbs: 7870, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(20) 1/4"x2-1/2" SDS + 7/8" anchor', codeRef: 'SDC D1-D2 / 2-Storey Shear', unitCostUsd: 78.0 },
  { sku: 'HDU11-SDS2.5', category: 'hold-down', name: 'HDU11-SDS2.5 Extra-Heavy Hold-Down', description: 'Extra-heavy multi-storey overturning hold-down (11,175 lb)', dimsIn: [3.0, 22.25, 3.5], upliftLbs: 11175, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(30) 1/4"x2-1/2" SDS + 1" anchor', codeRef: 'Engineered Shear Wall', unitCostUsd: 118.0 },
  { sku: 'STHD14', category: 'hold-down', name: 'STHD14 Embedded Strap-Tie Hold-Down', description: 'Cast-in-place stemwall strap hold-down for braced corners/portals', dimsIn: [2.0, 22.0, 0.125], upliftLbs: 3945, downloadLbs: 0, lateralLbs: 0, fastenerSpec: '(28) 16d sinkers', codeRef: 'IRC R602.10.6.4 / High Wind', unitCostUsd: 29.0 },
  { sku: 'BP3x3', category: 'plate-washer', name: 'BP 3"x3"x0.229" Seismic Plate Washer', description: 'Mandatory IRC R602.11.1 square bearing plate washer for SDC D0-D2', dimsIn: [3.0, 0.229, 3.0], upliftLbs: 0, downloadLbs: 0, lateralLbs: 1200, fastenerSpec: '1/2" or 5/8" anchor bolt nut', codeRef: 'IRC R602.11.1', unitCostUsd: 2.6 },
  { sku: 'SSTB16', category: 'anchor-bolt', name: 'SSTB16 5/8"x17-5/8" Anchor Bolt', description: 'High-capacity cast-in-place hold-down anchor bolt', dimsIn: [1.5, 17.625, 1.5], upliftLbs: 5800, downloadLbs: 0, lateralLbs: 1850, fastenerSpec: '5/8" heavy hex nut + washer', codeRef: 'IRC R403.1.6', unitCostUsd: 11.5 },
]

export function getConnectorBySku(sku: string): ConnectorCatalogEntry | undefined {
  return CONNECTOR_CATALOG.find((c) => c.sku === sku)
}

// ============================================================================
// IRC R302.11 FIRE BLOCKING & R302.12 DRAFTSTOPPING RULES
// ============================================================================

export type FirestopKind =
  | 'wall-vertical-10ft'
  | 'wall-horizontal-10ft'
  | 'soffit-drop-ceiling'
  | 'stair-stringer'
  | 'chase-chimney-shaft'
  | 'penetration-firestop'
  | 'floor-draftstop'
  | 'attic-draftstop'

export type FirestopMaterial =
  | '2x-lumber'
  | 'double-1x'
  | '23/32-osb'
  | '1/2-gypsum'
  | 'mineral-wool-batt'
  | 'intumescent-collar'

export type FirestopRuleSpec = {
  kind: FirestopKind
  codeRef: string
  title: string
  requirement: string
  defaultMaterial: FirestopMaterial
  approvedMaterials: readonly FirestopMaterial[]
  unitCostPerLfOrEaUsd: number
  unitKind: 'lf' | 'sqft' | 'ea'
}

export const FIRESTOP_RULES: Readonly<Record<FirestopKind, FirestopRuleSpec>> = {
  'wall-vertical-10ft': {
    kind: 'wall-vertical-10ft',
    codeRef: 'IRC R302.11(2)',
    title: 'Concealed Stud Cavity Fire Blocking (<=10 ft vertical)',
    requirement: 'Required horizontally across concealed vertical stud spaces at intervals not exceeding 10 ft.',
    defaultMaterial: '2x-lumber',
    approvedMaterials: ['2x-lumber', 'double-1x', '23/32-osb', '1/2-gypsum', 'mineral-wool-batt'],
    unitCostPerLfOrEaUsd: 2.1,
    unitKind: 'lf',
  },
  'wall-horizontal-10ft': {
    kind: 'wall-horizontal-10ft',
    codeRef: 'IRC R302.11(2)',
    title: 'Furred Wall / Horizontal Cavity Fire Blocking (<=10 ft)',
    requirement: 'Required vertically in furred spaces and concealed wall cavities at intervals not exceeding 10 ft horizontally.',
    defaultMaterial: '2x-lumber',
    approvedMaterials: ['2x-lumber', 'double-1x', '23/32-osb', '1/2-gypsum', 'mineral-wool-batt'],
    unitCostPerLfOrEaUsd: 2.1,
    unitKind: 'lf',
  },
  'soffit-drop-ceiling': {
    kind: 'soffit-drop-ceiling',
    codeRef: 'IRC R302.11(1)',
    title: 'Soffit / Drop-Ceiling / Knee-Wall Interconnection Fire Blocking',
    requirement: 'Required at all interconnections between concealed vertical stud spaces and concealed horizontal soffits, drop ceilings, or cove ceilings.',
    defaultMaterial: '23/32-osb',
    approvedMaterials: ['2x-lumber', 'double-1x', '23/32-osb', '1/2-gypsum', 'mineral-wool-batt'],
    unitCostPerLfOrEaUsd: 3.4,
    unitKind: 'lf',
  },
  'stair-stringer': {
    kind: 'stair-stringer',
    codeRef: 'IRC R302.11(3)',
    title: 'Stair Stringer Top & Bottom Fire Blocking',
    requirement: 'Required in concealed spaces between stair stringers at the top and bottom of every stair run.',
    defaultMaterial: '2x-lumber',
    approvedMaterials: ['2x-lumber', 'double-1x', '23/32-osb', '1/2-gypsum'],
    unitCostPerLfOrEaUsd: 4.5,
    unitKind: 'lf',
  },
  'chase-chimney-shaft': {
    kind: 'chase-chimney-shaft',
    codeRef: 'IRC R302.11(4)',
    title: 'Mechanical Chase / Chimney / Vertical Shaft Fire Blocking',
    requirement: 'Required at each floor and ceiling plane around vertical mechanical chases, plumbing shafts, and masonry chimneys (non-combustible mineral wool around chimneys).',
    defaultMaterial: 'mineral-wool-batt',
    approvedMaterials: ['mineral-wool-batt', '1/2-gypsum', '23/32-osb'],
    unitCostPerLfOrEaUsd: 6.0,
    unitKind: 'sqft',
  },
  'penetration-firestop': {
    kind: 'penetration-firestop',
    codeRef: 'IRC R302.11(5)',
    title: 'Pipe / Conduit / Duct Plate Penetration Firestopping',
    requirement: 'Required at openings around vents, pipes, ducts, cables, and wires at ceiling and floor level with approved fireblock caulk, mineral wool, or intumescent collar.',
    defaultMaterial: 'intumescent-collar',
    approvedMaterials: ['intumescent-collar', 'mineral-wool-batt'],
    unitCostPerLfOrEaUsd: 12.5,
    unitKind: 'ea',
  },
  'floor-draftstop': {
    kind: 'floor-draftstop',
    codeRef: 'IRC R302.12',
    title: 'Floor-Ceiling Assembly Draftstopping (<=1,000 sq ft)',
    requirement: 'Required in usable open-web floor trusses or concealed floor-ceiling cavities exceeding 1,000 sq ft so no concealed area exceeds 1,000 sq ft.',
    defaultMaterial: '1/2-gypsum',
    approvedMaterials: ['1/2-gypsum', '23/32-osb', '2x-lumber'],
    unitCostPerLfOrEaUsd: 4.2,
    unitKind: 'sqft',
  },
  'attic-draftstop': {
    kind: 'attic-draftstop',
    codeRef: 'IRC R302.12.1',
    title: 'Combustible Attic / Concealed Roof Draftstopping (<=3,000 sq ft)',
    requirement: 'Required in concealed combustible attic spaces in multi-unit or large (>3,000 sq ft) roof cavities.',
    defaultMaterial: '1/2-gypsum',
    approvedMaterials: ['1/2-gypsum', '23/32-osb'],
    unitCostPerLfOrEaUsd: 3.8,
    unitKind: 'sqft',
  },
}

/** Standard IRC R602.10 required braced wall percentages (simplified prescriptive lookup by wind/SDC/stories). */
export function getRequiredBracedWallPercent(params: {
  windMph: number
  seismicCategory: SeismicCategory
  storiesAbove: 0 | 1 | 2
}): number {
  const { windMph, seismicCategory, storiesAbove } = params
  let windPct = 16
  if (windMph >= 140) windPct = storiesAbove >= 1 ? 45 : 32
  else if (windMph >= 130) windPct = storiesAbove >= 1 ? 36 : 25
  else if (windMph >= 120) windPct = storiesAbove >= 1 ? 28 : 20
  else if (storiesAbove >= 1) windPct = 22

  let seisPct = 16
  if (seismicCategory === 'D2') seisPct = storiesAbove >= 1 ? 55 : 35
  else if (seismicCategory === 'D1') seisPct = storiesAbove >= 1 ? 45 : 30
  else if (seismicCategory === 'D0') seisPct = storiesAbove >= 1 ? 38 : 25
  else if (seismicCategory === 'C') seisPct = storiesAbove >= 1 ? 28 : 20

  return Math.max(windPct, seisPct)
}

export function belongsToLevel(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  node: SceneNodeLike,
  levelId: string | null,
): boolean {
  if (!levelId) return true
  if (node.type === 'level') return node.id === levelId
  if (node.parentId === levelId) return true
  let cur: SceneNodeLike | undefined = node
  const seen = new Set<string>()
  while (cur?.parentId && !seen.has(cur.id)) {
    if (cur.parentId === levelId) return true
    seen.add(cur.id)
    const parent: SceneNodeLike | undefined = nodes[cur.parentId]
    if (!parent) return false
    if (parent.type === 'level') return parent.id === levelId
    cur = parent
  }
  return false
}

/**
 * Walk upward from `node` to resolve its enclosing `level` node ID (or fallback parentId
 * if a test scene attaches nodes directly to a level ID string without an explicit level node).
 */
export function resolveNodeLevelId(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  node: SceneNodeLike,
): string | null {
  if (node.type === 'level') return node.id
  let cur: SceneNodeLike | undefined = node
  const seen = new Set<string>()
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    const parent: SceneNodeLike | undefined = nodes[cur.parentId]
    if (!parent) return cur.parentId
    if (parent.type === 'level') return parent.id
    cur = parent
  }
  return typeof node.parentId === 'string' ? node.parentId : null
}

/** True when both nodes belong to the same level, or at least one is unscoped (flat single-level scene). */
export function sameLevelOrUnscoped(levelA: string | null, levelB: string | null): boolean {
  if (!levelA || !levelB) return true
  return levelA === levelB
}
