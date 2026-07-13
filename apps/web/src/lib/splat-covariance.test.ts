import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disposeSparkRendererWhenIdle,
  requiresCovarianceTransform,
  shouldUseCovarianceSplats,
  sparkCovarianceOptions,
  splatMeshOptions,
} from './splat-covariance'
import type { SparkRenderer } from '@sparkjsdev/spark'

afterEach(() => vi.useRealTimers())

function compose(scale: [number, number, number], rotation: [number, number, number] = [0, 0, 0]) {
  return new Matrix4().compose(
    new Vector3(4, 5, 6),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    new Vector3(...scale),
  )
}

describe('requiresCovarianceTransform', () => {
  it('keeps positive uniform transforms on the packed path', () => {
    expect(requiresCovarianceTransform(compose([1, 1, 1]))).toBe(false)
    expect(requiresCovarianceTransform(compose([3, 3, 3], [0.3, -0.7, 1.1]))).toBe(false)
    expect(requiresCovarianceTransform(compose([1e-6, 1e-6, 1e-6]))).toBe(false)
  })

  it('requires covariance for anisotropic scale, shear, reflection, and singular transforms', () => {
    expect(requiresCovarianceTransform(compose([2, 1, 1]))).toBe(true)
    expect(requiresCovarianceTransform(compose([-1, 1, 1]))).toBe(true)
    expect(requiresCovarianceTransform(compose([0, 0, 0]))).toBe(true)

    const shear = new Matrix4().set(
      1, 0.5, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    )
    expect(requiresCovarianceTransform(shear)).toBe(true)
  })

  it('uses scale-relative tolerance without hiding small anisotropy', () => {
    expect(requiresCovarianceTransform(compose([1e-6, 2e-6, 1e-6]))).toBe(true)
  })
})

describe('Spark covariance options', () => {
  it('prewarms a selected uniform subtree for live axis-scale dragging', () => {
    const uniform = compose([1, 1, 1])
    expect(shouldUseCovarianceSplats(uniform, false)).toBe(false)
    expect(shouldUseCovarianceSplats(uniform, true)).toBe(true)
  })

  it('leaves the uniform-only renderer and mesh configuration unchanged', () => {
    expect(sparkCovarianceOptions(false)).toEqual({})
    expect(splatMeshOptions('/asset.spz', false)).toEqual({ url: '/asset.spz' })
  })

  it('enables ExtSplats and both covariance stages together', () => {
    expect(sparkCovarianceOptions(true)).toEqual({ covSplats: true, accumExtSplats: true })
    expect(splatMeshOptions('/asset.spz', true)).toEqual({
      url: '/asset.spz',
      extSplats: true,
      covSplats: true,
    })
  })

  it('stops queued work and waits for an active sort before disposing', () => {
    vi.useFakeTimers()
    const renderer = {
      autoUpdate: true,
      sortDirty: true,
      sorting: true,
      updateTimeoutId: window.setTimeout(vi.fn(), 100),
      sortTimeoutId: window.setTimeout(vi.fn(), 100),
      dispose: vi.fn(),
    } as unknown as SparkRenderer

    disposeSparkRendererWhenIdle(renderer)
    expect(renderer).toMatchObject({
      autoUpdate: false,
      sortDirty: false,
      updateTimeoutId: -1,
      sortTimeoutId: -1,
    })
    vi.advanceTimersByTime(32)
    expect(renderer.dispose).not.toHaveBeenCalled()
    renderer.sorting = false
    vi.advanceTimersByTime(16)
    expect(renderer.dispose).toHaveBeenCalledOnce()
  })
})
