import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JobEntry } from '@/lib/jobs'
import { ASSET_DRAG_MIME } from '@/lib/scene-dnd'
import type { Asset, Job, JobStatus } from '@splatorium/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentBrowser } from './content-browser'

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
beforeEach(() => localStorage.clear())
afterEach(cleanup)
afterAll(() => vi.unstubAllGlobals())

describe('ContentBrowser job promotion', () => {
  it('shows only models by default and switches to scene assets explicitly', () => {
    const model = makeAsset('model-1', 'Model.spz')
    const image = makeAsset('image-1', 'Source.png', 'image')
    const scene = makeAsset('scene-1', 'Scene A', 'scene')
    renderBrowser({ assets: [model, image, scene] })

    expect(screen.getByRole('textbox', { name: '名前で絞り込み' })).toBeTruthy()

    expect(screen.getByText(model.name)).toBeTruthy()
    expect(screen.queryByText(image.name)).toBeNull()
    expect(screen.queryByText(scene.name)).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'シーン1' }))

    expect(screen.queryByText(model.name)).toBeNull()
    expect(screen.queryByText(image.name)).toBeNull()
    expect(screen.getByText(scene.name)).toBeTruthy()
  })

  it('keeps job tiles in the model section and shows the scene empty state', () => {
    renderBrowser({
      jobs: [
        { job: makeJob('job-1', 'running'), label: 'input.png' },
        { job: makeJob('job-2', 'failed'), label: 'failed.png' },
      ],
    })

    expect(screen.getByText('input.png')).toBeTruthy()
    expect(screen.getByLabelText('生成中ジョブ 1 件')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'シーン0' }))

    expect(screen.queryByText('input.png')).toBeNull()
    expect(screen.getByLabelText('生成中ジョブ 1 件')).toBeTruthy()
    expect(screen.getByText(/シーンはまだありません。/)).toBeTruthy()
  })

  it('orders jobs and assets newest first so promotion stays at the leading asset position', () => {
    const oldAsset = makeAsset('asset-old', 'Old asset', 'splat', '2026-07-10T00:00:00.000Z')
    const newAsset = makeAsset('asset-new', 'New asset', 'splat', '2026-07-12T00:00:00.000Z')
    renderBrowser({
      assets: [oldAsset, newAsset],
      jobs: [
        { job: makeJob('job-old', 'running', '2026-07-09T00:00:00.000Z'), label: 'Old job' },
        { job: makeJob('job-new', 'running', '2026-07-13T00:00:00.000Z'), label: 'New job' },
      ],
    })

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('New job'),
      expect.stringContaining('Old job'),
      expect.stringContaining('New asset'),
      expect.stringContaining('Old asset'),
    ])
  })

  it('selects with one click and opens with a double click', () => {
    const asset = makeAsset('model-1', 'Model.spz')
    const onSelect = vi.fn()
    const onOpenAsset = vi.fn()
    renderBrowser({ assets: [asset], onSelect, onOpenAsset })
    const tile = screen.getByRole('button', { name: '未生成Model.spzsplat' })

    fireEvent.click(tile)
    expect(onSelect).toHaveBeenCalledWith(asset)
    expect(onOpenAsset).not.toHaveBeenCalled()

    fireEvent.doubleClick(tile)
    expect(onOpenAsset).toHaveBeenCalledWith(asset)
  })

  it('exposes D&D for splat placement and scene import, but not unsupported mesh', () => {
    const splat = makeAsset('splat-1', 'Model.spz')
    const mesh = makeAsset('mesh-1', 'Model.glb', 'mesh')
    const scene = makeAsset('scene-1', 'Nested scene', 'scene')
    renderBrowser({ assets: [splat, mesh, scene] })

    expect(
      (screen.getByRole('button', { name: '未生成Model.spzsplat' }).parentElement as HTMLElement)
        .draggable,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: '未生成Model.glbmesh' }).parentElement as HTMLElement)
        .draggable,
    ).toBe(false)

    fireEvent.click(screen.getByRole('radio', { name: 'シーン1' }))
    const sceneTile = screen.getByRole('button', {
      name: '未生成Nested scenescene',
    }).parentElement as HTMLElement
    expect(sceneTile.draggable).toBe(true)

    const setData = vi.fn()
    const dataTransfer = { setData, effectAllowed: 'none' }
    fireEvent.dragStart(sceneTile, { dataTransfer })
    expect(setData).toHaveBeenCalledWith(
      ASSET_DRAG_MIME,
      JSON.stringify({ assetId: scene.id }),
    )
    expect(dataTransfer.effectAllowed).toBe('copy')
  })

  it('offers an explicit root import action for scene assets', () => {
    const scene = makeAsset('scene-1', 'Nested scene', 'scene')
    const onImportScene = vi.fn()
    renderBrowser({ assets: [scene], onImportScene })

    fireEvent.click(screen.getByRole('radio', { name: 'シーン1' }))
    fireEvent.click(screen.getByRole('button', { name: 'シーンを取り込む' }))

    expect(onImportScene).toHaveBeenCalledWith(scene)
  })

  it('routes deletion from grid and list actions, including mesh assets', () => {
    const mesh = makeAsset('mesh-1', 'Mesh.glb', 'mesh')
    const onRequestDelete = vi.fn()
    renderBrowser({ assets: [mesh], onRequestDelete })

    fireEvent.click(screen.getByRole('button', { name: 'Mesh.glbを削除' }))
    expect(onRequestDelete).toHaveBeenCalledWith(mesh)

    fireEvent.click(screen.getByRole('radio', { name: 'リスト表示' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mesh.glbを削除' }))
    expect(onRequestDelete).toHaveBeenCalledTimes(2)
  })

  it('keeps a succeeded job visible while its asset is syncing', () => {
    renderBrowser({ jobs: [{ job: makeJob('job-1', 'succeeded'), label: 'input.png' }] })

    expect(screen.getByText('input.png')).toBeTruthy()
    expect(screen.getByText('完成アセットを同期中…')).toBeTruthy()
  })

  it('offers explicit resync after promotion fails', () => {
    const onSyncJob = vi.fn()
    const entry: JobEntry = {
      job: makeJob('job-1', 'succeeded'),
      label: 'input.png',
      promotionError: '同期に失敗しました',
    }
    renderBrowser({ jobs: [entry], onSyncJob })

    expect(screen.queryByRole('button', { name: '再試行' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '完成アセットを再同期' }))
    expect(onSyncJob).toHaveBeenCalledWith(entry)
  })

  it('keeps a newly promoted asset visible through the current name search', () => {
    const asset = makeAsset('output-uuid', 'generated.spz')
    renderBrowser({ assets: [asset], highlightIds: new Set([asset.id]) })

    fireEvent.change(screen.getByPlaceholderText('名前で絞り込み'), {
      target: { value: 'input.png' },
    })

    const tile = screen.getByText(asset.name).closest('li')?.firstElementChild
    expect(tile?.className).toContain('motion-safe:animate-pulse')
  })

  it('switches from the labeled source image to the generated thumbnail', () => {
    const asset: Asset = {
      ...makeAsset('asset-splat', 'generated.spz'),
      files: {
        main: { path: 'generated.spz', size: 1 },
        source: { path: 'input.png', size: 1, mime: 'image/png' },
      },
    }
    const props = {
      assetRevisions: new Map([[asset.id, 'server:7']]),
      jobs: [],
      highlightIds: new Set<string>(),
      selectedId: null,
      onSelect: vi.fn(),
      onAddToScene: vi.fn(),
      onImportScene: vi.fn(),
      onOpenAsset: vi.fn(),
      onRequestDelete: vi.fn(),
      onRequestUpload: vi.fn(),
      onRetryJob: vi.fn(),
      onSyncJob: vi.fn(),
      onDismissJob: vi.fn(),
    }
    const { container, rerender } = render(<ContentBrowser assets={[asset]} {...props} />)

    expect(screen.getByText('元画像')).toBeTruthy()
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/assets/asset-splat/files/source',
    )

    rerender(
      <ContentBrowser
        assets={[
          {
            ...asset,
            files: {
              ...asset.files,
              thumbnail: { path: 'thumbnail.webp', size: 100, mime: 'image/webp' },
            },
          },
        ]}
        {...props}
      />,
    )

    expect(screen.queryByText('元画像')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/assets/asset-splat/files/thumbnail?revision=server%3A7',
    )
  })
})

function renderBrowser({
  assets = [],
  jobs = [],
  highlightIds = new Set<string>(),
  onSyncJob = vi.fn(),
  onSelect = vi.fn(),
  onImportScene = vi.fn(),
  onOpenAsset = vi.fn(),
  onRequestDelete = vi.fn(),
}: {
  assets?: Asset[]
  jobs?: JobEntry[]
  highlightIds?: ReadonlySet<string>
  onSyncJob?: (entry: JobEntry) => void
  onSelect?: (asset: Asset) => void
  onImportScene?: (asset: Asset) => void
  onOpenAsset?: (asset: Asset) => void
  onRequestDelete?: (asset: Asset) => void
}) {
  return render(
    <ContentBrowser
      assets={assets}
      assetRevisions={new Map(assets.map((asset) => [asset.id, 'test:0']))}
      jobs={jobs}
      highlightIds={highlightIds}
      selectedId={null}
      onSelect={onSelect}
      onAddToScene={vi.fn()}
      onImportScene={onImportScene}
      onOpenAsset={onOpenAsset}
      onRequestDelete={onRequestDelete}
      onRequestUpload={vi.fn()}
      onRetryJob={vi.fn()}
      onSyncJob={onSyncJob}
      onDismissJob={vi.fn()}
    />,
  )
}

function makeJob(
  id: string,
  status: JobStatus,
  createdAt = '2026-07-10T00:00:00.000Z',
): Job {
  return {
    id,
    pipeline: 'image-to-splat',
    status,
    progress: status === 'succeeded' ? 100 : 50,
    inputAssetIds: ['input-asset'],
    outputAssetIds: status === 'succeeded' ? ['output-uuid'] : [],
    createdAt,
  }
}

function makeAsset(
  id: string,
  name: string,
  kind: Asset['kind'] = 'splat',
  createdAt = '2026-07-10T00:00:00.000Z',
): Asset {
  return {
    id,
    kind,
    name,
    tags: [],
    files: { main: { path: name, size: 1 } },
    createdAt,
  }
}
