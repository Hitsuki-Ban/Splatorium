import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MathUtils, Vector3, type Group, type Mesh, type PerspectiveCamera } from 'three'

const HANDLE_PIXELS = 16
const DRAG_PIXELS_PER_SCALE = 100
const MIN_SCALE_FACTOR = 0.01

interface DragState {
  pointerId: number
  startX: number
  startY: number
  initialScale: Vector3
  target: PointerCaptureTarget
  object: Group
  canvas: HTMLCanvasElement
  controls: { enabled: boolean } | null
  controlsEnabled: boolean | null
  onObjectChange: () => void
  onCommit: () => void
}

interface PointerCaptureTarget {
  hasPointerCapture: (pointerId: number) => boolean
  setPointerCapture: (pointerId: number) => void
  releasePointerCapture: (pointerId: number) => void
}

export function UniformScaleControl({
  object,
  snapping,
  scaleSnap,
  onDragStart,
  onObjectChange,
  onCommit,
}: {
  object: Group
  snapping: boolean
  scaleSnap: number
  onDragStart: () => void
  onObjectChange: () => void
  onCommit: () => void
}) {
  const handleRef = useRef<Mesh>(null)
  const dragRef = useRef<DragState | null>(null)
  const worldPositionRef = useRef(new Vector3())
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null
  const gl = useThree((state) => state.gl)
  const canvas = gl.domElement

  const finalizeDrag = useCallback(
    (canceled: boolean, pointerId?: number, updateState = true) => {
      const drag = dragRef.current
      if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return
      dragRef.current = null
      if (drag.target.hasPointerCapture(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId)
      }
      if (canceled) {
        drag.object.scale.copy(drag.initialScale)
        drag.onObjectChange()
      }
      if (updateState) {
        setDragging(false)
        setHovered(false)
      }
      drag.canvas.style.cursor = ''
      if (drag.controls && drag.controlsEnabled !== null) {
        drag.controls.enabled = drag.controlsEnabled
      }
      drag.onCommit()
    },
    [],
  )

  useEffect(() => {
    const cancelPointer = (event: PointerEvent) => finalizeDrag(true, event.pointerId)
    const cancelWindow = () => finalizeDrag(true)
    const cancelEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dragRef.current === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      finalizeDrag(true)
    }
    canvas.addEventListener('pointercancel', cancelPointer, true)
    canvas.addEventListener('lostpointercapture', cancelPointer, true)
    window.addEventListener('blur', cancelWindow)
    window.addEventListener('keydown', cancelEscape, true)
    setDragging(false)
    setHovered(false)
    return () => {
      canvas.removeEventListener('pointercancel', cancelPointer, true)
      canvas.removeEventListener('lostpointercapture', cancelPointer, true)
      window.removeEventListener('blur', cancelWindow)
      window.removeEventListener('keydown', cancelEscape, true)
      finalizeDrag(true, undefined, false)
      canvas.style.cursor = ''
    }
  }, [canvas, finalizeDrag, object])

  useFrame(({ camera, size }) => {
    const handle = handleRef.current
    if (!handle) return
    object.getWorldPosition(worldPositionRef.current)
    handle.position.copy(worldPositionRef.current)
    const perspective = camera as PerspectiveCamera
    const viewportHeight =
      2 *
      perspective.position.distanceTo(worldPositionRef.current) *
      Math.tan(MathUtils.degToRad(perspective.fov) / 2)
    handle.scale.setScalar((viewportHeight * HANDLE_PIXELS) / size.height)
  })

  return (
    <mesh
      ref={handleRef}
      renderOrder={1_000}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
        gl.domElement.style.cursor = 'ew-resize'
      }}
      onPointerOut={() => {
        setHovered(false)
        if (!dragRef.current) gl.domElement.style.cursor = ''
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        const target = event.target as unknown as Partial<PointerCaptureTarget>
        if (
          typeof target.setPointerCapture !== 'function' ||
          typeof target.hasPointerCapture !== 'function' ||
          typeof target.releasePointerCapture !== 'function'
        ) {
          throw new Error('uniform scale pointer capture is unavailable')
        }
        target.setPointerCapture(event.pointerId)
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.nativeEvent.clientX,
          startY: event.nativeEvent.clientY,
          initialScale: object.scale.clone(),
          target: target as PointerCaptureTarget,
          object,
          canvas,
          controls,
          controlsEnabled: controls?.enabled ?? null,
          onObjectChange,
          onCommit,
        }
        setDragging(true)
        if (controls) controls.enabled = false
        onDragStart()
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        event.stopPropagation()
        const factor = calculateUniformScaleFactor(
          drag.startX,
          drag.startY,
          event.nativeEvent.clientX,
          event.nativeEvent.clientY,
          snapping ? scaleSnap : null,
        )
        object.scale.copy(drag.initialScale).multiplyScalar(factor)
        onObjectChange()
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        finalizeDrag(false, event.pointerId)
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color={
          hovered ||
          (dragging && dragRef.current?.object === object && dragRef.current.canvas === canvas)
            ? 0xf59e0b
            : 0xffffff
        }
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.9}
      />
    </mesh>
  )
}

export function calculateUniformScaleFactor(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  snap: number | null,
): number {
  const delta = currentX - startX - (currentY - startY)
  const raw = Math.max(MIN_SCALE_FACTOR, 1 + delta / DRAG_PIXELS_PER_SCALE)
  if (snap === null) return raw
  if (!Number.isFinite(snap) || snap <= 0) throw new Error('scale snap must be positive')
  return Math.max(snap, Math.round(raw / snap) * snap)
}
