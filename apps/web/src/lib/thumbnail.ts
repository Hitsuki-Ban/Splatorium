export const THUMBNAIL_SIZE = 512
export const THUMBNAIL_WEBP_QUALITY = 0.82

const WEBP_MIME_TYPE = 'image/webp'
const PNG_MIME_TYPE = 'image/png'

export async function canvasToThumbnailBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  let webp: Blob | null
  try {
    webp = await canvasToBlob(canvas, WEBP_MIME_TYPE, THUMBNAIL_WEBP_QUALITY)
  } catch (cause) {
    throw new Error('サムネイルの WebP エンコードに失敗しました', { cause })
  }
  if (webp?.type === WEBP_MIME_TYPE) return webp

  let png: Blob | null
  try {
    png = await canvasToBlob(canvas, PNG_MIME_TYPE)
  } catch (cause) {
    throw new Error('サムネイルの PNG フォールバックに失敗しました', { cause })
  }
  if (!png || png.type !== PNG_MIME_TYPE) {
    throw new Error('サムネイルの PNG フォールバックが image/png を生成しませんでした')
  }
  return png
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (quality === undefined) {
      canvas.toBlob(resolve, type)
      return
    }
    canvas.toBlob(resolve, type, quality)
  })
}
