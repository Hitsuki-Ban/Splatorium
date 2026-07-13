import { describe, expect, it } from 'vitest'
import { createComfyUiClient, extractComfyOutputFiles } from './comfy-client.js'

describe('extractComfyOutputFiles', () => {
  it('finds output file descriptors inside a ComfyUI history response', () => {
    const outputs = extractComfyOutputFiles(
      {
        'prompt-1': {
          outputs: {
            '13': {
              glb: [
                {
                  filename: 'splatbench_00001_.spz',
                  subfolder: 'splatorium/job-1',
                  type: 'output',
                },
              ],
            },
          },
        },
      },
      'prompt-1',
    )

    expect(outputs).toEqual([
      {
        filename: 'splatbench_00001_.spz',
        subfolder: 'splatorium/job-1',
        type: 'output',
      },
    ])
  })
})

describe('createComfyUiClient', () => {
  it('submits API workflow prompts with the requested client id', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const client = createComfyUiClient({
      baseUrl: 'http://127.0.0.1:8189',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as unknown })
        return Response.json({ prompt_id: 'prompt-1' })
      },
    })

    const queued = await client.queuePrompt({ '1': { class_type: 'Test', inputs: {} } }, 'job-1')

    expect(queued).toEqual({ promptId: 'prompt-1' })
    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:8189/prompt',
        body: {
          client_id: 'job-1',
          prompt: { '1': { class_type: 'Test', inputs: {} } },
        },
      },
    ])
  })
})
