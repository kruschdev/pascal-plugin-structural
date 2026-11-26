/**
 * Main browser entry (`@kruschdev/pascal-plugin-structural`).
 *
 * Exports the full Pascal Plugin API v1 surface:
 * - `structuralPlugin`: Core `Plugin` manifest (`apiVersion: 1`, 5 `structural:*` node kinds + InspectorExtension)
 * - `structuralHostPanel`: Left-rail `EditorHostPanel`
 * - `structuralScheduleView`: Full-pane `EditorHostView` (Beams, Columns, Connectors, Firestops, Load Path, Audit, BOM)
 * - `structuralChatExtension`: `PluginChatExtension` (`/` actions + lazy tool result cards)
 */

import type { AnyNodeDefinition, InspectorExtension, Plugin } from '@pascal-app/core'
import type { EditorHostPanel, EditorHostView, PluginChatExtension } from '@pascal-app/editor'
import { structuralAssemblyRenderDefinition } from './nodes/assembly'
import { structuralBeamRenderDefinition } from './nodes/beam'
import { structuralColumnRenderDefinition } from './nodes/column'
import { structuralConnectorRenderDefinition } from './nodes/connector'
import { structuralFirestopRenderDefinition } from './nodes/firestop'
import {
  structuralAssemblyParametrics,
  structuralBeamParametrics,
  structuralColumnParametrics,
  structuralConnectorParametrics,
  structuralFirestopParametrics,
} from './nodes/parametrics'
import { STRUCTURAL_PLUGIN_ID, structuralRenderPlugin } from './render'
import StructuralChatCard from './ui/chat-card'
import StructuralInspectorCard from './ui/inspector-card'
import StructuralScheduleView from './ui/schedule-view'
import StructuralHostPanel, { STRUCTURAL_SCHEDULE_VIEW_ID } from './ui/structural-panel'

export const structuralInspectorExtensions: InspectorExtension[] = [
  {
    id: `${STRUCTURAL_PLUGIN_ID}:irc-diagnostics`,
    pluginId: STRUCTURAL_PLUGIN_ID,
    kinds: [
      'structural:assembly',
      'structural:beam',
      'structural:column',
      'structural:connector',
      'structural:firestop',
    ],
    icon: { kind: 'iconify', name: 'lucide:blocks' },
    title: 'IRC / NDS Structural Engineering',
    component: () => Promise.resolve({ default: StructuralInspectorCard }),
  },
]

export const structuralAssemblyDefinition = {
  ...structuralAssemblyRenderDefinition,
  snapProfile: 'structural' as const,
  parametrics: structuralAssemblyParametrics,
}

export const structuralBeamDefinition = {
  ...structuralBeamRenderDefinition,
  snapProfile: 'structural' as const,
  parametrics: structuralBeamParametrics,
}

export const structuralColumnDefinition = {
  ...structuralColumnRenderDefinition,
  snapProfile: 'structural' as const,
  parametrics: structuralColumnParametrics,
}

export const structuralConnectorDefinition = {
  ...structuralConnectorRenderDefinition,
  snapProfile: 'item' as const,
  parametrics: structuralConnectorParametrics,
}

export const structuralFirestopDefinition = {
  ...structuralFirestopRenderDefinition,
  snapProfile: 'structural' as const,
  parametrics: structuralFirestopParametrics,
}

export const structuralPlugin: Plugin = {
  ...structuralRenderPlugin,
  nodes: [
    structuralAssemblyDefinition as unknown as AnyNodeDefinition,
    structuralBeamDefinition as unknown as AnyNodeDefinition,
    structuralColumnDefinition as unknown as AnyNodeDefinition,
    structuralConnectorDefinition as unknown as AnyNodeDefinition,
    structuralFirestopDefinition as unknown as AnyNodeDefinition,
  ],
  inspectorExtensions: structuralInspectorExtensions,
}

export const structuralHostPanel: EditorHostPanel = {
  id: `${STRUCTURAL_PLUGIN_ID}:panel`,
  pluginId: STRUCTURAL_PLUGIN_ID,
  label: 'Structural',
  summary:
    'Builder-grade IRC/AWC/NDS wood & engineered framing, LVL/Glulam/PSL/steel beams, Simpson-class hardware, and R302.11 fire blocking.',
  description:
    'Author Priority #1 residential and light-commercial structural systems with multi-species (DF-L, SPF, SYP, Hem-Fir) framing, LVL/Glulam/PSL/LSL/Flitch/A992 Steel beams, TJI I-joists, roof/floor trusses, 40-SKU Simpson-class connector schedules, full IRC R302.11/R302.12 fire blocking & draftstopping, continuous gravity/uplift load-path tracing, and priced BOMs.',
  category: 'MEP & Engineering',
  creator: {
    name: 'Kevin Ruschman (@kruschdev)',
    url: 'https://github.com/kruschdev',
  },
  pluginUrl: 'https://github.com/kruschdev/pascal-plugin-structural',
  icon: { kind: 'iconify', name: 'lucide:blocks' },
  component: () => Promise.resolve({ default: StructuralHostPanel }),
  defaultInstalled: false,
}

export const structuralScheduleView: EditorHostView = {
  id: STRUCTURAL_SCHEDULE_VIEW_ID,
  pluginId: STRUCTURAL_PLUGIN_ID,
  label: 'Structural Schedule',
  description:
    'Beams & Headers, Columns & Footings, Simpson-class Connectors & Fasteners, IRC R302.11/R302.12 Fire Blocking, Load Path & Bracing, IRC Audit, and Priced BOM.',
  icon: { kind: 'iconify', name: 'lucide:table' },
  component: () => Promise.resolve({ default: StructuralScheduleView }),
  workspaces: ['edit'],
  defaultPinned: false,
}

export const structuralChatExtension: PluginChatExtension = {
  pluginId: STRUCTURAL_PLUGIN_ID,
  cards: {
    structural_audit_irc: () => Promise.resolve({ default: StructuralChatCard }),
    structural_trace_load_path: () => Promise.resolve({ default: StructuralChatCard }),
    structural_generate_schedule: () => Promise.resolve({ default: StructuralChatCard }),
    structural_autopopulate_irc: () => Promise.resolve({ default: StructuralChatCard }),
  },
  actions: [
    {
      id: 'irc-structural-audit',
      label: 'IRC & Load-Path Audit',
      hint: 'Check beams/LVL/Glulam, jack studs, connectors, R302.11 fire blocking & load paths',
      prompt:
        'Run structural_audit_irc on this scene and summarize any beam, connector, fire-blocking, load-path, or MEP clash issues.',
    },
    {
      id: 'structural-schedule',
      label: 'Structural Schedules & BOM',
      hint: 'Generate Beam, Column, Connector, Firestop Schedules and Priced BOM',
      prompt: 'Run structural_generate_schedule and open the structural schedule view.',
    },
    {
      id: 'structural-autoframe',
      label: 'Auto-Frame (IRC/NDS)',
      hint: 'Synthesize framing assemblies, LVL/Glulam beams, columns, hardware & R302.11 fire blocking',
      prompt: 'Run structural_autopopulate_irc on the active level.',
    },
  ],
}

export {
  STRUCTURAL_PLUGIN_ID,
  structuralRenderPlugin,
  StructuralAssemblyNode,
  AssemblyKindEnum,
  LumberSpeciesEnum,
  StudSizeEnum,
  StudSpacingInEnum,
  FloorSystemEnum,
  RoofSystemEnum,
  DesignParamsSchema,
  WallOverrideRuleSchema,
  StructuralBeamNode,
  BeamRoleEnum,
  BeamMaterialFamilyEnum,
  StructuralColumnNode,
  ColumnTypeEnum,
  StructuralConnectorNode,
  ConnectorCategoryEnum,
  StructuralFirestopNode,
  FirestopKindEnum,
  FirestopMaterialEnum,
} from './render'
export { STRUCTURAL_SCHEDULE_VIEW_ID } from './ui/structural-panel'
export * from './irc'
