import { GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box3,
  Box3Helper,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from 'three'
import { CameraReset, useOrbitControls } from '@/components/viewport-camera'
import { UniformScaleControl } from '@/components/uniform-scale-control'
import { assetFileUrl } from '@/lib/api'
import { SCENE_CAMERA_POSITION, VIEWER_FOV } from '@/lib/camera-presets'
import { getEffectiveSplatLocalBox } from '@/lib/effective-splat-bounds'
import {
  flattenSceneModels,
  getRenderableModelsForNode,
  getRenderableSceneModels,
  hasInvertibleSceneNodeParent,
  type FlattenedSceneModel,
} from '@/lib/scene'
import { findSceneNode } from '@/lib/scene-tree'
import { ASSET_DRAG_MIME, readAssetDragPayload } from '@/lib/scene-dnd'
import { isClickGesture, pointerToNdc, type PointerPosition } from '@/lib/viewport-selection'
import {
  disposeSparkRendererWhenIdle,
  shouldUseCovarianceSplats,
  splatMeshOptions,
} from '@/lib/splat-covariance'
import type { SceneNode, SceneTransform } from '@splatorium/shared'

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type ScaleMode = 'uniform' | 'axis'

export type PlacementTransform = SceneTransform

/** Ctrl 押下中の一時スナップ幅（プロツール共通の modifier-held 方式） */
export const TRANSLATION_SNAP = 0.1
export const ROTATION_SNAP = (15 * Math.PI) / 180
export const SCALE_SNAP = 0.1

const SELECTED_TINT = new Color(1, 0.82, 0.62)
const SELECTED_ACCENT = new Color(0xf59e0b)

interface SceneNodeObjects {
  group?: Group
  renderGroup?: Group
  mesh?: SplatMesh
}

function SparkRoot() {
  const { gl, scene } = useThree()

  useEffect(() => {
    // Spark 2.1 は同じ WebGL context 上で accumulator 形式を安全に熱交換できない。
    // renderer は cov 対応で固定し、32-byte Ext source の使用だけを model ごとに絞る。
    const spark = new SparkRenderer({ renderer: gl, covSplats: true, accumExtSplats: true })
    scene.add(spark)
    return () => {
      scene.remove(spark)
      disposeSparkRendererWhenIdle(spark)
    }
  }, [gl, scene])

  return null
}

function updateVisibleSplatWorldBox(target: Box3, meshes: readonly SplatMesh[]): boolean {
  target.makeEmpty()
  for (const mesh of meshes) {
    if (!mesh.isInitialized) continue
    mesh.updateWorldMatrix(true, false)
    const box = getEffectiveSplatLocalBox(mesh).applyMatrix4(mesh.matrixWorld)
    if (!box.isEmpty()) target.union(box)
  }
  return !target.isEmpty()
}

async function computeVisibleSplatWorldBox(meshes: readonly SplatMesh[]): Promise<Box3> {
  await Promise.allSettled(meshes.map((mesh) => mesh.initialized))
  const worldBox = new Box3()
  if (!updateVisibleSplatWorldBox(worldBox, meshes)) {
    throw new Error('選択ノードに表示できる境界がありません')
  }
  return worldBox
}

function updateGroundRing(ring: Mesh<RingGeometry, MeshBasicMaterial>, box: Box3): void {
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const outerRadius = Math.max(size.x, size.z, 0.4) * 0.56
  ring.position.set(center.x, box.min.y, center.z)
  ring.scale.setScalar(outerRadius)
  ring.updateMatrixWorld(true)
}

function CameraFocus({ signal, meshes }: { signal: number; meshes: readonly SplatMesh[] }) {
  const camera = useThree((state) => state.camera)
  const controls = useOrbitControls()
  const prev = useRef(0)

  useEffect(() => {
    if (signal === 0 || signal === prev.current || meshes.length === 0 || !controls) return
    prev.current = signal
    let cancelled = false
    void computeVisibleSplatWorldBox(meshes)
      .then((box) => {
        if (cancelled) return
        const center = box.getCenter(new Vector3())
        const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.25)
        const fov = (camera as PerspectiveCamera).fov
        const distance = (radius / Math.tan((fov * Math.PI) / 360)) * 1.2
        const direction = new Vector3().subVectors(camera.position, controls.target).normalize()
        camera.position.copy(center).addScaledVector(direction, distance)
        controls.target.copy(center)
        controls.update()
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error('選択ノードのフォーカスに失敗しました', error)
      })

    return () => {
      cancelled = true
    }
  }, [signal, meshes, camera, controls])

  return null
}

/**
 * 倉庫 Asset のビューポート直接 drop。ドロップ位置から地面（y=0 平面）
 * への交点を求めて配置座標にする。交点が取れない場合は原点
 */
function ViewportAssetDrop({
  onDropAsset,
  onDragActiveChange,
}: {
  onDropAsset: (assetId: string, position: [number, number, number]) => void
  onDragActiveChange: (active: boolean) => void
}) {
  const { camera, gl } = useThree()

  useEffect(() => {
    const canvas = gl.domElement
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const raycaster = new Raycaster()
    const pointer = new Vector2()

    const onDragOver = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.types.includes(ASSET_DRAG_MIME)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      onDragActiveChange(true)
    }
    const onDragLeave = () => onDragActiveChange(false)
    const onDrop = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.types.includes(ASSET_DRAG_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      onDragActiveChange(false)
      const payload = readAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
      if (!payload) return
      let position: [number, number, number] = [0, 0, 0]
      try {
        const rect = canvas.getBoundingClientRect()
        const [x, y] = pointerToNdc({ x: event.clientX, y: event.clientY }, rect)
        pointer.set(x, y)
        raycaster.setFromCamera(pointer, camera)
        const hit = new Vector3()
        if (raycaster.ray.intersectPlane(plane, hit)) {
          position = [hit.x, hit.y, hit.z]
        }
      } catch {
        // rect が空など。原点へフォールバック
      }
      onDropAsset(payload.assetId, position)
    }

    canvas.addEventListener('dragover', onDragOver)
    canvas.addEventListener('dragleave', onDragLeave)
    canvas.addEventListener('drop', onDrop)
    return () => {
      canvas.removeEventListener('dragover', onDragOver)
      canvas.removeEventListener('dragleave', onDragLeave)
      canvas.removeEventListener('drop', onDrop)
    }
  }, [camera, gl, onDropAsset, onDragActiveChange])

  return null
}

function ViewportPicker({
  getObjects,
  pickableModelIds,
  consumeSuppression,
  onSelect,
}: {
  getObjects: () => ReadonlyMap<string, SceneNodeObjects>
  pickableModelIds: ReadonlySet<string>
  consumeSuppression: () => boolean
  onSelect: (nodeId: string | null) => void
}) {
  const { camera, gl } = useThree()

  useEffect(() => {
    const canvas = gl.domElement
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    let down: (PointerPosition & { id: number }) | null = null

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      down = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const clearPointer = () => {
      down = null
    }
    const onPointerUp = (event: PointerEvent) => {
      const start = down
      down = null
      if (
        event.button !== 0 ||
        !start ||
        start.id !== event.pointerId ||
        !isClickGesture(start, { x: event.clientX, y: event.clientY }) ||
        consumeSuppression()
      ) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const [x, y] = pointerToNdc({ x: event.clientX, y: event.clientY }, rect)
      pointer.set(x, y)
      raycaster.setFromCamera(pointer, camera)

      const keyByMesh = new Map<SplatMesh, string>()
      const targets: SplatMesh[] = []
      for (const nodeId of pickableModelIds) {
        const mesh = getObjects().get(nodeId)?.mesh
        if (!mesh?.isInitialized) continue
        mesh.updateWorldMatrix(true, false)
        keyByMesh.set(mesh, nodeId)
        targets.push(mesh)
      }
      const hit = raycaster
        .intersectObjects(targets, false)
        .find((candidate) => candidate.object instanceof SplatMesh)
      onSelect(hit ? (keyByMesh.get(hit.object as SplatMesh) ?? null) : null)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', clearPointer)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', clearPointer)
    }
  }, [camera, gl, getObjects, pickableModelIds, consumeSuppression, onSelect])

  return null
}

function SelectionHighlight({
  meshes,
  showGroundRing,
  consumeTransformChange,
}: {
  meshes: readonly SplatMesh[]
  showGroundRing: boolean
  consumeTransformChange: () => boolean
}) {
  const scene = useThree((state) => state.scene)
  const helperRef = useRef<Box3Helper | null>(null)
  const ringRef = useRef<Mesh<RingGeometry, MeshBasicMaterial> | null>(null)

  useFrame(() => {
    if (!consumeTransformChange()) return
    const helper = helperRef.current
    if (!helper || !updateVisibleSplatWorldBox(helper.box, meshes)) return
    helper.updateMatrixWorld(true)
    if (ringRef.current) updateGroundRing(ringRef.current, helper.box)
  })

  useEffect(() => {
    if (meshes.length === 0) return
    let disposed = false
    let helper: Box3Helper | null = null
    let ring: Mesh<RingGeometry, MeshBasicMaterial> | null = null

    void computeVisibleSplatWorldBox(meshes)
      .then((box) => {
        if (disposed) return
        meshes.forEach((mesh) => mesh.recolor.copy(SELECTED_TINT))
        helper = new Box3Helper(box, SELECTED_ACCENT)
        helperRef.current = helper
        helper.renderOrder = 10
        const helperMaterials = Array.isArray(helper.material) ? helper.material : [helper.material]
        helperMaterials.forEach((material) => {
          material.transparent = true
          material.opacity = 0.9
          material.depthTest = false
        })

        scene.add(helper)
        if (showGroundRing) {
          const geometry = new RingGeometry(0.82, 1, 48)
          const material = new MeshBasicMaterial({
            color: SELECTED_ACCENT,
            side: DoubleSide,
            transparent: true,
            opacity: 0.82,
            depthTest: false,
            depthWrite: false,
          })
          ring = new Mesh(geometry, material)
          ringRef.current = ring
          ring.rotation.x = -Math.PI / 2
          ring.renderOrder = 10
          updateGroundRing(ring, box)
          scene.add(ring)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) console.error('選択ハイライトの作成に失敗しました', error)
      })

    return () => {
      disposed = true
      helperRef.current = null
      ringRef.current = null
      meshes.forEach((mesh) => mesh.recolor.setRGB(1, 1, 1))
      if (helper) {
        scene.remove(helper)
        helper.geometry.dispose()
        const helperMaterials = Array.isArray(helper.material) ? helper.material : [helper.material]
        helperMaterials.forEach((material) => material.dispose())
      }
      if (ring) {
        scene.remove(ring)
        ring.geometry.dispose()
        ring.material.dispose()
      }
    }
  }, [meshes, scene, showGroundRing])

  return null
}

function ModelSplat({
  placement,
  onRenderGroup,
  onMesh,
  onReady,
  covariance,
}: {
  placement: FlattenedSceneModel
  onRenderGroup: (nodeId: string, group: Group | null) => void
  onMesh: (nodeId: string, mesh: SplatMesh | null) => void
  onReady: (nodeId: string, ready: boolean) => void
  covariance: boolean
}) {
  const groupRef = useRef<Group>(null)
  const { modelNode, worldMatrix } = placement

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    onRenderGroup(modelNode.id, group)
    return () => onRenderGroup(modelNode.id, null)
  }, [modelNode.id, onRenderGroup])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    let disposed = false
    let attached = true
    const mesh = new SplatMesh(
      splatMeshOptions(assetFileUrl(modelNode.assetId, 'main'), covariance),
    )
    // .spz は Y 軸が下向きの座標系のため上下を反転する
    mesh.quaternion.set(1, 0, 0, 0)
    group.add(mesh)
    onMesh(modelNode.id, mesh)
    void mesh.initialized.then(
      () => {
        if (!disposed) onReady(modelNode.id, true)
      },
      (error: unknown) => {
        if (disposed) return
        attached = false
        onReady(modelNode.id, false)
        onMesh(modelNode.id, null)
        group.remove(mesh)
        mesh.dispose()
        console.error(`モデル ${modelNode.id} の読み込みに失敗しました`, error)
      },
    )
    return () => {
      disposed = true
      onReady(modelNode.id, false)
      if (attached) {
        onMesh(modelNode.id, null)
        group.remove(mesh)
        mesh.dispose()
      }
    }
  }, [covariance, modelNode.assetId, modelNode.id, onMesh, onReady])

  return <group ref={groupRef} matrix={worldMatrix} matrixAutoUpdate={false} />
}

function ControlNodeObject({
  node,
  onGroup,
}: {
  node: SceneNode
  onGroup: (nodeId: string, group: Group | null) => void
}) {
  const groupRef = useRef<Group>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    onGroup(node.id, group)
    return () => onGroup(node.id, null)
  }, [node.id, onGroup])

  return (
    <group
      ref={groupRef}
      position={node.transform.position}
      rotation={node.transform.rotation}
      scale={node.transform.scale}
    >
      {node.kind === 'group' &&
        node.children.map((child) => (
          <ControlNodeObject
            key={child.id}
            node={child}
            onGroup={onGroup}
          />
        ))}
    </group>
  )
}

export function SceneViewer({
  nodes,
  availableAssetIds,
  selectedNodeId,
  mode,
  scaleMode,
  snapping,
  focusSignal,
  resetSignal,
  onCommit,
  onTransformPreview,
  onSelect,
  onDropAsset,
}: {
  nodes: SceneNode[]
  availableAssetIds: ReadonlySet<string>
  selectedNodeId: string | null
  mode: GizmoMode
  scaleMode: ScaleMode
  /** true の間だけグリッド/角度スナップを有効化（Ctrl 押下中） */
  snapping: boolean
  focusSignal: number
  resetSignal: number
  onCommit: (nodeId: string, transform: PlacementTransform) => void
  onTransformPreview: (nodeId: string, transform: PlacementTransform) => void
  onSelect: (nodeId: string | null) => void
  /** 倉庫アセットのビューポート直接 drop（地面 y=0 との交点座標付き） */
  onDropAsset: (assetId: string, position: [number, number, number]) => void
}) {
  const objectsRef = useRef(new Map<string, SceneNodeObjects>())
  const suppressPickRef = useRef(false)
  const highlightDirtyRef = useRef(false)
  const [dropActive, setDropActive] = useState(false)
  const [objectsVersion, setObjectsVersion] = useState(0)
  const [readyModelIds, setReadyModelIds] = useState<ReadonlySet<string>>(new Set())
  const flattened = useMemo(() => flattenSceneModels(nodes), [nodes])
  const renderable = useMemo(
    () => getRenderableSceneModels(flattened, availableAssetIds),
    [availableAssetIds, flattened],
  )
  const renderableModelIds = useMemo(
    () => new Set(renderable.map(({ modelNode }) => modelNode.id)),
    [renderable],
  )

  const registerGroup = useCallback((nodeId: string, group: Group | null) => {
    const existing = objectsRef.current.get(nodeId) ?? {}
    const next = group ? { ...existing, group } : { ...existing, group: undefined }
    if (!next.group && !next.renderGroup && !next.mesh) {
      objectsRef.current.delete(nodeId)
    } else {
      objectsRef.current.set(nodeId, next)
    }
    setObjectsVersion((version) => version + 1)
  }, [])
  const registerRenderGroup = useCallback((nodeId: string, renderGroup: Group | null) => {
    const existing = objectsRef.current.get(nodeId) ?? {}
    const next = renderGroup
      ? { ...existing, renderGroup }
      : { ...existing, renderGroup: undefined }
    if (!next.group && !next.renderGroup && !next.mesh) {
      objectsRef.current.delete(nodeId)
    } else {
      objectsRef.current.set(nodeId, next)
    }
    setObjectsVersion((version) => version + 1)
  }, [])
  const registerMesh = useCallback((nodeId: string, mesh: SplatMesh | null) => {
    const existing = objectsRef.current.get(nodeId) ?? {}
    const next = mesh ? { ...existing, mesh } : { ...existing, mesh: undefined }
    if (!next.group && !next.renderGroup && !next.mesh) {
      objectsRef.current.delete(nodeId)
    } else {
      objectsRef.current.set(nodeId, next)
    }
    setObjectsVersion((version) => version + 1)
  }, [])
  const registerReady = useCallback((nodeId: string, ready: boolean) => {
    setReadyModelIds((previous) => {
      if (previous.has(nodeId) === ready) return previous
      const next = new Set(previous)
      if (ready) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
  }, [])

  const selectedGroup = selectedNodeId
    ? (objectsRef.current.get(selectedNodeId)?.group ?? null)
    : null
  const selectedModelIds = useMemo(
    () =>
      selectedNodeId
        ? new Set(
            getRenderableModelsForNode(renderable, selectedNodeId).map(
              ({ modelNode }) => modelNode.id,
            ),
          )
        : new Set<string>(),
    [renderable, selectedNodeId],
  )
  const selectedMeshes = useMemo(
    () =>
      [...selectedModelIds].flatMap((nodeId) => {
        const mesh = objectsRef.current.get(nodeId)?.mesh
        return mesh ? [mesh] : []
      }),
    [objectsVersion, selectedModelIds],
  )
  const covarianceModelIds = useMemo(() => {
    const axisPrewarm = mode === 'scale' && scaleMode === 'axis'
    return new Set(
      renderable.flatMap((placement) =>
        shouldUseCovarianceSplats(
          placement.worldMatrix,
          axisPrewarm && selectedModelIds.has(placement.modelNode.id),
        )
          ? [placement.modelNode.id]
          : [],
      ),
    )
  }, [mode, renderable, scaleMode, selectedModelIds])
  const getObjects = useCallback(() => objectsRef.current, [])
  const consumePickSuppression = useCallback(() => {
    const suppressed = suppressPickRef.current
    suppressPickRef.current = false
    return suppressed
  }, [])

  const commitSelected = useCallback(() => {
    if (!selectedNodeId) return
    const group = objectsRef.current.get(selectedNodeId)?.group
    if (!group) return
    onCommit(selectedNodeId, {
      position: group.position.toArray() as [number, number, number],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: group.scale.toArray() as [number, number, number],
    })
  }, [selectedNodeId, onCommit])

  const syncRenderedWorldMatrices = useCallback(() => {
    if (selectedGroup) selectedGroup.updateWorldMatrix(true, true)
    for (const { modelNode } of renderable) {
      const objects = objectsRef.current.get(modelNode.id)
      if (!objects?.group || !objects.renderGroup) continue
      objects.group.updateWorldMatrix(true, false)
      objects.renderGroup.matrix.copy(objects.group.matrixWorld)
      objects.renderGroup.matrixWorldNeedsUpdate = true
    }
    highlightDirtyRef.current = true
  }, [renderable, selectedGroup])
  const previewSelected = useCallback(() => {
    syncRenderedWorldMatrices()
    if (!selectedNodeId) return
    const group = objectsRef.current.get(selectedNodeId)?.group
    if (!group) return
    onTransformPreview(selectedNodeId, {
      position: group.position.toArray() as [number, number, number],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: group.scale.toArray() as [number, number, number],
    })
  }, [onTransformPreview, selectedNodeId, syncRenderedWorldMatrices])
  const consumeHighlightTransformChange = useCallback(() => {
    const dirty = highlightDirtyRef.current
    highlightDirtyRef.current = false
    return dirty
  }, [])

  const canTransformSelection =
    selectedNodeId !== null && hasInvertibleSceneNodeParent(nodes, selectedNodeId)
  const selectedIsModel =
    selectedNodeId !== null && findSceneNode(nodes, selectedNodeId)?.node.kind === 'model'

  return (
    <div
      role="region"
      aria-label={`3D ビューポート（モデル ${readyModelIds.size}/${renderable.length} 読み込み完了）`}
      className={`relative size-full overflow-hidden rounded-lg border ${
        dropActive ? 'ring-2 ring-primary/60' : ''
      }`}
    >
      <Canvas
        gl={{ antialias: false }}
        camera={{ position: SCENE_CAMERA_POSITION, fov: VIEWER_FOV }}
        onCreated={(state) => {
          if (import.meta.env.DEV) {
            // 開発時のみ: シーングラフ検査用フック（自動テスト・デバッグで使用）
            ;(window as unknown as Record<string, unknown>).__sceneViewerState = state
          }
        }}
      >
        <SparkRoot />
        <gridHelper args={[10, 10, '#555555', '#2a2a2a']} />
        {nodes.map((node) => (
          <ControlNodeObject
            key={node.id}
            node={node}
            onGroup={registerGroup}
          />
        ))}
        {renderable.map((placement) => (
          <ModelSplat
            key={placement.modelNode.id}
            placement={placement}
            onRenderGroup={registerRenderGroup}
            onMesh={registerMesh}
            onReady={registerReady}
            covariance={covarianceModelIds.has(placement.modelNode.id)}
          />
        ))}
        {selectedGroup && canTransformSelection && mode === 'scale' && scaleMode === 'uniform' && (
          <UniformScaleControl
            object={selectedGroup}
            snapping={snapping}
            scaleSnap={SCALE_SNAP}
            onDragStart={() => {
              suppressPickRef.current = true
            }}
            onObjectChange={previewSelected}
            onCommit={() => {
              syncRenderedWorldMatrices()
              commitSelected()
              window.setTimeout(() => {
                suppressPickRef.current = false
              }, 0)
            }}
          />
        )}
        {selectedGroup && canTransformSelection && (mode !== 'scale' || scaleMode === 'axis') && (
          <TransformControls
            object={selectedGroup}
            mode={mode}
            translationSnap={snapping ? TRANSLATION_SNAP : null}
            rotationSnap={snapping ? ROTATION_SNAP : null}
            scaleSnap={snapping ? SCALE_SNAP : null}
            showX
            showY
            showZ
            onObjectChange={previewSelected}
            onMouseDown={() => {
              suppressPickRef.current = true
            }}
            onMouseUp={() => {
              syncRenderedWorldMatrices()
              commitSelected()
              window.setTimeout(() => {
                suppressPickRef.current = false
              }, 0)
            }}
          />
        )}
        <OrbitControls makeDefault enableDamping />
        <ViewportPicker
          getObjects={getObjects}
          pickableModelIds={renderableModelIds}
          consumeSuppression={consumePickSuppression}
          onSelect={onSelect}
        />
        <ViewportAssetDrop onDropAsset={onDropAsset} onDragActiveChange={setDropActive} />
        <SelectionHighlight
          meshes={selectedMeshes}
          showGroundRing={selectedIsModel}
          consumeTransformChange={consumeHighlightTransformChange}
        />
        <CameraFocus signal={focusSignal} meshes={selectedMeshes} />
        <CameraReset signal={resetSignal} position={SCENE_CAMERA_POSITION} />
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport labelColor="white" />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
