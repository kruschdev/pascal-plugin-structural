/**
 * Fresh per-build PBR material factory for clean-room MIT structural 3D CAD models.
 * Editor-free and React-free: zero React, `@pascal-app/editor`, `@pascal-app/viewer`, or `next` imports.
 *
 * IMPORTANT: Always call `createStructuralMaterialPool()` fresh per build call.
 * NEVER cache global singleton materials so Pascal `<GeometrySystem>` disposal never breaks sibling meshes.
 */

import { MeshStandardMaterial } from 'three'
import type { BeamMaterialFamily, FirestopMaterial, LumberSpecies } from '../irc/tables'

export type StructuralMaterialPool = {
  lumberSpf: MeshStandardMaterial
  lumberDfl: MeshStandardMaterial
  lumberPt: MeshStandardMaterial
  lvlVeneer: MeshStandardMaterial
  glulamTimber: MeshStandardMaterial
  pslStrand: MeshStandardMaterial
  osbWeb: MeshStandardMaterial
  steelRedOxide: MeshStandardMaterial
  steelMillDark: MeshStandardMaterial
  galvanizedSteel: MeshStandardMaterial
  steelFastener: MeshStandardMaterial
  concrete: MeshStandardMaterial
  firestopMineralWool: MeshStandardMaterial
  firestopIntumescentRed: MeshStandardMaterial
  gypsumBoard: MeshStandardMaterial
  /** Subtle dark glue-line / ply-seam accent material */
  seamDark: MeshStandardMaterial
  /** Subtle galvanized embossed nail-hole / punch recess accent */
  galvanizedAccent: MeshStandardMaterial
  dispose: () => void
}

export function createStructuralMaterialPool(): StructuralMaterialPool {
  const created: MeshStandardMaterial[] = []
  const make = (params: ConstructorParameters<typeof MeshStandardMaterial>[0]) => {
    const mat = new MeshStandardMaterial(params)
    created.push(mat)
    return mat
  }

  return {
    lumberSpf: make({ color: 0xdcb98a, roughness: 0.82, metalness: 0.02 }),
    lumberDfl: make({ color: 0xc68b59, roughness: 0.78, metalness: 0.02 }),
    lumberPt: make({ color: 0x6b7c54, roughness: 0.84, metalness: 0.02 }),
    lvlVeneer: make({ color: 0xc99652, roughness: 0.72, metalness: 0.03 }),
    glulamTimber: make({ color: 0xb87634, roughness: 0.62, metalness: 0.04 }),
    pslStrand: make({ color: 0x8e5c34, roughness: 0.76, metalness: 0.03 }),
    osbWeb: make({ color: 0xc7a368, roughness: 0.88, metalness: 0.01 }),
    steelRedOxide: make({ color: 0x7c2d23, roughness: 0.56, metalness: 0.42 }),
    steelMillDark: make({ color: 0x334155, roughness: 0.50, metalness: 0.78 }),
    galvanizedSteel: make({ color: 0xb8c4d0, roughness: 0.32, metalness: 0.86 }),
    steelFastener: make({ color: 0x475569, roughness: 0.28, metalness: 0.90 }),
    concrete: make({ color: 0x9ca3af, roughness: 0.92, metalness: 0.02 }),
    firestopMineralWool: make({ color: 0x787452, roughness: 0.96, metalness: 0.0 }),
    firestopIntumescentRed: make({ color: 0xb91c1c, roughness: 0.46, metalness: 0.10 }),
    gypsumBoard: make({ color: 0xe5e7eb, roughness: 0.90, metalness: 0.0 }),
    seamDark: make({ color: 0x3b2a1d, roughness: 0.88, metalness: 0.04 }),
    galvanizedAccent: make({ color: 0x64748b, roughness: 0.44, metalness: 0.76 }),
    dispose: () => {
      for (const mat of created) {
        mat.dispose()
      }
    },
  }
}

export function lumberMaterialForSpecies(
  pool: StructuralMaterialPool,
  species: LumberSpecies,
): MeshStandardMaterial {
  switch (species) {
    case 'df-l-2':
      return pool.lumberDfl
    case 'syp-2':
      return pool.lvlVeneer
    case 'spf-2':
    case 'hem-fir-2':
      return pool.lumberSpf
  }
}

export function beamMaterialForFamily(
  pool: StructuralMaterialPool,
  family: BeamMaterialFamily,
): MeshStandardMaterial {
  switch (family) {
    case 'dimensional-built-up':
      return pool.lumberDfl
    case 'lvl':
      return pool.lvlVeneer
    case 'psl':
      return pool.pslStrand
    case 'lsl':
      return pool.osbWeb
    case 'glulam':
      return pool.glulamTimber
    case 'steel-w':
      return pool.steelRedOxide
    case 'flitch':
      return pool.lumberDfl
  }
}

export function firestopMaterialForKind(
  pool: StructuralMaterialPool,
  material: FirestopMaterial,
): MeshStandardMaterial {
  switch (material) {
    case '2x-lumber':
    case 'double-1x':
      return pool.lumberSpf
    case '23/32-osb':
      return pool.osbWeb
    case '1/2-gypsum':
      return pool.gypsumBoard
    case 'mineral-wool-batt':
      return pool.firestopMineralWool
    case 'intumescent-collar':
      return pool.firestopIntumescentRed
  }
}
