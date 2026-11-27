'use client'

/**
 * Isolated Zustand UI state store for `krusch:structural`.
 * Never mutates or extends Pascal's `useScene`, `useEditor`, or `useViewer` stores.
 */

import { create } from 'zustand'
import {
  type BeamMaterialFamily,
  type ColumnType,
  DEFAULT_DESIGN_PARAMS,
  type ExposureCategory,
  type FloorSystemKind,
  type LumberSpecies,
  type RoofSystemKind,
  type SceneNodeLike,
  type SeismicCategory,
  type StructuralDesignParams,
  type StudSize,
  type StudSpacingIn,
} from '../irc/tables'

/**
 * Deterministic scene/project identity key derived from top-level `site` / `building` IDs
 * (falling back to the lowest `level` ID when no site/building node exists).
 * Used to automatically clear stale `editedDesignParams` and `xrayHiddenNodeIds` when switching projects.
 */
export function computeSceneIdentityKey(nodes: Readonly<Record<string, SceneNodeLike>>): string {
  const roots: string[] = []
  const levels: string[] = []
  for (const n of Object.values(nodes)) {
    if (n.type === 'site' || n.type === 'building') roots.push(n.id)
    else if (n.type === 'level') levels.push(n.id)
  }
  if (roots.length > 0) {
    roots.sort()
    return `roots:${roots.join(',')}`
  }
  if (levels.length > 0) {
    levels.sort()
    return `level:${levels[0]!}`
  }
  return ''
}

export type StructuralScheduleTab =
  | 'beams'
  | 'columns'
  | 'connectors'
  | 'firestops'
  | 'load-path'
  | 'audit'
  | 'bom'

export type StructuralLayerKey =
  | 'walls'
  | 'floor'
  | 'roof'
  | 'beams'
  | 'columns'
  | 'connectors'
  | 'firestop'
  | 'foundation'

export type UiStudSize = StudSize | 'auto'

export type StructuralUiState = {
  codeEdition: StructuralDesignParams['codeEdition']
  species: LumberSpecies
  studSize: UiStudSize
  studSpacingIn: StudSpacingIn
  floorSystem: FloorSystemKind
  roofSystem: RoofSystemKind
  groundSnowPsf: number
  windMph: number
  exposure: ExposureCategory
  seismicCategory: SeismicCategory
  frostDepthIn: number
  soilBearingPsf: number
  /** Only design fields explicitly edited by the user in the UI panel (so persisted assembly.designParams are never silently clobbered). */
  editedDesignParams: Partial<StructuralDesignParams>
  preferredBeamFamily: BeamMaterialFamily
  preferredColumnType: ColumnType
  activeTab: StructuralScheduleTab
  xrayActive: boolean
  wallModeBeforeXray: string | null
  /** IDs of architectural `roof`, `roof-segment`, and `ceiling` nodes hidden while Framing X-Ray is enabled. */
  xrayHiddenNodeIds: string[]
  /** Last observed project/scene identity key so cross-project switches reset stale UI overrides. */
  lastSceneKey: string | null
  hiddenLayers: Readonly<Record<StructuralLayerKey, boolean>>
  setCodeEdition: (v: StructuralDesignParams['codeEdition']) => void
  setSpecies: (v: LumberSpecies) => void
  setStudSize: (v: UiStudSize) => void
  setStudSpacingIn: (v: StudSpacingIn) => void
  setFloorSystem: (v: FloorSystemKind) => void
  setRoofSystem: (v: RoofSystemKind) => void
  setGroundSnowPsf: (v: number) => void
  setWindMph: (v: number) => void
  setExposure: (v: ExposureCategory) => void
  setSeismicCategory: (v: SeismicCategory) => void
  setFrostDepthIn: (v: number) => void
  setSoilBearingPsf: (v: number) => void
  setPreferredBeamFamily: (v: BeamMaterialFamily) => void
  setPreferredColumnType: (v: ColumnType) => void
  setActiveTab: (v: StructuralScheduleTab) => void
  setXrayActive: (v: boolean) => void
  setWallModeBeforeXray: (v: string | null) => void
  setXrayHiddenNodeIds: (ids: string[]) => void
  syncSceneKey: (sceneKey: string) => void
  toggleLayerVisibility: (layer: StructuralLayerKey) => void
  resetDesignDefaults: () => void
}

const DEFAULT_HIDDEN_LAYERS: Readonly<Record<StructuralLayerKey, boolean>> = {
  walls: false,
  floor: false,
  roof: false,
  beams: false,
  columns: false,
  connectors: false,
  firestop: false,
  foundation: false,
}

export const useStructuralUi = create<StructuralUiState>((set) => ({
  codeEdition: DEFAULT_DESIGN_PARAMS.codeEdition,
  species: DEFAULT_DESIGN_PARAMS.species,
  studSize: 'auto',
  studSpacingIn: 16,
  floorSystem: 'tji-ijoist',
  roofSystem: 'stick-rafter',
  groundSnowPsf: DEFAULT_DESIGN_PARAMS.groundSnowPsf,
  windMph: DEFAULT_DESIGN_PARAMS.windMph,
  exposure: DEFAULT_DESIGN_PARAMS.exposure,
  seismicCategory: DEFAULT_DESIGN_PARAMS.seismicCategory,
  frostDepthIn: DEFAULT_DESIGN_PARAMS.frostDepthIn,
  soilBearingPsf: DEFAULT_DESIGN_PARAMS.soilBearingPsf,
  editedDesignParams: {},
  preferredBeamFamily: 'lvl',
  preferredColumnType: 'wood-solid',
  activeTab: 'beams',
  xrayActive: false,
  wallModeBeforeXray: null,
  xrayHiddenNodeIds: [],
  lastSceneKey: null,
  hiddenLayers: { ...DEFAULT_HIDDEN_LAYERS },

  setCodeEdition: (codeEdition) =>
    set((s) => ({ codeEdition, editedDesignParams: { ...s.editedDesignParams, codeEdition } })),
  setSpecies: (species) =>
    set((s) => ({ species, editedDesignParams: { ...s.editedDesignParams, species } })),
  setStudSize: (studSize) => set({ studSize }),
  setStudSpacingIn: (studSpacingIn) => set({ studSpacingIn }),
  setFloorSystem: (floorSystem) => set({ floorSystem }),
  setRoofSystem: (roofSystem) => set({ roofSystem }),
  setGroundSnowPsf: (groundSnowPsf) => {
    const clamped = Math.max(0, Math.min(200, groundSnowPsf))
    set((s) => ({ groundSnowPsf: clamped, editedDesignParams: { ...s.editedDesignParams, groundSnowPsf: clamped } }))
  },
  setWindMph: (windMph) => {
    const clamped = Math.max(85, Math.min(200, windMph))
    set((s) => ({ windMph: clamped, editedDesignParams: { ...s.editedDesignParams, windMph: clamped } }))
  },
  setExposure: (exposure) =>
    set((s) => ({ exposure, editedDesignParams: { ...s.editedDesignParams, exposure } })),
  setSeismicCategory: (seismicCategory) =>
    set((s) => ({ seismicCategory, editedDesignParams: { ...s.editedDesignParams, seismicCategory } })),
  setFrostDepthIn: (frostDepthIn) => {
    const clamped = Math.max(0, Math.min(96, frostDepthIn))
    set((s) => ({ frostDepthIn: clamped, editedDesignParams: { ...s.editedDesignParams, frostDepthIn: clamped } }))
  },
  setSoilBearingPsf: (soilBearingPsf) => {
    const clamped = Math.max(1000, Math.min(6000, soilBearingPsf))
    set((s) => ({ soilBearingPsf: clamped, editedDesignParams: { ...s.editedDesignParams, soilBearingPsf: clamped } }))
  },
  setPreferredBeamFamily: (preferredBeamFamily) => set({ preferredBeamFamily }),
  setPreferredColumnType: (preferredColumnType) => set({ preferredColumnType }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setXrayActive: (xrayActive) => set({ xrayActive }),
  setWallModeBeforeXray: (wallModeBeforeXray) => set({ wallModeBeforeXray }),
  setXrayHiddenNodeIds: (xrayHiddenNodeIds) => set({ xrayHiddenNodeIds }),
  syncSceneKey: (sceneKey) =>
    set((s) => {
      if (!sceneKey) return s
      if (s.lastSceneKey === sceneKey) return s
      if (s.lastSceneKey === null) return { lastSceneKey: sceneKey }
      // Switched to a different project/scene: reset stale design overrides & X-Ray tracking
      return {
        lastSceneKey: sceneKey,
        codeEdition: DEFAULT_DESIGN_PARAMS.codeEdition,
        species: DEFAULT_DESIGN_PARAMS.species,
        studSize: 'auto',
        studSpacingIn: 16,
        floorSystem: 'tji-ijoist',
        roofSystem: 'stick-rafter',
        groundSnowPsf: DEFAULT_DESIGN_PARAMS.groundSnowPsf,
        windMph: DEFAULT_DESIGN_PARAMS.windMph,
        exposure: DEFAULT_DESIGN_PARAMS.exposure,
        seismicCategory: DEFAULT_DESIGN_PARAMS.seismicCategory,
        frostDepthIn: DEFAULT_DESIGN_PARAMS.frostDepthIn,
        soilBearingPsf: DEFAULT_DESIGN_PARAMS.soilBearingPsf,
        editedDesignParams: {},
        preferredBeamFamily: 'lvl',
        preferredColumnType: 'wood-solid',
        xrayActive: false,
        wallModeBeforeXray: null,
        xrayHiddenNodeIds: [],
        hiddenLayers: { ...DEFAULT_HIDDEN_LAYERS },
      }
    }),
  toggleLayerVisibility: (layer) =>
    set((s) => ({
      hiddenLayers: { ...s.hiddenLayers, [layer]: !s.hiddenLayers[layer] },
    })),
  resetDesignDefaults: () =>
    set({
      codeEdition: DEFAULT_DESIGN_PARAMS.codeEdition,
      species: DEFAULT_DESIGN_PARAMS.species,
      studSize: 'auto',
      studSpacingIn: 16,
      floorSystem: 'tji-ijoist',
      roofSystem: 'stick-rafter',
      groundSnowPsf: DEFAULT_DESIGN_PARAMS.groundSnowPsf,
      windMph: DEFAULT_DESIGN_PARAMS.windMph,
      exposure: DEFAULT_DESIGN_PARAMS.exposure,
      seismicCategory: DEFAULT_DESIGN_PARAMS.seismicCategory,
      frostDepthIn: DEFAULT_DESIGN_PARAMS.frostDepthIn,
      soilBearingPsf: DEFAULT_DESIGN_PARAMS.soilBearingPsf,
      editedDesignParams: {},
      preferredBeamFamily: 'lvl',
      preferredColumnType: 'wood-solid',
    }),
}))

export function selectDesignParamsFromUi(s: StructuralUiState): Partial<StructuralDesignParams> {
  return {
    codeEdition: s.codeEdition,
    species: s.species,
    groundSnowPsf: s.groundSnowPsf,
    windMph: s.windMph,
    exposure: s.exposure,
    seismicCategory: s.seismicCategory,
    frostDepthIn: s.frostDepthIn,
    soilBearingPsf: s.soilBearingPsf,
  }
}
