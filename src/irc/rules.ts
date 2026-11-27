/**
 * Layer 3 — Single-Source Declarative IRC Structural Rule Table (`@kruschdev/pascal-plugin-structural/irc`).
 *
 * Expresses IRC wind/seismic uplift thresholds, roof framing envelope tolerances, and
 * Priority #1 structural right-of-way constraints ONCE as typed `DeclarativeRule[]` data
 * validated via `@kruschdev/pascal-mep-kernel`'s `validateRuleTable` (`INV-MEP-08`).
 *
 * Consumed directly by `autopopulate.ts`, `load-path.ts`, `sizing.ts`, and `audit.ts` so
 * generator, load-path tracer, and compliance auditor cannot drift.
 *
 * Framework-free: zero React, Three.js, `@pascal-app/*`, or Next.js imports.
 */

import {
  type CandidateEvaluationResult,
  type DeclarativeRule,
  type ElevationBandRule,
  type FixtureKeepoutRule,
  type PlacementCandidate,
  type RuleEvaluationMode,
  type WindSeismicThresholdParams,
  type WindSeismicThresholdRule,
  evaluatePlacementCandidate,
  validateRuleTable,
} from '@kruschdev/pascal-mep-kernel'

const IRC_WIND_SEISMIC_UPLIFT_RULE: WindSeismicThresholdRule = {
  id: 'irc-r802-11-wind-seismic-uplift',
  trade: 'structural',
  kind: 'wind-seismic-threshold',
  codeRef: 'IRC R802.11 / WFCM / R602.10',
  severity: 'error',
  category: 'connector-hardware',
  title: 'Wind & Seismic Continuous Uplift, Hold-Down & Bearing Thresholds',
  suggestedFix:
    'Add required roof hurricane ties (H2.5A/H10A), continuous wall/floor tension straps (MSTA36/MSTC40), foundation hold-downs (HDU/STHD14), sill anchor bolts (SSTB16/BP3x3), and code-minimum spread footings/bearing.',
  placementMarginM: 0,
  params: {
    roofTieWindMph: 115,
    strapWindMph: 130,
    heavyStrapWindMph: 140,
    holdDownWindMph: 130,
    highSeismicCategories: ['D0', 'D1', 'D2'],
    sillBoltSeismicCategories: ['C', 'D0', 'D1', 'D2'],
    minFootingWidthIn: 18,
    minBearingToleranceIn: 0.05,
  },
}

const IRC_ROOF_FRAMING_ENVELOPE_RULE: ElevationBandRule = {
  id: 'irc-r802-roof-framing-envelope',
  trade: 'structural',
  kind: 'elevation-band',
  codeRef: 'IRC R802 / Roof Framing Envelope',
  severity: 'warning',
  category: 'mep-clash',
  title: 'Roof Framing Plane & Building Envelope Intrusion Tolerance',
  suggestedFix:
    'Lower indoor MEP equipment/plenums or drop ducts, pipes, and conduits below the ceiling/rafter framing plane inside the conditioned building envelope.',
  placementMarginM: 0.07, // 0.08m warning + 0.07m placement cushion = 0.15m error threshold
  params: {
    targetKinds: [
      'hvac:equipment',
      'hvac:plenum',
      'plumbing:equipment',
      'hvac:duct-run',
      'plumbing:pipe-run',
      'electrical:conduit-run',
    ],
    roofMarginM: 0.08,
    atticThresholdOffsetM: 0.05,
  },
}

const IRC_MEP_RIGHT_OF_WAY_RULE: FixtureKeepoutRule = {
  id: 'irc-r502-8-mep-right-of-way',
  trade: 'structural',
  kind: 'fixture-keepout',
  codeRef: 'IRC R502.8 / Priority #1 Structural Right-of-Way',
  severity: 'error',
  category: 'mep-clash',
  title: 'Priority #1 Structural Right-of-Way (MEP Cannot Bore Beams or Columns)',
  suggestedFix:
    'Re-route MEP pipes, ducts, and conduits below beam soffits, through open joist/TJI knockout bays, or horizontally around structural column shafts with >= 1 in clearance.',
  placementMarginM: 0.0254, // 1" placement clearance cushion; audit flags direct penetration (<= 0m)
  params: {
    targetRoles: [
      'plumbing:pipe-run',
      'hvac:duct-run',
      'electrical:conduit-run',
      'mep-run',
    ],
    fixtureKinds: ['structural:beam', 'structural:column'],
    minHorizontalM: 0,
  },
}

/**
 * Authoritative single-source IRC structural rule table (`INV-MEP-08`).
 * Validated at module initialization via `@kruschdev/pascal-mep-kernel`'s `validateRuleTable`.
 */
export const IRC_DECLARATIVE_RULES: readonly DeclarativeRule[] = Object.freeze([
  IRC_WIND_SEISMIC_UPLIFT_RULE,
  IRC_ROOF_FRAMING_ENVELOPE_RULE,
  IRC_MEP_RIGHT_OF_WAY_RULE,
])

const initialValidation = validateRuleTable(IRC_DECLARATIVE_RULES)
if (!initialValidation.valid) {
  throw new Error(
    `Invalid IRC_DECLARATIVE_RULES table: ${initialValidation.errors.join('; ')}`,
  )
}

/**
 * Look up a canonical IRC declarative rule by its unique ID.
 */
export function getIrcRuleById(id: 'irc-r802-11-wind-seismic-uplift'): WindSeismicThresholdRule
export function getIrcRuleById(id: 'irc-r802-roof-framing-envelope'): ElevationBandRule
export function getIrcRuleById(id: 'irc-r502-8-mep-right-of-way'): FixtureKeepoutRule
export function getIrcRuleById(id: string): DeclarativeRule | undefined
export function getIrcRuleById(id: string): DeclarativeRule | undefined {
  return IRC_DECLARATIVE_RULES.find((rule) => rule.id === id)
}

/**
 * Single-source wind/seismic uplift, hold-down, sill-bolt, footing, and bearing thresholds
 * read directly from `irc-r802-11-wind-seismic-uplift`.
 */
export const IRC_WIND_SEISMIC_THRESHOLDS: WindSeismicThresholdParams =
  getIrcRuleById('irc-r802-11-wind-seismic-uplift').params

const roofEnvelopeRule = getIrcRuleById('irc-r802-roof-framing-envelope')
const roofWarningMarginM = roofEnvelopeRule.params.roofMarginM ?? 0.08
const roofErrorMarginM = Number(
  (roofWarningMarginM + (roofEnvelopeRule.placementMarginM ?? 0.07)).toFixed(3),
)

/**
 * Single-source roof framing plane & exterior building envelope intrusion tolerances
 * derived directly from `irc-r802-roof-framing-envelope`.
 */
export const IRC_ROOF_ENVELOPE_THRESHOLDS = Object.freeze({
  /** Warning protrusion threshold above roof framing plane (m), from `roofMarginM`. */
  roofMarginM: roofWarningMarginM,
  /** Warning protrusion threshold above roof framing plane (m). */
  warningProtrusionM: roofWarningMarginM,
  /** Error protrusion threshold above roof framing plane (m), `roofMarginM + placementMarginM` (`0.15m`). */
  errorProtrusionM: roofErrorMarginM,
  /** Vertical offset above wall top plate before roof-plane checks engage (m). */
  atticThresholdOffsetM: roofEnvelopeRule.params.atticThresholdOffsetM ?? 0.05,
  /** Exterior wall overhang warning threshold (m) for indoor equipment. */
  equipmentExteriorWarningM: 0.15,
  /** Exterior wall overhang error threshold (m) for indoor equipment. */
  equipmentExteriorErrorM: 0.6,
  /** Exterior wall overhang warning threshold (m) for indoor MEP runs. */
  runExteriorWarningM: 0.35,
})

/** Check whether a Seismic Design Category is in `IRC_WIND_SEISMIC_THRESHOLDS.highSeismicCategories` (`D0`/`D1`/`D2`). */
export function isHighSeismicCategory(seismicCategory: string): boolean {
  return IRC_WIND_SEISMIC_THRESHOLDS.highSeismicCategories.includes(seismicCategory)
}

/** Check whether a Seismic Design Category requires foundation sill anchor bolts (`C`/`D0`/`D1`/`D2`). */
export function requiresSillAnchorBolts(seismicCategory: string): boolean {
  return IRC_WIND_SEISMIC_THRESHOLDS.sillBoltSeismicCategories.includes(seismicCategory)
}

/** Evaluate a candidate directly against `irc-r802-11-wind-seismic-uplift`. */
export function evaluateIrcWindSeismicCandidate(
  candidate: PlacementCandidate,
  mode: RuleEvaluationMode = 'audit',
): CandidateEvaluationResult {
  return evaluatePlacementCandidate([IRC_WIND_SEISMIC_UPLIFT_RULE], candidate, mode)
}
