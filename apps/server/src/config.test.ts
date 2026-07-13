import { describe, expect, it } from 'vitest'
import { loadServerConfig } from './config.js'

describe('loadServerConfig', () => {
  it('leaves model preflight disabled when no local ComfyUI root is configured', () => {
    expect(loadServerConfig({}).modelManifestPath).toBeUndefined()
    expect(loadServerConfig({}).comfyUiRoot).toBeUndefined()
  })

  it('requires the model manifest and local ComfyUI root to be configured together', () => {
    expect(() =>
      loadServerConfig({ SPLATORIUM_MODEL_MANIFEST: 'comfy/models.json' }),
    ).toThrow(/SPLATORIUM_MODEL_MANIFEST and COMFYUI_ROOT must be set together/)
    expect(() => loadServerConfig({ COMFYUI_ROOT: 'comfy/ComfyUI_windows_portable/ComfyUI' })).toThrow(
      /SPLATORIUM_MODEL_MANIFEST and COMFYUI_ROOT must be set together/,
    )
  })

  it('rejects empty model preflight configuration', () => {
    expect(() =>
      loadServerConfig({
        SPLATORIUM_MODEL_MANIFEST: '',
        COMFYUI_ROOT: 'comfy/ComfyUI_windows_portable/ComfyUI',
      }),
    ).toThrow(/SPLATORIUM_MODEL_MANIFEST and COMFYUI_ROOT must be non-empty/)
    expect(() =>
      loadServerConfig({
        SPLATORIUM_MODEL_MANIFEST: 'comfy/models.json',
        COMFYUI_ROOT: '',
      }),
    ).toThrow(/SPLATORIUM_MODEL_MANIFEST and COMFYUI_ROOT must be non-empty/)
  })

  it('passes through paired model preflight configuration', () => {
    expect(
      loadServerConfig({
        SPLATORIUM_MODEL_MANIFEST: 'comfy/models.json',
        COMFYUI_ROOT: 'comfy/ComfyUI_windows_portable/ComfyUI',
      }),
    ).toMatchObject({
      modelManifestPath: 'comfy/models.json',
      comfyUiRoot: 'comfy/ComfyUI_windows_portable/ComfyUI',
    })
  })
})
