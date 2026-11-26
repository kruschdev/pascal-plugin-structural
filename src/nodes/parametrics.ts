/**
 * Auto-derived Pascal Inspector Parametrics for all 5 `structural:*` node kinds.
 */

import type { ParametricDescriptor } from '@pascal-app/core'
import {
  AssemblyKindEnum,
  FloorSystemEnum,
  LumberSpeciesEnum,
  RoofSystemEnum,
  type StructuralAssemblyNode,
  StudSizeEnum,
} from './assembly'
import { BeamMaterialFamilyEnum, BeamRoleEnum, type StructuralBeamNode } from './beam'
import { ColumnTypeEnum, type StructuralColumnNode } from './column'
import { ConnectorCategoryEnum, type StructuralConnectorNode } from './connector'
import { FirestopKindEnum, FirestopMaterialEnum, type StructuralFirestopNode } from './firestop'

export const structuralAssemblyParametrics: ParametricDescriptor<StructuralAssemblyNode> = {
  groups: [
    {
      label: 'Framing System & Species',
      fields: [
        { key: 'assemblyKind', kind: 'enum', options: [...AssemblyKindEnum.options] },
        { key: 'species', kind: 'enum', options: [...LumberSpeciesEnum.options] },
        { key: 'studSize', kind: 'enum', options: [...StudSizeEnum.options], display: 'segmented' },
        { key: 'floorSystem', kind: 'enum', options: [...FloorSystemEnum.options] },
        { key: 'roofSystem', kind: 'enum', options: [...RoofSystemEnum.options] },
      ],
    },
    {
      label: 'Dimensions & X-Ray',
      fields: [
        { key: 'joistDepthIn', kind: 'number', unit: 'in', min: 5.5, max: 24, step: 0.125 },
        { key: 'wallHeightM', kind: 'number', unit: 'm', min: 1.5, max: 8, step: 0.05 },
        { key: 'xrayOpacity', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
  ],
}

export const structuralBeamParametrics: ParametricDescriptor<StructuralBeamNode> = {
  groups: [
    {
      label: 'Beam / Header Specification',
      fields: [
        { key: 'role', kind: 'enum', options: [...BeamRoleEnum.options] },
        { key: 'beamType', kind: 'enum', options: [...BeamMaterialFamilyEnum.options] },
        { key: 'plyCount', kind: 'number', min: 1, max: 4, step: 1 },
        { key: 'widthIn', kind: 'number', unit: 'in', min: 1.5, max: 12, step: 0.25 },
        { key: 'depthIn', kind: 'number', unit: 'in', min: 3.5, max: 28, step: 0.125 },
      ],
    },
    {
      label: 'Loads & Bearing (IRC R502.6 / R602.7)',
      fields: [
        { key: 'tributaryWidthFt', kind: 'number', unit: 'ft', min: 1, max: 60, step: 1 },
        { key: 'liveLoadPsf', kind: 'number', unit: 'psf', min: 10, max: 150, step: 5 },
        { key: 'snowLoadPsf', kind: 'number', unit: 'psf', min: 0, max: 200, step: 5 },
        { key: 'bearingLengthIn', kind: 'number', unit: 'in', min: 1.5, max: 12, step: 0.5 },
        { key: 'jackStudsEachEnd', kind: 'number', min: 1, max: 4, step: 1 },
      ],
    },
  ],
}

export const structuralColumnParametrics: ParametricDescriptor<StructuralColumnNode> = {
  groups: [
    {
      label: 'Column & Axial Load',
      fields: [
        { key: 'columnType', kind: 'enum', options: [...ColumnTypeEnum.options] },
        { key: 'widthIn', kind: 'number', unit: 'in', min: 3, max: 12, step: 0.25 },
        { key: 'depthIn', kind: 'number', unit: 'in', min: 3, max: 12, step: 0.25 },
        { key: 'heightM', kind: 'number', unit: 'm', min: 0.4, max: 12, step: 0.05 },
        { key: 'axialLoadLbs', kind: 'number', unit: 'lbs', min: 0, max: 200000, step: 500 },
        { key: 'hasSquashBlocks', kind: 'boolean', label: 'TJI Squash Blocks Installed (R502.1.2)' },
      ],
    },
    {
      label: 'Spread / Pad Footing (IRC R403.1)',
      fields: [
        { key: 'footingWidthIn', kind: 'number', unit: 'in', min: 0, max: 96, step: 6 },
        { key: 'footingDepthIn', kind: 'number', unit: 'in', min: 0, max: 48, step: 2 },
      ],
    },
  ],
}

export const structuralConnectorParametrics: ParametricDescriptor<StructuralConnectorNode> = {
  groups: [
    {
      label: 'Hardware & Capacity',
      fields: [
        { key: 'category', kind: 'enum', options: [...ConnectorCategoryEnum.options] },
        { key: 'quantity', kind: 'number', min: 1, max: 500, step: 1 },
        { key: 'upliftCapacityLbs', kind: 'number', unit: 'lbs', min: 0, max: 50000, step: 50 },
        { key: 'downloadCapacityLbs', kind: 'number', unit: 'lbs', min: 0, max: 50000, step: 50 },
        { key: 'lateralCapacityLbs', kind: 'number', unit: 'lbs', min: 0, max: 50000, step: 50 },
      ],
    },
  ],
}

export const structuralFirestopParametrics: ParametricDescriptor<StructuralFirestopNode> = {
  groups: [
    {
      label: 'IRC R302.11 / R302.12 Firestop',
      fields: [
        { key: 'firestopKind', kind: 'enum', options: [...FirestopKindEnum.options] },
        { key: 'material', kind: 'enum', options: [...FirestopMaterialEnum.options] },
        { key: 'elevationY', kind: 'number', unit: 'm', min: -4, max: 12, step: 0.05 },
        { key: 'heightM', kind: 'number', unit: 'm', min: 0.03, max: 4, step: 0.05 },
        { key: 'thicknessM', kind: 'number', unit: 'm', min: 0.01, max: 1, step: 0.01 },
      ],
    },
  ],
}
