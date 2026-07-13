import { readFile } from 'node:fs/promises'
import WebSocket from 'ws'
import type { ComfyClient, ComfyOutputFile } from './comfy-runner.js'
import type { ApiWorkflow } from './workflow.js'

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface ComfyUiClientOptions {
  baseUrl: string
  fetchImpl?: FetchLike
}

interface PromptResponse {
  prompt_id?: string
  error?: unknown
  node_errors?: unknown
}

interface UploadResponse {
  name?: string
}

interface ComfyWsMessage {
  type?: string
  data?: {
    prompt_id?: string
    node?: string | null
    value?: number
    max?: number
    exception_message?: string
  }
}

export function createComfyUiClient(options: ComfyUiClientOptions): ComfyClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch

  async function getHistory(promptId: string): Promise<unknown> {
    const response = await fetchComfy(
      fetchImpl,
      `${baseUrl}/history/${encodeURIComponent(promptId)}`,
      undefined,
      'history',
    )
    await ensureOk(response, 'history')
    return response.json() as Promise<unknown>
  }

  return {
    async uploadImage(filePath, fileName) {
      const form = new FormData()
      const bytes = await readFile(filePath)
      form.set('image', new Blob([bytes]), fileName)
      form.set('overwrite', 'true')
      const response = await fetchComfy(
        fetchImpl,
        `${baseUrl}/upload/image`,
        {
          method: 'POST',
          body: form,
        },
        'image upload',
      )
      await ensureOk(response, 'image upload')
      const payload = (await response.json()) as UploadResponse
      if (!payload.name) {
        throw new Error('ComfyUI upload response did not include image name')
      }
      return { name: payload.name }
    },

    async queuePrompt(workflow: ApiWorkflow, clientId: string) {
      const response = await fetchComfy(
        fetchImpl,
        `${baseUrl}/prompt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, prompt: workflow }),
        },
        'prompt submission',
      )
      await ensureOk(response, 'prompt submission')
      const payload = (await response.json()) as PromptResponse
      if (!payload.prompt_id) {
        throw new Error(
          `ComfyUI prompt response did not include prompt_id: ${JSON.stringify(payload)}`,
        )
      }
      return { promptId: payload.prompt_id }
    },

    async waitForCompletion(promptId, clientId, onProgress) {
      let websocketError: Error | undefined
      const socket = new WebSocket(
        `${toWebSocketBaseUrl(baseUrl)}/ws?clientId=${encodeURIComponent(clientId)}`,
      )
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          return
        }
        const text = typeof data === 'string' ? data : data.toString('utf8')
        try {
          const error = handleWebSocketMessage(text, promptId, onProgress)
          if (error) {
            websocketError = error
          }
        } catch (error) {
          websocketError = error instanceof Error ? error : new Error(String(error))
        }
      })
      socket.on('error', (error) => {
        websocketError = error
      })

      try {
        for (;;) {
          if (websocketError) {
            throw websocketError
          }

          const history = await getHistory(promptId)
          const outputs = extractComfyOutputFiles(history, promptId)
          if (outputs.length > 0) {
            onProgress(85, 'ComfyUI output ready')
            return outputs
          }
          await sleep(1000)
        }
      } finally {
        socket.close()
      }
    },

    async downloadOutput(output) {
      const url = new URL(`${baseUrl}/view`)
      url.searchParams.set('filename', output.filename)
      url.searchParams.set('subfolder', output.subfolder ?? '')
      url.searchParams.set('type', output.type ?? 'output')
      const response = await fetchComfy(fetchImpl, url, undefined, 'output download')
      await ensureOk(response, 'output download')
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

export function extractComfyOutputFiles(history: unknown, promptId: string): ComfyOutputFile[] {
  if (!isRecord(history)) {
    return []
  }

  const promptEntry = history[promptId]
  if (!isRecord(promptEntry)) {
    return []
  }

  const outputs = isRecord(promptEntry.outputs) ? promptEntry.outputs : promptEntry
  const files: ComfyOutputFile[] = []
  visitOutputValue(outputs, files)
  return files
}

function visitOutputValue(value: unknown, files: ComfyOutputFile[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitOutputValue(item, files)
    }
    return
  }

  if (!isRecord(value)) {
    return
  }

  if (typeof value.filename === 'string') {
    files.push({
      filename: value.filename,
      subfolder: typeof value.subfolder === 'string' ? value.subfolder : undefined,
      type: typeof value.type === 'string' ? value.type : undefined,
    })
    return
  }

  for (const child of Object.values(value)) {
    visitOutputValue(child, files)
  }
}

function handleWebSocketMessage(
  text: string,
  promptId: string,
  onProgress: (progress: number, statusText: string) => void,
): Error | undefined {
  const message = JSON.parse(text) as ComfyWsMessage
  if (message.data?.prompt_id !== promptId) {
    return undefined
  }

  if (message.type === 'execution_error') {
    return new Error(message.data.exception_message ?? `ComfyUI execution failed for ${promptId}`)
  }

  if (message.type === 'progress' && message.data.max && message.data.value !== undefined) {
    const progress = 25 + Math.floor((message.data.value / message.data.max) * 60)
    onProgress(Math.min(progress, 85), `ComfyUI ${message.data.value}/${message.data.max}`)
  } else if (message.type === 'executing' && message.data.node) {
    onProgress(30, `ComfyUI node ${message.data.node}`)
  }

  return undefined
}

async function ensureOk(response: Response, action: string): Promise<void> {
  if (response.ok) {
    return
  }
  throw new Error(`ComfyUI ${action} failed (${response.status}): ${await response.text()}`)
}

async function fetchComfy(
  fetchImpl: FetchLike,
  input: string | URL,
  init: RequestInit | undefined,
  action: string,
): Promise<Response> {
  try {
    return await fetchImpl(input, init)
  } catch (error) {
    const url = typeof input === 'string' ? input : input.toString()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`ComfyUI ${action} request failed at ${url}: ${message}`)
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function toWebSocketBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
