import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CameraReset } from '@/components/viewport-camera'
import { Button } from '@/components/ui/button'
import { PREVIEW_CAMERA_POSITION, VIEWER_FOV } from '@/lib/camera-presets'

type LoadState =
  | { phase: 'loading'; percent: number | null }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

/**
 * Spark は WebGLRenderer ごとに 1 つの SparkRenderer を scene に置く方式
 * (README 推奨)。SplatMesh は url ごとに生成し、切替・unmount 時に dispose する。
 */
function SparkScene({
  url,
  onStateChange,
  onReady,
}: {
  url: string
  onStateChange: (state: LoadState) => void
  onReady?: () => void
}) {
  const { gl, scene } = useThree()
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl })
    scene.add(spark)
    return () => {
      scene.remove(spark)
      spark.dispose()
    }
  }, [gl, scene])

  useEffect(() => {
    let disposed = false
    onStateChange({ phase: 'loading', percent: null })
    const mesh = new SplatMesh({
      url,
      onProgress: (event) => {
        if (!disposed && event.lengthComputable) {
          onStateChange({
            phase: 'loading',
            percent: Math.round((event.loaded / event.total) * 100),
          })
        }
      },
    })
    // .spz は Y 軸が下向きの座標系のため上下を反転する（Spark README の作法）
    mesh.quaternion.set(1, 0, 0, 0)
    scene.add(mesh)
    mesh.initialized
      .then(() => {
        if (!disposed) {
          onStateChange({ phase: 'ready' })
          onReadyRef.current?.()
        }
      })
      .catch((err: unknown) => {
        if (!disposed) onStateChange({ phase: 'error', message: String(err) })
      })
    return () => {
      disposed = true
      scene.remove(mesh)
      mesh.dispose()
    }
  }, [url, scene, onStateChange])

  return null
}

export function SplatViewer({ url, onReady }: { url: string; onReady?: () => void }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading', percent: null })
  const [resetSignal, setResetSignal] = useState(0)

  return (
    <div className="relative size-full overflow-hidden rounded-lg border">
      {/* antialias は Splat 描画に効果がなく性能を落とすため無効 (Spark 推奨) */}
      <Canvas
        gl={{ antialias: false }}
        camera={{ position: PREVIEW_CAMERA_POSITION, fov: VIEWER_FOV }}
      >
        <SparkScene url={url} onStateChange={setState} onReady={onReady} />
        <gridHelper args={[10, 10, '#555555', '#2a2a2a']} />
        <OrbitControls makeDefault enableDamping target={[0, 0, 0]} />
        <CameraReset signal={resetSignal} position={PREVIEW_CAMERA_POSITION} />
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport labelColor="white" />
        </GizmoHelper>
      </Canvas>
      <Button
        size="icon"
        variant="outline"
        className="absolute top-3 right-3 size-8"
        aria-label="視点を初期位置へ戻す"
        title="視点を初期位置へ戻す"
        onClick={() => setResetSignal((n) => n + 1)}
      >
        <RotateCcw />
      </Button>
      {state.phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          読み込み中{state.percent !== null ? ` ${state.percent}%` : '…'}
        </div>
      )}
      {state.phase === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 px-6 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 break-all">読み込みに失敗しました: {state.message}</span>
        </div>
      )}
    </div>
  )
}
