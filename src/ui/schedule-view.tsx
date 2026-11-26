/**
 * Full-pane EditorHostView (`krusch:structural:schedule`) that opens beside the 3D/2D scene:
 * 7 Tabs:
 * 1. Beams & Headers
 * 2. Columns & Footings
 * 3. Connectors & Fasteners
 * 4. Fire Blocking & Draftstopping
 * 5. Load Path & Bracing
 * 6. IRC Audit
 * 7. Priced BOM (with Copy CSV / Copy Markdown)
 */

import { useScene, useViewer } from '@pascal-app/editor'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StructuralBomCategory } from '../irc/pricing'
import { generateStructuralSchedulePack } from '../irc/schedule'
import type { SceneNodeLike } from '../irc/tables'
import {
  type StructuralScheduleTab,
  computeSceneIdentityKey,
  useStructuralUi,
} from './store'

export default function StructuralScheduleView() {
  const nodes = useScene((s) => s.nodes)
  const setSelection = useViewer((s) => s.setSelection)
  const editedDesignParams = useStructuralUi((s) => s.editedDesignParams)
  const xrayHiddenNodeIds = useStructuralUi((s) => s.xrayHiddenNodeIds)
  const lastSceneKey = useStructuralUi((s) => s.lastSceneKey)
  const syncSceneKey = useStructuralUi((s) => s.syncSceneKey)
  const activeTab = useStructuralUi((s) => s.activeTab)
  const setActiveTab = useStructuralUi((s) => s.setActiveTab)
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

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
  const designOverride = useMemo(
    () => (Object.keys(effectiveEditedDesignParams).length > 0 ? effectiveEditedDesignParams : undefined),
    [effectiveEditedDesignParams],
  )
  const pack = useMemo(
    () => generateStructuralSchedulePack(auditRecord, designOverride),
    [auditRecord, designOverride],
  )

  const copyText = (label: string, content: string) => {
    navigator.clipboard?.writeText(content).catch(() => {})
    setCopiedMsg(`Copied ${label}`)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => {
      setCopiedMsg(null)
      copyTimerRef.current = null
    }, 2200)
  }

  const totalConnectors = useMemo(
    () => pack.connectors.reduce((sum, c) => sum + c.totalQuantity, 0),
    [pack.connectors],
  )

  const tabs: ReadonlyArray<[StructuralScheduleTab, string]> = [
    ['beams', `Beams & Headers (${pack.beams.length})`],
    ['columns', `Columns & Footings (${pack.columns.length})`],
    ['connectors', `Connectors & Fasteners (${totalConnectors})`],
    ['firestops', `Fire Blocking & Draftstopping (${pack.firestops.length})`],
    ['load-path', `Load Path & Bracing (${pack.loadPath.bracedWallLines.length})`],
    ['audit', `IRC Audit (${pack.audit.errorCount}/${pack.audit.warningCount})`],
    ['bom', `Priced BOM ($${Math.round(pack.bom.totalMaterialCostUsd).toLocaleString()})`],
  ]

  const bomCategories = Object.entries(pack.bom.subtotalByCategory) as Array<
    [StructuralBomCategory, number]
  >

  return (
    <div
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontSize: 12,
        height: '100%',
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <strong style={{ fontSize: 15 }}>
            Structural Engineering Schedule ({pack.designParams.codeEdition})
          </strong>
          <div style={{ fontSize: 11, opacity: 0.75 }}>
            {pack.designParams.species.toUpperCase()} · Snow {pack.designParams.groundSnowPsf} psf ·
            Wind {pack.designParams.windMph} mph (Exp {pack.designParams.exposure}) · SDC{' '}
            {pack.designParams.seismicCategory} · Soil {pack.designParams.soilBearingPsf} psf
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {copiedMsg && <span style={{ color: '#22c55e', fontSize: 11 }}>{copiedMsg}</span>}
          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              border: `1px solid ${pack.audit.passed ? '#22c55e' : '#ef4444'}`,
              background: pack.audit.passed ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.18)',
              color: pack.audit.passed ? '#86efac' : '#fca5a5',
            }}
          >
            {pack.audit.passed
              ? `PASS (${pack.audit.warningCount} Warn)`
              : `${pack.audit.errorCount} ERR · ${pack.audit.warningCount} WARN`}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.14))',
          paddingBottom: 8,
        }}
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--border, rgba(255,255,255,0.18))',
              background: activeTab === id ? 'rgba(245,158,11,0.25)' : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: activeTab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Beams & Headers */}
      {activeTab === 'beams' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pack.beams.length === 0 ? (
            <EmptyBanner text="No structural beams or headers placed yet. Run Auto-Frame (IRC/NDS) or quick-place a beam from the Structural panel." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Mark</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Family</th>
                  <th style={thStyle}>Designation</th>
                  <th style={thStyle}>Span</th>
                  <th style={thStyle}>Section (Plies)</th>
                  <th style={thStyle}>Mount</th>
                  <th style={thStyle}>Bearing</th>
                  <th style={thStyle}>Jacks/End</th>
                  <th style={thStyle}>Reaction</th>
                </tr>
              </thead>
              <tbody>
                {pack.beams.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setSelection({ selectedIds: [b.id] })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={tdStyle}><strong>{b.mark}</strong></td>
                    <td style={tdStyle}>{b.role}</td>
                    <td style={tdStyle}>{b.beamType}</td>
                    <td style={tdStyle}>{b.designation}</td>
                    <td style={tdStyle}>{b.spanFt.toFixed(1)} ft</td>
                    <td style={tdStyle}>{b.sizeIn} ({b.plyCount})</td>
                    <td style={tdStyle}>{b.mountStyle}</td>
                    <td style={tdStyle}>{b.bearingIn}&quot;</td>
                    <td style={tdStyle}>{b.jackStudsEachEnd}</td>
                    <td style={tdStyle}>{b.endReactionLbs.toLocaleString()} lbs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 2: Columns & Footings */}
      {activeTab === 'columns' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pack.columns.length === 0 ? (
            <EmptyBanner text="No structural columns or spread footings placed yet." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Mark</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Designation</th>
                  <th style={thStyle}>Height</th>
                  <th style={thStyle}>Axial Load</th>
                  <th style={thStyle}>Squash Blocks</th>
                  <th style={thStyle}>Pad Footing &amp; Rebar</th>
                </tr>
              </thead>
              <tbody>
                {pack.columns.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelection({ selectedIds: [c.id] })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={tdStyle}><strong>{c.mark}</strong></td>
                    <td style={tdStyle}>{c.columnType}</td>
                    <td style={tdStyle}>{c.designation}</td>
                    <td style={tdStyle}>{c.heightFt.toFixed(1)} ft</td>
                    <td style={tdStyle}>{c.axialLoadLbs.toLocaleString()} lbs</td>
                    <td style={tdStyle}>{c.hasSquashBlocks ? 'Yes (TJI)' : 'No'}</td>
                    <td style={tdStyle}>{c.footingCallout}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 3: Connectors & Fasteners */}
      {activeTab === 'connectors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pack.connectors.length === 0 ? (
            <EmptyBanner text="No Simpson-class connectors scheduled yet." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Hardware Name</th>
                  <th style={thStyle}>Total Qty</th>
                  <th style={thStyle}>Uplift (lbs)</th>
                  <th style={thStyle}>Download (lbs)</th>
                  <th style={thStyle}>Fastener Spec</th>
                  <th style={thStyle}>Code Ref</th>
                </tr>
              </thead>
              <tbody>
                {pack.connectors.map((c) => (
                  <tr key={c.sku}>
                    <td style={tdStyle}><strong>{c.sku}</strong></td>
                    <td style={tdStyle}>{c.category}</td>
                    <td style={tdStyle}>{c.name}</td>
                    <td style={tdStyle}><strong>{c.totalQuantity}</strong></td>
                    <td style={tdStyle}>{c.upliftLbs > 0 ? c.upliftLbs.toLocaleString() : '-'}</td>
                    <td style={tdStyle}>{c.downloadLbs > 0 ? c.downloadLbs.toLocaleString() : '-'}</td>
                    <td style={tdStyle}>{c.fastenerSpec}</td>
                    <td style={tdStyle}>{c.codeRef}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 4: Fire Blocking & Draftstopping */}
      {activeTab === 'firestops' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pack.firestops.length === 0 ? (
            <EmptyBanner text="No IRC R302.11 fire blocking or R302.12 draftstopping zones placed yet." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Code Ref</th>
                  <th style={thStyle}>Kind</th>
                  <th style={thStyle}>Label</th>
                  <th style={thStyle}>Material</th>
                  <th style={thStyle}>Length</th>
                  <th style={thStyle}>Elev AFF</th>
                </tr>
              </thead>
              <tbody>
                {pack.firestops.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => setSelection({ selectedIds: [f.id] })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={tdStyle}><strong>{f.codeRef}</strong></td>
                    <td style={tdStyle}>{f.firestopKind}</td>
                    <td style={tdStyle}>{f.label}</td>
                    <td style={tdStyle}>{f.material}</td>
                    <td style={tdStyle}>{f.lengthFt.toFixed(1)} ft</td>
                    <td style={tdStyle}>{f.elevationFt.toFixed(1)} ft</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 5: Load Path & Bracing */}
      {activeTab === 'load-path' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            <MetricCard
              title="Gravity Load Path"
              value={pack.loadPath.brokenLoadPaths === 0 ? 'INTACT' : `${pack.loadPath.brokenLoadPaths} BROKEN`}
              sub={`${pack.loadPath.gravityLinks.length} traced transfer link(s)`}
              warn={pack.loadPath.brokenLoadPaths > 0}
            />
            <MetricCard
              title="Uplift Load Path"
              value={pack.loadPath.upliftContinuous ? 'CONTINUOUS' : `${pack.loadPath.upliftFindings.length} GAP(S)`}
              sub={`Wind ${pack.designParams.windMph} mph · SDC ${pack.designParams.seismicCategory}`}
              warn={!pack.loadPath.upliftContinuous}
            />
            <MetricCard
              title="IRC R602.10 Braced Lines"
              value={`${pack.loadPath.bracedWallLines.filter((b) => b.passes).length}/${pack.loadPath.bracedWallLines.length} PASS`}
              sub="X & Z lateral wall lines"
              warn={pack.loadPath.bracedWallLines.some((b) => !b.passes)}
            />
          </div>

          {pack.loadPath.upliftFindings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong>Uplift Hardware Continuity Findings</strong>
              {pack.loadPath.upliftFindings.map((uf, i) => (
                <div
                  key={i}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: '1px solid rgba(239,68,68,0.5)',
                    background: 'rgba(239,68,68,0.1)',
                    fontSize: 11,
                  }}
                >
                  {uf}
                </div>
              ))}
            </div>
          )}

          <strong>IRC R602.10 Braced Wall Lines</strong>
          {pack.loadPath.bracedWallLines.length === 0 ? (
            <EmptyBanner text="No perimeter/interior walls detected for braced wall line analysis." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Line</th>
                  <th style={thStyle}>Axis</th>
                  <th style={thStyle}>Length / Braced</th>
                  <th style={thStyle}>Provided / Req</th>
                  <th style={thStyle}>Method</th>
                  <th style={thStyle}>Edge Nail</th>
                  <th style={thStyle}>Hold-Down</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pack.loadPath.bracedWallLines.map((bwl) => (
                  <tr
                    key={bwl.id}
                    onClick={() => bwl.wallIds.length > 0 && setSelection({ selectedIds: bwl.wallIds })}
                    style={{ cursor: bwl.wallIds.length > 0 ? 'pointer' : 'default' }}
                  >
                    <td style={tdStyle}><strong>{bwl.id}</strong></td>
                    <td style={tdStyle}>{bwl.axis}</td>
                    <td style={tdStyle}>{bwl.totalLineLengthFt} ft / {bwl.bracedPanelLengthFt} ft</td>
                    <td style={tdStyle}>{bwl.providedPercent}% / {bwl.requiredPercent}%</td>
                    <td style={tdStyle}>{bwl.bracingMethod}</td>
                    <td style={tdStyle}>{bwl.edgeNailSpacingIn}&quot; OC</td>
                    <td style={tdStyle}>
                      {bwl.requiredHoldDownSku ?? 'None'}
                      {bwl.requiresPlateWashers ? ' + BP3x3' : ''}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color: bwl.passes ? '#22c55e' : '#f59e0b',
                        fontWeight: 600,
                      }}
                    >
                      {bwl.passes ? 'PASS' : 'UPGRADE'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <strong>Gravity Load-Path Transfers</strong>
          {pack.loadPath.gravityLinks.length === 0 ? (
            <EmptyBanner text="No beam-to-column or column-to-footing gravity links traced yet." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>From</th>
                  <th style={thStyle}>To</th>
                  <th style={thStyle}>Load</th>
                  <th style={thStyle}>Squash Block</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pack.loadPath.gravityLinks.map((link, idx) => (
                  <tr
                    key={`${link.fromNodeId}_${idx}`}
                    onClick={() => setSelection({ selectedIds: [link.fromNodeId] })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={tdStyle}>{link.fromType} ({link.fromNodeId})</td>
                    <td style={tdStyle}>{link.toType}{link.toNodeId ? ` (${link.toNodeId})` : ''}</td>
                    <td style={tdStyle}>{link.axialLoadLbs.toLocaleString()} lbs</td>
                    <td style={tdStyle}>{link.requiresSquashBlock ? 'REQUIRED' : 'OK'}</td>
                    <td
                      style={{
                        ...tdStyle,
                        color: link.continuous && !link.issue ? '#22c55e' : '#ef4444',
                        fontWeight: 600,
                      }}
                    >
                      {link.continuous && !link.issue ? 'CONTINUOUS' : link.issue ?? 'BROKEN'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 6: IRC Audit */}
      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pack.audit.findings.length === 0 && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: 'rgba(34,197,94,0.14)',
                border: '1px solid #22c55e',
              }}
            >
              0 Errors · 0 Warnings. All IRC/AWC/NDS/WFCM structural, load-path, fire-blocking, and
              Priority #1 MEP right-of-way checks passed!
            </div>
          )}
          {pack.audit.findings.map((f) => (
            <div
              key={f.id}
              onClick={() => f.nodeId && setSelection({ selectedIds: [f.nodeId] })}
              style={{
                padding: 10,
                borderRadius: 8,
                cursor: f.nodeId ? 'pointer' : 'default',
                border: `1px solid ${
                  f.severity === 'error'
                    ? '#ef4444'
                    : f.severity === 'warning'
                      ? '#f59e0b'
                      : '#38bdf8'
                }`,
                background:
                  f.severity === 'error'
                    ? 'rgba(239,68,68,0.12)'
                    : f.severity === 'warning'
                      ? 'rgba(245,158,11,0.12)'
                      : 'rgba(56,189,248,0.12)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>
                  [{f.codeRef}] {f.id}
                </strong>
                <span style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.8 }}>
                  {f.category} · {f.severity}
                </span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.9, marginTop: 3 }}>{f.message}</div>
              <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 4 }}>Fix: {f.remediation}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 7: Priced BOM */}
      {activeTab === 'bom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              Estimated 2026 contractor material pricing across lumber, engineered beams, concrete, Simpson-class hardware, and firestop assemblies.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => copyText('BOM CSV', pack.bom.csv)} style={btnStyle}>
                Copy CSV
              </button>
              <button
                type="button"
                onClick={() => copyText('BOM Markdown', pack.bom.markdown)}
                style={btnStyle}
              >
                Copy Markdown
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {bomCategories.map(([cat, subtotal]) => (
              <MetricCard
                key={cat}
                title={cat}
                value={`$${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                sub="Material subtotal"
              />
            ))}
          </div>

          {pack.bom.items.length === 0 ? (
            <EmptyBanner text="No structural BOM line items yet. Auto-frame or place structural members to compute material takeoff." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Unit Cost</th>
                  <th style={thStyle}>Extended</th>
                  <th style={thStyle}>Code</th>
                </tr>
              </thead>
              <tbody>
                {pack.bom.items.map((item, idx) => (
                  <tr key={`${item.sku}_${idx}`}>
                    <td style={tdStyle}>{item.category}</td>
                    <td style={tdStyle}><code>{item.sku}</code></td>
                    <td style={tdStyle}>{item.description}</td>
                    <td style={tdStyle}>{item.quantity} {item.unit}</td>
                    <td style={tdStyle}>${item.unitCostUsd.toFixed(2)}</td>
                    <td style={tdStyle}><strong>${item.extendedCostUsd.toFixed(2)}</strong></td>
                    <td style={tdStyle}>{item.codeRef ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700 }}>
            Estimated Material Total: $
            {pack.bom.totalMaterialCostUsd.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
      )}

      {/* Footer Disclaimer */}
      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 'auto', paddingTop: 8 }}>
        Deterministic IRC/AWC/NDS/AISC drafting aid only; all structural members, lateral shear
        schedules, connectors, and footings require verification by a licensed SE/PE and local AHJ.
      </div>
    </div>
  )
}

function MetricCard({
  title,
  value,
  sub,
  warn,
}: {
  title: string
  value: string
  sub: string
  warn?: boolean
}) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        border: `1px solid ${warn ? 'rgba(239,68,68,0.5)' : 'var(--border, rgba(255,255,255,0.14))'}`,
        background: warn ? 'rgba(239,68,68,0.08)' : 'transparent',
      }}
    >
      <div style={{ fontSize: 10, opacity: 0.72 }}>{title}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: warn ? '#fca5a5' : 'inherit' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, opacity: 0.8 }}>{sub}</div>
    </div>
  )
}

function EmptyBanner({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        border: '1px solid var(--border, rgba(255,255,255,0.14))',
        opacity: 0.8,
        fontSize: 11,
      }}
    >
      {text}
    </div>
  )
}

const tableStyle = { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10.5 }
const thStyle = {
  textAlign: 'left' as const,
  padding: '5px 5px',
  borderBottom: '1px solid var(--border, rgba(255,255,255,0.16))',
  opacity: 0.8,
  whiteSpace: 'nowrap' as const,
}
const tdStyle = {
  padding: '5px 5px',
  borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
}
const btnStyle = {
  padding: '4px 9px',
  borderRadius: 6,
  border: '1px solid rgba(56,189,248,0.5)',
  background: 'rgba(56,189,248,0.16)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 11,
}
