'use client'

/**
 * Persisted ChatToolCard for `krusch:structural` (`PluginChatExtension`).
 */

import type { ChatToolCardProps } from '@pascal-app/editor'
import { STRUCTURAL_SCHEDULE_VIEW_ID } from './structural-panel'

type AuditFindingLike = {
  id: string
  severity?: 'error' | 'warning' | 'info'
  codeRef: string
  message: string
  nodeId?: string
}

function extractSelectableNodeIds(data: Record<string, unknown> | undefined): string[] {
  if (!data) return []
  const ids: string[] = []
  if (Array.isArray(data.nodeIds)) {
    for (const id of data.nodeIds) {
      if (typeof id === 'string') ids.push(id)
    }
  }
  for (const key of ['beamId', 'columnId', 'connectorId', 'firestopId'] as const) {
    const val = data[key]
    if (typeof val === 'string' && !ids.includes(val)) {
      ids.push(val)
    }
  }
  return ids
}

export default function StructuralChatCard({
  toolName,
  output,
  state,
  actions,
}: ChatToolCardProps) {
  const data = output?.data as Record<string, unknown> | undefined
  const findings = Array.isArray(data?.findings)
    ? (data.findings as AuditFindingLike[])
    : []
  const selectableIds = extractSelectableNodeIds(data)

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        border: '1px solid var(--border, rgba(255,255,255,0.16))',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 }}>
        <span>{toolName}</span>
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            opacity: 0.78,
            color: state === 'error' ? '#ef4444' : state === 'done' ? '#22c55e' : 'inherit',
          }}
        >
          {state}
        </span>
      </div>

      {output?.text && <div style={{ opacity: 0.88 }}>{output.text}</div>}
      {output?.error && (
        <div style={{ color: '#fca5a5', fontSize: 11 }}>{output.error}</div>
      )}

      {findings.slice(0, 4).map((f) => (
        <div
          key={f.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
          }}
        >
          <span>
            <strong
              style={{
                color:
                  f.severity === 'error'
                    ? '#fca5a5'
                    : f.severity === 'warning'
                      ? '#fcd34d'
                      : 'inherit',
              }}
            >
              {f.codeRef}
            </strong>
            : {f.message}
          </span>
          {f.nodeId && (
            <button
              type="button"
              onClick={() => actions.select([f.nodeId!])}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#38bdf8',
                cursor: 'pointer',
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              Select
            </button>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {selectableIds.length > 0 && (
          <button
            type="button"
            onClick={() => actions.select(selectableIds)}
            style={{
              padding: '4px 8px',
              borderRadius: 5,
              border: '1px solid rgba(56,189,248,0.55)',
              background: 'rgba(56,189,248,0.16)',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Select {selectableIds.length === 1 ? 'Node' : `${selectableIds.length} Nodes`}
          </button>
        )}
        <button
          type="button"
          onClick={() => actions.openView(STRUCTURAL_SCHEDULE_VIEW_ID, { beside: true })}
          style={{
            padding: '4px 8px',
            borderRadius: 5,
            border: '1px solid rgba(245,158,11,0.55)',
            background: 'rgba(245,158,11,0.18)',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Open Structural Schedule
        </button>
      </div>
    </div>
  )
}
