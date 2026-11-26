import { describe, expect, test } from 'bun:test'
import {
  BEAM_CATALOG,
  FLOOR_JOIST_SPANS_FT,
  checkBeamEntry,
  sizeBeamOrHeader,
  sizeColumnAndFooting,
  sizeFloorSystem,
  sizeRoofSystem,
} from '../irc'

describe('IRC / AWC NDS Multi-Species & Engineered Beam Sizing', () => {
  test('multi-species floor joist spans differ correctly across DF-L, SPF, SYP, and Hem-Fir', () => {
    expect(FLOOR_JOIST_SPANS_FT['df-l-2']['2x10'][16]).toBeGreaterThan(
      FLOOR_JOIST_SPANS_FT['spf-2']['2x10'][16],
    )
    expect(FLOOR_JOIST_SPANS_FT['syp-2']['2x12'][16]).toBeGreaterThan(
      FLOOR_JOIST_SPANS_FT['hem-fir-2']['2x12'][16],
    )

    const dflFloor = sizeFloorSystem({
      clearSpanFt: 16,
      crossLengthFt: 28,
      system: 'dimensional',
      species: 'df-l-2',
      spacingIn: 16,
    })
    const spfFloor = sizeFloorSystem({
      clearSpanFt: 16,
      crossLengthFt: 28,
      system: 'dimensional',
      species: 'spf-2',
      spacingIn: 16,
    })
    expect(dflFloor.memberLabel).toContain('2x10')
    expect(spfFloor.memberLabel).toContain('2x12')
  })

  test('sizes LVL, Glulam, PSL, Flitch, and A992 Steel W-beams across heavy spans', () => {
    const lvlGarageHeader = sizeBeamOrHeader({
      spanFt: 16,
      tributaryWidthFt: 14,
      role: 'header',
      preferredFamily: 'lvl',
      snowLoadPsf: 50,
      storiesSupported: 1,
    })
    expect(lvlGarageHeader.passes).toBe(true)
    expect(['lvl', 'psl', 'steel-w']).toContain(lvlGarageHeader.entry.family)
    expect(lvlGarageHeader.jackStudsEachEnd).toBeGreaterThanOrEqual(3)
    expect(lvlGarageHeader.recommendedHangerSku).toMatch(/^(HHUS|HGUS|HUCQ)/)

    const glulamRidge = sizeBeamOrHeader({
      spanFt: 18,
      tributaryWidthFt: 14,
      role: 'ridge-beam',
      preferredFamily: 'glulam',
      snowLoadPsf: 40,
    })
    expect(glulamRidge.passes).toBe(true)
    expect(glulamRidge.entry.family).toBe('glulam')
    expect(glulamRidge.liveDeflectionRatio).toBeGreaterThanOrEqual(240)

    const steelTransfer = sizeBeamOrHeader({
      spanFt: 22,
      tributaryWidthFt: 16,
      role: 'transfer-beam',
      preferredFamily: 'steel-w',
      liveLoadPsf: 40,
      storiesSupported: 1,
    })
    expect(steelTransfer.passes).toBe(true)
    expect(steelTransfer.entry.family).toBe('steel-w')

    const flitch = BEAM_CATALOG.find((b) => b.family === 'flitch')!
    const flitchCheck = checkBeamEntry(flitch, {
      spanFt: 12,
      tributaryWidthFt: 10,
      role: 'floor-girder',
    })
    expect(flitchCheck.entry.family).toBe('flitch')
    expect(flitchCheck.momentFtLbs).toBeGreaterThan(0)
  })

  test('detects overstressed undersized built-up header on wide opening', () => {
    const smallDim = BEAM_CATALOG.find((b) => b.id === 'dim-2-2x8')!
    const check = checkBeamEntry(smallDim, {
      spanFt: 14,
      tributaryWidthFt: 16,
      role: 'header',
      snowLoadPsf: 50,
    })
    expect(check.passes).toBe(false)
    expect(check.bendingUtilization).toBeGreaterThan(1)
    expect(check.warnings.length).toBeGreaterThan(0)
  })

  test('sizes TJI I-joists and open-web floor trusses with girder escalation', () => {
    const tji = sizeFloorSystem({
      clearSpanFt: 24,
      crossLengthFt: 32,
      system: 'tji-ijoist',
      spacingIn: 16,
    })
    expect(tji.tjiEntry).toBeDefined()
    expect(tji.tjiEntry!.maxFieldRoundHoleIn).toBeGreaterThan(5)
    expect(tji.joistHangerSku).toMatch(/^(IUS|MIT)/)

    const trussFloor = sizeFloorSystem({
      clearSpanFt: 30,
      crossLengthFt: 36,
      system: 'open-web-truss',
      spacingIn: 24,
    })
    expect(trussFloor.girderLinesNeeded).toBe(0)
    expect(trussFloor.depthIn).toBe(24)
  })

  test('flags structural ridge beam when roof pitch < 3:12 (IRC R802.4.3) and supports prefab trusses', () => {
    const lowSlope = sizeRoofSystem({
      buildingSpanFt: 28,
      ridgeLengthFt: 16,
      pitchRiseOver12: 2,
      system: 'stick-rafter',
      design: { groundSnowPsf: 40, windMph: 135, exposure: 'C' },
    })
    expect(lowSlope.needsStructuralRidgeBeam).toBe(true)
    expect(lowSlope.recommendedRidgeBeam?.passes).toBe(true)
    expect(lowSlope.hurricaneTieSku).toBe('H10A')

    const fink = sizeRoofSystem({
      buildingSpanFt: 36,
      ridgeLengthFt: 40,
      pitchRiseOver12: 6,
      system: 'fink-truss',
    })
    expect(fink.needsStructuralRidgeBeam).toBe(false)
    expect(fink.spacingIn).toBe(24)
  })

  test('sizes wood, PSL, and steel HSS columns with NDS buckling & spread footings', () => {
    const woodPost = sizeColumnAndFooting({
      axialLoadLbs: 9000,
      unbracedHeightFt: 9,
      soilBearingPsf: 1500,
    })
    expect(woodPost.passes).toBe(true)
    expect(woodPost.footingWidthIn).toBeGreaterThanOrEqual(30)
    expect(woodPost.recommendedBaseSku).toMatch(/^(ABU|CB)/)
    expect(woodPost.recommendedCapSku).toMatch(/^(BC|LPC|CCQ)/)

    const heavySteel = sizeColumnAndFooting({
      axialLoadLbs: 55000,
      unbracedHeightFt: 10,
      preferredType: 'steel-hss',
      soilBearingPsf: 2000,
    })
    expect(heavySteel.passes).toBe(true)
    expect(heavySteel.entry.columnType).toBe('steel-hss')
  })
})
