import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ASSET_NAME_MAX_LENGTH, type Asset, type AssetFileRef, type Job } from '@splatorium/shared'
import type { JobRunContext, JobRunResult, JobRunner } from './job-queue.js'
import type { ModelPreflight } from './model-preflight.js'
import type { WorkbenchStore } from './store.js'
import { patchImageToSplatWorkflow, type ApiWorkflow } from './workflow.js'

export interface ComfyUploadedImage {
  name: string
}

export interface ComfyQueuedPrompt {
  promptId: string
}

export interface ComfyOutputFile {
  filename: string
  subfolder?: string
  type?: string
}

export interface ComfyClient {
  uploadImage(filePath: string, fileName: string): Promise<ComfyUploadedImage>
  queuePrompt(workflow: ApiWorkflow, clientId: string): Promise<ComfyQueuedPrompt>
  waitForCompletion(
    promptId: string,
    clientId: string,
    onProgress: (progress: number, statusText: string) => void,
  ): Promise<ComfyOutputFile[]>
  downloadOutput(output: ComfyOutputFile): Promise<Uint8Array>
}

export interface ImageToSplatRunnerOptions {
  dataDir: string
  store: WorkbenchStore
  baseWorkflow: ApiWorkflow
  comfyClient: ComfyClient
  modelPreflight?: ModelPreflight
  createId?: () => string
  now?: () => string
}

export function createImageToSplatRunner(options: ImageToSplatRunnerOptions): JobRunner {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())

  return async (job: Job, context: JobRunContext): Promise<JobRunResult> => {
    if (job.pipeline !== 'image-to-splat') {
      throw new Error(`unsupported pipeline: ${job.pipeline}`)
    }
    if (!job.params) {
      throw new Error('image-to-splat job params are required')
    }

    const startedAt = now()
    const imageAsset = options.store.getAsset(job.inputAssetIds[0])
    if (!imageAsset) {
      throw new Error(`input image asset not found: ${job.inputAssetIds[0]}`)
    }

    if (options.modelPreflight) {
      context.updateJob({ progress: 5, statusText: 'Checking required models' })
      await options.modelPreflight.assertReady()
    }

    const sourceFile = imageAsset.files.main
    const inputPath = join(options.dataDir, 'assets', imageAsset.id, sourceFile.path)
    context.updateJob({ progress: 10, statusText: 'Uploading image to ComfyUI' })
    const uploadedImage = await options.comfyClient.uploadImage(inputPath, imageAsset.name)

    const clientId = job.id
    const filenamePrefix = `splatorium/${job.id}`
    const workflow = patchImageToSplatWorkflow(options.baseWorkflow, {
      imageName: uploadedImage.name,
      seed: job.params.seed,
      numGaussians: job.params.numGaussians,
      filenamePrefix,
    })

    context.updateJob({ progress: 20, statusText: 'Submitting ComfyUI workflow' })
    const queuedPrompt = await options.comfyClient.queuePrompt(workflow, clientId)
    context.updateJob({
      progress: 25,
      statusText: 'Waiting for ComfyUI',
      metrics: { ...job.metrics, comfyPromptId: queuedPrompt.promptId },
    })

    const outputs = await options.comfyClient.waitForCompletion(
      queuedPrompt.promptId,
      clientId,
      (progress, statusText) => context.updateJob({ progress, statusText }),
    )
    const spzOutput = outputs.find((output) => output.filename.endsWith('.spz'))
    if (!spzOutput) {
      throw new Error(`ComfyUI prompt ${queuedPrompt.promptId} did not produce an .spz file`)
    }

    context.updateJob({ progress: 90, statusText: 'Downloading generated splat' })
    const bytes = await options.comfyClient.downloadOutput(spzOutput)
    const outputAssetId = createId()
    const outputDir = join(options.dataDir, 'assets', outputAssetId)
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, spzOutput.filename), bytes)
    await writeFile(join(outputDir, sourceFile.path), await readFile(inputPath))

    const finishedAt = now()
    const outputFile: AssetFileRef = {
      path: spzOutput.filename,
      size: bytes.byteLength,
      mime: 'model/vnd.spz',
    }
    const completedImageAsset = options.store.getAsset(imageAsset.id)
    if (!completedImageAsset) {
      throw new Error(`input image asset not found after generation: ${imageAsset.id}`)
    }
    const splatAsset: Asset = {
      id: outputAssetId,
      kind: 'splat',
      name: createGeneratedAssetName(
        completedImageAsset.name,
        options.store.listAssets().filter((asset) => asset.id !== completedImageAsset.id),
      ),
      tags: [],
      sourceJobId: job.id,
      files: {
        main: outputFile,
        source: sourceFile,
      },
      createdAt: finishedAt,
    }
    options.store.saveAsset(splatAsset)

    return {
      outputAssetIds: [outputAssetId],
      metrics: {
        comfyPromptId: queuedPrompt.promptId,
        durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
        outputBytes: bytes.byteLength,
      },
    }
  }
}

export function createGeneratedAssetName(
  sourceName: string,
  existingAssets: readonly Pick<Asset, 'name'>[],
): string {
  const extensionIndex = sourceName.lastIndexOf('.')
  const stem = extensionIndex > 0 ? sourceName.slice(0, extensionIndex) : sourceName
  const comfySuffix = '_00001_'
  const base = stem.endsWith(comfySuffix) && stem.length > comfySuffix.length
    ? stem.slice(0, -comfySuffix.length)
    : stem
  if (base.length === 0) {
    throw new Error(`input image filename has no display name: ${sourceName}`)
  }

  const existingNames = new Set(existingAssets.map((asset) => asset.name))
  const firstCandidate = base.slice(0, ASSET_NAME_MAX_LENGTH)
  if (!existingNames.has(firstCandidate)) return firstCandidate

  for (let sequence = 2; ; sequence += 1) {
    const suffix = ` ${sequence}`
    const candidate = `${base.slice(0, ASSET_NAME_MAX_LENGTH - suffix.length)}${suffix}`
    if (!existingNames.has(candidate)) return candidate
  }
}
