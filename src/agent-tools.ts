/**
 * Pure Zod-only Agent Tool Contracts (`@kruschdev/pascal-plugin-structural/agent-tools`).
 * Conforms to Pascal DECISIONS.md E-016: zero Three.js, React, viewer, or editor imports.
 */

import type { PluginAgentTools } from '@pascal-app/core/agent-tools'
import { z } from 'zod'

const Vec2 = z.tuple([z.number(), z.number()])
const Vec3 = z.tuple([z.number(), z.number(), z.number()])

const SpeciesEnum = z.enum(['df-l-2', 'spf-2', 'syp-2', 'hem-fir-2'])
const StudSizeEnum = z.enum(['2x4', '2x6'])
const StudSpacingEnum = z.union([z.literal(12), z.literal(16), z.literal(24)])
const FloorSystemEnum = z.enum(['dimensional', 'tji-ijoist', 'open-web-truss'])
const RoofSystemEnum = z.enum([
  'stick-rafter',
  'fink-truss',
  'scissor-truss',
  'attic-truss',
  'ridge-beam-cathedral',
])
const ExposureEnum = z.enum(['B', 'C', 'D'])
const SeismicEnum = z.enum(['A', 'B', 'C', 'D0', 'D1', 'D2'])
const BeamFamilyEnum = z.enum([
  'dimensional-built-up',
  'lvl',
  'psl',
  'lsl',
  'glulam',
  'steel-w',
  'flitch',
])
const BeamRoleEnum = z.enum([
  'header',
  'floor-girder',
  'ridge-beam',
  'hip-beam',
  'valley-beam',
  'porch-beam',
  'transfer-beam',
])
const ColumnTypeEnum = z.enum([
  'wood-solid',
  'wood-built-up',
  'psl',
  'glulam',
  'steel-hss',
  'steel-lally',
])
const FirestopKindEnum = z.enum([
  'wall-vertical-10ft',
  'wall-horizontal-10ft',
  'soffit-drop-ceiling',
  'stair-stringer',
  'chase-chimney-shaft',
  'penetration-firestop',
  'floor-draftstop',
  'attic-draftstop',
])
const FirestopMaterialEnum = z.enum([
  '2x-lumber',
  'double-1x',
  '23/32-osb',
  '1/2-gypsum',
  'mineral-wool-batt',
  'intumescent-collar',
])

const DesignParamsSchema = z
  .object({
    codeEdition: z.enum(['IRC-2021', 'IRC-2024']).optional(),
    species: SpeciesEnum.optional(),
    groundSnowPsf: z.number().min(0).max(200).optional(),
    windMph: z.number().min(85).max(200).optional(),
    exposure: ExposureEnum.optional(),
    seismicCategory: SeismicEnum.optional(),
    frostDepthIn: z.number().min(0).max(96).optional(),
    soilBearingPsf: z.number().min(1000).max(6000).optional(),
    floorLiveLoadPsf: z.number().min(20).max(150).optional(),
    floorDeadLoadPsf: z.number().min(5).max(50).optional(),
    roofLiveLoadPsf: z.number().min(10).max(60).optional(),
    roofDeadLoadPsf: z.number().min(5).max(40).optional(),
    buildingWidthFt: z.number().min(8).max(80).optional(),
    storiesAbove: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  })
  .optional()

export const structuralAgentTools: PluginAgentTools = {
  pluginId: 'krusch:structural',
  apiVersion: 1,
  version: '0.2.0',
  instructions:
    'Structural (`krusch:structural`) holds Priority #1 right-of-way (1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical). Always establish `structural:assembly`, `structural:beam`, `structural:column`, `structural:connector`, and `structural:firestop` nodes before routing MEP runs. Engineered beams (LVL/Glulam/PSL/Flitch/Steel) and columns are strict no-bore keep-out zones for Plumbing and Electrical.',
  skills: [
    {
      name: 'irc-builder-grade-structural',
      summary:
        'Builder-grade IRC/AWC/NDS residential & light-commercial structural framing with engineered wood/steel beams, Simpson-class connectors, continuous load paths, and full IRC R302.11/R302.12 fire blocking',
      body: [
        '1. Call `structural_autopopulate_irc` to scan walls, doors, windows, slabs, roofs, stairs, and zones and generate editable `structural:assembly`, sized LVL/Glulam/PSL/built-up `structural:beam` headers & girders, `structural:column` posts with pad footings, Simpson-class `structural:connector` hardware (hurricane ties, angles, hangers, post caps/bases, hold-downs, plate washers), and complete `IRC R302.11`/`R302.12` `structural:firestop` zones.',
        '2. Use `structural_place_beam`, `structural_place_column`, `structural_place_connector`, or `structural_place_firestop` for custom engineered spans (e.g., 24F-V4 Glulam ridge beams, A992 steel W-beams, flitch beams, H10A/HGA10 hurricane ties, A35/LTP4 framing angles, or stair/soffit fire blocking).',
        '3. Run `structural_trace_load_path` and `structural_audit_irc` to confirm zero overstressed beams, intact gravity & uplift load paths, sufficient `R602.10` braced wall lines, complete fire blocking, and zero MEP beam-boring clashes.',
        '4. Run `structural_generate_schedule` to export Beam/Header, Column/Footing, Connector/Fastener, Fire-Blocking Schedules, and a priced BOM.',
      ].join('\n'),
    },
  ],
  tools: [
    {
      name: 'structural_autopopulate_irc',
      title: 'Auto-frame building per IRC/AWC/NDS',
      description:
        'Scan Pascal walls, openings, slabs, roofs, stairs, and zones to synthesize complete builder-grade IRC/NDS structural assemblies, engineered beams/girders, columns with spread footings, Simpson-class connectors, and full IRC R302.11/R302.12 fire blocking.',
      runsIn: 'operation',
      input: {
        levelId: z.string().nullable().optional(),
        studSize: StudSizeEnum.optional(),
        studSpacingIn: StudSpacingEnum.optional(),
        floorSystem: FloorSystemEnum.optional(),
        roofSystem: RoofSystemEnum.optional(),
        preferredBeamFamily: BeamFamilyEnum.optional(),
        preferredColumnType: ColumnTypeEnum.optional(),
        includeRoof: z.boolean().optional(),
        includeFoundation: z.boolean().optional(),
        includeFireblocking: z.boolean().optional(),
        clearExisting: z.boolean().optional(),
        design: DesignParamsSchema,
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'structural_place_beam',
      title: 'Place & size structural beam or header',
      description:
        'Place and auto-size a structural beam, header, floor girder, ridge beam, flitch beam, or A992 steel W-beam with ASD bending/shear/deflection verification, required jack studs, and recommended hanger SKU.',
      runsIn: 'operation',
      input: {
        levelId: z.string().nullable().optional(),
        name: z.string().optional(),
        start: Vec2,
        end: Vec2,
        elevationY: z.number().default(2.4),
        role: BeamRoleEnum.default('floor-girder'),
        preferredFamily: BeamFamilyEnum.optional(),
        mountStyle: z.enum(['flush', 'dropped']).default('flush'),
        tributaryWidthFt: z.number().min(1).max(60).default(12),
        liveLoadPsf: z.number().min(10).max(150).optional(),
        deadLoadPsf: z.number().min(5).max(50).optional(),
        snowLoadPsf: z.number().min(0).max(200).optional(),
        pointLoadLbs: z.number().min(0).max(100000).optional(),
        species: SpeciesEnum.optional(),
        storiesSupported: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        autoPlaceHangers: z.boolean().default(true),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'structural_place_column',
      title: 'Place & size structural column and footing',
      description:
        'Place and size a wood, built-up, PSL, Glulam, or steel HSS/Lally column with NDS buckling check, spread pad footing + rebar callout, squash-block flag, and matching post cap & standoff post base.',
      runsIn: 'operation',
      input: {
        levelId: z.string().nullable().optional(),
        name: z.string().optional(),
        position: Vec3,
        heightM: z.number().min(0.5).max(12).default(2.7432),
        axialLoadLbs: z.number().min(500).max(200000).default(6000),
        preferredType: ColumnTypeEnum.optional(),
        soilBearingPsf: z.number().min(1000).max(6000).default(1500),
        frostDepthIn: z.number().min(0).max(96).default(36),
        hasSquashBlocks: z.boolean().default(false),
        transfersFromNodeId: z.string().optional(),
        transfersToNodeId: z.string().optional(),
        autoPlaceBaseAndCap: z.boolean().default(true),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'structural_place_connector',
      title: 'Place Simpson-class structural connector',
      description:
        'Place a Simpson-class metal hardware connector (hurricane tie H1/H2.5A/H10A/HGA10, framing angle A35/LTP4/LS50, joist/beam hanger LUS/HUS/HHUS/IUS/MIT/LSSU/HGUS, post base/cap ABU/CB/BC/CCQ, hold-down HDU2-11/STHD14, tension strap MSTA36/CS16, or seismic BP3x3 plate washer).',
      runsIn: 'operation',
      input: {
        levelId: z.string().nullable().optional(),
        name: z.string().optional(),
        sku: z.string(),
        position: Vec3,
        rotation: z.number().default(0),
        quantity: z.number().int().min(1).max(500).default(1),
        attachedNodeIds: z.array(z.string()).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'structural_place_firestop',
      title: 'Place IRC R302.11 fire blocking or R302.12 draftstop',
      description:
        'Place an IRC R302.11 fire-blocking or IRC R302.12 draftstopping assembly (10 ft wall cavity, soffit/drop ceiling, stair stringer, mechanical chase/chimney, MEP plate penetration collar, floor-ceiling draftstop, or attic draftstop).',
      runsIn: 'operation',
      input: {
        levelId: z.string().nullable().optional(),
        name: z.string().optional(),
        firestopKind: FirestopKindEnum,
        material: FirestopMaterialEnum.optional(),
        start: Vec2,
        end: Vec2,
        elevationY: z.number().default(2.4),
        heightM: z.number().min(0.03).max(4).default(0.3),
        thicknessM: z.number().min(0.01).max(1).default(0.038),
        hostWallId: z.string().optional(),
        penetratingNodeId: z.string().optional(),
        compartmentAreaSqFt: z.number().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'structural_size_member',
      title: 'Size structural beam, floor, roof, column, or hardware',
      description:
        'Pure IRC/AWC/NDS calculator for sizing a beam/header (built-up, LVL, PSL, LSL, Glulam, Flitch, Steel W), floor system (dimensional, TJI I-joist, open-web truss), roof system (stick rafter or prefab truss), column/footing, or hurricane tie/hold-down SKU without mutating the scene.',
      runsIn: 'operation',
      input: {
        memberKind: z.enum(['beam', 'floor', 'roof', 'column', 'hurricane-tie', 'hold-down']),
        spanFt: z.number().min(1).max(80).optional(),
        tributaryWidthFt: z.number().min(1).max(60).optional(),
        role: BeamRoleEnum.optional(),
        preferredBeamFamily: BeamFamilyEnum.optional(),
        floorSystem: FloorSystemEnum.optional(),
        roofSystem: RoofSystemEnum.optional(),
        pitchRiseOver12: z.number().min(0).max(24).optional(),
        axialLoadLbs: z.number().min(100).max(200000).optional(),
        unbracedHeightFt: z.number().min(2).max(30).optional(),
        upliftDemandLbs: z.number().min(0).max(50000).optional(),
        species: SpeciesEnum.optional(),
        spacingIn: StudSpacingEnum.optional(),
        design: DesignParamsSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    {
      name: 'structural_trace_load_path',
      title: 'Trace continuous gravity & uplift load paths',
      description:
        'Analyze continuous gravity load paths (beams -> columns -> squash blocks -> spread footings), continuous wind/seismic uplift hardware paths, and IRC R602.10 braced wall lines across the scene.',
      runsIn: 'operation',
      input: {
        design: DesignParamsSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    {
      name: 'structural_audit_irc',
      title: 'Audit scene for IRC/AWC/NDS structural compliance',
      description:
        'Run a full deterministic IRC/AWC/NDS/WFCM structural code audit covering beam bending/shear/deflection, jack stud counts, footings, Simpson-class connector schedules, IRC R302.11/R302.12 fire blocking & draftstopping, load paths, braced walls, and Priority #1 MEP beam-boring clashes.',
      runsIn: 'operation',
      input: {
        design: DesignParamsSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    {
      name: 'structural_generate_schedule',
      title: 'Generate structural schedules and priced BOM',
      description:
        'Generate complete Beam & Header, Column & Footing, Connector & Fastener, Fire-Blocking & Draftstopping, Braced Wall Schedules, and a priced structural BOM (JSON, CSV, and Markdown).',
      runsIn: 'operation',
      input: {
        design: DesignParamsSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  ],
}
