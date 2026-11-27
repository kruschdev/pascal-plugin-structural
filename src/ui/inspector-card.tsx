'use client'

/**
 * InspectorExtension card for `structural:*` nodes:
 * Shows live COMPLIANT / NOT TO CODE badge, exact beam utilization/deflection/jack-studs,
 * column capacity/footing callout, connector SKU ratings/fasteners, firestop compliance,
 * and one-click jump to the Schedule/Audit view.
 */

import type { AnyNode } from '@pascal-app/core'
import { openEditorView, useScene } from '@pascal-app/editor'
import { useMemo } from 'react'
import { auditStructuralScene } from '../irc/audit'
import { isApprovedFirestopMaterial } from '../irc/fireblocking'
import { checkBeamEntry, checkColumnEntry, resolveBeamCatalogEntry } from '../irc/sizing'
import {
  type BeamMaterialFamily,
  type BeamRole,
  type ColumnType,
  DEFAULT_DESIGN_PARAMS,
  FIRESTOP_RULES,
  type FirestopKind,
  type FirestopMaterial,
  METERS_TO_FEET,
  type SceneNodeLike,
  type StructuralDesignParams,
  type Vec2,
  getConnectorBySku,
} from '../irc/tables'
import { type StructuralScheduleTab, useStructuralUi } from './store'
import { STRUCTURAL_SCHEDULE_VIEW_ID } from './structural-panel'

export default function StructuralInspectorCard({ node }: { node?: AnyNode }) {
  const nodes = useScene((s) => s.nodes) as unknown as Readonly<Record<string, SceneNodeLike>>
  const editedDesignParams = useStructuralUi((s) => s.editedDesignParams)
  const setActiveTab = useStructuralUi((s) => s.setActiveTab)

  const raw = node as unknown as SceneNodeLike | undefined
  const isStructuralNode = Boolean(raw && typeof raw.type === 'string' && raw.type.startsWith('structural:'))

  const designOverride = useMemo(
    () => (Object.keys(editedDesignParams).length > 0 ? editedDesignParams : undefined),
    [editedDesignParams],
  )
  const design = useMemo(() => {
    if (!isStructuralNode) return DEFAULT_DESIGN_PARAMS
    const firstAssembly = Object.values(nodes).find((n) => n.type === 'structural:assembly')
    const persisted = (firstAssembly?.designParams as Partial<StructuralDesignParams> | undefined) ?? {}
    return {
      ...DEFAULT_DESIGN_PARAMS,
      ...persisted,
      ...editedDesignParams,
    }
  }, [isStructuralNode, nodes, editedDesignParams])
  const audit = useMemo(
    () => (isStructuralNode ? auditStructuralScene(nodes, designOverride) : null),
    [isStructuralNode, nodes, designOverride],
  )

  const nodeFindings = useMemo(
    () => (raw && audit ? audit.findings.filter((f) => f.nodeId === raw.id) : []),
    [audit, raw],
  )

  if (!isStructuralNode || !raw) return null

  const hasError = nodeFindings.some((f) => f.severity === 'error')
  const hasWarning = nodeFindings.length > 0 && !hasError

  const openTab = (tab: StructuralScheduleTab) => {
    setActiveTab(tab)
    openEditorView(STRUCTURAL_SCHEDULE_VIEW_ID, { beside: true })
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      {/* Live Compliance Badge */}
      <div
        style={{
          padding: '6px 8px',
          borderRadius: 6,
          background: hasError
            ? 'rgba(239,68,68,0.18)'
            : hasWarning
              ? 'rgba(245,158,11,0.18)'
              : 'rgba(34,197,94,0.15)',
          border: `1px solid ${hasError ? '#ef4444' : hasWarning ? '#f59e0b' : '#22c55e'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        <span>
          {hasError
            ? `NOT TO CODE (${nodeFindings.length})`
            : hasWarning
              ? `WARNINGS (${nodeFindings.length})`
              : `${design.codeEdition} COMPLIANT`}
        </span>
        <button
          type="button"
          onClick={() => openTab('audit')}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#38bdf8',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Audit
        </button>
      </div>

      {/* structural:beam telemetry */}
      {raw.type === 'structural:beam' && (() => {
        const start = (raw.start as Vec2 | undefined) ?? [0, 0]
        const end = (raw.end as Vec2 | undefined) ?? [1, 0]
        const spanFt = Math.max(1, Math.hypot(end[0] - start[0], end[1] - start[1]) * METERS_TO_FEET)
        const family = (raw.beamType as BeamMaterialFamily | undefined) ?? 'lvl'
        const widthIn = typeof raw.widthIn === 'number' ? raw.widthIn : 3.5
        const depthIn = typeof raw.depthIn === 'number' ? raw.depthIn : 11.875
        const role = (raw.role as BeamRole | undefined) ?? 'header'
        const tribFt = typeof raw.tributaryWidthFt === 'number' ? raw.tributaryWidthFt : 10

        const entry = resolveBeamCatalogEntry({
          designation: typeof raw.designation === 'string' ? raw.designation : undefined,
          family,
          widthIn,
          depthIn,
          plyCount: typeof raw.plyCount === 'number' ? raw.plyCount : undefined,
        })

        const check = checkBeamEntry(entry, {
          spanFt,
          tributaryWidthFt: tribFt,
          role,
          liveLoadPsf: typeof raw.liveLoadPsf === 'number' ? raw.liveLoadPsf : design.floorLiveLoadPsf,
          deadLoadPsf: typeof raw.deadLoadPsf === 'number' ? raw.deadLoadPsf : design.floorDeadLoadPsf,
          snowLoadPsf: typeof raw.snowLoadPsf === 'number' ? raw.snowLoadPsf : design.groundSnowPsf,
          species:
            typeof raw.species === 'string'
              ? (raw.species as StructuralDesignParams['species'])
              : design.species,
          storiesSupported: design.storiesAbove,
        })

        const actualJacks = typeof raw.jackStudsEachEnd === 'number' ? raw.jackStudsEachEnd : check.jackStudsEachEnd
        const actualBearing = typeof raw.bearingLengthIn === 'number' ? raw.bearingLengthIn : check.requiredBearingIn

        return (
          <>
            <Row label="Designation" value={String(raw.designation ?? entry.designation)} />
            <Row label="Role / Mount" value={`${role} · ${String(raw.mountStyle ?? 'flush')}`} />
            <Row label="Span / Section" value={`${spanFt.toFixed(1)} ft · ${widthIn}" × ${depthIn}" (${String(raw.plyCount ?? entry.plyCount)}-ply)`} />
            <Row
              label="Bending / Shear Util"
              value={`${Math.round(check.bendingUtilization * 100)}% Fb · ${Math.round(check.shearUtilization * 100)}% Fv`}
              warn={check.bendingUtilization > 1 || check.shearUtilization > 1}
            />
            <Row
              label="Live / Total Defl"
              value={`L/${check.liveDeflectionRatio} (${check.liveDeflectionIn}") · L/${check.totalDeflectionRatio}`}
              warn={!check.passes && check.governingCheck.startsWith('deflection')}
            />
            <Row
              label="Jack Studs / Bearing"
              value={`${actualJacks} req ${check.jackStudsEachEnd}/end · ${actualBearing}" (min ${check.requiredBearingIn}")`}
              warn={actualJacks < check.jackStudsEachEnd || actualBearing < check.requiredBearingIn - 0.05}
            />
            <Row label="End Reaction / Hanger" value={`${check.shearLbs.toLocaleString()} lbs · ${check.recommendedHangerSku}`} />
            <button type="button" onClick={() => openTab('beams')} style={linkBtnStyle}>
              Open Beam &amp; Header Schedule
            </button>
          </>
        )
      })()}

      {/* structural:column telemetry */}
      {raw.type === 'structural:column' && (() => {
        const axialLoadLbs = typeof raw.axialLoadLbs === 'number' ? raw.axialLoadLbs : 4500
        const heightFt = (typeof raw.heightM === 'number' ? raw.heightM : 2.74) * METERS_TO_FEET
        const check = checkColumnEntry({
          designation: typeof raw.designation === 'string' ? raw.designation : undefined,
          columnType: raw.columnType as ColumnType | undefined,
          widthIn: typeof raw.widthIn === 'number' ? raw.widthIn : undefined,
          depthIn: typeof raw.depthIn === 'number' ? raw.depthIn : undefined,
          axialLoadLbs,
          unbracedHeightFt: heightFt,
          soilBearingPsf: design.soilBearingPsf,
          frostDepthIn: design.frostDepthIn,
        })
        const hasFootingW = typeof raw.footingWidthIn === 'number' && raw.footingWidthIn > 0
        const hasFootingD = typeof raw.footingDepthIn === 'number' && raw.footingDepthIn > 0
        const fw = hasFootingW ? (raw.footingWidthIn as number) : 0
        const fd = hasFootingD ? (raw.footingDepthIn as number) : 0
        const rebar = String(raw.footingRebar ?? check.footingRebar)

        return (
          <>
            <Row label="Designation" value={String(raw.designation ?? check.entry.designation)} />
            <Row label="Height / Type" value={`${heightFt.toFixed(1)} ft · ${String(raw.columnType ?? check.entry.columnType)}`} />
            <Row
              label="Axial Load / Capacity"
              value={`${axialLoadLbs.toLocaleString()} / ${check.allowableAxialLbs.toLocaleString()} lbs (${Math.round(check.utilization * 100)}%)`}
              warn={!check.passes}
            />
            <Row
              label="Pad Footing"
              value={hasFootingW && hasFootingD ? `${fw}"×${fw}"×${fd}" (min ${check.footingWidthIn}"×${check.footingDepthIn}")` : `Missing (req ${check.footingWidthIn}"×${check.footingWidthIn}"×${check.footingDepthIn}")`}
              warn={!hasFootingW || !hasFootingD || fw < check.footingWidthIn - 1 || fd < check.footingDepthIn}
            />
            <Row label="Footing Rebar" value={rebar} />
            <Row label="Squash Blocks" value={raw.hasSquashBlocks ? 'Installed (TJI)' : 'None'} />
            <Row label="Base / Cap SKUs" value={`${check.recommendedBaseSku} / ${check.recommendedCapSku}`} />
            <button type="button" onClick={() => openTab('columns')} style={linkBtnStyle}>
              Open Column &amp; Footing Schedule
            </button>
          </>
        )
      })()}

      {/* structural:connector telemetry */}
      {raw.type === 'structural:connector' && (() => {
        const sku = String(raw.sku ?? 'H2.5A')
        const cat = getConnectorBySku(sku)
        const uplift = Number(raw.upliftCapacityLbs ?? cat?.upliftLbs ?? 0)
        const download = Number(raw.downloadCapacityLbs ?? cat?.downloadLbs ?? 0)
        const lateral = Number(raw.lateralCapacityLbs ?? cat?.lateralLbs ?? 0)
        const qty = Math.max(1, Number(raw.quantity ?? 1))

        return (
          <>
            <Row label="Connector SKU" value={`${sku} (×${qty})`} warn={!cat} />
            <Row label="Catalog Name" value={cat?.name ?? 'Unlisted SKU'} warn={!cat} />
            <Row label="Uplift / Download" value={`${uplift.toLocaleString()} lbs / ${download.toLocaleString()} lbs`} />
            {lateral > 0 && <Row label="Lateral Shear" value={`${lateral.toLocaleString()} lbs`} />}
            <Row label="Fasteners" value={String(raw.fastenerSpec ?? cat?.fastenerSpec ?? 'Per mfr spec')} />
            <Row label="Code Reference" value={cat?.codeRef ?? 'IRC R802.11'} />
            <button type="button" onClick={() => openTab('connectors')} style={linkBtnStyle}>
              Open Connector &amp; Fastener Schedule
            </button>
          </>
        )
      })()}

      {/* structural:firestop telemetry */}
      {raw.type === 'structural:firestop' && (() => {
        const kind = (raw.firestopKind as FirestopKind | undefined) ?? 'wall-vertical-10ft'
        const rule = FIRESTOP_RULES[kind]
        const mat = (raw.material as FirestopMaterial | undefined) ?? rule.defaultMaterial
        const approved = isApprovedFirestopMaterial(kind, mat)
        const start = (raw.start as Vec2 | undefined) ?? [0, 0]
        const end = (raw.end as Vec2 | undefined) ?? [1, 0]
        const lenFt = Number((Math.hypot(end[0] - start[0], end[1] - start[1]) * METERS_TO_FEET).toFixed(1))
        const elevFt = Number(((typeof raw.elevationY === 'number' ? raw.elevationY : 0) * METERS_TO_FEET).toFixed(1))

        return (
          <>
            <Row label="Code Reference" value={String(raw.codeRef ?? rule.codeRef)} />
            <Row label="Category" value={kind} />
            <Row
              label="Material Compliance"
              value={`${mat} (${approved ? 'APPROVED' : 'UNAPPROVED'})`}
              warn={!approved}
            />
            <Row label="Length / Elev AFF" value={`${lenFt} ft @ ${elevFt} ft`} />
            {typeof raw.compartmentAreaSqFt === 'number' && (
              <Row label="Compartment Area" value={`${raw.compartmentAreaSqFt} sq ft`} />
            )}
            <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.35 }}>{rule.requirement}</div>
            <button type="button" onClick={() => openTab('firestops')} style={linkBtnStyle}>
              Open Fire Blocking Schedule
            </button>
          </>
        )
      })()}

      {/* structural:assembly telemetry */}
      {raw.type === 'structural:assembly' && (
        <>
          <Row label="Species / Studs" value={`${String(raw.species ?? design.species).toUpperCase()} · ${String(raw.studSize ?? '2x6')} @ ${String(raw.studSpacingIn ?? 16)}" OC`} />
          <Row label="Floor System" value={`${String(raw.floorSystem ?? 'tji-ijoist')} (${String(raw.joistDepthIn ?? 11.875)}")`} />
          <Row label="Roof System" value={String(raw.roofSystem ?? 'stick-rafter')} />
          <button type="button" onClick={() => openTab('load-path')} style={linkBtnStyle}>
            Open Load Path &amp; Bracing View
          </button>
        </>
      )}

      {/* Node-specific audit findings */}
      {nodeFindings.slice(0, 3).map((f) => (
        <div
          key={f.id}
          style={{
            padding: 6,
            borderRadius: 6,
            border: `1px solid ${f.severity === 'error' ? 'rgba(239,68,68,0.45)' : 'rgba(245,158,11,0.45)'}`,
            background: f.severity === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            fontSize: 11,
            lineHeight: 1.35,
          }}
        >
          <strong>{f.codeRef}:</strong> {f.message}
          <div style={{ fontSize: 10, color: '#38bdf8', marginTop: 2 }}>Fix: {f.remediation}</div>
        </div>
      ))}
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
      <span style={{ opacity: 0.78, flexShrink: 0 }}>{label}</span>
      <strong style={{ color: warn ? '#ef4444' : 'inherit', textAlign: 'right' }}>{value}</strong>
    </div>
  )
}

const linkBtnStyle = {
  padding: '4px 8px',
  borderRadius: 5,
  border: '1px solid rgba(56,189,248,0.45)',
  background: 'rgba(56,189,248,0.12)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
  marginTop: 2,
}
