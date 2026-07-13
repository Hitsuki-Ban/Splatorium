import { Button } from '@/components/ui/button'
import * as api from '@/lib/api'
import type { Asset } from '@splatorium/shared'
import { RefreshCw, Rotate3d } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

const SplatViewer = lazy(() =>
  import('@/components/splat-viewer').then((module) => ({ default: module.SplatViewer })),
)
const ThumbnailCapture = lazy(() =>
  import('@/components/thumbnail-capture').then((module) => ({
    default: module.ThumbnailCapture,
  })),
)

type CaptureState = { phase: 'idle' | 'capturing' } | { phase: 'error'; message: string }

const activeSplatCaptures = new Set<string>()
const THUMBNAIL_CAPTURE_TIMEOUT_MS = 5_000

export function PreviewPane({
  asset,
  onAssetUpdated,
}: {
  asset: Asset | null
  onAssetUpdated: (asset: Asset) => void
}) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
      {asset?.kind === 'splat' ? (
        // key で切替時に Canvas ごと作り直し、SplatMesh の dispose を確実にする
        <Suspense fallback={<PreviewLoading label="Spark ビューアを読み込み中…" />}>
          <SplatPreview key={asset.id} asset={asset} onAssetUpdated={onAssetUpdated} />
        </Suspense>
      ) : asset?.kind === 'image' ? (
        <div className="flex size-full items-center justify-center overflow-hidden rounded-lg border">
          <img
            src={api.assetFileUrl(asset.id, 'main')}
            alt={asset.name}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex size-full items-center justify-center rounded-lg border border-dashed">
          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
            <Rotate3d className="size-10" />
            <div>
              <p className="font-medium text-foreground">3D プレビューエリア</p>
              <p className="text-sm">倉庫からアセットを選択してください</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SplatPreview({
  asset,
  onAssetUpdated,
}: {
  asset: Asset
  onAssetUpdated: (asset: Asset) => void
}) {
  const [capture, setCapture] = useState<CaptureState>({ phase: 'idle' })
  const captureRef = useRef<CaptureState>(capture)
  const nextCaptureId = useRef(0)
  const activeCaptureId = useRef<number | null>(null)
  const captureTimeout = useRef<number | null>(null)
  const uploadController = useRef<{ captureId: number; controller: AbortController } | null>(
    null,
  )
  const mounted = useRef(true)
  captureRef.current = capture

  const clearCaptureTimeout = useCallback(() => {
    if (captureTimeout.current !== null) {
      window.clearTimeout(captureTimeout.current)
      captureTimeout.current = null
    }
  }, [])

  const abortUpload = useCallback(() => {
    uploadController.current?.controller.abort()
    uploadController.current = null
  }, [])

  const releaseCapture = useCallback(
    (captureId: number) => {
      if (activeCaptureId.current !== captureId) return false
      clearCaptureTimeout()
      abortUpload()
      activeCaptureId.current = null
      activeSplatCaptures.delete(asset.id)
      return true
    },
    [abortUpload, asset.id, clearCaptureTimeout],
  )

  const finishWithErrorForRequest = useCallback(
    (captureId: number, error: unknown) => {
      if (!releaseCapture(captureId)) return
      const message = error instanceof Error ? error.message : String(error)
      if (mounted.current) {
        const next: CaptureState = { phase: 'error', message }
        captureRef.current = next
        setCapture(next)
        toast.error(`「${asset.name}」のサムネイル生成に失敗しました`, {
          description: message,
        })
      }
    },
    [asset.name, releaseCapture],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const captureId = activeCaptureId.current
      if (captureId !== null) releaseCapture(captureId)
    }
  }, [releaseCapture])

  const startCapture = useCallback(() => {
    if (
      asset.files.thumbnail ||
      captureRef.current.phase === 'capturing' ||
      activeSplatCaptures.has(asset.id)
    ) {
      return
    }
    clearCaptureTimeout()
    abortUpload()
    activeSplatCaptures.add(asset.id)
    const captureId = ++nextCaptureId.current
    activeCaptureId.current = captureId
    const next: CaptureState = { phase: 'capturing' }
    captureRef.current = next
    setCapture(next)
    captureTimeout.current = window.setTimeout(() => {
      finishWithErrorForRequest(
        captureId,
        new Error('サムネイルの生成がタイムアウトしました。'),
      )
    }, THUMBNAIL_CAPTURE_TIMEOUT_MS)
  }, [
    abortUpload,
    asset.files.thumbnail,
    asset.id,
    clearCaptureTimeout,
    finishWithErrorForRequest,
  ])

  const finishWithError = useCallback(
    (error: unknown) => {
      const captureId = activeCaptureId.current
      if (captureId !== null) finishWithErrorForRequest(captureId, error)
    },
    [finishWithErrorForRequest],
  )

  const handleCapture = useCallback(
    (blob: Blob) => {
      const captureId = activeCaptureId.current
      if (captureId === null || uploadController.current?.captureId === captureId) return
      abortUpload()
      const controller = new AbortController()
      uploadController.current = { captureId, controller }
      void api
        .uploadAssetThumbnail(asset.id, blob, controller.signal)
        .then((updated) => {
          if (!mounted.current || !releaseCapture(captureId)) return
          onAssetUpdated(updated)
          const next: CaptureState = { phase: 'idle' }
          captureRef.current = next
          setCapture(next)
        })
        .catch((error: unknown) => finishWithErrorForRequest(captureId, error))
    },
    [abortUpload, asset.id, finishWithErrorForRequest, onAssetUpdated, releaseCapture],
  )

  const source = useMemo(() => ({ kind: 'splat' as const, assetId: asset.id }), [asset.id])

  return (
    <div className="relative size-full">
      <SplatViewer url={api.assetFileUrl(asset.id, 'main')} onReady={startCapture} />
      {capture.phase === 'capturing' && (
        <Suspense fallback={null}>
          <ThumbnailCapture source={source} onCapture={handleCapture} onError={finishWithError} />
        </Suspense>
      )}
      {capture.phase === 'error' && (
        <Button
          size="icon"
          variant="outline"
          className="absolute bottom-3 left-3 size-8"
          aria-label="サムネイル生成を再試行"
          title={`サムネイル生成を再試行: ${capture.message}`}
          onClick={startCapture}
        >
          <RefreshCw />
        </Button>
      )}
    </div>
  )
}

function PreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex size-full items-center justify-center rounded-lg border text-sm text-muted-foreground">
      {label}
    </div>
  )
}
