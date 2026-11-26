import { describe, expect, test } from 'bun:test'
import { structuralAgentOperations } from '../agent-operations'
import { structuralAgentTools } from '../agent-tools'
import {
  STRUCTURAL_PLUGIN_ID,
  StructuralAssemblyNode,
  StructuralBeamNode,
  StructuralColumnNode,
  StructuralConnectorNode,
  StructuralFirestopNode,
  structuralChatExtension,
  structuralHostPanel,
  structuralPlugin,
  structuralRenderPlugin,
  structuralScheduleView,
} from '../index'

describe('Pascal Plugin API v1 & E-016 Agent Contracts', () => {
  test('plugin manifest and editor-free render manifest share identical pluginId, apiVersion, and 5 node kinds', () => {
    expect(STRUCTURAL_PLUGIN_ID).toBe('krusch:structural')
    expect(structuralPlugin.id).toBe(STRUCTURAL_PLUGIN_ID)
    expect(structuralRenderPlugin.id).toBe(STRUCTURAL_PLUGIN_ID)
    expect(structuralPlugin.apiVersion).toBe(1)
    expect(structuralRenderPlugin.apiVersion).toBe(1)
    expect(structuralPlugin.nodes?.length).toBe(5)
    expect(structuralRenderPlugin.nodes?.length).toBe(5)
    expect(structuralHostPanel.pluginId).toBe(STRUCTURAL_PLUGIN_ID)
    expect(structuralScheduleView.pluginId).toBe(STRUCTURAL_PLUGIN_ID)
    expect(structuralChatExtension.pluginId).toBe(STRUCTURAL_PLUGIN_ID)
  })

  test('all 5 persisted structural:* Zod schemas parse defaults cleanly', () => {
    expect(StructuralAssemblyNode.parse({ object: 'node' }).type).toBe('structural:assembly')
    expect(StructuralBeamNode.parse({ object: 'node' }).type).toBe('structural:beam')
    expect(StructuralColumnNode.parse({ object: 'node' }).type).toBe('structural:column')
    expect(StructuralConnectorNode.parse({ object: 'node' }).type).toBe('structural:connector')
    expect(StructuralFirestopNode.parse({ object: 'node' }).type).toBe('structural:firestop')
  })

  test('exposes 9 E-016 Zod agent tools with matching headless operations', () => {
    expect(structuralAgentTools.pluginId).toBe('krusch:structural')
    expect(structuralAgentTools.tools.length).toBe(9)

    const beamRes = structuralAgentOperations.structural_place_beam(
      {},
      {
        start: [0, 0],
        end: [4.88, 0],
        role: 'floor-girder',
        preferredFamily: 'lvl',
        tributaryWidthFt: 14,
      },
    )
    expect(beamRes.ok).toBe(true)
    expect(beamRes.createdNodes?.length).toBe(2) // beam + hangers

    const colRes = structuralAgentOperations.structural_place_column(
      {},
      { position: [0, 0, 0], axialLoadLbs: 14000, preferredType: 'psl' },
    )
    expect(colRes.ok).toBe(true)
    expect(colRes.createdNodes?.length).toBe(3) // column + base + cap

    const conRes = structuralAgentOperations.structural_place_connector(
      {},
      { sku: 'A35', position: [1, 2.74, 0], quantity: 12 },
    )
    expect(conRes.ok).toBe(true)

    const fsRes = structuralAgentOperations.structural_place_firestop(
      {},
      { firestopKind: 'stair-stringer', start: [0, 0], end: [1.1, 0] },
    )
    expect(fsRes.ok).toBe(true)

    const calcRes = structuralAgentOperations.structural_size_member(
      {},
      { memberKind: 'hurricane-tie', design: { windMph: 140, exposure: 'C' } },
    )
    expect(calcRes.ok).toBe(true)
    expect(calcRes.data.sku).toBe('H10A')
  })
})
