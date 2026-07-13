import type { SceneTransform } from '@splatorium/shared'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export function matrixFromSceneTransform(transform: SceneTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotation, 'XYZ')),
    new Vector3(...transform.scale),
  )
}
