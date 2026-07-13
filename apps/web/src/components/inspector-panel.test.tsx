import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Asset } from '@splatorium/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from './inspector-panel'

const apiMocks = vi.hoisted(() => ({ renameAsset: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, renameAsset: apiMocks.renameAsset }
})

beforeEach(() => apiMocks.renameAsset.mockReset())
afterEach(cleanup)

describe('InspectorPanel', () => {
  it('shows a splat source image as model metadata', () => {
    const asset: Asset = {
      ...makeAsset('asset-1', 'Model.spz'),
      files: {
        main: { path: 'model.spz', size: 1024, mime: 'model/vnd.spz' },
        source: { path: 'source.png', size: 512, mime: 'image/png' },
      },
    }
    renderInspector(asset)

    const image = screen.getByRole('img', { name: 'Model.spz の生成元画像' })
    expect(image.getAttribute('src')).toBe('/api/assets/asset-1/files/source')
    expect(screen.getByText('元画像')).toBeTruthy()
  })

  it('opens from the name and submits a trimmed name with Enter', async () => {
    const asset = makeAsset('asset-1', 'machine-name.spz')
    const updated = { ...asset, name: 'Mana Potion' }
    const onAssetUpdated = vi.fn()
    apiMocks.renameAsset.mockResolvedValue(updated)
    renderInspector(asset, onAssetUpdated)

    fireEvent.click(screen.getByRole('button', { name: asset.name }))
    const input = screen.getByRole('textbox', { name: 'アセット名' })
    fireEvent.change(input, { target: { value: '  Mana Potion  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(apiMocks.renameAsset).toHaveBeenCalledWith(asset.id, 'Mana Potion')
      expect(onAssetUpdated).toHaveBeenCalledWith(updated)
    })
    expect(screen.queryByRole('textbox', { name: 'アセット名' })).toBeNull()
  })

  it('opens from the pencil or F2 and cancels with Escape', () => {
    const asset = makeAsset('asset-1', 'Original')
    renderInspector(asset)

    fireEvent.click(screen.getByRole('button', { name: 'アセット名を編集' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'アセット名' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'アセット名' })).toBeNull()

    fireEvent.keyDown(window, { key: 'F2' })
    expect(screen.getByRole('textbox', { name: 'アセット名' })).toBeTruthy()
    expect(apiMocks.renameAsset).not.toHaveBeenCalled()
  })

  it('does not request an unchanged name', () => {
    const asset = makeAsset('asset-1', 'Original')
    renderInspector(asset)

    fireEvent.keyDown(window, { key: 'F2' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'アセット名' }), { key: 'Enter' })

    expect(apiMocks.renameAsset).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'アセット名' })).toBeNull()
  })

  it('routes asset deletion from the inspector', () => {
    const asset = makeAsset('asset-1', 'Model.spz')
    const onRequestDelete = vi.fn()
    render(inspector(asset, vi.fn(), onRequestDelete))

    fireEvent.click(screen.getByRole('button', { name: 'アセットを削除' }))

    expect(onRequestDelete).toHaveBeenCalledWith(asset)
  })

  it('keeps the draft open and reports a validation error', () => {
    const asset = makeAsset('asset-1', 'Original')
    renderInspector(asset)

    fireEvent.keyDown(window, { key: 'F2' })
    const input = screen.getByRole('textbox', { name: 'アセット名' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '名前変更を確定' }))

    expect(screen.getByRole('alert').textContent).toContain('名前を入力してください。')
    expect((screen.getByRole('textbox', { name: 'アセット名' }) as HTMLInputElement).value).toBe(
      '   ',
    )
    expect(apiMocks.renameAsset).not.toHaveBeenCalled()
  })

  it('resets an unfinished draft when selection changes', () => {
    const first = makeAsset('asset-1', 'First')
    const second = makeAsset('asset-2', 'Second')
    const view = renderInspector(first)
    fireEvent.keyDown(window, { key: 'F2' })
    fireEvent.change(screen.getByRole('textbox', { name: 'アセット名' }), {
      target: { value: 'Unfinished' },
    })

    view.rerender(inspector(second))

    expect(screen.queryByRole('textbox', { name: 'アセット名' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Second' })).toBeTruthy()
  })

  it('submits at most one rename per asset while the request is pending', async () => {
    const asset = makeAsset('asset-1', 'Original')
    const updated = { ...asset, name: 'Next' }
    let resolveRename!: (asset: Asset) => void
    apiMocks.renameAsset.mockReturnValue(
      new Promise<Asset>((resolve) => {
        resolveRename = resolve
      }),
    )
    const onAssetUpdated = vi.fn()
    renderInspector(asset, onAssetUpdated)
    fireEvent.keyDown(window, { key: 'F2' })
    const input = screen.getByRole('textbox', { name: 'アセット名' })
    fireEvent.change(input, { target: { value: 'Next' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(apiMocks.renameAsset).toHaveBeenCalledTimes(1)
    resolveRename(updated)
    await waitFor(() => expect(onAssetUpdated).toHaveBeenCalledWith(updated))
  })
})

function renderInspector(asset: Asset, onAssetUpdated = vi.fn()) {
  return render(inspector(asset, onAssetUpdated))
}

function inspector(asset: Asset, onAssetUpdated = vi.fn(), onRequestDelete = vi.fn()) {
  return (
    <InspectorPanel
      asset={asset}
      onAddToScene={vi.fn()}
      onOpenAsset={vi.fn()}
      onAssetUpdated={onAssetUpdated}
      onRequestDelete={onRequestDelete}
    />
  )
}

function makeAsset(id: string, name: string): Asset {
  return {
    id,
    kind: 'splat',
    name,
    tags: [],
    files: { main: { path: `${id}.spz`, size: 1024, mime: 'model/vnd.spz' } },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}
