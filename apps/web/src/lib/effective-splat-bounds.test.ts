import { Box3, Color, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  computeEffectiveSplatLocalBox,
  getEffectiveSplatLocalBox,
  type SplatBoundsSource,
} from './effective-splat-bounds'

interface TestSplat {
  center: Vector3
  scales: Vector3
  quaternion: Quaternion
  opacity: number
}

function makeSplat({
  center = new Vector3(),
  scales = new Vector3(1, 1, 1),
  quaternion = new Quaternion(),
  opacity = 1,
}: Partial<TestSplat> = {}): TestSplat {
  return { center, scales, quaternion, opacity }
}

function makeSource(splats: TestSplat[], minRaycastOpacity = 0.2) {
  let passes = 0
  const source: SplatBoundsSource = {
    minRaycastOpacity,
    forEachSplat(callback) {
      passes += 1
      splats.forEach((splat, index) => {
        callback(
          index,
          splat.center,
          splat.scales,
          splat.quaternion,
          splat.opacity,
          new Color(),
        )
      })
    },
  }
  return { source, getPasses: () => passes }
}

function expectBox(box: Box3, min: [number, number, number], max: [number, number, number]) {
  expect(box.min.toArray()).toEqual(min)
  expect(box.max.toArray()).toEqual(max)
}

describe('effective splat bounds', () => {
  it('excludes low-opacity splats before evaluating centers and scales', () => {
    const { source } = makeSource([
      makeSplat(),
      makeSplat({
        center: new Vector3(100, 100, 100),
        scales: new Vector3(50, 50, 50),
        opacity: 0.1,
      }),
    ])

    expectBox(computeEffectiveSplatLocalBox(source), [-1, -1, -1], [1, 1, 1])
  })

  it('clips the outer one percent of visible centers on each axis', () => {
    const splats = Array.from({ length: 100 }, (_, x) =>
      makeSplat({ center: new Vector3(x, 0, 0), scales: new Vector3(0.5, 0.5, 0.5) }),
    )
    splats.push(makeSplat({ center: new Vector3(1000, 0, 0) }))
    const { source } = makeSource(splats)

    expectBox(computeEffectiveSplatLocalBox(source), [0.5, -0.5, -0.5], [99.5, 0.5, 0.5])
  })

  it('includes each retained splat scale and rotation in the final bounds', () => {
    const { source } = makeSource([
      makeSplat({
        scales: new Vector3(2, 1, 0.5),
        quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
      }),
    ])

    const box = computeEffectiveSplatLocalBox(source)
    expect(box.min.x).toBeCloseTo(-1)
    expect(box.min.y).toBeCloseTo(-2)
    expect(box.min.z).toBeCloseTo(-0.5)
    expect(box.max.x).toBeCloseTo(1)
    expect(box.max.y).toBeCloseTo(2)
    expect(box.max.z).toBeCloseTo(0.5)
  })

  it('caches the computed bounds but returns a clone to each caller', () => {
    const { source, getPasses } = makeSource([makeSplat()])

    const first = getEffectiveSplatLocalBox(source)
    first.min.set(-99, -99, -99)
    const second = getEffectiveSplatLocalBox(source)

    expect(getPasses()).toBe(2)
    expectBox(second, [-1, -1, -1], [1, 1, 1])
  })

  it('fails when no splat reaches the effective opacity threshold', () => {
    const { source } = makeSource([makeSplat({ opacity: 0.1 })])

    expect(() => computeEffectiveSplatLocalBox(source)).toThrow(
      'opacity 0.2 以上の splat がありません',
    )
  })
})
