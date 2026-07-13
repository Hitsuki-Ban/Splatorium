import { describe, expect, it } from 'vitest'
import { patchImageToSplatWorkflow } from './workflow.js'

describe('patchImageToSplatWorkflow', () => {
  it('patches the image, seed, gaussian count, and output prefix without mutating the base workflow', () => {
    const baseWorkflow = {
      '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
      '9': { class_type: 'KSampler', inputs: { seed: 1 } },
      '11': { class_type: 'VAEDecodeTripoSplat', inputs: { seed: 1, num_gaussians: 65536 } },
      '13': { class_type: 'SaveGLB', inputs: { filename_prefix: 'old/prefix' } },
    }

    const patched = patchImageToSplatWorkflow(baseWorkflow, {
      imageName: 'upload.png',
      seed: 42,
      numGaussians: 262144,
      filenamePrefix: 'splatorium/job-1',
    })

    expect(patched['1'].inputs.image).toBe('upload.png')
    expect(patched['9'].inputs.seed).toBe(42)
    expect(patched['11'].inputs.seed).toBe(42)
    expect(patched['11'].inputs.num_gaussians).toBe(262144)
    expect(patched['13'].inputs.filename_prefix).toBe('splatorium/job-1')
    expect(baseWorkflow['1'].inputs.image).toBe('old.png')
    expect(baseWorkflow['13'].inputs.filename_prefix).toBe('old/prefix')
  })
})
