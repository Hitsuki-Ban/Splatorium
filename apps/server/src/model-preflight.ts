import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export interface ModelPreflight {
  assertReady(): Promise<void>
}

export interface ModelPreflightOptions {
  manifestPath: string
  comfyUiRoot: string
}

interface ModelManifest {
  files: ModelManifestFile[]
}

interface ModelManifestFile {
  role: string
  sourceFile: string
  sourceUrl: string
  targetPath: string
  size: number
  sha256: string
}

export function createModelPreflight(options: ModelPreflightOptions): ModelPreflight {
  return {
    assertReady: async () => {
      const manifest = await loadModelManifest(options.manifestPath)
      const missing: Array<{ file: ModelManifestFile; target: string }> = []
      for (const file of manifest.files) {
        const target = resolveModelTarget(options.comfyUiRoot, file.targetPath)
        if (!(await isReadableFile(target))) {
          missing.push({ file, target })
        }
      }
      if (missing.length > 0) {
        throw new Error(formatMissingModels(missing))
      }
    },
  }
}

async function loadModelManifest(manifestPath: string): Promise<ModelManifest> {
  const raw = await readFile(manifestPath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error(`model manifest must contain a non-empty files array: ${manifestPath}`)
  }
  return {
    files: parsed.files.map((file, index) => readManifestFile(file, index)),
  }
}

function readManifestFile(value: unknown, index: number): ModelManifestFile {
  if (!isRecord(value)) {
    throw new Error(`model manifest files[${index}] must be an object`)
  }
  const role = value.role
  const sourceFile = value.sourceFile
  const sourceUrl = value.sourceUrl
  const targetPath = value.targetPath
  const size = value.size
  const sha256 = value.sha256
  if (typeof role !== 'string' || role.length === 0) {
    throw new Error(`model manifest files[${index}].role must be a non-empty string`)
  }
  if (typeof sourceFile !== 'string' || sourceFile.length === 0) {
    throw new Error(`model manifest files[${index}].sourceFile must be a non-empty string`)
  }
  if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) {
    throw new Error(`model manifest files[${index}].sourceUrl must be a non-empty string`)
  }
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error(`model manifest files[${index}].targetPath must be a non-empty string`)
  }
  if (typeof sha256 !== 'string' || sha256.length === 0) {
    throw new Error(`model manifest files[${index}].sha256 must be a non-empty string`)
  }
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`model manifest files[${index}].size must be a positive safe integer`)
  }
  return {
    role,
    sourceFile,
    sourceUrl,
    targetPath,
    size,
    sha256,
  }
}

function resolveModelTarget(comfyUiRoot: string, targetPath: string): string {
  const root = resolve(comfyUiRoot)
  const target = resolve(root, targetPath)
  const inside = relative(root, target)
  if (inside === '..' || inside.startsWith('..\\') || inside.startsWith('../') || isAbsolute(inside)) {
    throw new Error(`model manifest target escapes ComfyUI root: ${targetPath}`)
  }
  return target
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) {
      return false
    }
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function formatMissingModels(missing: Array<{ file: ModelManifestFile; target: string }>): string {
  return [
    'Missing required model files:',
    ...missing.flatMap(({ file, target }) => [
      `- ${file.role}`,
      `  source file: ${file.sourceFile}`,
      `  source: ${file.sourceUrl}`,
      `  target: ${target}`,
      `  expected sha256: ${file.sha256}`,
    ]),
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
