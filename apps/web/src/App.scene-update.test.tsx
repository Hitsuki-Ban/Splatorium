import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSceneStore } from '@/stores/scene-store'
import { ApiError } from '@/lib/api'
import {
  hashSceneNodes,
  type Asset,
  type Job,
  type SceneDocument,
  type SceneGroupNode,
  type WorkbenchEvent,
} from '@splatorium/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import App from './App'

const apiMocks = vi.hoisted(() => ({
  fetchAssets: vi.fn(),
  fetchJobs: vi.fn(),
  fetchJob: vi.fn(),
  fetchHealth: vi.fn(),
  fetchSceneDocument: vi.fn(),
  createJob: vi.fn(),
  subscribeWorkbenchEvents: vi.fn(),
}))
const syncHarness = vi.hoisted(() => ({
  onEvent: null as ((event: WorkbenchEvent) => void) | null,
  onDisconnect: null as (() => void) | null,
}))
const contentBrowserState = vi.hoisted(() => ({
  jobs: [] as { job: Job; label: string }[],
  highlightIds: new Set<string>() as ReadonlySet<string>,
}))
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchAssets: apiMocks.fetchAssets,
  fetchJobs: apiMocks.fetchJobs,
  fetchJob: apiMocks.fetchJob,
  fetchHealth: apiMocks.fetchHealth,
  fetchSceneDocument: apiMocks.fetchSceneDocument,
  createJob: apiMocks.createJob,
  subscribeWorkbenchEvents: apiMocks.subscribeWorkbenchEvents,
}))

vi.mock('sonner', () => ({ toast: toastMocks }))

vi.mock('@/components/content-browser', () => ({
  ContentBrowser: ({
    assets,
    jobs,
    highlightIds,
    onOpenAsset,
    onImportScene,
  }: {
    assets: Asset[]
    jobs: { job: Job; label: string }[]
    highlightIds: ReadonlySet<string>
    onOpenAsset: (asset: Asset) => void
    onImportScene: (asset: Asset) => void
  }) => {
    contentBrowserState.jobs = jobs
    contentBrowserState.highlightIds = highlightIds
    return <div>
      {assets.map((asset) => (
        <div key={asset.id}>
          <button type="button" onClick={() => onOpenAsset(asset)}>
            open-{asset.id}
          </button>
          {asset.kind === 'scene' && (
            <button type="button" onClick={() => onImportScene(asset)}>
              import-{asset.id}
            </button>
          )}
        </div>
      ))}
    </div>
  },
}))

vi.mock('@/components/scene-workspace', () => ({
  SceneWorkspace: ({ onClear }: { onClear: () => void }) => (
    <div data-testid="scene-workspace">
      <button type="button" onClick={onClear}>clear-test-scene</button>
      <button
        type="button"
        onClick={() => useSceneStore.getState().setSceneNameDraft('ローカル下書き')}
      >
        dirty-test-name
      </button>
    </div>
  ),
}))
vi.mock('@/components/inspector-panel', () => ({
  InspectorPanel: () => <div data-testid="asset-inspector" />,
}))
vi.mock('@/components/theme-menu', () => ({ ThemeMenu: () => <button>theme</button> }))
vi.mock('@/components/upload-dialog', () => ({
  UploadDialog: ({ onSubmit }: { onSubmit: (file: File, options: { numGaussians: number }) => void }) => (
    <button type="button" onClick={() => onSubmit(new File(['image'], 'owned.png'), { numGaussians: 10 })}>
      submit-test-job
    </button>
  ),
}))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('react-resizable-panels', () => ({ usePanelRef: () => ({ current: null }) }))
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}))

beforeEach(() => {
  const history = useSceneStore.temporal.getState()
  history.pause()
  useSceneStore.setState(useSceneStore.getInitialState(), true)
  history.clear()
  history.resume()
  vi.clearAllMocks()
  apiMocks.fetchHealth.mockResolvedValue({ status: 'ok' })
  apiMocks.fetchJobs.mockResolvedValue([])
  apiMocks.fetchAssets.mockResolvedValue([])
  syncHarness.onEvent = null
  syncHarness.onDisconnect = null
  contentBrowserState.jobs = []
  contentBrowserState.highlightIds = new Set()
  apiMocks.subscribeWorkbenchEvents.mockImplementation(
    (onEvent: (event: WorkbenchEvent) => void, _onProtocolError: unknown, onDisconnect: () => void) => {
      syncHarness.onEvent = onEvent
      syncHarness.onDisconnect = onDisconnect
      queueMicrotask(() => onEvent({ type: 'sync', serverId: 'test-server', seq: 0 }))
      return vi.fn()
    },
  )
})

afterEach(cleanup)

describe('App imported scene updates', () => {
  it('checks in background, warns for dirty reimport, commits atomically, and undoes once', async () => {
    const emptyHash = await hashSceneNodes([])
    const sourceAsset = sceneAsset('source-scene', 'Source scene')
    const parentAsset = sceneAsset('parent-scene', 'Parent scene')
    const wrapper: SceneGroupNode = {
      id: uuid(1),
      kind: 'group',
      name: 'Local wrapper name',
      visible: false,
      transform: { position: [4, 5, 6], rotation: [0, 0, 0], scale: [2, 2, 2] },
      children: [],
      importedFrom: {
        sceneId: sourceAsset.id,
        sourceHash: emptyHash,
        contentHash: emptyHash,
      },
    }
    const parentDocument: SceneDocument = { schemaVersion: 2, nodes: [wrapper] }
    const initialSource: SceneDocument = { schemaVersion: 2, nodes: [] }
    let sourceDocument = initialSource
    let resolveInitialSource!: (document: SceneDocument) => void
    let firstSourceRequest = true
    const initialSourceRequest = new Promise<SceneDocument>((resolve) => {
      resolveInitialSource = resolve
    })
    apiMocks.fetchAssets.mockResolvedValue([parentAsset, sourceAsset])
    apiMocks.fetchSceneDocument.mockImplementation((sceneId: string) => {
      if (sceneId === parentAsset.id) return Promise.resolve(parentDocument)
      if (sceneId !== sourceAsset.id) throw new Error(`unexpected scene: ${sceneId}`)
      if (firstSourceRequest) {
        firstSourceRequest = false
        return initialSourceRequest
      }
      return Promise.resolve(sourceDocument)
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: `open-${parentAsset.id}` }))
    await waitFor(() => expect(useSceneStore.getState().nodes[0]?.id).toBe(wrapper.id))
    act(() => {
      useSceneStore.getState().selectNode(wrapper.id)
    })
    expect((await screen.findAllByText('確認中')).length).toBeGreaterThan(0)
    expect(screen.getByTestId('scene-workspace')).toBeTruthy()

    await act(async () => {
      resolveInitialSource(initialSource)
      await initialSourceRequest
    })
    expect(await screen.findByText('最新')).toBeTruthy()

    const sourceChild: SceneGroupNode = {
      id: uuid(100),
      kind: 'group',
      name: 'Source child',
      visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      children: [],
    }
    sourceDocument = { schemaVersion: 2, nodes: [sourceChild] }
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }))
    expect((await screen.findAllByText('更新あり')).length).toBeGreaterThan(0)

    act(() => {
      useSceneStore.getState().createGroup(wrapper.id)
      useSceneStore.getState().selectNode(wrapper.id)
    })
    expect(await screen.findByText('更新あり・ローカル変更あり')).toBeTruthy()
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '最新を取り込む' }))
    expect(await screen.findByText('ローカル変更を上書きしますか？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await screen.findByRole('button', { name: '最新を取り込む' })
    expect((useSceneStore.getState().nodes[0] as SceneGroupNode).children[0].name).toBe(
      'グループ 1',
    )
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '最新を取り込む' }))
    fireEvent.click(await screen.findByRole('button', { name: '上書きして取り込む' }))
    await waitFor(() => {
      const refreshed = useSceneStore.getState().nodes[0] as SceneGroupNode
      expect(refreshed.children[0].name).toBe('Source child')
    })
    const refreshed = useSceneStore.getState().nodes[0] as SceneGroupNode
    expect(refreshed).toMatchObject({
      id: wrapper.id,
      name: wrapper.name,
      visible: wrapper.visible,
      transform: wrapper.transform,
    })
    expect(refreshed.children[0].id).not.toBe(sourceChild.id)
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(2)

    act(() => useSceneStore.temporal.getState().undo())
    expect((useSceneStore.getState().nodes[0] as SceneGroupNode).children[0].name).toBe(
      'グループ 1',
    )
  }, 15_000)

  it('marks a missing source and unlinks it as one undoable mutation', async () => {
    const emptyHash = await hashSceneNodes([])
    const sourceAsset = sceneAsset('missing-source', 'Missing source')
    const parentAsset = sceneAsset('missing-parent', 'Parent')
    const wrapper: SceneGroupNode = {
      id: uuid(500),
      kind: 'group',
      name: 'Imported copy',
      visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      children: [],
      importedFrom: {
        sceneId: sourceAsset.id,
        sourceHash: emptyHash,
        contentHash: emptyHash,
      },
    }
    apiMocks.fetchAssets.mockResolvedValue([parentAsset, sourceAsset])
    apiMocks.fetchSceneDocument.mockImplementation((sceneId: string) => {
      if (sceneId === parentAsset.id) {
        return Promise.resolve({ schemaVersion: 2, nodes: [wrapper] })
      }
      return Promise.reject(new ApiError(404, 'missing'))
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: `open-${parentAsset.id}` }))
    await waitFor(() => expect(useSceneStore.getState().nodes[0]?.id).toBe(wrapper.id))
    act(() => useSceneStore.getState().selectNode(wrapper.id))

    expect((await screen.findAllByText('リンク切れ')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '最新を取り込む' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'リンク解除' }))
    expect((useSceneStore.getState().nodes[0] as SceneGroupNode).importedFrom).toBeUndefined()
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)

    act(() => useSceneStore.temporal.getState().undo())
    expect((useSceneStore.getState().nodes[0] as SceneGroupNode).importedFrom).toEqual(
      wrapper.importedFrom,
    )
  })

  it('blocks duplicate reimports while the fresh source request is pending', async () => {
    const emptyHash = await hashSceneNodes([])
    const sourceAsset = sceneAsset('duplicate-source', 'Source')
    const parentAsset = sceneAsset('duplicate-parent', 'Parent')
    const wrapper = importedWrapper(700, sourceAsset.id, emptyHash)
    const sourceChild = groupNode(701, 'Latest child')
    const latestDocument: SceneDocument = { schemaVersion: 2, nodes: [sourceChild] }
    const pendingReimport = deferred<SceneDocument>()
    let sourceRequests = 0
    apiMocks.fetchAssets.mockResolvedValue([parentAsset, sourceAsset])
    apiMocks.fetchSceneDocument.mockImplementation((sceneId: string) => {
      if (sceneId === parentAsset.id) {
        return Promise.resolve({ schemaVersion: 2, nodes: [wrapper] })
      }
      sourceRequests += 1
      if (sourceRequests === 1) return Promise.resolve({ schemaVersion: 2, nodes: [] })
      if (sourceRequests === 2) return Promise.resolve(latestDocument)
      if (sourceRequests === 3) return pendingReimport.promise
      throw new Error(`unexpected duplicate source request: ${sourceRequests}`)
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: `open-${parentAsset.id}` }))
    await waitFor(() => expect(useSceneStore.getState().nodes[0]?.id).toBe(wrapper.id))
    act(() => useSceneStore.getState().selectNode(wrapper.id))
    expect(await screen.findByText('最新')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }))
    expect((await screen.findAllByText('更新あり')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '最新を取り込む' }))
    const pendingButton = await screen.findByRole('button', { name: '取込中' })
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(pendingButton)
    expect(sourceRequests).toBe(3)

    await act(async () => pendingReimport.resolve(latestDocument))
    await waitFor(() => {
      const refreshed = useSceneStore.getState().nodes[0] as SceneGroupNode
      expect(refreshed.children[0]?.name).toBe(sourceChild.name)
    })
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
  })

  it('keeps checks for different source scenes independent', async () => {
    const emptyHash = await hashSceneNodes([])
    const sourceA = sceneAsset('source-a', 'Source A')
    const sourceB = sceneAsset('source-b', 'Source B')
    const parentAsset = sceneAsset('independent-parent', 'Parent')
    const wrapperA = importedWrapper(800, sourceA.id, emptyHash)
    const wrapperB = importedWrapper(810, sourceB.id, emptyHash)
    const pendingA = deferred<SceneDocument>()
    const pendingB = deferred<SceneDocument>()
    const sourceRequests = new Map<string, number>()
    apiMocks.fetchAssets.mockResolvedValue([parentAsset, sourceA, sourceB])
    apiMocks.fetchSceneDocument.mockImplementation((sceneId: string) => {
      if (sceneId === parentAsset.id) {
        return Promise.resolve({ schemaVersion: 2, nodes: [wrapperA, wrapperB] })
      }
      const count = (sourceRequests.get(sceneId) ?? 0) + 1
      sourceRequests.set(sceneId, count)
      if (count === 1) return Promise.resolve({ schemaVersion: 2, nodes: [] })
      if (sceneId === sourceA.id && count === 2) return pendingA.promise
      if (sceneId === sourceB.id && count === 2) return pendingB.promise
      throw new Error(`unexpected source request: ${sceneId} #${count}`)
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: `open-${parentAsset.id}` }))
    await waitFor(() => expect(useSceneStore.getState().nodes).toHaveLength(2))
    act(() => useSceneStore.getState().selectNode(wrapperA.id))
    expect(await screen.findByText('最新')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }))

    act(() => useSceneStore.getState().selectNode(wrapperB.id))
    expect(await screen.findByText('最新')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }))

    await act(async () =>
      pendingA.resolve({ schemaVersion: 2, nodes: [groupNode(820, 'A update')] }),
    )
    act(() => useSceneStore.getState().selectNode(wrapperA.id))
    expect((await screen.findAllByText('更新あり')).length).toBeGreaterThan(0)
    expect(sourceRequests.get(sourceB.id)).toBe(2)

    await act(async () =>
      pendingB.resolve({ schemaVersion: 2, nodes: [groupNode(830, 'B update')] }),
    )
    act(() => useSceneStore.getState().selectNode(wrapperB.id))
    expect((await screen.findAllByText('更新あり')).length).toBeGreaterThan(0)
  })

  it('shows checkFailed and leaves the scene and history unchanged when reimport fails', async () => {
    const emptyHash = await hashSceneNodes([])
    const sourceAsset = sceneAsset('failing-source', 'Source')
    const parentAsset = sceneAsset('failing-parent', 'Parent')
    const wrapper = importedWrapper(900, sourceAsset.id, emptyHash)
    const latestDocument: SceneDocument = {
      schemaVersion: 2,
      nodes: [groupNode(901, 'Available update')],
    }
    let sourceRequests = 0
    apiMocks.fetchAssets.mockResolvedValue([parentAsset, sourceAsset])
    apiMocks.fetchSceneDocument.mockImplementation((sceneId: string) => {
      if (sceneId === parentAsset.id) {
        return Promise.resolve({ schemaVersion: 2, nodes: [wrapper] })
      }
      sourceRequests += 1
      if (sourceRequests === 1) return Promise.resolve({ schemaVersion: 2, nodes: [] })
      if (sourceRequests === 2) return Promise.resolve(latestDocument)
      if (sourceRequests === 3) return Promise.reject(new ApiError(500, 'source unavailable'))
      throw new Error(`unexpected failing source request: ${sourceRequests}`)
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: `open-${parentAsset.id}` }))
    await waitFor(() => expect(useSceneStore.getState().nodes[0]?.id).toBe(wrapper.id))
    act(() => useSceneStore.getState().selectNode(wrapper.id))
    expect(await screen.findByText('最新')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }))
    expect((await screen.findAllByText('更新あり')).length).toBeGreaterThan(0)
    const before = structuredClone(useSceneStore.getState().nodes)

    fireEvent.click(screen.getByRole('button', { name: '最新を取り込む' }))

    expect((await screen.findAllByText('確認失敗')).length).toBeGreaterThan(0)
    expect(screen.getByRole('alert').textContent).toContain('source unavailable')
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
    expect(screen.queryByRole('button', { name: '最新を取り込む' })).toBeNull()
  })

  it('preserves existing source status when another import of that source fails', async () => {
    const emptyHash = await hashSceneNodes([])
    const sourceAsset = sceneAsset('failed-import-source', 'Source')
    const parentAsset = sceneAsset('failed-import-parent', 'Parent')
    const wrapper = importedWrapper(950, sourceAsset.id, emptyHash)
    let sourceRequests = 0
    apiMocks.fetchAssets.mockResolvedValue([parentAsset, sourceAsset])
    apiMocks.fetchSceneDocument.mockImplementation((sceneId: string) => {
      if (sceneId === parentAsset.id) {
        return Promise.resolve({ schemaVersion: 2, nodes: [wrapper] })
      }
      sourceRequests += 1
      if (sourceRequests === 1) return Promise.resolve({ schemaVersion: 2, nodes: [] })
      if (sourceRequests === 2) return Promise.reject(new ApiError(500, 'import failed'))
      throw new Error(`unexpected failed import request: ${sourceRequests}`)
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: `open-${parentAsset.id}` }))
    await waitFor(() => expect(useSceneStore.getState().nodes[0]?.id).toBe(wrapper.id))
    act(() => useSceneStore.getState().selectNode(wrapper.id))
    expect(await screen.findByText('最新')).toBeTruthy()
    const before = structuredClone(useSceneStore.getState().nodes)

    fireEvent.click(screen.getByRole('button', { name: `import-${sourceAsset.id}` }))

    await waitFor(() => expect(sourceRequests).toBe(2))
    expect(await screen.findByText('最新')).toBeTruthy()
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })
})

describe('App self scene import confirmation', () => {
  it('waits for confirmation, cancels without mutation, and imports after confirmation', async () => {
    const current = sceneAsset('self-scene', 'Self scene')
    const baseline = groupNode(1_000, 'Existing node')
    useSceneStore.getState().replaceScene(
      { schemaVersion: 2, nodes: [baseline] },
      { id: current.id, name: current.name },
    )
    apiMocks.fetchAssets.mockResolvedValue([current])
    apiMocks.fetchSceneDocument.mockResolvedValue({ schemaVersion: 2, nodes: [] })
    render(<App />)

    const importButton = await screen.findByRole('button', { name: `import-${current.id}` })
    const before = structuredClone(useSceneStore.getState().nodes)
    fireEvent.click(importButton)

    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(apiMocks.fetchSceneDocument).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(useSceneStore.getState().nodes).toEqual(before)
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
    expect(apiMocks.fetchSceneDocument).not.toHaveBeenCalled()

    fireEvent.click(importButton)
    fireEvent.click(await screen.findByRole('button', { name: '取り込む' }))

    await waitFor(() => expect(apiMocks.fetchSceneDocument).toHaveBeenCalledWith(current.id))
    await waitFor(() => expect(useSceneStore.getState().nodes).toHaveLength(2))
    expect(useSceneStore.getState().nodes[0]).toEqual(baseline)
    expect(useSceneStore.getState().nodes[1]).toMatchObject({
      kind: 'group',
      name: current.name,
      importedFrom: { sceneId: current.id },
    })
    expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1)
  })

  it('imports another scene immediately without showing a warning', async () => {
    const current = sceneAsset('current-scene', 'Current scene')
    const other = sceneAsset('other-scene', 'Other scene')
    useSceneStore.getState().replaceScene(
      { schemaVersion: 2, nodes: [groupNode(1_010, 'Existing node')] },
      { id: current.id, name: current.name },
    )
    apiMocks.fetchAssets.mockResolvedValue([current, other])
    apiMocks.fetchSceneDocument.mockResolvedValue({ schemaVersion: 2, nodes: [] })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: `import-${other.id}` }))

    await waitFor(() => expect(apiMocks.fetchSceneDocument).toHaveBeenCalledWith(other.id))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(useSceneStore.getState().nodes).toHaveLength(2))
    expect(useSceneStore.getState().nodes[1]).toMatchObject({
      kind: 'group',
      importedFrom: { sceneId: other.id },
    })
  })

  it('rejects a confirmed import when its pending destination became stale', async () => {
    const current = sceneAsset('stale-self-scene', 'Stale self scene')
    const replacement = sceneAsset('replacement-scene', 'Replacement scene')
    const original = groupNode(1_020, 'Original node')
    const replacementNode = groupNode(1_021, 'Replacement node')
    useSceneStore.getState().replaceScene(
      { schemaVersion: 2, nodes: [original] },
      { id: current.id, name: current.name },
    )
    apiMocks.fetchAssets.mockResolvedValue([current, replacement])
    apiMocks.fetchSceneDocument.mockResolvedValue({ schemaVersion: 2, nodes: [] })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: `import-${current.id}` }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    act(() => {
      useSceneStore.getState().replaceScene(
        { schemaVersion: 2, nodes: [replacementNode] },
        { id: replacement.id, name: replacement.name },
      )
    })
    fireEvent.click(screen.getByRole('button', { name: '取り込む' }))

    await waitFor(() => expect(apiMocks.fetchSceneDocument).toHaveBeenCalledWith(current.id))
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith(
      'シーンを取り込めませんでした',
      { description: 'scene changed while the import was being prepared' },
    ))
    expect(useSceneStore.getState().activeScene).toEqual({
      id: replacement.id,
      name: replacement.name,
    })
    expect(useSceneStore.getState().nodes).toEqual([replacementNode])
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })
})

describe('App global job synchronization', () => {
  it('drops an owned job that returns 404 without failing the reconnect snapshot', async () => {
    apiMocks.fetchAssets.mockResolvedValue([imageAsset('input', 'owned.png')])
    apiMocks.createJob.mockResolvedValue(workbenchJob('missing-owned-job', 'queued'))
    apiMocks.fetchJob.mockRejectedValue(new ApiError(404, 'missing'))
    render(<App />)
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'submit-test-job' }))
    await waitFor(() => expect(apiMocks.createJob).toHaveBeenCalledOnce())
    act(() => {
      syncHarness.onDisconnect?.()
      syncHarness.onEvent?.({ type: 'sync', serverId: 'test-server', seq: 10 })
    })
    await waitFor(() => expect(apiMocks.fetchJob).toHaveBeenCalledWith('missing-owned-job'))
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(4))

    act(() => {
      syncHarness.onEvent?.(jobUpsert(11, workbenchJob('missing-owned-job', 'running')))
      syncHarness.onEvent?.(jobUpsert(12, workbenchJob('missing-owned-job', 'failed')))
    })

    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(contentBrowserState.jobs.find(({ job }) => job.id === 'missing-owned-job')?.job.status)
      .toBe('failed')
  })

  it('retains ownership when an owned job snapshot fails with a non-404 error', async () => {
    apiMocks.fetchAssets.mockResolvedValue([imageAsset('input', 'owned.png')])
    apiMocks.createJob.mockResolvedValue(workbenchJob('retry-owned-job', 'queued'))
    apiMocks.fetchJob
      .mockRejectedValueOnce(new ApiError(500, 'temporary failure'))
      .mockResolvedValue(workbenchJob('retry-owned-job', 'running'))
    render(<App />)
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'submit-test-job' }))
    await waitFor(() => expect(apiMocks.createJob).toHaveBeenCalledOnce())
    act(() => {
      syncHarness.onDisconnect?.()
      syncHarness.onEvent?.({ type: 'sync', serverId: 'test-server', seq: 10 })
    })
    await waitFor(() => expect(apiMocks.fetchJob).toHaveBeenCalledTimes(1))

    act(() => {
      syncHarness.onEvent?.({ type: 'sync', serverId: 'test-server', seq: 20 })
    })
    await waitFor(() => expect(apiMocks.fetchJob).toHaveBeenCalledTimes(2))
    act(() => {
      syncHarness.onEvent?.(jobUpsert(21, workbenchJob('retry-owned-job', 'failed')))
    })

    expect(toastMocks.error).toHaveBeenCalledWith(
      '「owned.png」の生成に失敗しました',
      { description: undefined },
    )
  })

  it('releases a settled owned job so later reconnects do not fetch it again', async () => {
    apiMocks.fetchAssets.mockResolvedValue([imageAsset('input', 'owned.png')])
    apiMocks.createJob.mockResolvedValue(workbenchJob('settled-owned-job', 'queued'))
    render(<App />)
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'submit-test-job' }))
    await waitFor(() => expect(apiMocks.createJob).toHaveBeenCalledOnce())
    act(() => {
      syncHarness.onEvent?.(jobUpsert(1, workbenchJob('settled-owned-job', 'running')))
      syncHarness.onEvent?.(jobUpsert(2, workbenchJob('settled-owned-job', 'failed')))
    })
    expect(toastMocks.error).toHaveBeenCalledOnce()

    act(() => {
      syncHarness.onDisconnect?.()
      syncHarness.onEvent?.({ type: 'sync', serverId: 'test-server', seq: 10 })
    })
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(4))
    expect(apiMocks.fetchJob).not.toHaveBeenCalled()
  })

  it('keeps a terminal event observed before the create response and notifies it as owned', async () => {
    const response = deferred<Job>()
    const input = imageAsset('input', 'owned.png')
    const output = splatAsset('output')
    apiMocks.fetchAssets.mockResolvedValue([input])
    apiMocks.createJob.mockReturnValue(response.promise)
    render(<App />)
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'submit-test-job' }))
    await waitFor(() => expect(apiMocks.createJob).toHaveBeenCalledOnce())
    act(() => {
      syncHarness.onEvent?.(jobUpsert(1, workbenchJob('owned-job', 'running')))
      syncHarness.onEvent?.(assetUpsert(2, output))
      syncHarness.onEvent?.(
        jobUpsert(3, workbenchJob('owned-job', 'succeeded', [output.id])),
      )
    })
    await act(async () => response.resolve(workbenchJob('owned-job', 'queued')))

    expect(toastMocks.success).toHaveBeenCalledWith(
      '生成を開始しました',
      { description: 'owned.png' },
    )
    expect(toastMocks.success).toHaveBeenCalledWith('「owned.png」の 3D 生成が完了しました')
    expect(contentBrowserState.jobs.some(({ job }) => job.id === 'owned-job')).toBe(false)
    expect(contentBrowserState.highlightIds.has(output.id)).toBe(true)

    act(() => {
      syncHarness.onDisconnect?.()
      syncHarness.onEvent?.({ type: 'sync', serverId: 'test-server', seq: 10 })
    })
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(4))
    expect(apiMocks.fetchJob).not.toHaveBeenCalled()
  })

  it('keeps a failed event observed before the create response instead of restoring queued', async () => {
    const response = deferred<Job>()
    apiMocks.fetchAssets.mockResolvedValue([imageAsset('input', 'owned.png')])
    apiMocks.createJob.mockReturnValue(response.promise)
    render(<App />)
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'submit-test-job' }))
    await waitFor(() => expect(apiMocks.createJob).toHaveBeenCalledOnce())
    const failed = { ...workbenchJob('owned-job', 'failed'), error: 'pipeline failed' }
    act(() => {
      syncHarness.onEvent?.(jobUpsert(1, workbenchJob('owned-job', 'running')))
      syncHarness.onEvent?.(jobUpsert(2, failed))
    })
    await act(async () => response.resolve(workbenchJob('owned-job', 'queued')))

    expect(toastMocks.error).toHaveBeenCalledWith(
      '「owned.png」の生成に失敗しました',
      { description: 'pipeline failed' },
    )
    expect(contentBrowserState.jobs.find(({ job }) => job.id === 'owned-job')?.job.status)
      .toBe('failed')
  })

  it('promotes a remote success without showing an owned completion toast', async () => {
    const input = imageAsset('input', 'remote.png')
    const output = splatAsset('output')
    apiMocks.fetchAssets.mockResolvedValue([input])
    render(<App />)
    await waitFor(() => expect(apiMocks.fetchJobs).toHaveBeenCalledTimes(2))

    act(() => {
      syncHarness.onEvent?.(jobUpsert(1, workbenchJob('remote-job', 'running')))
      syncHarness.onEvent?.(assetUpsert(2, output))
      syncHarness.onEvent?.(
        jobUpsert(3, workbenchJob('remote-job', 'succeeded', [output.id])),
      )
    })

    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(contentBrowserState.jobs.some(({ job }) => job.id === 'remote-job')).toBe(false)
    expect(contentBrowserState.highlightIds.has(output.id)).toBe(true)
  })
})

describe('App scene discard confirmation', () => {
  it('opens a different scene immediately when the current scene is clean', async () => {
    const current = sceneAsset('current-scene', 'Current')
    const target = sceneAsset('target-scene', 'Target')
    useSceneStore.getState().replaceScene(
      { schemaVersion: 2, nodes: [groupNode(1, 'Saved')] },
      { id: current.id, name: current.name },
    )
    apiMocks.fetchAssets.mockResolvedValue([current, target])
    apiMocks.fetchSceneDocument.mockResolvedValue({ schemaVersion: 2, nodes: [] })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: `open-${target.id}` }))

    await waitFor(() => expect(apiMocks.fetchSceneDocument).toHaveBeenCalledWith(target.id))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useSceneStore.getState().activeScene).toEqual({ id: target.id, name: target.name })
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('cancels or confirms opening when the current scene is dirty', async () => {
    const current = sceneAsset('current-scene', 'Current')
    const target = sceneAsset('target-scene', 'Target')
    useSceneStore.getState().replaceScene(
      { schemaVersion: 2, nodes: [groupNode(1, 'Saved')] },
      { id: current.id, name: current.name },
    )
    useSceneStore.getState().createGroup(null)
    const before = structuredClone(useSceneStore.getState().nodes)
    apiMocks.fetchAssets.mockResolvedValue([current, target])
    apiMocks.fetchSceneDocument.mockResolvedValue({ schemaVersion: 2, nodes: [] })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: `open-${target.id}` }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(apiMocks.fetchSceneDocument).not.toHaveBeenCalled()
    expect(useSceneStore.getState().nodes).toEqual(before)

    fireEvent.click(screen.getByRole('button', { name: `open-${target.id}` }))
    fireEvent.click(await screen.findByRole('button', { name: '破棄して開く' }))
    await waitFor(() => expect(apiMocks.fetchSceneDocument).toHaveBeenCalledWith(target.id))
    expect(useSceneStore.getState().nodes).toEqual([])
    expect(useSceneStore.temporal.getState().pastStates).toEqual([])
  })

  it('treats an unsaved scene-name draft as dirty even when nodes are clean', async () => {
    const current = sceneAsset('current-scene', 'Current')
    const target = sceneAsset('target-scene', 'Target')
    const model = splatAsset('preview-model')
    useSceneStore.getState().replaceScene(
      { schemaVersion: 2, nodes: [groupNode(1, 'Saved')] },
      { id: current.id, name: current.name },
    )
    apiMocks.fetchAssets.mockResolvedValue([current, target, model])
    apiMocks.fetchSceneDocument.mockResolvedValue({ schemaVersion: 2, nodes: [] })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'dirty-test-name' }))
    fireEvent.click(screen.getByRole('button', { name: `open-${model.id}` }))
    fireEvent.click(await screen.findByRole('button', { name: 'シーン編集へ戻る' }))
    expect(useSceneStore.getState().sceneNameDraft).toBe('ローカル下書き')
    fireEvent.click(screen.getByRole('button', { name: `open-${target.id}` }))

    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(apiMocks.fetchSceneDocument).not.toHaveBeenCalled()
  })

  it('clears clean scenes immediately with undo, and confirms dirty clears', async () => {
    const current = sceneAsset('current-scene', 'Current')
    const baseline = { schemaVersion: 2 as const, nodes: [groupNode(1, 'Saved')] }
    useSceneStore.getState().replaceScene(baseline, { id: current.id, name: current.name })
    apiMocks.fetchAssets.mockResolvedValue([current])
    render(<App />)
    await screen.findByTestId('scene-workspace')

    fireEvent.click(screen.getByRole('button', { name: 'clear-test-scene' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useSceneStore.getState().nodes).toEqual([])
    expect(toastMocks.success).toHaveBeenCalledWith(
      'シーンをクリアしました',
      { description: 'Ctrl+Z で戻せます' },
    )
    act(() => useSceneStore.temporal.getState().undo())
    expect(useSceneStore.getState().nodes).toEqual(baseline.nodes)

    act(() => {
      useSceneStore.getState().setSceneNameDraft('ローカル下書き')
      useSceneStore.getState().createGroup(null)
    })
    const dirty = structuredClone(useSceneStore.getState().nodes)
    fireEvent.click(screen.getByRole('button', { name: 'clear-test-scene' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(useSceneStore.getState().nodes).toEqual(dirty)
    fireEvent.click(screen.getByRole('button', { name: 'clear-test-scene' }))
    fireEvent.click(await screen.findByRole('button', { name: 'クリア' }))
    expect(useSceneStore.getState().nodes).toEqual([])
    expect(useSceneStore.getState().sceneNameDraft).toBe('ローカル下書き')
    act(() => useSceneStore.temporal.getState().undo())
    expect(useSceneStore.getState().nodes).toEqual(dirty)
    expect(useSceneStore.getState().sceneNameDraft).toBe('ローカル下書き')
  })
})

function sceneAsset(id: string, name: string): Asset {
  return {
    id,
    kind: 'scene',
    name,
    tags: [],
    files: { main: { path: 'scene.json', size: 1, mime: 'application/json' } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function imageAsset(id: string, name: string): Asset {
  return {
    id,
    kind: 'image',
    name,
    tags: [],
    files: { main: { path: `${id}.png`, size: 1, mime: 'image/png' } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function splatAsset(id: string): Asset {
  return {
    id,
    kind: 'splat',
    name: `${id}.spz`,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 1 } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function workbenchJob(id: string, status: Job['status'], outputAssetIds: string[] = []): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status,
    progress: status === 'succeeded' || status === 'failed' ? 100 : 25,
    inputAssetIds: ['input'],
    outputAssetIds,
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function jobUpsert(seq: number, job: Job): WorkbenchEvent {
  return { type: 'job.upserted', serverId: 'test-server', seq, occurredAt: '2026-07-10T00:00:00.000Z', job }
}

function assetUpsert(seq: number, asset: Asset): WorkbenchEvent {
  return { type: 'asset.upserted', serverId: 'test-server', seq, occurredAt: '2026-07-10T00:00:00.000Z', asset }
}

function importedWrapper(sequence: number, sceneId: string, emptyHash: string): SceneGroupNode {
  return {
    ...groupNode(sequence, `Imported ${sequence}`),
    importedFrom: { sceneId, sourceHash: emptyHash, contentHash: emptyHash },
  }
}

function groupNode(sequence: number, name: string): SceneGroupNode {
  return {
    id: uuid(sequence),
    kind: 'group',
    name,
    visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    children: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}
