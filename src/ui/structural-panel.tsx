'use client'

/**
 * Left-rail EditorHostPanel for `krusch:structural`.
 * Uses scoped inline styles and Pascal CSS variables so zero global CSS leaks.
 */

import { type AnyNode, runAsSingleSceneHistoryStep } from '@pascal-app/core'
import { openEditorView, useScene, useViewer } from '@pascal-app/editor'
import { useEffect, useMemo, useState } from 'react'
import { structuralAgentOperations } from '../agent-operations'
import { auditStructuralScene } from '../irc/audit'
import { computeLevelBounds, extractWallOpenings } from '../irc/openings'
import {
  type BeamMaterialFamily,
  type ColumnType,
  type ExposureCategory,
  type FirestopKind,
  type FloorSystemKind,
  type LumberSpecies,
  type RoofSystemKind,
  type SceneNodeLike,
  type SeismicCategory,
  type StructuralDesignParams,
  type StudSpacingIn,
  belongsToLevel,
  isLowestWalledLevelInBuilding,
} from '../irc/tables'
import {
  type StructuralLayerKey,
  type StructuralScheduleTab,
  type UiStudSize,
  computeSceneIdentityKey,
  useStructuralUi,
} from './store'

export { belongsToLevel }
export const STRUCTURAL_SCHEDULE_VIEW_ID = 'krusch:structural:schedule'

const ASSEMBLY_LAYER_KEYS: ReadonlySet<StructuralLayerKey> = new Set([
  'walls',
  'floor',
  'roof',
  'beams',
  'foundation',
  'connectors',
  'firestop',
])

export function activeLevelOf(
  nodes: Readonly<Record<string, AnyNode>>,
  selectedLevelId: string | null,
): string | null {
  if (selectedLevelId && nodes[selectedLevelId]?.type === 'level') return selectedLevelId
  for (const n of Object.values(nodes)) {
    if (n.type === 'level') return n.id
  }
  return null
}

function layerForNodeType(type: string): StructuralLayerKey | null {
  if (type === 'structural:beam') return 'beams'
  if (type === 'structural:column') return 'columns'
  if (type === 'structural:connector') return 'connectors'
  if (type === 'structural:firestop') return 'firestop'
  return null
}

export function toPascalNode(
  node: SceneNodeLike,
  fallbackLevelId: string | null,
  hiddenLayers?: Readonly<Record<StructuralLayerKey, boolean>>,
): AnyNode {
  const layer = layerForNodeType(node.type)
  const visible = layer && hiddenLayers ? !hiddenLayers[layer] : true
  const extra: Record<string, unknown> = {}
  if (node.type === 'structural:assembly' && hiddenLayers) {
    extra.visibleSystems = {
      walls: !hiddenLayers.walls,
      floor: !hiddenLayers.floor,
      roof: !hiddenLayers.roof,
      beams: !hiddenLayers.beams,
      columns: !hiddenLayers.columns,
      connectors: !hiddenLayers.connectors,
      firestop: !hiddenLayers.firestop,
      foundation: !hiddenLayers.foundation,
    }
  }
  return {
    object: 'node',
    metadata: {},
    ...node,
    ...extra,
    visible,
    parentId: node.parentId ?? fallbackLevelId,
  } as unknown as AnyNode
}

const QUICK_BEAMS: ReadonlyArray<{ family: BeamMaterialFamily; label: string }> = [
  { family: 'lvl', label: 'LVL' },
  { family: 'glulam', label: 'Glulam' },
  { family: 'psl', label: 'PSL' },
  { family: 'flitch', label: 'Flitch' },
  { family: 'steel-w', label: 'Steel W' },
]

const QUICK_COLUMNS: ReadonlyArray<{ type: ColumnType; label: string }> = [
  { type: 'wood-solid', label: '6x6 Post' },
  { type: 'psl', label: 'PSL Col' },
  { type: 'steel-hss', label: 'Steel HSS' },
]

const QUICK_CONNECTORS: ReadonlyArray<{ sku: string; title: string }> = [
  { sku: 'H2.5A', title: 'H2.5A Hurricane Tie (600 lb)' },
  { sku: 'H10A', title: 'H10A High-Uplift Tie (1,340 lb)' },
  { sku: 'HGA10', title: 'HGA10 Gusset Angle (3,055 lb)' },
  { sku: 'A35', title: 'A35 Framing Angle' },
  { sku: 'LTP4', title: 'LTP4 Lateral Tie Plate' },
  { sku: 'HHUS410', title: 'HHUS410 3.5" LVL/Glulam Hanger' },
  { sku: 'ABU66Z', title: 'ABU66Z 6x6 Standoff Post Base' },
  { sku: 'CCQ66', title: 'CCQ66 Heavy SDS Post Cap' },
  { sku: 'HDU5-SDS2.5', title: 'HDU5-SDS2.5 Hold-Down (5,645 lb)' },
  { sku: 'BP3x3', title: 'BP3x3 Seismic Plate Washer' },
]

const QUICK_FIRESTOPS: ReadonlyArray<{ kind: FirestopKind; label: string; title: string }> = [
  { kind: 'soffit-drop-ceiling', label: 'R302.11(1) Soffit', title: 'Soffit / Drop-Ceiling Fire Blocking' },
  { kind: 'wall-vertical-10ft', label: 'R302.11(2) 10ft Wall', title: 'Concealed Stud Cavity 10 ft Horizontal Fire Blocking' },
  { kind: 'stair-stringer', label: 'R302.11(3) Stair', title: 'Stair Stringer Top/Bottom Fire Blocking' },
  { kind: 'chase-chimney-shaft', label: 'R302.11(4) Chase', title: 'Mechanical Chase / Shaft / Chimney Fire Blocking' },
  { kind: 'penetration-firestop', label: 'R302.11(5) Collar', title: 'MEP Plate Penetration Intumescent Collar' },
  { kind: 'floor-draftstop', label: 'R302.12 Draftstop', title: 'Floor-Ceiling 1,000 sq ft Draftstopping' },
]

const LAYER_TOGGLES: ReadonlyArray<{ key: StructuralLayerKey; label: string; color: string }> = [
  { key: 'beams', label: 'Beams', color: '#f59e0b' },
  { key: 'columns', label: 'Columns', color: '#a855f7' },
  { key: 'connectors', label: 'Hardware', color: '#38bdf8' },
  { key: 'firestop', label: 'Firestop', color: '#ef4444' },
  { key: 'walls', label: 'Walls', color: '#d97706' },
  { key: 'floor', label: 'Floor', color: '#10b981' },
  { key: 'roof', label: 'Roof', color: '#6366f1' },
  { key: 'foundation', label: 'Footings', color: '#94a3b8' },
]

export default function StructuralHostPanel() {
  const nodes = useScene((s) => s.nodes)
  const createNodes = useScene((s) => s.createNodes)
  const deleteNodes = useScene((s) => s.deleteNodes)
  const updateNodes = useScene((s) => s.updateNodes)
  const selectedLevelId = useViewer((s) => s.selection.levelId)
  const viewerWallMode = useViewer((s) => (s as unknown as { wallMode?: string }).wallMode)

  const codeEdition = useStructuralUi((s) => s.codeEdition)
  const species = useStructuralUi((s) => s.species)
  const studSize = useStructuralUi((s) => s.studSize)
  const studSpacingIn = useStructuralUi((s) => s.studSpacingIn)
  const floorSystem = useStructuralUi((s) => s.floorSystem)
  const roofSystem = useStructuralUi((s) => s.roofSystem)
  const groundSnowPsf = useStructuralUi((s) => s.groundSnowPsf)
  const windMph = useStructuralUi((s) => s.windMph)
  const exposure = useStructuralUi((s) => s.exposure)
  const seismicCategory = useStructuralUi((s) => s.seismicCategory)
  const frostDepthIn = useStructuralUi((s) => s.frostDepthIn)
  const soilBearingPsf = useStructuralUi((s) => s.soilBearingPsf)
  const editedDesignParams = useStructuralUi((s) => s.editedDesignParams)
  const preferredBeamFamily = useStructuralUi((s) => s.preferredBeamFamily)
  const preferredColumnType = useStructuralUi((s) => s.preferredColumnType)
  const xrayActive = useStructuralUi((s) => s.xrayActive)
  const wallModeBeforeXray = useStructuralUi((s) => s.wallModeBeforeXray)
  const xrayHiddenNodeIds = useStructuralUi((s) => s.xrayHiddenNodeIds)
  const lastSceneKey = useStructuralUi((s) => s.lastSceneKey)
  const hiddenLayers = useStructuralUi((s) => s.hiddenLayers)
  const setSpecies = useStructuralUi((s) => s.setSpecies)
  const setStudSize = useStructuralUi((s) => s.setStudSize)
  const setStudSpacingIn = useStructuralUi((s) => s.setStudSpacingIn)
  const setFloorSystem = useStructuralUi((s) => s.setFloorSystem)
  const setRoofSystem = useStructuralUi((s) => s.setRoofSystem)
  const setGroundSnowPsf = useStructuralUi((s) => s.setGroundSnowPsf)
  const setWindMph = useStructuralUi((s) => s.setWindMph)
  const setExposure = useStructuralUi((s) => s.setExposure)
  const setSeismicCategory = useStructuralUi((s) => s.setSeismicCategory)
  const setPreferredBeamFamily = useStructuralUi((s) => s.setPreferredBeamFamily)
  const setPreferredColumnType = useStructuralUi((s) => s.setPreferredColumnType)
  const setActiveTab = useStructuralUi((s) => s.setActiveTab)
  const setXrayActive = useStructuralUi((s) => s.setXrayActive)
  const setWallModeBeforeXray = useStructuralUi((s) => s.setWallModeBeforeXray)
  const setXrayHiddenNodeIds = useStructuralUi((s) => s.setXrayHiddenNodeIds)
  const syncSceneKey = useStructuralUi((s) => s.syncSceneKey)
  const toggleLayerVisibility = useStructuralUi((s) => s.toggleLayerVisibility)

  const record = nodes as unknown as Readonly<Record<string, SceneNodeLike>>
  const sceneKey = useMemo(() => computeSceneIdentityKey(record), [record])
  useEffect(() => {
    if (sceneKey) syncSceneKey(sceneKey)
  }, [sceneKey, syncSceneKey])

  const isSameScene = !lastSceneKey || !sceneKey || lastSceneKey === sceneKey
  const effectiveEditedDesignParams = useMemo(
    () => (isSameScene ? editedDesignParams : {}),
    [isSameScene, editedDesignParams],
  )
  const effectiveXrayHiddenIds = useMemo(
    () => (isSameScene ? xrayHiddenNodeIds : []),
    [isSameScene, xrayHiddenNodeIds],
  )

  const isXrayActive = typeof viewerWallMode === 'string' ? viewerWallMode === 'down' : xrayActive

  const applyXrayMode = (enable: boolean) => {
    const viewerState = useViewer.getState() as unknown as {
      wallMode?: string
      setWallMode?: (mode: string) => void
    }
    const latestRecord = useScene.getState().nodes as unknown as Readonly<Record<string, SceneNodeLike>>
    if (enable) {
      if (viewerState.setWallMode && viewerState.wallMode !== 'down') {
        setWallModeBeforeXray(viewerState.wallMode ?? 'up')
        viewerState.setWallMode('down')
      }
      // VIS-V3-08: Hide architectural roof/roof-segment/ceiling shells so roof framing skeleton is clearly visible
      const newlyHiddenIds: string[] = []
      const updates: Array<{ id: string; data: Record<string, unknown> }> = []
      for (const n of Object.values(latestRecord)) {
        if ((n.type === 'roof' || n.type === 'roof-segment' || n.type === 'ceiling') && n.visible !== false) {
          newlyHiddenIds.push(n.id)
          updates.push({ id: n.id, data: { visible: false } })
        }
      }
      const prevIds = useStructuralUi.getState().xrayHiddenNodeIds.filter((id) => id in latestRecord)
      const mergedIds = Array.from(new Set([...prevIds, ...newlyHiddenIds]))
      // Register hidden IDs BEFORE mutating scene visibility so StructuralAssemblyRenderer preserves roof framing
      setXrayHiddenNodeIds(mergedIds)
      if (updates.length > 0) {
        runAsSingleSceneHistoryStep(useScene, () => {
          updateNodes(updates as never)
        })
      }
      setXrayActive(true)
    } else {
      if (viewerState.setWallMode && viewerState.wallMode === 'down') {
        viewerState.setWallMode(wallModeBeforeXray && wallModeBeforeXray !== 'down' ? wallModeBeforeXray : 'up')
      }
      const trackedRestoreIds = useStructuralUi.getState().xrayHiddenNodeIds.filter((id) => id in latestRecord)
      const restoreIds =
        trackedRestoreIds.length > 0
          ? trackedRestoreIds
          : Object.values(latestRecord)
              .filter(
                (n) =>
                  (n.type === 'roof' || n.type === 'roof-segment' || n.type === 'ceiling') &&
                  n.visible === false,
              )
              .map((n) => n.id)
      if (restoreIds.length > 0) {
        const restoreUpdates = restoreIds.map((id) => ({ id, data: { visible: true } }))
        runAsSingleSceneHistoryStep(useScene, () => {
          updateNodes(restoreUpdates as never)
        })
      }
      setXrayHiddenNodeIds([])
      setXrayActive(false)
    }
  }

  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [placeIdx, setPlaceIdx] = useState(0)
  const [snowDraft, setSnowDraft] = useState(String(groundSnowPsf))
  const [windDraft, setWindDraft] = useState(String(windMph))

  useEffect(() => setSnowDraft(String(groundSnowPsf)), [groundSnowPsf])
  useEffect(() => setWindDraft(String(windMph)), [windMph])

  const commitSnowDraft = (rawVal: string) => {
    const parsed = Number(rawVal)
    if (rawVal.trim() !== '' && Number.isFinite(parsed)) {
      const clamped = Math.max(0, Math.min(200, parsed))
      setGroundSnowPsf(clamped)
      setSnowDraft(String(clamped))
    } else {
      setSnowDraft(String(groundSnowPsf))
    }
  }

  const commitWindDraft = (rawVal: string) => {
    const parsed = Number(rawVal)
    if (rawVal.trim() !== '' && Number.isFinite(parsed)) {
      const clamped = Math.max(85, Math.min(200, parsed))
      setWindMph(clamped)
      setWindDraft(String(clamped))
    } else {
      setWindDraft(String(windMph))
    }
  }

  const levelId = activeLevelOf(nodes, selectedLevelId)
  const designOverride = useMemo(
    () => (Object.keys(effectiveEditedDesignParams).length > 0 ? effectiveEditedDesignParams : undefined),
    [effectiveEditedDesignParams],
  )
  const auditRecord = useMemo(() => {
    if (effectiveXrayHiddenIds.length === 0) return record
    let cloned: Record<string, SceneNodeLike> | null = null
    for (const id of effectiveXrayHiddenIds) {
      const n = record[id]
      if (n && n.visible === false) {
        if (!cloned) cloned = { ...record }
        cloned[id] = { ...n, visible: true }
      }
    }
    return cloned ?? record
  }, [record, effectiveXrayHiddenIds])
  const autoFrameDesign = useMemo(() => {
    const firstAssembly = Object.values(record).find((n) => n.type === 'structural:assembly')
    const persisted = (firstAssembly?.designParams as Partial<StructuralDesignParams> | undefined) ?? {}
    return {
      codeEdition,
      species,
      groundSnowPsf,
      windMph,
      exposure,
      seismicCategory,
      frostDepthIn,
      soilBearingPsf,
      ...persisted,
      ...effectiveEditedDesignParams,
    }
  }, [
    record,
    codeEdition,
    species,
    groundSnowPsf,
    windMph,
    exposure,
    seismicCategory,
    frostDepthIn,
    soilBearingPsf,
    effectiveEditedDesignParams,
  ])
  const audit = useMemo(() => auditStructuralScene(auditRecord, designOverride), [auditRecord, designOverride])

  const counts = useMemo(() => {
    let beams = 0
    let columns = 0
    let connectors = 0
    let firestops = 0
    for (const n of Object.values(record)) {
      if (n.type === 'structural:beam') beams += 1
      else if (n.type === 'structural:column') columns += 1
      else if (n.type === 'structural:connector') connectors += Math.max(1, Number(n.quantity ?? 1))
      else if (n.type === 'structural:firestop') firestops += 1
    }
    return { beams, columns, connectors, firestops }
  }, [record])

  const commitCreatedNodes = (created: ReadonlyArray<SceneNodeLike>, clearExistingStructural = false) => {
    const existingIds = clearExistingStructural
      ? Object.values(record)
          .filter((n) => n.type.startsWith('structural:') && belongsToLevel(record, n, levelId))
          .map((n) => n.id)
      : []
    const ops = created.map((n) => ({
      node: toPascalNode(n, levelId, hiddenLayers),
      parentId: (n.parentId ?? levelId ?? undefined) as never,
    }))
    runAsSingleSceneHistoryStep(useScene, () => {
      if (existingIds.length > 0) {
        deleteNodes(existingIds as never)
      }
      if (ops.length > 0) {
        createNodes(ops as never)
      }
    })
  }

  const runAutoFrame = () => {
    if (!levelId) {
      setStatusMsg('Create a building level first before auto-framing.')
      return
    }
    const outcome = structuralAgentOperations.structural_autopopulate_irc(auditRecord, {
      levelId,
      studSize: studSize === 'auto' ? undefined : studSize,
      studSpacingIn,
      floorSystem,
      roofSystem,
      preferredBeamFamily,
      preferredColumnType,
      includeFoundation: isLowestWalledLevelInBuilding(auditRecord, levelId),
      includeFireblocking: true,
      design: autoFrameDesign,
    })
    commitCreatedNodes(outcome.createdNodes ?? [], true)
    applyXrayMode(true)
    setStatusMsg(outcome.text)
  }

  const clearStructural = () => {
    const ids = Object.values(record)
      .filter((n) => n.type.startsWith('structural:') && belongsToLevel(record, n, levelId))
      .map((n) => n.id)
    if (ids.length === 0) return
    runAsSingleSceneHistoryStep(useScene, () => {
      deleteNodes(ids as never)
    })
    applyXrayMode(false)
    setStatusMsg(`Cleared ${ids.length} structural node(s)${levelId ? ' on active level' : ''}.`)
  }

  const toggleLayer = (layer: StructuralLayerKey) => {
    const willHide = !hiddenLayers[layer]
    toggleLayerVisibility(layer)
    const updates: Array<{ id: string; data: Record<string, unknown> }> = []
    for (const n of Object.values(record)) {
      if (layer === 'beams' && n.type === 'structural:beam') {
        updates.push({ id: n.id, data: { visible: !willHide } })
      } else if (layer === 'columns' && n.type === 'structural:column') {
        updates.push({ id: n.id, data: { visible: !willHide } })
      } else if (layer === 'connectors' && n.type === 'structural:connector') {
        updates.push({ id: n.id, data: { visible: !willHide } })
      } else if (layer === 'firestop' && n.type === 'structural:firestop') {
        updates.push({ id: n.id, data: { visible: !willHide } })
      } else if (n.type === 'structural:assembly' && ASSEMBLY_LAYER_KEYS.has(layer)) {
        const prevVis = (n.visibleSystems as Record<string, boolean> | undefined) ?? {}
        updates.push({
          id: n.id,
          data: { visibleSystems: { ...prevVis, [layer]: !willHide } },
        })
      }
    }
    if (updates.length > 0) {
      runAsSingleSceneHistoryStep(useScene, () => {
        updateNodes(updates as never)
      })
    }
  }

  const quickPlaceBeam = (family: BeamMaterialFamily) => {
    if (!levelId) {
      setStatusMsg('Create a building level first before placing beams.')
      return
    }
    const b = computeLevelBounds(record, levelId)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const halfSpan = Math.max(1.5, Math.min(2.4, (b.maxX - b.minX) * 0.35))
    const offset = ((placeIdx % 5) - 2) * 0.45
    setPlaceIdx((i) => i + 1)
    setPreferredBeamFamily(family)
    const outcome = structuralAgentOperations.structural_place_beam(record, {
      levelId,
      start: [Number((cx - halfSpan).toFixed(2)), Number((cz + offset).toFixed(2))],
      end: [Number((cx + halfSpan).toFixed(2)), Number((cz + offset).toFixed(2))],
      elevationY: Number(Math.max(2.1, b.avgWallHeightM - 0.18).toFixed(2)),
      role: 'floor-girder',
      preferredFamily: family,
      species,
      snowLoadPsf: groundSnowPsf,
      autoPlaceHangers: true,
    })
    commitCreatedNodes(outcome.createdNodes ?? [], false)
    setStatusMsg(outcome.text)
  }

  const quickPlaceColumn = (columnType: ColumnType) => {
    if (!levelId) {
      setStatusMsg('Create a building level first before placing columns.')
      return
    }
    const b = computeLevelBounds(record, levelId)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const offset = ((placeIdx % 5) - 2) * 0.5
    setPlaceIdx((i) => i + 1)
    setPreferredColumnType(columnType)
    const outcome = structuralAgentOperations.structural_place_column(record, {
      levelId,
      position: [Number((cx + offset).toFixed(2)), 0, Number((cz + offset).toFixed(2))],
      heightM: Number(b.avgWallHeightM.toFixed(3)),
      axialLoadLbs: columnType === 'steel-hss' ? 24000 : columnType === 'psl' ? 16000 : 10000,
      preferredType: columnType,
      soilBearingPsf,
      frostDepthIn,
      hasSquashBlocks: floorSystem === 'tji-ijoist',
      autoPlaceBaseAndCap: true,
    })
    commitCreatedNodes(outcome.createdNodes ?? [], false)
    setStatusMsg(outcome.text)
  }

  const quickPlaceConnector = (sku: string) => {
    if (!levelId) {
      setStatusMsg('Create a building level first before placing connectors.')
      return
    }
    const b = computeLevelBounds(record, levelId)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const offset = ((placeIdx % 7) - 3) * 0.3
    setPlaceIdx((i) => i + 1)
    const outcome = structuralAgentOperations.structural_place_connector(record, {
      levelId,
      sku,
      position: [Number((cx + offset).toFixed(2)), Number(b.avgWallHeightM.toFixed(2)), Number(cz.toFixed(2))],
      quantity: 1,
    })
    if (outcome.createdNodes && outcome.createdNodes.length > 0) {
      commitCreatedNodes(outcome.createdNodes, false)
    }
    setStatusMsg(outcome.text)
  }

  const quickPlaceFirestop = (kind: FirestopKind) => {
    if (!levelId) {
      setStatusMsg('Create a building level first before placing fire blocking.')
      return
    }
    const b = computeLevelBounds(record, levelId)
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const idx = placeIdx
    setPlaceIdx((i) => i + 1)

    const levelWalls = Object.values(record)
      .filter(
        (n) =>
          n.type === 'wall' &&
          n.visible !== false &&
          belongsToLevel(record, n, levelId) &&
          Array.isArray(n.start) &&
          Array.isArray(n.end),
      )
      .map((w) => {
        const sx = Number(w.start![0])
        const sz = Number(w.start![1])
        const ex = Number(w.end![0])
        const ez = Number(w.end![1])
        const len = Math.hypot(ex - sx, ez - sz)
        const h = typeof w.height === 'number' && w.height > 0 ? w.height : b.avgWallHeightM
        const baseY = typeof w.elevation === 'number' && Number.isFinite(w.elevation) ? w.elevation : 0
        const thick = typeof w.thickness === 'number' && w.thickness > 0 ? w.thickness : 0.14
        return { wall: w, sx, sz, ex, ez, len, h, baseY, thick }
      })
      .filter((w) => w.len >= 1.2)
      .sort((a, bW) => bW.len - a.len)

    // Pick longest unobstructed solid stud-bay interval [u0, u1] on a host wall so fire blocking
    // seats flush inside framed stud cavities without ever piercing doors or windows.
    const findWallSegment = (
      preferIndex: number,
      maxLenM: number,
    ): { start: [number, number]; end: [number, number]; wall: typeof levelWalls[number] } | null => {
      if (levelWalls.length === 0) return null
      const candidateOrder = [
        levelWalls[preferIndex % levelWalls.length]!,
        ...levelWalls.filter((_, i) => i !== preferIndex % levelWalls.length),
      ]
      for (const w of candidateOrder) {
        const openings = extractWallOpenings(record, w.wall)
          .map((o) => [Math.max(0.18, o.uCenterM - o.widthM / 2 - 0.1), Math.min(w.len - 0.18, o.uCenterM + o.widthM / 2 + 0.1)] as [number, number])
          .sort((a, c) => a[0] - c[0])
        const intervals: Array<[number, number]> = []
        let cursor = 0.22
        for (const [o0, o1] of openings) {
          if (o0 - cursor >= 0.8) intervals.push([cursor, o0])
          cursor = Math.max(cursor, o1)
        }
        if (w.len - 0.22 - cursor >= 0.8) intervals.push([cursor, w.len - 0.22])
        intervals.sort((a, c) => c[1] - c[0] - (a[1] - a[0]))
        const best = intervals[0]
        if (!best) continue
        const span = Math.min(maxLenM, best[1] - best[0])
        const mid = (best[0] + best[1]) / 2
        const u0 = mid - span / 2
        const u1 = mid + span / 2
        const ux = (w.ex - w.sx) / w.len
        const uz = (w.ez - w.sz) / w.len
        return {
          wall: w,
          start: [Number((w.sx + ux * u0).toFixed(3)), Number((w.sz + uz * u0).toFixed(3))],
          end: [Number((w.sx + ux * u1).toFixed(3)), Number((w.sz + uz * u1).toFixed(3))],
        }
      }
      return null
    }

    let start: [number, number] = [Number((cx - 1.5).toFixed(2)), Number(cz.toFixed(2))]
    let end: [number, number] = [Number((cx + 1.5).toFixed(2)), Number(cz.toFixed(2))]
    let elevationY = Number((b.baseElevationM + Math.max(1.2, b.avgWallHeightM * 0.52)).toFixed(2))
    let heightM = 0.089
    let thicknessM = 0.14
    let hostWallId: string | undefined

    if (kind === 'wall-vertical-10ft' || kind === 'wall-horizontal-10ft') {
      const seg = findWallSegment(idx, 3.2)
      if (seg) {
        start = seg.start
        end = seg.end
        // Match IRC R302.11(2) 10 ft tier elevation (3.048 m above wall base) on tall walls so auditStructuralScene passes
        const relY = kind === 'wall-vertical-10ft' && seg.wall.h > 3.048 ? 3.048 : seg.wall.h * 0.52
        elevationY = Number((seg.wall.baseY + relY).toFixed(2))
        heightM = 0.089
        thicknessM = Number(Math.max(0.089, seg.wall.thick).toFixed(3))
        hostWallId = seg.wall.wall.id
      }
    } else if (kind === 'soffit-drop-ceiling') {
      const seg = findWallSegment(idx + 1, 3.0)
      if (seg) {
        start = seg.start
        end = seg.end
        elevationY = Number((seg.wall.baseY + Math.max(1.8, seg.wall.h - 0.36)).toFixed(2))
        heightM = 0.24
        thicknessM = Number(Math.max(0.14, seg.wall.thick).toFixed(3))
        hostWallId = seg.wall.wall.id
      }
    } else if (kind === 'chase-chimney-shaft') {
      // Compact 22"x22" mineral-wool shaft firestop tucked into an interior corner at ceiling plane
      const chaseX = Number((b.minX + 0.45).toFixed(2))
      const chaseZ = Number((b.minZ + 0.45).toFixed(2))
      start = [Number((chaseX - 0.28).toFixed(2)), chaseZ]
      end = [Number((chaseX + 0.28).toFixed(2)), chaseZ]
      elevationY = Number((b.baseElevationM + Math.max(2.0, b.avgWallHeightM - 0.28)).toFixed(2))
      heightM = 0.22
      thicknessM = 0.56
    } else if (kind === 'penetration-firestop') {
      const seg = findWallSegment(idx, 0.2)
      if (seg) {
        const mx = (seg.start[0] + seg.end[0]) / 2
        const mz = (seg.start[1] + seg.end[1]) / 2
        start = [Number((mx - 0.08).toFixed(3)), Number(mz.toFixed(3))]
        end = [Number((mx + 0.08).toFixed(3)), Number(mz.toFixed(3))]
        elevationY = Number((seg.wall.baseY + Math.max(2.1, seg.wall.h - 0.06)).toFixed(2))
        heightM = 0.08
        thicknessM = 0.14
        hostWallId = seg.wall.wall.id
      } else {
        start = [Number((cx - 0.08).toFixed(2)), Number(cz.toFixed(2))]
        end = [Number((cx + 0.08).toFixed(2)), Number(cz.toFixed(2))]
        elevationY = Number((b.baseElevationM + Math.max(2.1, b.avgWallHeightM - 0.06)).toFixed(2))
        heightM = 0.08
        thicknessM = 0.14
      }
    } else if (kind === 'floor-draftstop') {
      elevationY = Number((b.baseElevationM - 0.3).toFixed(2))
      heightM = 0.3
      thicknessM = 0.04
    } else {
      elevationY = Number((b.baseElevationM + Math.max(1.8, b.avgWallHeightM - 0.3)).toFixed(2))
      heightM = 0.28
      thicknessM = 0.089
    }

    const outcome = structuralAgentOperations.structural_place_firestop(record, {
      levelId,
      firestopKind: kind,
      start,
      end,
      elevationY,
      heightM,
      thicknessM,
      hostWallId,
    })
    commitCreatedNodes(outcome.createdNodes ?? [], false)
    setStatusMsg(outcome.text)
  }

  const openSchedule = (tab?: StructuralScheduleTab) => {
    if (tab) setActiveTab(tab)
    openEditorView(STRUCTURAL_SCHEDULE_VIEW_ID, { beside: true })
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <strong style={{ fontSize: 13 }}>Structural ({codeEdition})</strong>
        <button type="button" onClick={() => openSchedule()} style={primaryBtnStyle}>
          Schedule &amp; Audit
        </button>
      </div>

      {/* View Mode (Finished vs Engineering X-Ray) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <button
          type="button"
          onClick={() => applyXrayMode(false)}
          style={{
            ...ghostBtnStyle,
            borderColor: !isXrayActive ? 'rgba(245,158,11,0.75)' : 'var(--border, rgba(255,255,255,0.18))',
            background: !isXrayActive ? 'rgba(245,158,11,0.16)' : 'transparent',
            fontWeight: !isXrayActive ? 600 : 400,
          }}
        >
          Finished View
        </button>
        <button
          type="button"
          onClick={() => applyXrayMode(true)}
          style={{
            ...ghostBtnStyle,
            borderColor: isXrayActive ? 'rgba(56,189,248,0.8)' : 'var(--border, rgba(255,255,255,0.18))',
            background: isXrayActive ? 'rgba(56,189,248,0.18)' : 'transparent',
            fontWeight: isXrayActive ? 600 : 400,
          }}
        >
          Framing X-Ray
        </button>
      </div>

      {/* Design Criteria */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>Design Criteria (IRC / AWC NDS)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <label style={fieldLabelStyle}>
            <span>Species (#2)</span>
            <select
              value={species}
              onChange={(e) => setSpecies(e.target.value as LumberSpecies)}
              style={selectStyle}
            >
              <option value="df-l-2">DF-L #2</option>
              <option value="spf-2">SPF #2</option>
              <option value="syp-2">SYP #2</option>
              <option value="hem-fir-2">Hem-Fir #2</option>
            </select>
          </label>

          <label style={fieldLabelStyle}>
            <span>Wall Framing</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <select
                value={studSize}
                onChange={(e) => setStudSize(e.target.value as UiStudSize)}
                title="Auto: 2x6 exterior & wet walls, 2x4 interior"
                style={{ ...selectStyle, flex: '1 1 auto', minWidth: 0 }}
              >
                <option value="auto">Auto (2x4/6)</option>
                <option value="2x4">2x4</option>
                <option value="2x6">2x6</option>
              </select>
              <select
                value={studSpacingIn}
                onChange={(e) => setStudSpacingIn(Number(e.target.value) as StudSpacingIn)}
                title="Stud On-Center Spacing"
                style={{ ...selectStyle, flex: '0 0 54px', width: 54 }}
              >
                <option value={12}>12&quot;</option>
                <option value={16}>16&quot;</option>
                <option value={24}>24&quot;</option>
              </select>
            </div>
          </label>

          <label style={fieldLabelStyle}>
            <span>Floor System</span>
            <select
              value={floorSystem}
              onChange={(e) => setFloorSystem(e.target.value as FloorSystemKind)}
              style={selectStyle}
            >
              <option value="dimensional">Dimensional</option>
              <option value="tji-ijoist">TJI I-Joist</option>
              <option value="open-web-truss">Open-Web Truss</option>
            </select>
          </label>

          <label style={fieldLabelStyle}>
            <span>Roof System</span>
            <select
              value={roofSystem}
              onChange={(e) => setRoofSystem(e.target.value as RoofSystemKind)}
              style={selectStyle}
            >
              <option value="stick-rafter">Stick Rafter</option>
              <option value="fink-truss">Fink Truss</option>
              <option value="scissor-truss">Scissor Truss</option>
              <option value="attic-truss">Attic Truss</option>
              <option value="ridge-beam-cathedral">Cathedral Ridge</option>
            </select>
          </label>

          <label style={fieldLabelStyle}>
            <span>Ground Snow (psf)</span>
            <input
              type="number"
              min={0}
              max={200}
              step={5}
              value={snowDraft}
              onChange={(e) => {
                const raw = e.target.value
                setSnowDraft(raw)
                const parsed = Number(raw)
                if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 200) {
                  setGroundSnowPsf(parsed)
                }
              }}
              onBlur={(e) => commitSnowDraft(e.target.value)}
              style={selectStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span>Wind Speed (mph)</span>
            <input
              type="number"
              min={85}
              max={200}
              step={5}
              value={windDraft}
              onChange={(e) => {
                const raw = e.target.value
                setWindDraft(raw)
                const parsed = Number(raw)
                if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= 85 && parsed <= 200) {
                  setWindMph(parsed)
                }
              }}
              onBlur={(e) => commitWindDraft(e.target.value)}
              style={selectStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span>Seismic (SDC)</span>
            <select
              value={seismicCategory}
              onChange={(e) => setSeismicCategory(e.target.value as SeismicCategory)}
              style={selectStyle}
            >
              <option value="A">SDC A</option>
              <option value="B">SDC B</option>
              <option value="C">SDC C</option>
              <option value="D0">SDC D0</option>
              <option value="D1">SDC D1</option>
              <option value="D2">SDC D2</option>
            </select>
          </label>

          <label style={fieldLabelStyle}>
            <span>Wind Exposure</span>
            <select
              value={exposure}
              onChange={(e) => setExposure(e.target.value as ExposureCategory)}
              style={selectStyle}
            >
              <option value="B">Exp B (Suburban)</option>
              <option value="C">Exp C (Open)</option>
              <option value="D">Exp D (Coastal)</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button type="button" onClick={runAutoFrame} style={{ ...primaryBtnStyle, flex: 1 }}>
            Auto-Frame (IRC/NDS)
          </button>
          <button type="button" onClick={clearStructural} style={ghostBtnStyle}>
            Clear
          </button>
        </div>
      </div>

      {/* Live IRC Audit Badge & Scene Summary */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 11 }}>IRC / NDS Audit</span>
          <button
            type="button"
            onClick={() => openSchedule('audit')}
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              border: `1px solid ${audit.errorCount > 0 ? '#ef4444' : audit.warningCount > 0 ? '#f59e0b' : '#22c55e'}`,
              background:
                audit.errorCount > 0
                  ? 'rgba(239,68,68,0.18)'
                  : audit.warningCount > 0
                    ? 'rgba(245,158,11,0.18)'
                    : 'rgba(34,197,94,0.16)',
              color:
                audit.errorCount > 0 ? '#fca5a5' : audit.warningCount > 0 ? '#fcd34d' : '#86efac',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {audit.errorCount} Err · {audit.warningCount} Warn
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, fontSize: 10, textAlign: 'center' }}>
          <button type="button" onClick={() => openSchedule('beams')} style={statBtnStyle}>
            <strong>{counts.beams}</strong>
            <span>Beams</span>
          </button>
          <button type="button" onClick={() => openSchedule('columns')} style={statBtnStyle}>
            <strong>{counts.columns}</strong>
            <span>Cols</span>
          </button>
          <button type="button" onClick={() => openSchedule('connectors')} style={statBtnStyle}>
            <strong>{counts.connectors}</strong>
            <span>Hw</span>
          </button>
          <button type="button" onClick={() => openSchedule('firestops')} style={statBtnStyle}>
            <strong>{counts.firestops}</strong>
            <span>Fire</span>
          </button>
        </div>
      </div>

      {/* Visibility Layer Toggles */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>Structural Layers</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {LAYER_TOGGLES.map((layer) => {
            const hidden = hiddenLayers[layer.key]
            return (
              <button
                key={layer.key}
                type="button"
                onClick={() => toggleLayer(layer.key)}
                style={{
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 10,
                  cursor: 'pointer',
                  border: `1px solid ${layer.color}`,
                  background: hidden ? 'transparent' : `${layer.color}24`,
                  opacity: hidden ? 0.45 : 1,
                  color: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: layer.color }} />
                {layer.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Quick-Place Engineered Beams */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>Quick-Place Engineered Beams</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {QUICK_BEAMS.map((b) => (
            <button
              key={b.family}
              type="button"
              onClick={() => quickPlaceBeam(b.family)}
              style={chipBtnStyle}
            >
              + {b.label}
            </button>
          ))}
        </div>

        <div style={{ fontWeight: 600, fontSize: 11, marginTop: 2 }}>Quick-Place Columns</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {QUICK_COLUMNS.map((c) => (
            <button
              key={c.type}
              type="button"
              onClick={() => quickPlaceColumn(c.type)}
              style={chipBtnStyle}
            >
              + {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick-Place Simpson-Class Connectors */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>Simpson-Class Connectors</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {QUICK_CONNECTORS.map((c) => (
            <button
              key={c.sku}
              type="button"
              title={c.title}
              onClick={() => quickPlaceConnector(c.sku)}
              style={chipBtnStyle}
            >
              {c.sku}
            </button>
          ))}
        </div>
      </div>

      {/* Quick-Place Fire Blocking & Draftstopping */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, fontSize: 11 }}>Fire Blocking &amp; Draftstopping</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {QUICK_FIRESTOPS.map((fs) => (
            <button
              key={fs.kind}
              type="button"
              title={fs.title}
              onClick={() => quickPlaceFirestop(fs.kind)}
              style={{ ...chipBtnStyle, textAlign: 'left' }}
            >
              + {fs.label}
            </button>
          ))}
        </div>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid var(--border, rgba(255,255,255,0.14))',
            background: 'rgba(15,23,42,0.45)',
            fontSize: 11,
            opacity: 0.9,
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* Non-PE Engineering Disclaimer */}
      <div
        style={{
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid var(--border, rgba(245,158,11,0.3))',
          background: 'rgba(245,158,11,0.08)',
          fontSize: 10,
          lineHeight: 1.4,
          opacity: 0.82,
        }}
      >
        <strong>Drafting Aid Notice:</strong> IRC/AWC/NDS/AISC sizing, engineered beam checks,
        connector schedules, fire-blocking callouts, and BOM estimates are deterministic drafting
        aids only and do not substitute for a licensed Structural/Professional Engineer (SE/PE)
        stamp or local AHJ approval.
      </div>
    </div>
  )
}

const sectionStyle = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border, rgba(255,255,255,0.14))',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
}

const fieldLabelStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 2,
  fontSize: 10,
  opacity: 0.9,
}

const selectStyle = {
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid var(--border, rgba(255,255,255,0.18))',
  background: 'var(--background, rgba(15,23,42,0.75))',
  color: 'inherit',
  fontSize: 11,
  width: '100%',
  boxSizing: 'border-box' as const,
}

const primaryBtnStyle = {
  padding: '5px 9px',
  borderRadius: 6,
  border: '1px solid rgba(245,158,11,0.65)',
  background: 'rgba(245,158,11,0.2)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
}

const ghostBtnStyle = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--border, rgba(255,255,255,0.2))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
}

const chipBtnStyle = {
  padding: '3px 7px',
  borderRadius: 5,
  border: '1px solid var(--border, rgba(255,255,255,0.18))',
  background: 'rgba(255,255,255,0.04)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 10,
}

const statBtnStyle = {
  padding: '4px 2px',
  borderRadius: 6,
  border: '1px solid var(--border, rgba(255,255,255,0.12))',
  background: 'rgba(255,255,255,0.03)',
  color: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 1,
  fontSize: 10,
}
