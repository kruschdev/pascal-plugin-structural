/**
 * `structural:assembly` — Persisted per-level/system framing assembly node
 * (wall framing, floor system, roof system, braced wall line, foundation system).
 * Groups repetitive field sticks inside a single renderable node while exposing
 * exact stud spacing, species, floor/roof system, and per-wall overrides to
 * downstream Plumbing, HVAC, and Electrical plugins.
 *
 * Render-safe module: zero `@pascal-app/editor` imports.
 */

import {
  BaseNode,
  type FloorplanGeometry,
  type GeometryContext,
  type NodeDefinition,
  type NodePort,
  nodeType,
  objectId,
} from '@pascal-app/core'
import { Group } from 'three'
import { z } from 'zod'
import { buildAssemblyPreviewCad } from '../cad/assemblies'
import { type AssemblyKind, DEFAULT_DESIGN_PARAMS, type LumberSpecies } from '../irc/tables'

export const AssemblyKindEnum = z.enum([
  'wall-framing',
  'floor-system',
  'roof-system',
  'braced-wall-line',
  'foundation-system',
])

export const LumberSpeciesEnum = z.enum(['df-l-2', 'spf-2', 'syp-2', 'hem-fir-2'])
export const StudSizeEnum = z.enum(['2x4', '2x6'])
export const StudSpacingInEnum = z.union([z.literal(12), z.literal(16), z.literal(24)])
export const FloorSystemEnum = z.enum(['dimensional', 'tji-ijoist', 'open-web-truss'])
export const RoofSystemEnum = z.enum([
  'stick-rafter',
  'fink-truss',
  'scissor-truss',
  'attic-truss',
  'ridge-beam-cathedral',
])

export const WallOverrideRuleSchema = z.object({
  construction: z.enum(['wood-framed', 'lgs', 'cmu', 'shear-wall', 'skip']).default('wood-framed'),
  studSize: StudSizeEnum.optional(),
  studSpacingIn: StudSpacingInEnum.optional(),
  isLoadBearing: z.boolean().optional(),
  isShearWall: z.boolean().optional(),
  isWetWall: z.boolean().optional(),
  sheathingEdgeNailIn: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]).optional(),
})

export const DesignParamsSchema = z.object({
  codeEdition: z.enum(['IRC-2021', 'IRC-2024']).default('IRC-2021'),
  species: LumberSpeciesEnum.default('df-l-2'),
  groundSnowPsf: z.number().min(0).max(200).default(30),
  windMph: z.number().min(85).max(200).default(115),
  exposure: z.enum(['B', 'C', 'D']).default('B'),
  seismicCategory: z.enum(['A', 'B', 'C', 'D0', 'D1', 'D2']).default('C'),
  frostDepthIn: z.number().min(0).max(96).default(36),
  soilBearingPsf: z.number().min(1000).max(6000).default(1500),
  floorLiveLoadPsf: z.number().min(20).max(150).default(40),
  floorDeadLoadPsf: z.number().min(5).max(50).default(10),
  roofLiveLoadPsf: z.number().min(10).max(60).default(20),
  roofDeadLoadPsf: z.number().min(5).max(40).default(10),
  buildingWidthFt: z.number().min(8).max(80).default(28),
  storiesAbove: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
})

export const StructuralAssemblyNode = BaseNode.extend({
  id: objectId('strasm'),
  type: nodeType('structural:assembly'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  assemblyKind: AssemblyKindEnum.default('wall-framing'),
  species: LumberSpeciesEnum.default('df-l-2'),
  studSize: StudSizeEnum.default('2x6'),
  studSpacingIn: StudSpacingInEnum.default(16),
  floorSystem: FloorSystemEnum.default('tji-ijoist'),
  joistDepthIn: z.number().min(5.5).max(24).default(11.875),
  roofSystem: RoofSystemEnum.default('stick-rafter'),
  designParams: DesignParamsSchema.default(DEFAULT_DESIGN_PARAMS),
  wallOverrides: z.record(z.string(), WallOverrideRuleSchema).default({}),
  footprintBounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([0, 0, 9.144, 7.315]),
  wallHeightM: z.number().min(1.5).max(8).default(2.7432),
  xrayOpacity: z.number().min(0).max(1).default(0.25),
})

export type StructuralAssemblyNode = z.infer<typeof StructuralAssemblyNode>

export function getStructuralAssemblyPorts(node: StructuralAssemblyNode): NodePort[] {
  const [x, y, zPos] = node.position
  return [
    { id: 'bearing-base', position: [x, y, zPos], direction: [0, -1, 0], diameter: 0.14, system: 'structural' },
    { id: 'bearing-top', position: [x, y + node.wallHeightM, zPos], direction: [0, 1, 0], diameter: 0.14, system: 'structural' },
  ]
}

export function buildStructuralAssemblyGeometry(
  node: StructuralAssemblyNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `structural-assembly-${node.id}`
  const [minX, , maxX] = node.footprintBounds
  const previewLen = Math.max(2.4384, Math.min(6.0, Math.abs(maxX - minX)))
  group.add(
    buildAssemblyPreviewCad({
      assemblyKind: node.assemblyKind as AssemblyKind,
      lengthM: previewLen,
      heightM: node.wallHeightM,
      species: node.species as LumberSpecies,
    }),
  )
  return group
}

export function buildStructuralAssemblyFloorplan(
  node: StructuralAssemblyNode,
  _ctx: GeometryContext,
): FloorplanGeometry {
  const [minX, minZ, maxX, maxZ] = node.footprintBounds
  const stroke = '#d97706'
  const children: FloorplanGeometry[] = [
    { kind: 'line', x1: minX, y1: minZ, x2: maxX, y2: minZ, stroke, strokeWidth: 0.03 },
    { kind: 'line', x1: maxX, y1: minZ, x2: maxX, y2: maxZ, stroke, strokeWidth: 0.03 },
    { kind: 'line', x1: maxX, y1: maxZ, x2: minX, y2: maxZ, stroke, strokeWidth: 0.03 },
    { kind: 'line', x1: minX, y1: maxZ, x2: minX, y2: minZ, stroke, strokeWidth: 0.03 },
  ]
  return { kind: 'group', children }
}

export const structuralAssemblyRenderDefinition: NodeDefinition<typeof StructuralAssemblyNode> = {
  kind: 'structural:assembly',
  schemaVersion: 1,
  schema: StructuralAssemblyNode,
  category: 'structure',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Structural Framing Assembly',
    position: [0, 0, 0],
    rotation: 0,
    assemblyKind: 'wall-framing',
    species: 'df-l-2',
    studSize: '2x6',
    studSpacingIn: 16,
    floorSystem: 'tji-ijoist',
    joistDepthIn: 11.875,
    roofSystem: 'stick-rafter',
    designParams: { ...DEFAULT_DESIGN_PARAMS },
    wallOverrides: {},
    footprintBounds: [0, 0, 9.144, 7.315],
    wallHeightM: 2.7432,
    xrayOpacity: 0.25,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 2] },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildStructuralAssemblyGeometry,
  geometryKey: (n) => JSON.stringify([n.assemblyKind, n.species, n.studSize, n.studSpacingIn, n.floorSystem, n.roofSystem, n.wallHeightM]),
  ports: getStructuralAssemblyPorts,
  floorplan: buildStructuralAssemblyFloorplan,
  presentation: {
    label: 'Structural Assembly',
    description: 'Per-level IRC/NDS multi-species wall, floor (dimensional/TJI/truss), and roof framing assembly.',
    icon: { kind: 'iconify', name: 'lucide:blocks' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Authoritative Priority #1 structural framing assembly with species, stud spacing, floor/roof system, and per-wall rules.',
  },
}
