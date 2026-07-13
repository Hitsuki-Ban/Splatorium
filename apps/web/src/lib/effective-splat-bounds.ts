import { Box3, Vector3, type Color, type Quaternion } from 'three'

const LOWER_CENTER_PERCENTILE = 0.01
const UPPER_CENTER_PERCENTILE = 0.99

type SplatCallback = (
  index: number,
  center: Vector3,
  scales: Vector3,
  quaternion: Quaternion,
  opacity: number,
  color: Color,
) => void

export interface SplatBoundsSource {
  minRaycastOpacity: number
  forEachSplat(callback: SplatCallback): void
}

const boundsCache = new WeakMap<SplatBoundsSource, Box3>()

function percentileBounds(values: number[]): [number, number] {
  values.sort((a, b) => a - b)
  const last = values.length - 1
  return [
    values[Math.floor(last * LOWER_CENTER_PERCENTILE)],
    values[Math.ceil(last * UPPER_CENTER_PERCENTILE)],
  ]
}

function expandBySplat(
  box: Box3,
  center: Vector3,
  scales: Vector3,
  quaternion: Quaternion,
  corner: Vector3,
) {
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        corner
          .set(x * scales.x, y * scales.y, z * scales.z)
          .applyQuaternion(quaternion)
          .add(center)
        box.expandByPoint(corner)
      }
    }
  }
}

export function computeEffectiveSplatLocalBox(source: SplatBoundsSource): Box3 {
  const minOpacity = source.minRaycastOpacity
  if (!Number.isFinite(minOpacity) || minOpacity < 0 || minOpacity > 1) {
    throw new Error('splat の minRaycastOpacity は 0 以上 1 以下である必要があります')
  }

  const centersX: number[] = []
  const centersY: number[] = []
  const centersZ: number[] = []
  source.forEachSplat((_index, center, _scales, _quaternion, opacity) => {
    if (opacity < minOpacity) return
    centersX.push(center.x)
    centersY.push(center.y)
    centersZ.push(center.z)
  })

  if (centersX.length === 0) {
    throw new Error(`opacity ${minOpacity} 以上の splat がありません`)
  }

  const [minX, maxX] = percentileBounds(centersX)
  const [minY, maxY] = percentileBounds(centersY)
  const [minZ, maxZ] = percentileBounds(centersZ)
  const box = new Box3()
  const corner = new Vector3()

  source.forEachSplat((_index, center, scales, quaternion, opacity) => {
    if (
      opacity < minOpacity ||
      center.x < minX ||
      center.x > maxX ||
      center.y < minY ||
      center.y > maxY ||
      center.z < minZ ||
      center.z > maxZ
    ) {
      return
    }
    expandBySplat(box, center, scales, quaternion, corner)
  })

  if (box.isEmpty()) {
    throw new Error('実効境界に含められる splat がありません')
  }
  return box
}

export function getEffectiveSplatLocalBox(source: SplatBoundsSource): Box3 {
  const cached = boundsCache.get(source)
  if (cached) return cached.clone()

  // Workbench の asset splat は immutable なので、mesh の寿命中は再計算しない。
  const box = computeEffectiveSplatLocalBox(source)
  boundsCache.set(source, box)
  return box.clone()
}
