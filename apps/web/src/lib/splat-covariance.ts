import type { SparkRenderer, SparkRendererOptions } from '@sparkjsdev/spark'
import type { Matrix4 } from 'three'

const SIMILARITY_RELATIVE_TOLERANCE = 1e-6

export interface CovarianceSplatMeshOptions {
  url: string
  extSplats?: true
  covSplats?: true
}

/**
 * Spark の通常 transform が正確に表現できる、正の等比拡縮 + 回転かを判定する。
 * 線形 3x3 の Gram matrix が s^2 I でない場合と reflection は covariance が必要。
 */
export function requiresCovarianceTransform(matrix: Matrix4): boolean {
  const e = matrix.elements
  const x0 = e[0]
  const x1 = e[1]
  const x2 = e[2]
  const y0 = e[4]
  const y1 = e[5]
  const y2 = e[6]
  const z0 = e[8]
  const z1 = e[9]
  const z2 = e[10]
  const values = [x0, x1, x2, y0, y1, y2, z0, z1, z2]
  if (values.some((value) => !Number.isFinite(value))) return true

  const xx = x0 * x0 + x1 * x1 + x2 * x2
  const yy = y0 * y0 + y1 * y1 + y2 * y2
  const zz = z0 * z0 + z1 * z1 + z2 * z2
  const scaleSquared = Math.max(xx, yy, zz)
  if (scaleSquared === 0 || matrix.determinant() <= 0) return true

  const tolerance = scaleSquared * SIMILARITY_RELATIVE_TOLERANCE
  const xy = x0 * y0 + x1 * y1 + x2 * y2
  const xz = x0 * z0 + x1 * z1 + x2 * z2
  const yz = y0 * z0 + y1 * z1 + y2 * z2
  return (
    Math.abs(xx - yy) > tolerance ||
    Math.abs(xx - zz) > tolerance ||
    Math.abs(xy) > tolerance ||
    Math.abs(xz) > tolerance ||
    Math.abs(yz) > tolerance
  )
}

/** 軸別ギズモの drag 開始前から選択 subtree を covariance 経路へ準備する。 */
export function shouldUseCovarianceSplats(matrix: Matrix4, axisScalePrewarm: boolean): boolean {
  return axisScalePrewarm || requiresCovarianceTransform(matrix)
}

export function splatMeshOptions(
  url: string,
  covariance: boolean,
): CovarianceSplatMeshOptions {
  return covariance ? { url, extSplats: true, covSplats: true } : { url }
}

export function sparkCovarianceOptions(
  covariance: boolean,
): Pick<SparkRendererOptions, 'covSplats' | 'accumExtSplats'> {
  return covariance ? { covSplats: true, accumExtSplats: true } : {}
}

/**
 * Spark 2.1 の dispose は進行中の sort worker を即時 terminate するため、unmount 時は
 * 新規 update を止め、保留 timer を消し、現在の sort が完了してから解放する。
 */
export function disposeSparkRendererWhenIdle(renderer: SparkRenderer): void {
  renderer.autoUpdate = false
  renderer.sortDirty = false
  if (renderer.updateTimeoutId !== -1) {
    window.clearTimeout(renderer.updateTimeoutId)
    renderer.updateTimeoutId = -1
  }
  if (renderer.sortTimeoutId !== -1) {
    window.clearTimeout(renderer.sortTimeoutId)
    renderer.sortTimeoutId = -1
  }

  const dispose = () => {
    if (renderer.sorting) {
      window.setTimeout(dispose, 16)
      return
    }
    renderer.dispose()
  }
  window.setTimeout(dispose, 0)
}
