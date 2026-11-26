/**
 * Read-only viewer entry (`@kruschdev/pascal-plugin-structural/render`).
 * Same plugin ID, contract version, schemas, defaults, 3D geometry, and 2D floorplan symbols
 * as `structuralPlugin`, with ZERO imports from `@pascal-app/editor` or `next`.
 */

import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { structuralAssemblyRenderDefinition } from './nodes/assembly'
import { structuralBeamRenderDefinition } from './nodes/beam'
import { structuralColumnRenderDefinition } from './nodes/column'
import { structuralConnectorRenderDefinition } from './nodes/connector'
import { structuralFirestopRenderDefinition } from './nodes/firestop'

export const STRUCTURAL_PLUGIN_ID = 'krusch:structural' as const

export const structuralRenderPlugin: Plugin = {
  id: STRUCTURAL_PLUGIN_ID,
  apiVersion: 1,
  nodes: [
    structuralAssemblyRenderDefinition as unknown as AnyNodeDefinition,
    structuralBeamRenderDefinition as unknown as AnyNodeDefinition,
    structuralColumnRenderDefinition as unknown as AnyNodeDefinition,
    structuralConnectorRenderDefinition as unknown as AnyNodeDefinition,
    structuralFirestopRenderDefinition as unknown as AnyNodeDefinition,
  ],
}

export {
  StructuralAssemblyNode,
  AssemblyKindEnum,
  LumberSpeciesEnum,
  StudSizeEnum,
  StudSpacingInEnum,
  FloorSystemEnum,
  RoofSystemEnum,
  DesignParamsSchema,
  WallOverrideRuleSchema,
  structuralAssemblyRenderDefinition,
  buildStructuralAssemblyGeometry,
  buildStructuralAssemblyFloorplan,
  getStructuralAssemblyPorts,
} from './nodes/assembly'

export {
  StructuralBeamNode,
  BeamRoleEnum,
  BeamMaterialFamilyEnum,
  structuralBeamRenderDefinition,
  buildStructuralBeamGeometry,
  buildStructuralBeamFloorplan,
  getStructuralBeamPorts,
} from './nodes/beam'

export {
  StructuralColumnNode,
  ColumnTypeEnum,
  structuralColumnRenderDefinition,
  buildStructuralColumnGeometry,
  buildStructuralColumnFloorplan,
  getStructuralColumnPorts,
} from './nodes/column'

export {
  StructuralConnectorNode,
  ConnectorCategoryEnum,
  structuralConnectorRenderDefinition,
  buildStructuralConnectorGeometry,
  buildStructuralConnectorFloorplan,
  getStructuralConnectorPorts,
} from './nodes/connector'

export {
  StructuralFirestopNode,
  FirestopKindEnum,
  FirestopMaterialEnum,
  structuralFirestopRenderDefinition,
  buildStructuralFirestopGeometry,
  buildStructuralFirestopFloorplan,
  getStructuralFirestopPorts,
} from './nodes/firestop'
