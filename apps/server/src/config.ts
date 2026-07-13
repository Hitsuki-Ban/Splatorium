import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

export interface ServerConfig {
  host: string
  port: number
  dataDir: string
  comfyUiUrl: string
  workflowPath: string
  webStaticDir: string
  modelManifestPath?: string
  comfyUiRoot?: string
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const modelManifestPath = env.SPLATORIUM_MODEL_MANIFEST
  const comfyUiRoot = env.COMFYUI_ROOT
  if ((modelManifestPath === undefined) !== (comfyUiRoot === undefined)) {
    throw new Error('SPLATORIUM_MODEL_MANIFEST and COMFYUI_ROOT must be set together')
  }
  if (modelManifestPath === '' || comfyUiRoot === '') {
    throw new Error('SPLATORIUM_MODEL_MANIFEST and COMFYUI_ROOT must be non-empty')
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT),
    dataDir: env.SPLATORIUM_DATA_DIR ?? resolve(projectRoot, 'data'),
    comfyUiUrl: env.COMFYUI_URL ?? 'http://127.0.0.1:8189',
    workflowPath:
      env.IMAGE_TO_SPLAT_WORKFLOW_PATH ??
      resolve(projectRoot, 'comfy', 'workflows', 'image-to-splat.json'),
    webStaticDir: env.SPLATORIUM_WEB_DIR ?? resolve(projectRoot, 'apps', 'web', 'dist'),
    modelManifestPath,
    comfyUiRoot,
  }
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 8787
  }

  const port = Number(value)
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535')
  }
  return port
}
