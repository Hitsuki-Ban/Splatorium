import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Asset } from '@splatorium/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewPane } from './preview-pane'

const splatViewerModule = vi.hoisted(() => ({
  loaded: false,
}))
const thumbnailModule = vi.hoisted(() => ({ renderCount: 0 }))
const apiMocks = vi.hoisted(() => ({ uploadAssetThumbnail: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, uploadAssetThumbnail: apiMocks.uploadAssetThumbnail }
})

vi.mock('@/components/splat-viewer', () => {
  splatViewerModule.loaded = true
  return {
    SplatViewer: ({ url, onReady }: { url: string; onReady?: () => void }) => (
      <button type="button" data-testid="splat-viewer" onClick={onReady}>
        {url}
      </button>
    ),
  }
})

vi.mock('@/components/thumbnail-capture', () => ({
  ThumbnailCapture: ({ onCapture }: { onCapture: (blob: Blob) => void }) => {
    thumbnailModule.renderCount += 1
    return (
      <button
        type="button"
        data-testid="thumbnail-capture"
        onClick={() => onCapture(new Blob(['webp'], { type: 'image/webp' }))}
      >
        capture
      </button>
    )
  },
}))

beforeEach(() => {
  apiMocks.uploadAssetThumbnail.mockReset()
  thumbnailModule.renderCount = 0
})
afterEach(cleanup)

describe('PreviewPane', () => {
  it('does not load the Spark viewer module for the empty preview state', () => {
    render(<PreviewPane asset={null} onAssetUpdated={vi.fn()} />)

    expect(screen.getByText('3D プレビューエリア')).toBeTruthy()
    expect(splatViewerModule.loaded).toBe(false)
  })

  it('lazy-loads the Spark viewer only for splat assets', async () => {
    render(<PreviewPane asset={createSplatAsset()} onAssetUpdated={vi.fn()} />)

    expect(screen.getByText('Spark ビューアを読み込み中…')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('splat-viewer')).toBeTruthy())
    expect(screen.getByTestId('splat-viewer').textContent).toBe(
      '/api/assets/asset-splat/files/main',
    )
  })

  it('captures and uploads a missing splat thumbnail after the viewer is ready', async () => {
    const asset = createSplatAsset()
    const updated = withThumbnail(asset)
    const onAssetUpdated = vi.fn()
    apiMocks.uploadAssetThumbnail.mockResolvedValue(updated)
    render(<PreviewPane asset={asset} onAssetUpdated={onAssetUpdated} />)

    fireEvent.click(await screen.findByTestId('splat-viewer'))
    fireEvent.click(await screen.findByTestId('thumbnail-capture'))

    await waitFor(() => {
      expect(apiMocks.uploadAssetThumbnail).toHaveBeenCalledWith(
        asset.id,
        expect.objectContaining({ type: 'image/webp' }),
        expect.any(AbortSignal),
      )
      expect(onAssetUpdated).toHaveBeenCalledWith(updated)
    })
  })

  it('does not capture a splat that already has a thumbnail', async () => {
    const asset = withThumbnail(createSplatAsset())
    render(<PreviewPane asset={asset} onAssetUpdated={vi.fn()} />)

    fireEvent.click(await screen.findByTestId('splat-viewer'))

    expect(screen.queryByTestId('thumbnail-capture')).toBeNull()
    expect(thumbnailModule.renderCount).toBe(0)
    expect(apiMocks.uploadAssetThumbnail).not.toHaveBeenCalled()
  })

  it('allows retrying a failed thumbnail upload', async () => {
    const asset = createSplatAsset()
    const updated = withThumbnail(asset)
    const onAssetUpdated = vi.fn()
    apiMocks.uploadAssetThumbnail
      .mockRejectedValueOnce(new Error('controlled upload failure'))
      .mockResolvedValueOnce(updated)
    render(<PreviewPane asset={asset} onAssetUpdated={onAssetUpdated} />)

    fireEvent.click(await screen.findByTestId('splat-viewer'))
    fireEvent.click(await screen.findByTestId('thumbnail-capture'))
    fireEvent.click(await screen.findByRole('button', { name: 'サムネイル生成を再試行' }))
    fireEvent.click(await screen.findByTestId('thumbnail-capture'))

    await waitFor(() => {
      expect(apiMocks.uploadAssetThumbnail).toHaveBeenCalledTimes(2)
      expect(onAssetUpdated).toHaveBeenCalledWith(updated)
    })
  })

  it('times out capture after five seconds and permits retrying', async () => {
    vi.useFakeTimers()
    try {
      render(<PreviewPane asset={createSplatAsset()} onAssetUpdated={vi.fn()} />)

      await act(async () => {
        await vi.runAllTimersAsync()
      })
      fireEvent.click(screen.getByTestId('splat-viewer'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(screen.queryByTestId('thumbnail-capture')).toBeNull()
      expect(screen.getByRole('button', { name: 'サムネイル生成を再試行' }).title).toContain(
        'サムネイルの生成がタイムアウトしました',
      )

      fireEvent.click(screen.getByRole('button', { name: 'サムネイル生成を再試行' }))
      expect(screen.getByTestId('thumbnail-capture')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts a timed-out upload and ignores its late response', async () => {
    vi.useFakeTimers()
    try {
      let resolveUpload!: (asset: Asset) => void
      const pendingUpload = new Promise<Asset>((resolve) => {
        resolveUpload = resolve
      })
      const asset = createSplatAsset()
      const onAssetUpdated = vi.fn()
      apiMocks.uploadAssetThumbnail.mockReturnValue(pendingUpload)
      render(<PreviewPane asset={asset} onAssetUpdated={onAssetUpdated} />)

      await act(async () => {
        await vi.runAllTimersAsync()
      })
      fireEvent.click(screen.getByTestId('splat-viewer'))
      fireEvent.click(screen.getByTestId('thumbnail-capture'))
      const signal = apiMocks.uploadAssetThumbnail.mock.calls[0][2] as AbortSignal

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(signal.aborted).toBe(true)
      expect(screen.getByRole('button', { name: 'サムネイル生成を再試行' })).toBeTruthy()

      await act(async () => resolveUpload(withThumbnail(asset)))
      expect(onAssetUpdated).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an in-flight upload when the preview unmounts', async () => {
    apiMocks.uploadAssetThumbnail.mockReturnValue(new Promise<Asset>(() => {}))
    const view = render(<PreviewPane asset={createSplatAsset()} onAssetUpdated={vi.fn()} />)

    fireEvent.click(await screen.findByTestId('splat-viewer'))
    fireEvent.click(await screen.findByTestId('thumbnail-capture'))
    const signal = apiMocks.uploadAssetThumbnail.mock.calls[0][2] as AbortSignal
    view.unmount()

    expect(signal.aborted).toBe(true)
  })
})

function createSplatAsset(): Asset {
  return {
    id: 'asset-splat',
    kind: 'splat',
    name: 'asset.spz',
    tags: [],
    files: { main: { path: 'asset.spz', size: 1024, mime: 'model/vnd.spz' } },
    createdAt: '2026-07-09T00:00:00.000Z',
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
