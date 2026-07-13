import { Canvas, useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Group } from 'three'
import {
  PREVIEW_CAMERA_POSITION,
  SCENE_CAMERA_POSITION,
  VIEWER_FOV,
} from '@/lib/camera-presets'
import { assetFileUrl } from '@/lib/api'
import type { ThumbnailPlacement } from '@/lib/scene'
import { canvasToThumbnailBlob, THUMBNAIL_SIZE } from '@/lib/thumbnail'
import {
  disposeSparkRendererWhenIdle,
  requiresCovarianceTransform,
  sparkCovarianceOptions,
  splatMeshOptions,
} from '@/lib/splat-covariance'
import {
  summarizeThumbnailCapture,
  type ThumbnailCaptureResult,
} from '@/lib/thumbnail-capture-state'

export type ThumbnailCaptureSource =
  | { kind: 'splat'; assetId: string }
  | { kind: 'scene'; placements: ThumbnailPlacement[] }

interface ThumbnailCaptureProps {
  source: ThumbnailCaptureSource
  onCapture: (blob: Blob) => void
  onError: (error: unknown) => void
}

function SparkRoot({
  sparkRef,
  covariance,
}: {
  sparkRef: RefObject<SparkRenderer | null>
  covariance: boolean
}) {
  const { gl, scene } = useThree()

  useEffect(() => {
    const spark = new SparkRenderer({
      renderer: gl,
      autoUpdate: false,
      ...sparkCovarianceOptions(covariance),
    })
    sparkRef.current = spark
    scene.add(spark)
    return () => {
      sparkRef.current = null
      scene.remove(spark)
      disposeSparkRendererWhenIdle(spark)
    }
  }, [covariance, gl, scene, sparkRef])

  return null
}

function FixedCamera({ position }: { position: [number, number, number] }) {
  const { camera, invalidate } = useThree()

  useEffect(() => {
    camera.position.set(...position)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, invalidate, position])

  return null
}

function CaptureSplat({
  readyKey,
  assetId,
  placement,
  covariance,
  onSettled,
}: {
  readyKey: string
  assetId: string
  placement?: ThumbnailPlacement
  covariance: boolean
  onSettled: (key: string, result: ThumbnailCaptureResult) => void
}) {
  const groupRef = useRef<Group>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    let disposed = false
    let attached = true
    const mesh = new SplatMesh(splatMeshOptions(assetFileUrl(assetId, 'main'), covariance))
    mesh.quaternion.set(1, 0, 0, 0)
    group.add(mesh)
    void mesh.initialized
      .then(() => {
        if (!disposed) onSettled(readyKey, { ok: true })
      })
      .catch((error: unknown) => {
        if (disposed) return
        attached = false
        group.remove(mesh)
        mesh.dispose()
        onSettled(readyKey, { ok: false, error })
      })
    return () => {
      disposed = true
      if (attached) {
        group.remove(mesh)
        mesh.dispose()
      }
    }
  }, [assetId, covariance, onSettled, readyKey])

  return placement ? (
    <group
      ref={groupRef}
      matrix={placement.worldMatrix}
      matrixAutoUpdate={false}
    />
  ) : (
    <group ref={groupRef} />
  )
}

function EncodeFrame({
  ready,
  sparkRef,
  onCapture,
  onError,
}: {
  ready: boolean
  sparkRef: RefObject<SparkRenderer | null>
  onCapture: (blob: Blob) => void
  onError: (error: unknown) => void
}) {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    if (!ready) return
    const spark = sparkRef.current
    if (!spark) {
      onError(new Error('サムネイル用 Spark renderer の準備ができていません'))
      return
    }
    let cancelled = false
    void spark
      .update({ scene, camera })
      .then(async () => {
        if (cancelled) return
        if (spark.activeSplats === 0) {
          throw new Error('サムネイルに表示できる splat がありません')
        }
        spark.render(scene, camera)
        const blob = await canvasToThumbnailBlob(gl.domElement)
        if (!cancelled) onCapture(blob)
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error)
      })
    return () => {
      cancelled = true
    }
  }, [camera, gl, onCapture, onError, ready, scene, sparkRef])

  return null
}

function ThumbnailCaptureSession({
  source,
  onCapture,
  onError,
}: ThumbnailCaptureProps) {
  const [settled, setSettled] = useState<ReadonlyMap<string, ThumbnailCaptureResult>>(new Map())
  const errorReported = useRef(false)
  const sparkRef = useRef<SparkRenderer | null>(null)
  const cameraPosition =
    source.kind === 'splat' ? PREVIEW_CAMERA_POSITION : SCENE_CAMERA_POSITION
  const captures = useMemo(
    () =>
      source.kind === 'splat'
        ? [{ key: source.assetId, assetId: source.assetId, placement: undefined, covariance: false }]
        : source.placements.map((placement) => ({
            key: placement.nodeId,
            assetId: placement.assetId,
            placement,
            covariance: requiresCovarianceTransform(placement.worldMatrix),
          })),
    [source],
  )
  const markSettled = useCallback(
    (key: string, result: ThumbnailCaptureResult) => {
      setSettled((previous) => {
        if (previous.has(key)) return previous
        return new Map(previous).set(key, result)
      })
    },
    [],
  )
  const { allSettled, successfulCount, firstFailure } = summarizeThumbnailCapture(
    captures.map(({ key }) => key),
    settled,
  )
  const reportError = useCallback(
    (error: unknown) => {
      if (errorReported.current) return
      errorReported.current = true
      onError(error)
    },
    [onError],
  )
  useEffect(() => {
    if (!allSettled || successfulCount > 0) return
    reportError(firstFailure?.error ?? new Error('サムネイルに表示できる splat がありません'))
  }, [allSettled, firstFailure, reportError, successfulCount])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: -10000,
        top: 0,
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        pointerEvents: 'none',
      }}
    >
      <Canvas
        dpr={1}
        gl={{ antialias: false, preserveDrawingBuffer: true }}
        camera={{ position: cameraPosition, fov: VIEWER_FOV }}
      >
        <color attach="background" args={['#18181b']} />
        <SparkRoot
          sparkRef={sparkRef}
          covariance={captures.some(({ covariance }) => covariance)}
        />
        <FixedCamera position={cameraPosition} />
        <gridHelper args={[10, 10, '#555555', '#2a2a2a']} />
        {captures.map(({ key, assetId, placement, covariance }) => (
          <CaptureSplat
            key={key}
            readyKey={key}
            assetId={assetId}
            placement={placement}
            covariance={covariance}
            onSettled={markSettled}
          />
        ))}
        <EncodeFrame
          ready={allSettled && successfulCount > 0}
          sparkRef={sparkRef}
          onCapture={onCapture}
          onError={reportError}
        />
      </Canvas>
    </div>
  )
}

export function ThumbnailCapture(props: ThumbnailCaptureProps) {
  const sessionKey =
    props.source.kind === 'splat'
      ? `splat:${props.source.assetId}`
      : `scene:${props.source.placements
          .map(
            ({ nodeId, assetId, worldMatrix }) =>
              `${nodeId}:${assetId}:${worldMatrix.elements.join(',')}`,
          )
          .join('|')}`
  return <ThumbnailCaptureSession key={sessionKey} {...props} />
}
