import { describe, expect, test } from 'bun:test'
import { type InstancedMesh, Matrix4, Vector3 } from 'three'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import type { SceneNodeLike } from '../irc/tables'

function makeDualRoofScene(roofSystem: 'stick-rafter' | 'fink-truss' = 'stick-rafter') {
  const H2 = 2.4384
  const nodes: Record<string, SceneNodeLike> = {
    level_1: { id: 'level_1', type: 'level', level: 1, height: H2, baseElevation: 0 },
    roof_main: {
      id: 'roof_main',
      type: 'roof',
      parentId: 'level_1',
      visible: true,
      position: [0, H2, 0],
      rotation: 0,
    },
    rseg_main: {
      id: 'rseg_main',
      type: 'roof-segment',
      parentId: 'roof_main',
      visible: true,
      position: [0, 0, 0],
      rotation: 0,
      roofType: 'gable',
      width: 10.98,
      depth: 7.32,
      pitch: 33.69, // 8:12
      overhang: 0.45,
      wallHeight: 0,
    },
    roof_cross: {
      id: 'roof_cross',
      type: 'roof',
      parentId: 'level_1',
      visible: true,
      position: [-2.74, H2, 1.95],
      rotation: Math.PI / 2,
    },
    rseg_cross: {
      id: 'rseg_cross',
      type: 'roof-segment',
      parentId: 'roof_cross',
      visible: true,
      position: [0, 0, 0],
      rotation: 0,
      roofType: 'gable',
      width: 3.42, // extends back to z = 0.24 well behind valley intersection z ≈ 1.035!
      depth: 4.2,
      pitch: 39.81, // 10:12
      overhang: 0.42,
      wallHeight: 0,
    },
  }
  const assembly: SceneNodeLike = {
    id: 'strasm_test',
    type: 'structural:assembly',
    parentId: 'level_1',
    visible: true,
    species: 'df-l-2',
    studSize: '2x6',
    studSpacingIn: 16,
    floorSystem: 'tji-ijoist',
    roofSystem,
    wallHeightM: H2,
    visibleSystems: {
      walls: false,
      floor: false,
      roof: true,
      beams: true,
      columns: false,
      connectors: true,
      firestop: false,
      foundation: false,
    },
  }
  return { H2, nodes, assembly }
}

/** Sample all 8 world-space corners of every instanced member box in `bucketName`. */
function extractBucketInstances(group: ReturnType<typeof buildBuildingSkeletonGroup>, bucketName: string) {
  const inst = group.children.find((c) => c.name === `structural-skeleton-${bucketName}`) as InstancedMesh | undefined
  if (!inst) return []
  const out: Array<{ center: Vector3; corners: Vector3[] }> = []
  const mat = new Matrix4()
  const localCorners = [
    new Vector3(-0.5, -0.5, -0.5),
    new Vector3(-0.5, -0.5, 0.5),
    new Vector3(-0.5, 0.5, -0.5),
    new Vector3(-0.5, 0.5, 0.5),
    new Vector3(0.5, -0.5, -0.5),
    new Vector3(0.5, -0.5, 0.5),
    new Vector3(0.5, 0.5, -0.5),
    new Vector3(0.5, 0.5, 0.5),
  ]
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, mat)
    const center = new Vector3().setFromMatrixPosition(mat)
    const corners = localCorners.map((c) => c.clone().applyMatrix4(mat))
    out.push({ center, corners })
  }
  return out
}

describe('Dual-roof California over-frame valley clipping', () => {
  test('clips 10:12 cross-gable rafters & ridge cleanly above the 8:12 main roof with valley sleepers', () => {
    const { H2, nodes, assembly } = makeDualRoofScene('stick-rafter')

    // Build main-only baseline vs dual-roof scene
    const mainOnlyNodes = { ...nodes }
    delete mainOnlyNodes.roof_cross
    delete mainOnlyNodes.rseg_cross

    const mainGroup = buildBuildingSkeletonGroup({ assembly, nodes: mainOnlyNodes })
    const dualGroup = buildBuildingSkeletonGroup({ assembly, nodes })

    const mainLumber = extractBucketInstances(mainGroup, 'lumber')
    const dualLumber = extractBucketInstances(dualGroup, 'lumber')
    const dualLvl = extractBucketInstances(dualGroup, 'header-lvl')

    // Extra lumber members added by the cross-gable (after mainGroup's members)
    const crossLumber = dualLumber.slice(mainLumber.length)
    expect(crossLumber.length).toBeGreaterThan(8)

    // Main 8:12 south roof plane height: y_main(z) = H2 + (3.66 - |z|) * tan(33.69 deg)
    const mainSlopeTan = Math.tan((33.69 * Math.PI) / 180)
    const mainSurfaceY = (z: number) => H2 + (3.66 - Math.abs(z)) * mainSlopeTan

    // ZERO cross-gable lumber centers may plunge deeply beneath the main 8:12 roof into the house interior!
    // (Allow half a rafter depth ~0.12 m tolerance for centerline thickness & front gable face at z ≈ 3.66)
    for (const m of crossLumber) {
      if (m.center.z < 3.55) {
        const yMain = mainSurfaceY(m.center.z)
        expect(m.center.y).toBeGreaterThanOrEqual(yMain - 0.14)
      }
      // Cross-gable ridge hits main roof at z ≈ 1.035; zero cross-gable lumber should extend behind z = 0.90!
      expect(m.center.z).toBeGreaterThan(0.9)
    }

    // LVL bucket must contain: 1 main ridge + 1 clipped cross-gable ridge + 2 diagonal valley sleepers = 4 members
    expect(dualLvl.length).toBe(4)

    // Verify clipped cross-gable ridge does NOT extend behind the valley intersection (z ≈ 1.035)
    const crossRidge = dualLvl[1]!
    const minRidgeZ = Math.min(...crossRidge.corners.map((c) => c.z))
    expect(minRidgeZ).toBeGreaterThan(0.95)
    expect(minRidgeZ).toBeLessThan(1.15)
  })

  test('clips over-framed cross-gable trusses cleanly in fink-truss mode without penetrating main roof', () => {
    const { H2, nodes, assembly } = makeDualRoofScene('fink-truss')
    const mainOnlyNodes = { ...nodes }
    delete mainOnlyNodes.roof_cross
    delete mainOnlyNodes.rseg_cross

    const mainGroup = buildBuildingSkeletonGroup({ assembly, nodes: mainOnlyNodes })
    const dualGroup = buildBuildingSkeletonGroup({ assembly, nodes })

    const mainLumber = extractBucketInstances(mainGroup, 'lumber')
    const dualLumber = extractBucketInstances(dualGroup, 'lumber')
    const crossLumber = dualLumber.slice(mainLumber.length)
    expect(crossLumber.length).toBeGreaterThan(6)

    const mainSlopeTan = Math.tan((33.69 * Math.PI) / 180)
    const mainSurfaceY = (z: number) => H2 + (3.66 - Math.abs(z)) * mainSlopeTan

    for (const m of crossLumber) {
      if (m.center.z < 3.55) {
        expect(m.center.y).toBeGreaterThanOrEqual(mainSurfaceY(m.center.z) - 0.14)
      }
      expect(m.center.z).toBeGreaterThan(0.9)
    }
  })
})
