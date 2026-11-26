/**
 * `structural:connector` — First-class Simpson-class metal hardware & fastener node
 * (hurricane ties, framing angles, joist/beam hangers, post bases/caps, hold-downs,
 * tension straps, seismic plate washers, and anchor bolts).
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
import { buildConnectorCad } from '../cad/connectors'
import type { ConnectorCategory } from '../irc/tables'

export const ConnectorCategoryEnum = z.enum([
  'hurricane-tie',
  'framing-angle',
  'joist-hanger',
  'beam-hanger',
  'post-base',
  'post-cap',
  'hold-down',
  'tension-strap',
  'plate-washer',
  'anchor-bolt',
])

export const StructuralConnectorNode = BaseNode.extend({
  id: objectId('strcon'),
  type: nodeType('structural:connector'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  category: ConnectorCategoryEnum.default('hurricane-tie'),
  sku: z.string().default('H2.5A'),
  quantity: z.number().int().min(1).max(500).default(1),
  fastenerSpec: z.string().default('(10) 8d x 1-1/2" nails'),
  upliftCapacityLbs: z.number().min(0).max(50000).default(600),
  downloadCapacityLbs: z.number().min(0).max(50000).default(0),
  lateralCapacityLbs: z.number().min(0).max(50000).default(110),
  attachedNodeIds: z.array(z.string()).default([]),
})

export type StructuralConnectorNode = z.infer<typeof StructuralConnectorNode>

export function getStructuralConnectorPorts(node: StructuralConnectorNode): NodePort[] {
  return [
    { id: 'mount', position: node.position, direction: [0, 1, 0], diameter: 0.05, system: 'structural' },
  ]
}

export function buildStructuralConnectorGeometry(
  node: StructuralConnectorNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `structural-connector-${node.id}`
  group.add(
    buildConnectorCad({
      sku: node.sku,
      category: node.category as ConnectorCategory,
    }),
  )
  return group
}

export function buildStructuralConnectorFloorplan(
  node: StructuralConnectorNode,
  _ctx: GeometryContext,
): FloorplanGeometry {
  const [cx, , cz] = node.position
  const r = 0.09
  const stroke = node.category === 'hold-down' ? '#7c3aed' : '#0284c7'
  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx,
      cy: cz,
      r,
      fill: stroke,
      fillOpacity: 0.25,
      stroke,
      strokeWidth: 0.02,
    },
  ]
  return { kind: 'group', children }
}

export const structuralConnectorRenderDefinition: NodeDefinition<typeof StructuralConnectorNode> = {
  kind: 'structural:connector',
  schemaVersion: 1,
  schema: StructuralConnectorNode,
  category: 'structure',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'H2.5A Hurricane Tie',
    position: [0, 2.74, 0],
    rotation: 0,
    category: 'hurricane-tie',
    sku: 'H2.5A',
    quantity: 1,
    fastenerSpec: '(10) 8d x 1-1/2" nails',
    upliftCapacityLbs: 600,
    downloadCapacityLbs: 0,
    lateralCapacityLbs: 110,
    attachedNodeIds: [],
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildStructuralConnectorGeometry,
  geometryKey: (n) => JSON.stringify([n.sku, n.category]),
  ports: getStructuralConnectorPorts,
  floorplan: buildStructuralConnectorFloorplan,
  presentation: {
    label: 'Structural Connector',
    description: 'Simpson-class hurricane ties, framing angles, hangers, post bases/caps, hold-downs, straps, and seismic plate washers.',
    icon: { kind: 'iconify', name: 'lucide:wrench' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Simpson-class galvanized steel structural connector with ASD uplift/download/lateral capacity and fastener schedule.',
  },
}
