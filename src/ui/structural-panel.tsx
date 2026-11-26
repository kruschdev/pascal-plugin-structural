/**
 * Left-rail EditorHostPanel for `krusch:structural`.
 * Uses scoped inline styles and Pascal CSS variables so zero global CSS leaks.
 */

import { type AnyNode, runAsSingleSceneHistoryStep } from '@pascal-app/core'
import { openEditorView, useScene, useViewer } from '@pascal-app/editor'
import { useEffect, useMemo, useState } from 'react'
import { structuralAgentOperations } from '../agent-operations'
import { auditStructuralScene } from '../irc/audit'
import type {
  BeamMaterialFamily,
  ColumnType,
  ExposureCategory,
  FirestopKind,
  FloorSystemKind,
  LumberSpecies,
  RoofSystemKind,
  SceneNodeLike,
  SeismicCategory,
  StudSize,
  StudSpacingIn,
} from '../irc/tables'
import {
  type StructuralLayerKey,
  type StructuralScheduleTab,
  useStructuralUi,
} from './store'

export const STRUCTURAL_SCHEDULE_VIEW_ID = 'krusch:structural:schedule'

const ASSEMBLY_LAYER_KEYS: ReadonlySet<StructuralLayerKey> = new Set([
  'walls',
  'floor',
  'roof',
  'foundation',
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

export function belongsToLevel(
  record: Readonly<Record<string, SceneNodeLike>>,
  node: SceneNodeLike,
  levelId: string | null,
): boolean {
  if (!levelId) return true
  let cur: SceneNodeLike | undefined = node
  const seen = new Set<string>()
  while (cur?.parentId && !seen.has(cur.id)) {
    if (cur.parentId === levelId) return true
    seen.add(cur.id)
    cur = record[cur.parentId]
    if (cur?.type === 'level') return cur.id === levelId
  }
  return false
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
  const preferredBeamFamily = useStructuralUi((s) => s.preferredBeamFamily)
  const preferredColumnType = useStructuralUi((s) => s.preferredColumnType)
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
  const toggleLayerVisibility = useStructuralUi((s) => s.toggleLayerVisibility)

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

  const record = nodes as unknown as Readonly<Record<string, SceneNodeLike>>
  const levelId = activeLevelOf(nodes, selectedLevelId)
  const designParams = useMemo(
    () => ({
      codeEdition,
      species,
      groundSnowPsf,
      windMph,
      exposure,
      seismicCategory,
      frostDepthIn,
      soilBearingPsf,
    }),
    [codeEdition, species, groundSnowPsf, windMph, exposure, seismicCategory, frostDepthIn, soilBearingPsf],
  )
  const audit = useMemo(() => auditStructuralScene(record, designParams), [record, designParams])

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
    const outcome = structuralAgentOperations.structural_autopopulate_irc(record, {
      levelId,
      studSize,
      studSpacingIn,
      floorSystem,
      roofSystem,
      preferredBeamFamily,
      preferredColumnType,
      includeRoof: true,
      includeFoundation: true,
      includeFireblocking: true,
      design: designParams,
    })
    commitCreatedNodes(outcome.createdNodes ?? [], true)
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
    const offset = (placeIdx % 5) * 0.6
    setPlaceIdx((i) => i + 1)
    setPreferredBeamFamily(family)
    const outcome = structuralAgentOperations.structural_place_beam(record, {
      levelId,
      start: [0.5, 1.0 + offset],
      end: [4.16, 1.0 + offset],
      elevationY: 2.4,
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
    const offset = (placeIdx % 6) * 0.5
    setPlaceIdx((i) => i + 1)
    setPreferredColumnType(columnType)
    const outcome = structuralAgentOperations.structural_place_column(record, {
      levelId,
      position: [1.0 + offset, 0, 1.0 + offset],
      heightM: 2.7432,
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
    const offset = (placeIdx % 8) * 0.35
    setPlaceIdx((i) => i + 1)
    const outcome = structuralAgentOperations.structural_place_connector(record, {
      levelId,
      sku,
      position: [0.6 + offset, 2.4, 0.6],
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
    const offset = (placeIdx % 5) * 0.5
    setPlaceIdx((i) => i + 1)
    const isPoint = kind === 'penetration-firestop'
    const outcome = structuralAgentOperations.structural_place_firestop(record, {
      levelId,
      firestopKind: kind,
      start: [0.5, 0.5 + offset],
      end: isPoint ? [0.65, 0.5 + offset] : [3.5, 0.5 + offset],
      elevationY: kind === 'floor-draftstop' ? -0.3 : 2.4,
      heightM: isPoint ? 0.08 : 0.3,
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
                onChange={(e) => setStudSize(e.target.value as StudSize)}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="2x4">2x4</option>
                <option value="2x6">2x6</option>
              </select>
              <select
                value={studSpacingIn}
                onChange={(e) => setStudSpacingIn(Number(e.target.value) as StudSpacingIn)}
                style={{ ...selectStyle, flex: 1 }}
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
