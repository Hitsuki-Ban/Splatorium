import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Vector3 } from 'three'

/** OrbitControls（makeDefault）に触るための最小限の構造型 */
export type ControlsLike = { target: Vector3; update: () => void }

export function useOrbitControls(): ControlsLike | null {
  return useThree((state) => state.controls) as unknown as ControlsLike | null
}

/**
 * signal のインクリメントでカメラを初期位置へ戻す（Home / 視点リセットボタン用）。
 * Canvas 外の UI からはカウンター state を上げるだけで発火できる。
 */
export function CameraReset({
  signal,
  position,
  target = [0, 0, 0],
}: {
  signal: number
  position: [number, number, number]
  target?: [number, number, number]
}) {
  const camera = useThree((state) => state.camera)
  const controls = useOrbitControls()
  const prev = useRef(signal)

  useEffect(() => {
    if (signal === prev.current) return
    prev.current = signal
    camera.position.set(...position)
    if (controls) {
      controls.target.set(...target)
      controls.update()
    }
  }, [signal, camera, controls, position, target])

  return null
}
