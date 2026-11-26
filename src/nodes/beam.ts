/**
 * `structural:beam` — First-class editable structural beam, header, floor girder,
 * ridge beam, flitch beam, or A992 steel W-beam node.
 *
 * Acts as a Priority #1 no-bore structural keep-out for Plumbing, HVAC, and Electrical.
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
import { buildBeamCad } from '../cad/beams'
import { type BeamMaterialFamily, INCHES_TO_METERS, type LumberSpecies } from '../irc/tables'

export const BeamRoleEnum = z.enum([
  'header',
  'floor-girder',
  'ridge-beam',
  'hip-beam',
  'valley-beam',
  'porch-beam',
  'transfer-beam',
])

export const BeamMaterialFamilyEnum = z.enum([
  'dimensional-built-up',
  'lvl',
  'psl',
  'lsl',
  'glulam',
  'steel-w',
  'flitch',
])

export const StructuralBeamNode = BaseNode.extend({
  id: objectId('strbm'),
  type: nodeType('structural:beam'),
  start: z.tuple([z.number(), z.number()]).default([0, 0]),
  end: z.tuple([z.number(), z.number()]).default([3.6576, 0]),
  elevationY: z.number().default(2.4),
  role: BeamRoleEnum.default('floor-girder'),
  beamType: BeamMaterialFamilyEnum.default('lvl'),
  designation: z.string().default('(2) 1-3/4"x11-7/8" 2.0E LVL'),
  plyCount: z.number().int().min(1).max(4).default(2),
  widthIn: z.number().min(1.5).max(12).default(3.5),
  depthIn: z.number().min(3.5).max(28).default(11.875),
  species: z.enum(['df-l-2', 'spf-2', 'syp-2', 'hem-fir-2']).default('df-l-2'),
  mountStyle: z.enum(['flush', 'dropped']).default('flush'),
  tributaryWidthFt: z.number().min(1).max(60).default(12),
  liveLoadPsf: z.number().min(10).max(150).default(40),
  deadLoadPsf: z.number().min(5).max(50).default(10),
  snowLoadPsf: z.number().min(0).max(200).default(30),
  bearingLengthIn: z.number().min(1.5).max(12).default(3.0),
  jackStudsEachEnd: z.number().int().min(1).max(4).default(2),
  endReactionLbs: z.number().min(0).max(100000).default(2400),
  hostWallId: z.string().optional(),
  openingId: z.string().optional(),
})

export type StructuralBeamNode = z.infer<typeof StructuralBeamNode>

export function getStructuralBeamPorts(node: StructuralBeamNode): NodePort[] {
  const [sx, sz] = node.start
  const [ex, ez] = node.end
  const y = node.elevationY
  const wM = node.widthIn * INCHES_TO_METERS
  return [
    { id: 'bearing-start', position: [sx, y, sz], direction: [0, -1, 0], diameter: wM, system: 'structural' },
    { id: 'bearing-end', position: [ex, y, ez], direction: [0, -1, 0], diameter: wM, system: 'structural' },
  ]
}

export function buildStructuralBeamGeometry(
  node: StructuralBeamNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `structural-beam-${node.id}`
  const [sx, sz] = node.start
  const [ex, ez] = node.end
  const dx = ex - sx
  const dz = ez - sz
  const lenM = Math.max(0.3, Math.hypot(dx, dz))
  const yaw = Math.atan2(-dz, dx)

  const beamMesh = buildBeamCad({
    family: node.beamType as BeamMaterialFamily,
    lengthM: lenM,
    widthIn: node.widthIn,
    depthIn: node.depthIn,
    plyCount: node.plyCount,
    species: node.species as LumberSpecies,
  })
  beamMesh.position.set((sx + ex) / 2, node.elevationY, (sz + ez) / 2)
  beamMesh.rotation.y = yaw
  group.add(beamMesh)
  return group
}

export function buildStructuralBeamFloorplan(
  node: StructuralBeamNode,
  _ctx: GeometryContext,
): FloorplanGeometry {
  const [sx, sz] = node.start
  const [ex, ez] = node.end
  const stroke =
    node.beamType === 'steel-w' || node.beamType === 'flitch'
      ? '#dc2626'
      : node.beamType === 'glulam'
        ? '#b45309'
        : '#d97706'
  const wM = Math.max(0.06, node.widthIn * INCHES_TO_METERS)
  const children: FloorplanGeometry[] = [
    { kind: 'line', x1: sx, y1: sz, x2: ex, y2: ez, stroke, strokeWidth: wM },
  ]
  return { kind: 'group', children }
}

export const structuralBeamRenderDefinition: NodeDefinition<typeof StructuralBeamNode> = {
  kind: 'structural:beam',
  schemaVersion: 1,
  schema: StructuralBeamNode,
  category: 'structure',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: '(2) 1-3/4"x11-7/8" 2.0E LVL Girder',
    start: [0, 0],
    end: [3.6576, 0],
    elevationY: 2.4,
    role: 'floor-girder',
    beamType: 'lvl',
    designation: '(2) 1-3/4"x11-7/8" 2.0E LVL',
    plyCount: 2,
    widthIn: 3.5,
    depthIn: 11.875,
    species: 'df-l-2',
    mountStyle: 'flush',
    tributaryWidthFt: 12,
    liveLoadPsf: 40,
    deadLoadPsf: 10,
    snowLoadPsf: 30,
    bearingLengthIn: 3.0,
    jackStudsEachEnd: 2,
    endReactionLbs: 2400,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildStructuralBeamGeometry,
  geometryKey: (n) => JSON.stringify([n.start, n.end, n.elevationY, n.beamType, n.widthIn, n.depthIn, n.plyCount, n.species]),
  ports: getStructuralBeamPorts,
  floorplan: buildStructuralBeamFloorplan,
  presentation: {
    label: 'Structural Beam / Header',
    description: 'Engineered LVL, Glulam, PSL, LSL, built-up dimensional, Flitch, or A992 steel W-beam with ASD sizing.',
    icon: { kind: 'iconify', name: 'lucide:minus' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Priority #1 structural beam/header/girder/ridge beam (no-bore keep-out for Plumbing & Electrical).',
  },
}
