/**
 * `structural:column` — First-class editable wood, built-up king-post, PSL,
 * Glulam, or steel HSS/Lally column with spread pad footing & load-path metadata.
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
import { buildColumnCad } from '../cad/assemblies'
import { type ColumnType, INCHES_TO_METERS } from '../irc/tables'

export const ColumnTypeEnum = z.enum([
  'wood-solid',
  'wood-built-up',
  'psl',
  'glulam',
  'steel-hss',
  'steel-lally',
])

export const StructuralColumnNode = BaseNode.extend({
  id: objectId('strcol'),
  type: nodeType('structural:column'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  heightM: z.number().min(0.4).max(12).default(2.7432),
  columnType: ColumnTypeEnum.default('wood-solid'),
  designation: z.string().default('6x6 DF-L #2 Post'),
  widthIn: z.number().min(3.0).max(12).default(5.5),
  depthIn: z.number().min(3.0).max(12).default(5.5),
  axialLoadLbs: z.number().min(0).max(200000).default(6000),
  transfersFromNodeId: z.string().optional(),
  transfersToNodeId: z.string().optional(),
  hasSquashBlocks: z.boolean().default(false),
  footingWidthIn: z.number().min(0).max(96).default(24),
  footingDepthIn: z.number().min(0).max(48).default(12),
  footingRebar: z.string().default('(4) #4 EW @ bottom (3" clear cover)'),
})

export type StructuralColumnNode = z.infer<typeof StructuralColumnNode>

export function getStructuralColumnPorts(node: StructuralColumnNode): NodePort[] {
  const [x, y, zPos] = node.position
  const wM = node.widthIn * INCHES_TO_METERS
  return [
    { id: 'base', position: [x, y, zPos], direction: [0, -1, 0], diameter: wM, system: 'structural' },
    { id: 'cap', position: [x, y + node.heightM, zPos], direction: [0, 1, 0], diameter: wM, system: 'structural' },
  ]
}

export function buildStructuralColumnGeometry(
  node: StructuralColumnNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `structural-column-${node.id}`
  group.add(
    buildColumnCad({
      columnType: node.columnType as ColumnType,
      widthIn: node.widthIn,
      depthIn: node.depthIn,
      heightM: node.heightM,
      includeFooting: node.footingWidthIn >= 18,
      footingWidthM: node.footingWidthIn * INCHES_TO_METERS,
      footingThicknessM: Math.max(0.2, node.footingDepthIn * INCHES_TO_METERS),
      includeBaseHardware: true,
      includeCapHardware: true,
    }),
  )
  return group
}

export function buildStructuralColumnFloorplan(
  node: StructuralColumnNode,
  _ctx: GeometryContext,
): FloorplanGeometry {
  const [cx, , cz] = node.position
  const half = Math.max(0.08, (node.widthIn * INCHES_TO_METERS) / 2)
  const stroke = node.columnType.startsWith('steel') ? '#dc2626' : '#b45309'
  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: cx - half,
      y: cz - half,
      width: half * 2,
      height: half * 2,
      fill: stroke,
      fillOpacity: 0.25,
      stroke,
      strokeWidth: 0.025,
    },
    { kind: 'line', x1: cx - half, y1: cz - half, x2: cx + half, y2: cz + half, stroke, strokeWidth: 0.02 },
    { kind: 'line', x1: cx + half, y1: cz - half, x2: cx - half, y2: cz + half, stroke, strokeWidth: 0.02 },
  ]
  return { kind: 'group', children }
}

export const structuralColumnRenderDefinition: NodeDefinition<typeof StructuralColumnNode> = {
  kind: 'structural:column',
  schemaVersion: 1,
  schema: StructuralColumnNode,
  category: 'structure',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: '6x6 DF-L #2 Post',
    position: [0, 0, 0],
    rotation: 0,
    heightM: 2.7432,
    columnType: 'wood-solid',
    designation: '6x6 DF-L #2 Post',
    widthIn: 5.5,
    depthIn: 5.5,
    axialLoadLbs: 6000,
    hasSquashBlocks: false,
    footingWidthIn: 24,
    footingDepthIn: 12,
    footingRebar: '(4) #4 EW @ bottom (3" clear cover)',
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 2] },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildStructuralColumnGeometry,
  geometryKey: (n) => JSON.stringify([n.columnType, n.widthIn, n.depthIn, n.heightM, n.footingWidthIn, n.footingDepthIn]),
  ports: getStructuralColumnPorts,
  floorplan: buildStructuralColumnFloorplan,
  presentation: {
    label: 'Structural Column / Post',
    description: 'Solid wood, built-up, PSL, Glulam, or steel HSS/Lally column with NDS buckling check and spread pad footing.',
    icon: { kind: 'iconify', name: 'lucide:square' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Priority #1 structural column/post with continuous gravity load-path tracking and spread footing callout.',
  },
}
