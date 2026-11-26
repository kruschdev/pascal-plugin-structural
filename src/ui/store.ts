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
  type SeismicCategory,
  type StructuralDesignParams,
  type StudSize,
  type StudSpacingIn,
} from '../irc/tables'

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

export type StructuralUiState = {
  codeEdition: StructuralDesignParams['codeEdition']
  species: LumberSpecies
  studSize: StudSize
  studSpacingIn: StudSpacingIn
  floorSystem: FloorSystemKind
  roofSystem: RoofSystemKind
  groundSnowPsf: number
  windMph: number
  exposure: ExposureCategory
  seismicCategory: SeismicCategory
  frostDepthIn: number
  soilBearingPsf: number
  preferredBeamFamily: BeamMaterialFamily
  preferredColumnType: ColumnType
  activeTab: StructuralScheduleTab
  hiddenLayers: Readonly<Record<StructuralLayerKey, boolean>>
  setCodeEdition: (v: StructuralDesignParams['codeEdition']) => void
  setSpecies: (v: LumberSpecies) => void
  setStudSize: (v: StudSize) => void
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
  studSize: '2x6',
  studSpacingIn: 16,
  floorSystem: 'tji-ijoist',
  roofSystem: 'stick-rafter',
  groundSnowPsf: DEFAULT_DESIGN_PARAMS.groundSnowPsf,
  windMph: DEFAULT_DESIGN_PARAMS.windMph,
  exposure: DEFAULT_DESIGN_PARAMS.exposure,
  seismicCategory: DEFAULT_DESIGN_PARAMS.seismicCategory,
  frostDepthIn: DEFAULT_DESIGN_PARAMS.frostDepthIn,
  soilBearingPsf: DEFAULT_DESIGN_PARAMS.soilBearingPsf,
  preferredBeamFamily: 'lvl',
  preferredColumnType: 'wood-solid',
  activeTab: 'beams',
  hiddenLayers: { ...DEFAULT_HIDDEN_LAYERS },

  setCodeEdition: (codeEdition) => set({ codeEdition }),
  setSpecies: (species) => set({ species }),
  setStudSize: (studSize) => set({ studSize }),
  setStudSpacingIn: (studSpacingIn) => set({ studSpacingIn }),
  setFloorSystem: (floorSystem) => set({ floorSystem }),
  setRoofSystem: (roofSystem) => set({ roofSystem }),
  setGroundSnowPsf: (groundSnowPsf) => set({ groundSnowPsf: Math.max(0, Math.min(200, groundSnowPsf)) }),
  setWindMph: (windMph) => set({ windMph: Math.max(85, Math.min(200, windMph)) }),
  setExposure: (exposure) => set({ exposure }),
  setSeismicCategory: (seismicCategory) => set({ seismicCategory }),
  setFrostDepthIn: (frostDepthIn) => set({ frostDepthIn: Math.max(0, Math.min(96, frostDepthIn)) }),
  setSoilBearingPsf: (soilBearingPsf) => set({ soilBearingPsf: Math.max(1000, Math.min(6000, soilBearingPsf)) }),
  setPreferredBeamFamily: (preferredBeamFamily) => set({ preferredBeamFamily }),
  setPreferredColumnType: (preferredColumnType) => set({ preferredColumnType }),
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleLayerVisibility: (layer) =>
    set((s) => ({
      hiddenLayers: { ...s.hiddenLayers, [layer]: !s.hiddenLayers[layer] },
    })),
  resetDesignDefaults: () =>
    set({
      codeEdition: DEFAULT_DESIGN_PARAMS.codeEdition,
      species: DEFAULT_DESIGN_PARAMS.species,
      studSize: '2x6',
      studSpacingIn: 16,
      floorSystem: 'tji-ijoist',
      roofSystem: 'stick-rafter',
      groundSnowPsf: DEFAULT_DESIGN_PARAMS.groundSnowPsf,
      windMph: DEFAULT_DESIGN_PARAMS.windMph,
      exposure: DEFAULT_DESIGN_PARAMS.exposure,
      seismicCategory: DEFAULT_DESIGN_PARAMS.seismicCategory,
      frostDepthIn: DEFAULT_DESIGN_PARAMS.frostDepthIn,
      soilBearingPsf: DEFAULT_DESIGN_PARAMS.soilBearingPsf,
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
