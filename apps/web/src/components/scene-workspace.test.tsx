import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useSceneStore } from '@/stores/scene-store'
import type { ScaleMode } from '@/components/scene-viewer'
import type { Asset, SceneGroupNode, SceneModelNode, SceneNode } from '@splatorium/shared'
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneWorkspace } from './scene-workspace'

// react-resizable-panels は ResizeObserver を要求するが jsdom には無い
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterAll(() => vi.unstubAllGlobals())

const sceneViewerModule = vi.hoisted(() => ({
  loaded: false,
  props: null as Record<string, unknown> | null,
}))
const thumbnailModule = vi.hoisted(() => ({ source: null as Record<string, unknown> | null }))
const apiMocks = vi.hoisted(() => ({
  saveScene: vi.fn(),
  updateScene: vi.fn(),
  uploadAssetThumbnail: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    saveScene: apiMocks.saveScene,
    updateScene: apiMocks.updateScene,
    uploadAssetThumbnail: apiMocks.uploadAssetThumbnail,
  }
})

vi.mock('@/components/scene-viewer', () => {
  sceneViewerModule.loaded = true
  return {
    SceneViewer: (props: Record<string, unknown>) => {
      sceneViewerModule.props = props
      return <div data-testid="scene-viewer" />
    },
  }
})

vi.mock('@/components/thumbnail-capture', () => ({
  ThumbnailCapture: ({
    source,
    onCapture,
  }: {
    source: Record<string, unknown>
    onCapture: (blob: Blob) => void
  }) => {
    thumbnailModule.source = source
    return (
      <button
        type="button"
        data-testid="scene-thumbnail-capture"
        onClick={() => onCapture(new Blob(['webp'], { type: 'image/webp' }))}
      >
        capture scene
      </button>
    )
  },
}))

beforeEach(() => {
  resetSceneStore()
  apiMocks.saveScene.mockReset()
  apiMocks.updateScene.mockReset()
  apiMocks.uploadAssetThumbnail.mockReset()
  sceneViewerModule.props = null
  thumbnailModule.source = null
})

afterEach(() => {
  cleanup()
  resetSceneStore()
})

describe('SceneWorkspace', () => {
  it('does not load the SceneViewer module for an empty scene', () => {
    renderSceneWorkspace([])

    expect(
      screen.getByText('倉庫のモデルをドラッグ、または「＋」でシーンに追加できます。'),
    ).toBeTruthy()
    expect(sceneViewerModule.loaded).toBe(false)
  })

  it('loads the SceneViewer when the tree is non-empty', async () => {
    renderSceneWorkspace([model(1)])

    expect(screen.getByText('シーンビューアを読み込み中…')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('scene-viewer')).toBeTruthy())
  })

  it('uses overwrite mode and tracks an external active-scene rename', () => {
    const view = renderSceneWorkspace([model(1)], { id: 'scene-1', name: '変更前' })

    expect(screen.getByRole('button', { name: '上書き保存' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'シーン名' }) as HTMLInputElement).value).toBe(
      '変更前',
    )

    useSceneStore.getState().reconcileActiveScene({
      ...makeSceneAsset(),
      id: 'scene-1',
      name: '変更後',
    })
    view.rerender(createWorkspace([model(1)], { id: 'scene-1', name: '変更後' }))
    expect((screen.getByRole('textbox', { name: 'シーン名' }) as HTMLInputElement).value).toBe('変更後')
    expect((screen.getByRole('textbox', { name: 'シーン名' }) as HTMLInputElement).maxLength).toBe(255)
  })

  it('keeps an unsaved name draft when a remote rename arrives', () => {
    const nodes = [model(1)]
    const view = renderSceneWorkspace(nodes, { id: 'scene-1', name: '保存名' })
    fireEvent.change(screen.getByRole('textbox', { name: 'シーン名' }), {
      target: { value: 'ローカル下書き' },
    })

    useSceneStore.getState().reconcileActiveScene({
      ...makeSceneAsset(),
      id: 'scene-1',
      name: 'リモート名',
    })
    view.rerender(createWorkspace(nodes, { id: 'scene-1', name: 'リモート名' }))

    expect((screen.getByRole('textbox', { name: 'シーン名' }) as HTMLInputElement).value)
      .toBe('ローカル下書き')
  })

  it('completes an in-flight save when its global upsert arrives before the response', async () => {
    let resolveSave!: (asset: Asset) => void
    const pendingSave = new Promise<Asset>((resolve) => {
      resolveSave = resolve
    })
    const onSaved = vi.fn()
    const nodes = [group(1, [])]
    const saved = { ...makeSceneAsset(), name: '同期後' }
    apiMocks.updateScene.mockReturnValue(pendingSave)
    const view = renderSceneWorkspace(nodes, { id: saved.id, name: '同期前' }, onSaved)

    fireEvent.change(screen.getByRole('textbox', { name: 'シーン名' }), {
      target: { value: saved.name },
    })
    fireEvent.click(screen.getByRole('button', { name: '上書き保存' }))
    view.rerender(createWorkspace(nodes, { id: saved.id, name: saved.name }, onSaved))
    await act(async () => resolveSave(saved))

    expect(onSaved).toHaveBeenCalledWith(saved, { schemaVersion: 2, nodes }, saved.name)
    expect(screen.getByText(/「同期後」を倉庫に保存しました/)).toBeTruthy()
  })

  it('undoes and redoes tree edits through toolbar and Windows shortcuts', () => {
    useSceneStore.getState().addModel(makeAsset(), null)
    renderSceneWorkspace(useSceneStore.getState().nodes)

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(useSceneStore.getState().nodes).toEqual([])

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(useSceneStore.getState().nodes).toHaveLength(1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useSceneStore.getState().nodes).toEqual([])

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(useSceneStore.getState().nodes).toHaveLength(1)
  })

  it('leaves Ctrl+Z to an editable scene name field', () => {
    useSceneStore.getState().addModel(makeAsset(), null)
    renderSceneWorkspace(useSceneStore.getState().nodes)
    const input = screen.getByRole('textbox', { name: 'シーン名' })

    input.focus()
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })

    expect(useSceneStore.getState().nodes).toHaveLength(1)
  })

  it('toggles scale mode with R and restores it after using another gizmo', () => {
    const nodes = [model(1)]
    const onModeChange = vi.fn()
    const onScaleModeChange = vi.fn()

    function Harness() {
      const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate')
      const [scaleMode, setScaleMode] = useState<ScaleMode>('uniform')
      return createWorkspace(
        nodes,
        null,
        vi.fn(),
        nodes[0].id,
        vi.fn(),
        assetsForNodes(nodes),
        vi.fn(),
        new Set(),
        {
          mode,
          scaleMode,
          onModeChange: (nextMode) => {
            onModeChange(nextMode)
            setMode(nextMode)
          },
          onScaleModeChange: (nextScaleMode) => {
            onScaleModeChange(nextScaleMode)
            setScaleMode(nextScaleMode)
          },
        },
      )
    }

    render(<Harness />)
    const scaleButton = () => screen.getByRole('button', { name: /拡縮（(?:等比|軸別)）/ })

    expect(scaleButton().textContent).toContain('拡縮（等比）')
    fireEvent.keyDown(window, { key: 'r' })
    expect(onModeChange).toHaveBeenLastCalledWith('scale')
    expect(onScaleModeChange).not.toHaveBeenCalled()
    expect(sceneViewerModule.props).toMatchObject({ mode: 'scale', scaleMode: 'uniform' })

    fireEvent.keyDown(window, { key: 'R' })
    expect(onScaleModeChange).toHaveBeenLastCalledWith('axis')
    expect(scaleButton().textContent).toContain('拡縮（軸別）')
    expect(sceneViewerModule.props).toMatchObject({ mode: 'scale', scaleMode: 'axis' })

    fireEvent.keyDown(window, { key: 'w' })
    fireEvent.keyDown(window, { key: 'r' })
    expect(onModeChange).toHaveBeenLastCalledWith('scale')
    expect(onScaleModeChange).toHaveBeenCalledTimes(1)
    expect(sceneViewerModule.props).toMatchObject({ mode: 'scale', scaleMode: 'axis' })

    fireEvent.click(scaleButton())
    expect(onScaleModeChange).toHaveBeenLastCalledWith('uniform')
    expect(scaleButton().textContent).toContain('拡縮（等比）')
  })

  it('isolates every scene shortcut while a dialog is open and restores them after close', async () => {
    useSceneStore.getState().addModel(makeAsset(), null)
    const nodes = useSceneStore.getState().nodes
    const selectedNodeId = nodes[0].id
    const onModeChange = vi.fn()
    const onSelect = vi.fn()
    const onRemove = vi.fn()
    const shortcutCallbacks = { onModeChange, onSelect, onRemove }
    const renderTree = (dialogOpen: boolean) => (
      <>
        {createWorkspace(
          nodes,
          null,
          vi.fn(),
          selectedNodeId,
          onRemove,
          assetsForNodes(nodes),
          vi.fn(),
          new Set(),
          shortcutCallbacks,
        )}
        <Dialog open={dialogOpen}>
          <DialogContent>
            <DialogTitle>テストダイアログ</DialogTitle>
            <button type="button">ダイアログ内操作</button>
          </DialogContent>
        </Dialog>
      </>
    )
    const view = render(renderTree(true))
    const dialogAction = screen.getByRole('button', { name: 'ダイアログ内操作' })

    for (const key of ['Delete', 'w', 'e', 'r', 'f', 'Home', 'Escape']) {
      fireEvent.keyDown(dialogAction, { key })
    }
    fireEvent.keyDown(dialogAction, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(dialogAction, { key: 'y', ctrlKey: true })
    fireEvent.keyDown(dialogAction, { key: 'Control' })

    expect(onModeChange).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    expect(useSceneStore.getState().nodes).toHaveLength(1)
    expect(sceneViewerModule.props?.focusSignal).toBe(0)
    expect(sceneViewerModule.props?.resetSignal).toBe(0)
    expect(sceneViewerModule.props?.snapping).toBe(false)

    view.rerender(renderTree(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.keyDown(window, { key: 'Delete' })
    fireEvent.keyDown(window, { key: 'w' })
    fireEvent.keyDown(window, { key: 'f' })
    fireEvent.keyDown(window, { key: 'Home' })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(useSceneStore.getState().nodes).toEqual([])
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })

    expect(onRemove).toHaveBeenCalledWith(selectedNodeId)
    expect(onModeChange).toHaveBeenCalledWith('translate')
    expect(onSelect).toHaveBeenCalledWith(null)
    expect(useSceneStore.getState().nodes).toHaveLength(1)
    expect(sceneViewerModule.props?.focusSignal).toBe(1)
    expect(sceneViewerModule.props?.resetSignal).toBe(1)
  })

  it('captures and uploads a thumbnail after saving a flat scene', async () => {
    const saved = makeSceneAsset()
    const updated = withThumbnail(saved)
    const onSaved = vi.fn()
    apiMocks.saveScene.mockResolvedValue(saved)
    apiMocks.uploadAssetThumbnail.mockResolvedValue(updated)
    const nodes = [model(1)]
    renderSceneWorkspace(nodes, null, onSaved)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(apiMocks.saveScene).toHaveBeenCalledWith(
        expect.any(String),
        { schemaVersion: 2, nodes },
      )
      expect(onSaved).toHaveBeenCalledWith(saved, { schemaVersion: 2, nodes }, '')
    })
    fireEvent.click(await screen.findByTestId('scene-thumbnail-capture'))

    await waitFor(() => {
      expect(apiMocks.uploadAssetThumbnail).toHaveBeenCalledWith(
        saved.id,
        expect.objectContaining({ type: 'image/webp' }),
        expect.any(AbortSignal),
      )
      expect(onSaved).toHaveBeenLastCalledWith(updated, { schemaVersion: 2, nodes }, '')
    })
  })

  it('reports thumbnail failure separately from a successful flat scene save', async () => {
    const saved = makeSceneAsset()
    apiMocks.saveScene.mockResolvedValue(saved)
    apiMocks.uploadAssetThumbnail.mockRejectedValue(new Error('controlled thumbnail failure'))
    renderSceneWorkspace([model(1)])

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(await screen.findByTestId('scene-thumbnail-capture'))

    await waitFor(() => {
      expect(screen.getByText(/は保存しましたが、サムネイル更新に失敗しました/)).toBeTruthy()
      expect(screen.getByText(/controlled thumbnail failure/)).toBeTruthy()
    })
  })

  it('releases saving after a thumbnail capture timeout and permits another save', async () => {
    vi.useFakeTimers()
    try {
      const saved = makeSceneAsset()
      apiMocks.saveScene.mockResolvedValue(saved)
      renderSceneWorkspace([model(1)])

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '保存' }))
      })
      const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
      expect(saveButton.disabled).toBe(true)
      expect(saveButton.title).toBe('サムネイルの更新が完了するまで利用できません。')
      expect(screen.getByText(/を倉庫に保存しました。/)).toBeTruthy()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(screen.getByText(/は保存しましたが、サムネイル更新に失敗しました/)).toBeTruthy()
      expect(screen.getByText(/サムネイルの生成がタイムアウトしました/)).toBeTruthy()
      expect(saveButton.disabled).toBe(false)
      expect(screen.queryByTestId('scene-thumbnail-capture')).toBeNull()

      await act(async () => {
        fireEvent.click(saveButton)
      })
      expect(apiMocks.saveScene).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a save response after switching to another active scene', async () => {
    let resolveSave!: (asset: Asset) => void
    const pendingSave = new Promise<Asset>((resolve) => {
      resolveSave = resolve
    })
    const onSaved = vi.fn()
    apiMocks.updateScene.mockReturnValue(pendingSave)
    const nodes = [model(1)]
    const view = renderSceneWorkspace(nodes, { id: 'scene-a', name: 'Scene A' }, onSaved)

    fireEvent.click(screen.getByRole('button', { name: '上書き保存' }))
    useSceneStore.setState({
      activeScene: { id: 'scene-b', name: 'Scene B' },
      sceneNameDraft: 'Scene B',
      savedSceneName: 'Scene B',
    })
    view.rerender(createWorkspace(nodes, { id: 'scene-b', name: 'Scene B' }, onSaved))
    await act(async () => resolveSave(makeSceneAsset()))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByTestId('scene-thumbnail-capture')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'シーン名' }) as HTMLInputElement).value).toBe('Scene B')
    expect((screen.getByRole('button', { name: '上書き保存' }) as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('ignores a thumbnail upload response after unmounting the workspace', async () => {
    let resolveUpload!: (asset: Asset) => void
    const pendingUpload = new Promise<Asset>((resolve) => {
      resolveUpload = resolve
    })
    const saved = makeSceneAsset()
    const updated = withThumbnail(saved)
    const onSaved = vi.fn()
    apiMocks.saveScene.mockResolvedValue(saved)
    apiMocks.uploadAssetThumbnail.mockReturnValue(pendingUpload)
    const view = renderSceneWorkspace([model(1)], null, onSaved)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(await screen.findByTestId('scene-thumbnail-capture'))
    const signal = apiMocks.uploadAssetThumbnail.mock.calls[0][2] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => resolveUpload(updated))

    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith(saved, {
      schemaVersion: 2,
      nodes: [model(1)],
    }, '')
  })

  it('aborts a timed-out thumbnail upload and ignores its late response', async () => {
    vi.useFakeTimers()
    try {
      let resolveUpload!: (asset: Asset) => void
      const pendingUpload = new Promise<Asset>((resolve) => {
        resolveUpload = resolve
      })
      const saved = makeSceneAsset()
      const updated = withThumbnail(saved)
      const onSaved = vi.fn()
      apiMocks.saveScene.mockResolvedValue(saved)
      apiMocks.uploadAssetThumbnail.mockReturnValue(pendingUpload)
      renderSceneWorkspace([model(1)], null, onSaved)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '保存' }))
      })
      fireEvent.click(screen.getByTestId('scene-thumbnail-capture'))
      const signal = apiMocks.uploadAssetThumbnail.mock.calls[0][2] as AbortSignal

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(signal.aborted).toBe(true)
      expect(screen.getByText(/サムネイルの生成がタイムアウトしました/)).toBeTruthy()

      await act(async () => resolveUpload(updated))
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(onSaved).toHaveBeenLastCalledWith(saved, {
        schemaVersion: 2,
        nodes: [model(1)],
      }, '')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves a nested tree exactly and captures the flattened world placement', async () => {
    const saved = makeSceneAsset()
    const nested = group(1, [model(2)])
    nested.transform.position = [4, 5, 6]
    nested.importedFrom = {
      sceneId: 'source-scene',
      sourceHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
    }
    apiMocks.saveScene.mockResolvedValue(saved)
    renderSceneWorkspace([nested])

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(apiMocks.saveScene).toHaveBeenCalledWith(
        expect.any(String),
        { schemaVersion: 2, nodes: [nested] },
      )
      expect(screen.getByTestId('scene-thumbnail-capture')).toBeTruthy()
    })
    const source = thumbnailModule.source as {
      kind: string
      placements: { nodeId: string; worldMatrix: { elements: number[] } }[]
    }
    expect(source.kind).toBe('scene')
    expect(source.placements.map(({ nodeId }) => nodeId)).toEqual([nested.children[0].id])
    expect(source.placements[0].worldMatrix.elements.slice(12, 15)).toEqual([4, 5, 6])
  })

  it('captures both root and nested models from a mixed tree', async () => {
    apiMocks.saveScene.mockResolvedValue(makeSceneAsset())
    renderSceneWorkspace([model(1), group(2, [model(3)])])

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByTestId('scene-thumbnail-capture')).toBeTruthy())
    const source = thumbnailModule.source as { placements: { nodeId: string }[] }
    expect(source.placements.map(({ nodeId }) => nodeId)).toEqual([uuid(1), uuid(3)])
  })

  it('passes group selection to the viewer and enables group focus and delete', () => {
    const onRemove = vi.fn()
    const selectedGroup = group(1, [model(2)])
    render(createWorkspace([selectedGroup], null, vi.fn(), selectedGroup.id, onRemove))

    expect((screen.getByRole('button', { name: /フォーカス/ }) as HTMLButtonElement).disabled)
      .toBe(false)
    expect(sceneViewerModule.props?.selectedNodeId).toBe(selectedGroup.id)
    fireEvent.click(screen.getByRole('button', { name: /フォーカス/ }))
    expect(sceneViewerModule.props?.focusSignal).toBe(1)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(onRemove).toHaveBeenCalledWith(selectedGroup.id)
  })

  it('keeps an empty or broken-only group transformable but disables focus', () => {
    const onRemove = vi.fn()
    const selectedGroup = group(1, [model(2)])
    render(createWorkspace([selectedGroup], null, vi.fn(), selectedGroup.id, onRemove, []))

    expect((screen.getByRole('button', { name: /フォーカス/ }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect(sceneViewerModule.props?.selectedNodeId).toBe(selectedGroup.id)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(onRemove).toHaveBeenCalledWith(selectedGroup.id)
  })

  it('checks all imported scenes from the toolbar and disables duplicate checks', () => {
    const imported = group(20, [])
    imported.importedFrom = {
      sceneId: 'source-scene',
      sourceHash: 'a'.repeat(64),
      contentHash: 'a'.repeat(64),
    }
    const onCheckAll = vi.fn()
    const { rerender } = render(
      createWorkspace(
        [imported],
        null,
        vi.fn(),
        imported.id,
        vi.fn(),
        assetsForNodes([imported]),
        onCheckAll,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'シーン更新を確認' }))
    expect(onCheckAll).toHaveBeenCalledOnce()

    rerender(
      createWorkspace(
        [imported],
        null,
        vi.fn(),
        imported.id,
        vi.fn(),
        assetsForNodes([imported]),
        onCheckAll,
        new Set([imported.id]),
      ),
    )
    expect((screen.getByRole('button', { name: 'シーン更新を確認' }) as HTMLButtonElement).disabled)
      .toBe(true)
  })
})

function renderSceneWorkspace(
  nodes: SceneNode[],
  activeScene: { id: string; name: string } | null = null,
  onSaved = vi.fn(),
) {
  if (activeScene) {
    useSceneStore.setState({
      activeScene,
      sceneNameDraft: activeScene.name,
      savedSceneName: activeScene.name,
    })
  }
  return render(createWorkspace(nodes, activeScene, onSaved))
}

function createWorkspace(
  nodes: SceneNode[],
  activeScene: { id: string; name: string } | null,
  onSaved = vi.fn(),
  selectedNodeId: string | null = nodes[0]?.id ?? null,
  onRemove = vi.fn(),
  assets = assetsForNodes(nodes),
  onCheckAllImportedScenes = vi.fn(),
  checkingImportedNodeIds: ReadonlySet<string> = new Set(),
  shortcutCallbacks: {
    mode?: 'translate' | 'rotate' | 'scale'
    scaleMode?: ScaleMode
    onModeChange?: (mode: 'translate' | 'rotate' | 'scale') => void
    onScaleModeChange?: (mode: ScaleMode) => void
    onSelect?: (nodeId: string | null) => void
    onRemove?: (nodeId: string) => void
  } = {},
) {
  return (
    <SceneWorkspace
      nodes={nodes}
      assets={assets}
      selectedNodeId={selectedNodeId}
      mode={shortcutCallbacks.mode ?? 'translate'}
      scaleMode={shortcutCallbacks.scaleMode ?? 'uniform'}
      activeScene={activeScene}
      onModeChange={shortcutCallbacks.onModeChange ?? vi.fn()}
      onScaleModeChange={shortcutCallbacks.onScaleModeChange ?? vi.fn()}
      onSelect={shortcutCallbacks.onSelect ?? vi.fn()}
      onCommit={vi.fn()}
      onTransformPreview={vi.fn()}
      onToggleVisible={vi.fn()}
      onRemove={shortcutCallbacks.onRemove ?? onRemove}
      onClear={vi.fn()}
      onSaved={onSaved}
      onImportScene={vi.fn()}
      onViewportDropAsset={vi.fn()}
      importedSceneUpdates={new Map()}
      checkingImportedNodeIds={checkingImportedNodeIds}
      onCheckAllImportedScenes={onCheckAllImportedScenes}
    />
  )
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function model(sequence: number): SceneModelNode {
  return {
    id: uuid(sequence),
    kind: 'model',
    name: `Model ${sequence}`,
    visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    assetId: `asset-${sequence}`,
  }
}

function group(sequence: number, children: SceneNode[]): SceneGroupNode {
  return {
    id: uuid(sequence),
    kind: 'group',
    name: `Group ${sequence}`,
    visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    children,
  }
}

function makeAsset(id = 'asset-splat'): Asset {
  return {
    id,
    kind: 'splat',
    name: `${id}.spz`,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 1 } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function assetsForNodes(nodes: readonly SceneNode[]): Asset[] {
  return nodes.flatMap((node) =>
    node.kind === 'model' ? [makeAsset(node.assetId)] : assetsForNodes(node.children),
  )
}

function makeSceneAsset(): Asset {
  return {
    id: 'scene-asset',
    kind: 'scene',
    name: '保存シーン',
    tags: [],
    files: { main: { path: 'scene.json', size: 10, mime: 'application/json' } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function withThumbnail(asset: Asset): Asset {
  return {
    ...asset,
    files: {
      ...asset.files,
      thumbnail: { path: 'thumbnail.webp', size: 100, mime: 'image/webp' },
    },
  }
}

function resetSceneStore() {
  const history = useSceneStore.temporal.getState()
  history.pause()
  useSceneStore.setState(useSceneStore.getInitialState(), true)
  history.clear()
  history.resume()
}
