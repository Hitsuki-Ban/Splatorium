import { sha256 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'

export const SCENE_SCHEMA_VERSION = 2 as const
export const SCENE_DOCUMENT_MAX_NODES = 10_000
export const SCENE_DOCUMENT_MAX_DEPTH = 32
export const SCENE_DOCUMENT_MAX_CHILDREN = 2_000
export const SCENE_NODE_NAME_MAX_LENGTH = 255

const UNKNOWN_MODEL_NAME = '不明なモデル'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export type Vector3 = [number, number, number]

export interface SceneTransform {
  position: Vector3
  /** オイラー角 (rad), Three.js の既定 XYZ 順。 */
  rotation: Vector3
  scale: Vector3
}

export interface SceneNodeBase {
  /** SceneDocument 内で一意な UUID。 */
  id: string
  name: string
  visible: boolean
  transform: SceneTransform
}

export interface SceneModelNode extends SceneNodeBase {
  kind: 'model'
  /** kind=splat | mesh の Asset ID。 */
  assetId: string
}

export interface ImportedSceneOrigin {
  sceneId: string
  sourceHash: string
  contentHash: string
}

export interface SceneGroupNode extends SceneNodeBase {
  kind: 'group'
  children: SceneNode[]
  importedFrom?: ImportedSceneOrigin
}

export type SceneNode = SceneModelNode | SceneGroupNode

export interface SceneDocument {
  schemaVersion: typeof SCENE_SCHEMA_VERSION
  nodes: SceneNode[]
}

export type ParseSceneDocumentResult =
  | { ok: true; value: SceneDocument }
  | { ok: false; error: string }

export interface ParseStoredSceneDocumentOptions {
  resolveAssetName: (assetId: string) => string | undefined
  createNodeId: () => string
}

interface LegacyScenePlacement {
  assetId: string
  position: Vector3
  rotation: Vector3
  scale: Vector3
}

interface ValidationState {
  nodeCount: number
  ids: Set<string>
}

/** POST/PUT 用。version 2 以外と未知フィールドを拒否する。 */
export function parseWritableSceneDocument(value: unknown): ParseSceneDocumentResult {
  if (!isRecord(value)) {
    return failure('document must be an object')
  }
  const documentKeys = exactKeys(value, ['schemaVersion', 'nodes'])
  if (documentKeys) return failure(`document ${documentKeys}`)
  if (value.schemaVersion !== SCENE_SCHEMA_VERSION) {
    return failure(`document.schemaVersion must be ${SCENE_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(value.nodes)) {
    return failure('document.nodes must be an array')
  }

  const state: ValidationState = { nodeCount: 0, ids: new Set() }
  const nodes: SceneNode[] = []
  for (let index = 0; index < value.nodes.length; index += 1) {
    const result = parseNode(value.nodes[index], `document.nodes[${index}]`, 0, state)
    if (!result.ok) return result
    nodes.push(result.value)
  }
  return { ok: true, value: { schemaVersion: SCENE_SCHEMA_VERSION, nodes } }
}

/** 保存済み file 用。厳密な version 2 または唯一の legacy placements 形式を読む。 */
export function parseStoredSceneDocument(
  value: unknown,
  options: ParseStoredSceneDocumentOptions,
): ParseSceneDocumentResult {
  if (!isRecord(value)) {
    return failure('document must be an object')
  }
  if (Object.hasOwn(value, 'schemaVersion')) {
    return parseWritableSceneDocument(value)
  }

  const documentKeys = exactKeys(value, ['placements'])
  if (documentKeys) return failure(`legacy document ${documentKeys}`)
  if (!Array.isArray(value.placements)) {
    return failure('legacy document.placements must be an array')
  }
  if (value.placements.length > SCENE_DOCUMENT_MAX_NODES) {
    return failure(`document must contain at most ${SCENE_DOCUMENT_MAX_NODES} nodes`)
  }

  const nodes: SceneModelNode[] = []
  const ids = new Set<string>()
  for (let index = 0; index < value.placements.length; index += 1) {
    const placementResult = parseLegacyPlacement(
      value.placements[index],
      `legacy document.placements[${index}]`,
    )
    if (!placementResult.ok) return placementResult

    const id = options.createNodeId()
    if (!UUID_PATTERN.test(id)) {
      return failure('createNodeId must return a UUID')
    }
    const idKey = id.toLowerCase()
    if (ids.has(idKey)) {
      return failure(`createNodeId returned duplicate UUID: ${id}`)
    }
    ids.add(idKey)

    const placement = placementResult.value
    const resolvedName = options.resolveAssetName(placement.assetId)
    if (
      resolvedName !== undefined &&
      (resolvedName.trim().length === 0 || resolvedName.length > SCENE_NODE_NAME_MAX_LENGTH)
    ) {
      return failure(
        `resolved asset name must be 1-${SCENE_NODE_NAME_MAX_LENGTH} characters after trim`,
      )
    }
    nodes.push({
      id,
      kind: 'model',
      name:
        resolvedName ?? UNKNOWN_MODEL_NAME,
      visible: true,
      transform: {
        position: [...placement.position],
        rotation: [...placement.rotation],
        scale: [...placement.scale],
      },
      assetId: placement.assetId,
    })
  }
  return { ok: true, value: { schemaVersion: SCENE_SCHEMA_VERSION, nodes } }
}

/** insecure LAN origin でも利用できる Crypto.getRandomValues で UUID v4 を生成する。 */
export function createSceneNodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** ID と schemaVersion を除外した scene tree を RFC 8785 JCS へ変換する。 */
export function canonicalizeSceneNodes(nodes: readonly SceneNode[]): string {
  const serialized = canonicalize(nodes.map(projectNode))
  if (serialized === undefined) {
    throw new Error('scene nodes could not be canonicalized')
  }
  return serialized
}

export async function hashSceneNodes(nodes: readonly SceneNode[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeSceneNodes(nodes))
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function parseNode(
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState,
): { ok: true; value: SceneNode } | { ok: false; error: string } {
  if (depth > SCENE_DOCUMENT_MAX_DEPTH) {
    return failure(`document node depth must be at most ${SCENE_DOCUMENT_MAX_DEPTH}`)
  }
  state.nodeCount += 1
  if (state.nodeCount > SCENE_DOCUMENT_MAX_NODES) {
    return failure(`document must contain at most ${SCENE_DOCUMENT_MAX_NODES} nodes`)
  }
  if (!isRecord(value)) return failure(`${path} must be an object`)
  if (value.kind !== 'model' && value.kind !== 'group') {
    return failure(`${path}.kind must be model or group`)
  }

  const allowedKeys =
    value.kind === 'model'
      ? ['id', 'kind', 'name', 'visible', 'transform', 'assetId']
      : ['id', 'kind', 'name', 'visible', 'transform', 'children']
  const keysError = exactKeys(value, allowedKeys, value.kind === 'group' ? ['importedFrom'] : [])
  if (keysError) return failure(`${path} ${keysError}`)

  if (typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) {
    return failure(`${path}.id must be a UUID`)
  }
  const idKey = value.id.toLowerCase()
  if (state.ids.has(idKey)) return failure(`${path}.id must be unique`)
  state.ids.add(idKey)

  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > SCENE_NODE_NAME_MAX_LENGTH
  ) {
    return failure(`${path}.name must be 1-${SCENE_NODE_NAME_MAX_LENGTH} characters after trim`)
  }
  if (typeof value.visible !== 'boolean') return failure(`${path}.visible must be a boolean`)

  const transform = parseTransform(value.transform, `${path}.transform`)
  if (!transform.ok) return transform
  const base = {
    id: value.id,
    name: value.name,
    visible: value.visible,
    transform: transform.value,
  }

  if (value.kind === 'model') {
    if (typeof value.assetId !== 'string' || value.assetId.length === 0) {
      return failure(`${path}.assetId must be a non-empty string`)
    }
    return { ok: true, value: { ...base, kind: 'model', assetId: value.assetId } }
  }

  if (!Array.isArray(value.children)) return failure(`${path}.children must be an array`)
  if (value.children.length > SCENE_DOCUMENT_MAX_CHILDREN) {
    return failure(`${path}.children must contain at most ${SCENE_DOCUMENT_MAX_CHILDREN} nodes`)
  }
  const children: SceneNode[] = []
  for (let index = 0; index < value.children.length; index += 1) {
    const child = parseNode(value.children[index], `${path}.children[${index}]`, depth + 1, state)
    if (!child.ok) return child
    children.push(child.value)
  }

  let importedFrom: ImportedSceneOrigin | undefined
  if (value.importedFrom !== undefined) {
    const origin = parseImportedSceneOrigin(value.importedFrom, `${path}.importedFrom`)
    if (!origin.ok) return origin
    importedFrom = origin.value
  }
  return {
    ok: true,
    value: {
      ...base,
      kind: 'group',
      children,
      ...(importedFrom ? { importedFrom } : {}),
    },
  }
}

function parseTransform(
  value: unknown,
  path: string,
): { ok: true; value: SceneTransform } | { ok: false; error: string } {
  if (!isRecord(value)) return failure(`${path} must be an object`)
  const keysError = exactKeys(value, ['position', 'rotation', 'scale'])
  if (keysError) return failure(`${path} ${keysError}`)
  if (!isVector3(value.position)) return failure(`${path}.position must contain 3 finite numbers`)
  if (!isVector3(value.rotation)) return failure(`${path}.rotation must contain 3 finite numbers`)
  if (!isVector3(value.scale)) return failure(`${path}.scale must contain 3 finite numbers`)
  return {
    ok: true,
    value: {
      position: [...value.position],
      rotation: [...value.rotation],
      scale: [...value.scale],
    },
  }
}

function parseImportedSceneOrigin(
  value: unknown,
  path: string,
): { ok: true; value: ImportedSceneOrigin } | { ok: false; error: string } {
  if (!isRecord(value)) return failure(`${path} must be an object`)
  const keysError = exactKeys(value, ['sceneId', 'sourceHash', 'contentHash'])
  if (keysError) return failure(`${path} ${keysError}`)
  if (typeof value.sceneId !== 'string' || value.sceneId.length === 0) {
    return failure(`${path}.sceneId must be a non-empty string`)
  }
  if (typeof value.sourceHash !== 'string' || !SHA256_PATTERN.test(value.sourceHash)) {
    return failure(`${path}.sourceHash must be a lowercase SHA-256 hash`)
  }
  if (typeof value.contentHash !== 'string' || !SHA256_PATTERN.test(value.contentHash)) {
    return failure(`${path}.contentHash must be a lowercase SHA-256 hash`)
  }
  return {
    ok: true,
    value: {
      sceneId: value.sceneId,
      sourceHash: value.sourceHash,
      contentHash: value.contentHash,
    },
  }
}

function parseLegacyPlacement(
  value: unknown,
  path: string,
): { ok: true; value: LegacyScenePlacement } | { ok: false; error: string } {
  if (!isRecord(value)) return failure(`${path} must be an object`)
  const keysError = exactKeys(value, ['assetId', 'position', 'rotation', 'scale'])
  if (keysError) return failure(`${path} ${keysError}`)
  if (typeof value.assetId !== 'string' || value.assetId.length === 0) {
    return failure(`${path}.assetId must be a non-empty string`)
  }
  if (!isVector3(value.position)) return failure(`${path}.position must contain 3 finite numbers`)
  if (!isVector3(value.rotation)) return failure(`${path}.rotation must contain 3 finite numbers`)
  if (!isVector3(value.scale)) return failure(`${path}.scale must contain 3 finite numbers`)
  return {
    ok: true,
    value: {
      assetId: value.assetId,
      position: [...value.position],
      rotation: [...value.rotation],
      scale: [...value.scale],
    },
  }
}

function projectNode(node: SceneNode): Record<string, unknown> {
  const projected = {
    kind: node.kind,
    name: node.name,
    visible: node.visible,
    transform: {
      position: node.transform.position.map(normalizeTransformNumber),
      rotation: node.transform.rotation.map(normalizeTransformNumber),
      scale: node.transform.scale.map(normalizeTransformNumber),
    },
  }
  if (node.kind === 'model') {
    return { ...projected, assetId: node.assetId }
  }
  return {
    ...projected,
    children: node.children.map(projectNode),
    ...(node.importedFrom ? { importedFrom: { ...node.importedFrom } } : {}),
  }
}

function normalizeTransformNumber(value: number): number {
  const rounded = Number(value.toFixed(6))
  return Object.is(rounded, -0) ? 0 : rounded
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): string | undefined {
  const allowed = new Set([...required, ...optional])
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) return `contains unknown field: ${unknown}`
  const missing = required.find((key) => !Object.hasOwn(value, key))
  if (missing) return `is missing field: ${missing}`
  return undefined
}

function isVector3(value: unknown): value is Vector3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(error: string): { ok: false; error: string } {
  return { ok: false, error }
}
