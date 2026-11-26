/**
 * `structural:firestop` — First-class IRC R302.11 Fire Blocking & IRC R302.12 Draftstopping node
 * covering 10 ft walls, soffits/drop ceilings, stair stringers, chases/chimneys,
 * MEP plate penetration collars, and floor/attic draftstopping compartments.
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
import { buildFirestopCad } from '../cad/assemblies'
import type { FirestopKind, FirestopMaterial } from '../irc/tables'

export const FirestopKindEnum = z.enum([
  'wall-vertical-10ft',
  'wall-horizontal-10ft',
  'soffit-drop-ceiling',
  'stair-stringer',
  'chase-chimney-shaft',
  'penetration-firestop',
  'floor-draftstop',
  'attic-draftstop',
])

export const FirestopMaterialEnum = z.enum([
  '2x-lumber',
  'double-1x',
  '23/32-osb',
  '1/2-gypsum',
  'mineral-wool-batt',
  'intumescent-collar',
])

export const StructuralFirestopNode = BaseNode.extend({
  id: objectId('strfs'),
  type: nodeType('structural:firestop'),
  start: z.tuple([z.number(), z.number()]).default([0, 0]),
  end: z.tuple([z.number(), z.number()]).default([2.4384, 0]),
  elevationY: z.number().default(2.4),
  heightM: z.number().min(0.03).max(4).default(0.3),
  thicknessM: z.number().min(0.01).max(1).default(0.089),
  firestopKind: FirestopKindEnum.default('wall-vertical-10ft'),
  material: FirestopMaterialEnum.default('2x-lumber'),
  codeRef: z.string().default('IRC R302.11(2)'),
  hostWallId: z.string().optional(),
  penetratingNodeId: z.string().optional(),
  compartmentAreaSqFt: z.number().optional(),
})

export type StructuralFirestopNode = z.infer<typeof StructuralFirestopNode>

export function getStructuralFirestopPorts(node: StructuralFirestopNode): NodePort[] {
  const [sx, sz] = node.start
  const [ex, ez] = node.end
  return [
    {
      id: 'center',
      position: [(sx + ex) / 2, node.elevationY, (sz + ez) / 2],
      direction: [0, 1, 0],
      diameter: node.thicknessM,
      system: 'structural',
    },
  ]
}

export function buildStructuralFirestopGeometry(
  node: StructuralFirestopNode,
  _ctx: GeometryContext,
): Group {
  const group = new Group()
  group.name = `structural-firestop-${node.id}`
  const [sx, sz] = node.start
  const [ex, ez] = node.end
  const dx = ex - sx
  const dz = ez - sz
  const lenM = Math.max(0.15, Math.hypot(dx, dz))
  const yaw = Math.atan2(-dz, dx)

  const mesh = buildFirestopCad({
    firestopKind: node.firestopKind as FirestopKind,
    material: node.material as FirestopMaterial,
    widthM: lenM,
    heightM: node.heightM,
    depthM: node.thicknessM,
    mode: 'live',
  })
  mesh.position.set((sx + ex) / 2, node.elevationY, (sz + ez) / 2)
  mesh.rotation.y = yaw
  group.add(mesh)
  return group
}

export function buildStructuralFirestopFloorplan(
  node: StructuralFirestopNode,
  _ctx: GeometryContext,
): FloorplanGeometry {
  const [sx, sz] = node.start
  const [ex, ez] = node.end
  const stroke = node.firestopKind === 'penetration-firestop' ? '#ef4444' : '#f97316'
  const children: FloorplanGeometry[] = [
    { kind: 'line', x1: sx, y1: sz, x2: ex, y2: ez, stroke, strokeWidth: 0.04 },
  ]
  return { kind: 'group', children }
}

export const structuralFirestopRenderDefinition: NodeDefinition<typeof StructuralFirestopNode> = {
  kind: 'structural:firestop',
  schemaVersion: 1,
  schema: StructuralFirestopNode,
  category: 'structure',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'IRC R302.11 Fire Blocking',
    start: [0, 0],
    end: [2.4384, 0],
    elevationY: 2.4,
    heightM: 0.3,
    thicknessM: 0.089,
    firestopKind: 'wall-vertical-10ft',
    material: '2x-lumber',
    codeRef: 'IRC R302.11(2)',
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    duplicable: true,
    deletable: true,
    snappable: {},
  },
  geometry: buildStructuralFirestopGeometry,
  geometryKey: (n) =>
    JSON.stringify([n.start, n.end, n.elevationY, n.heightM, n.firestopKind, n.material, n.thicknessM]),
  ports: getStructuralFirestopPorts,
  floorplan: buildStructuralFirestopFloorplan,
  presentation: {
    label: 'Fire Blocking / Draftstop',
    description: 'IRC R302.11 fire blocking (10ft walls, soffits, stair stringers, chases, MEP collars) and R302.12 draftstopping.',
    icon: { kind: 'iconify', name: 'lucide:flame' },
    paletteSection: 'structure',
  },
  mcp: {
    description: 'Code-required IRC R302.11 fire-blocking or R302.12 draftstopping plane coordinated with MEP plate penetrations.',
  },
}
