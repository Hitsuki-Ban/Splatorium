export type WorkflowNode = {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export type ApiWorkflow = Record<string, WorkflowNode>

export interface ImageToSplatPatch {
  imageName: string
  seed: number
  numGaussians: number
  filenamePrefix: string
}

export function patchImageToSplatWorkflow(
  baseWorkflow: ApiWorkflow,
  patch: ImageToSplatPatch,
): ApiWorkflow {
  const workflow = structuredClone(baseWorkflow)

  workflow['1'].inputs.image = patch.imageName
  workflow['9'].inputs.seed = patch.seed
  workflow['11'].inputs.seed = patch.seed
  workflow['11'].inputs.num_gaussians = patch.numGaussians
  workflow['13'].inputs.filename_prefix = patch.filenamePrefix

  return workflow
}
