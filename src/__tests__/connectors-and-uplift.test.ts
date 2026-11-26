import { describe, expect, test } from 'bun:test'
import {
  CONNECTOR_CATALOG,
  getConnectorBySku,
  selectHoldDownSku,
  selectHurricaneTieSku,
} from '../irc'

describe('Simpson-Class Structural Connector & Hardware Catalog', () => {
  test('catalog covers all 10 hardware categories including hurricane ties, framing angles, hangers, post bases/caps, hold-downs, straps & plate washers', () => {
    const categories = new Set(CONNECTOR_CATALOG.map((c) => c.category))
    expect(categories.has('hurricane-tie')).toBe(true)
    expect(categories.has('framing-angle')).toBe(true)
    expect(categories.has('joist-hanger')).toBe(true)
    expect(categories.has('beam-hanger')).toBe(true)
    expect(categories.has('post-base')).toBe(true)
    expect(categories.has('post-cap')).toBe(true)
    expect(categories.has('hold-down')).toBe(true)
    expect(categories.has('tension-strap')).toBe(true)
    expect(categories.has('plate-washer')).toBe(true)
    expect(categories.has('anchor-bolt')).toBe(true)
    expect(CONNECTOR_CATALOG.length).toBeGreaterThanOrEqual(38)
  })

  test('selects progressively stronger hurricane ties with wind speed, exposure, and girder-truss demand', () => {
    expect(
      selectHurricaneTieSku({ windMph: 105, exposure: 'B', seismicCategory: 'B' }),
    ).toBe('H1')
    expect(
      selectHurricaneTieSku({ windMph: 115, exposure: 'B', seismicCategory: 'C' }),
    ).toBe('H2.5A')
    expect(
      selectHurricaneTieSku({ windMph: 135, exposure: 'C', seismicCategory: 'C' }),
    ).toBe('H10A')
    expect(
      selectHurricaneTieSku({ windMph: 150, exposure: 'D', seismicCategory: 'C' }),
    ).toBe('HTS20')
    expect(
      selectHurricaneTieSku({ windMph: 130, exposure: 'C', seismicCategory: 'C', isGirderTruss: true }),
    ).toBe('HGA10')
  })

  test('selects framing angles (A35, LTP4, LS50) and hold-downs (HDU2–HDU11) by demand', () => {
    expect(getConnectorBySku('A35')?.lateralLbs).toBeGreaterThan(500)
    expect(getConnectorBySku('LTP4')?.lateralLbs).toBeGreaterThan(600)
    expect(getConnectorBySku('BP3x3')?.codeRef).toContain('R602.11.1')

    expect(selectHoldDownSku(2500).sku).toBe('HDU2-SDS2.5')
    expect(selectHoldDownSku(5200).sku).toBe('HDU5-SDS2.5')
    expect(selectHoldDownSku(9000).sku).toBe('HDU11-SDS2.5')
  })
})
