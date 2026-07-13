import { describe, expect, it, vi } from 'vitest'
import {
  canvasToThumbnailBlob,
  THUMBNAIL_SIZE,
  THUMBNAIL_WEBP_QUALITY,
} from './thumbnail'

describe('thumbnail encoding', () => {
  it('encodes a 512px thumbnail as WebP at quality 0.82', async () => {
    const webp = new Blob(['webp'], { type: 'image/webp' })
    const toBlob = vi.fn((callback: BlobCallback) => callback(webp))

    await expect(canvasToThumbnailBlob(makeCanvas(toBlob))).resolves.toBe(webp)

    expect(THUMBNAIL_SIZE).toBe(512)
    expect(THUMBNAIL_WEBP_QUALITY).toBe(0.82)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.82)
    expect(toBlob).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a null WebP result', null],
    ['a mismatched WebP MIME type', new Blob(['wrong'], { type: 'image/png' })],
  ])('falls back to PNG after %s', async (_label, webpResult) => {
    const png = new Blob(['png'], { type: 'image/png' })
    const toBlob = vi
      .fn<(callback: BlobCallback, type?: string, quality?: number) => void>()
      .mockImplementationOnce((callback) => callback(webpResult))
      .mockImplementationOnce((callback) => callback(png))

    await expect(canvasToThumbnailBlob(makeCanvas(toBlob))).resolves.toBe(png)

    expect(toBlob).toHaveBeenNthCalledWith(1, expect.any(Function), 'image/webp', 0.82)
    expect(toBlob).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/png')
  })

  it.each([
    ['a null result', null],
    ['an invalid MIME type', new Blob(['wrong'], { type: 'image/jpeg' })],
  ])('rejects when the PNG fallback returns %s', async (_label, pngResult) => {
    const toBlob = vi
      .fn<(callback: BlobCallback, type?: string, quality?: number) => void>()
      .mockImplementationOnce((callback) => callback(null))
      .mockImplementationOnce((callback) => callback(pngResult))

    await expect(canvasToThumbnailBlob(makeCanvas(toBlob))).rejects.toThrow(
      'サムネイルの PNG フォールバックが image/png を生成しませんでした',
    )
  })

  it('does not try PNG when WebP encoding throws', async () => {
    const toBlob = vi.fn(() => {
      throw new DOMException('Canvas is not origin-clean')
    })

    await expect(canvasToThumbnailBlob(makeCanvas(toBlob))).rejects.toThrow(
      'サムネイルの WebP エンコードに失敗しました',
    )
    expect(toBlob).toHaveBeenCalledTimes(1)
  })
})

function makeCanvas(toBlob: HTMLCanvasElement['toBlob']): HTMLCanvasElement {
  return { toBlob } as HTMLCanvasElement
}
