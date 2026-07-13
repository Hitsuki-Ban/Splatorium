import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'splatorium-e2e-'))
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }))

process.env.HOST = '127.0.0.1'
process.env.PORT = '18792'
process.env.SPLATORIUM_DATA_DIR = dataDir
process.env.SPLATORIUM_WEB_DIR = resolve('apps/web/dist')
process.env.IMAGE_TO_SPLAT_WORKFLOW_PATH = resolve(
  'comfy/workflows/image-to-splat.json',
)
process.env.COMFYUI_URL = 'http://127.0.0.1:1'

const { createSqliteStore } = await import('../apps/server/dist/store.js')
const store = createSqliteStore({ dataDir })
const modelHeader = Buffer.from(`ply
format binary_little_endian 1.0
element vertex 1
property float x
property float y
property float z
property float nx
property float ny
property float nz
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`)
const modelVertexValues = [
  0, 0, 0,
  0, 0, 0,
  1, 0, 0,
  5,
  -2, -2, -2,
  1, 0, 0, 0,
]
const modelVertex = Buffer.alloc(modelVertexValues.length * Float32Array.BYTES_PER_ELEMENT)
modelVertexValues.forEach((value, index) => modelVertex.writeFloatLE(value, index * 4))
const modelBytes = Buffer.concat([modelHeader, modelVertex])
for (const asset of [
  { id: '00000000-0000-4000-8000-000000000096', name: '参照モデル' },
  { id: '00000000-0000-4000-8000-000000000097', name: '未参照モデル' },
  { id: '00000000-0000-4000-8000-000000000099', name: '復旧モデル' },
]) {
  const assetDir = resolve(dataDir, 'assets', asset.id)
  mkdirSync(assetDir, { recursive: true })
  writeFileSync(resolve(assetDir, 'model.ply'), modelBytes)
  store.saveAsset({
    ...asset,
    kind: 'splat',
    tags: [],
    files: {
      main: { path: 'model.ply', size: modelBytes.byteLength, mime: 'application/octet-stream' },
    },
    createdAt: '2026-07-12T00:00:00.000Z',
  })
}
store.close()

await import('../apps/server/dist/index.js')
