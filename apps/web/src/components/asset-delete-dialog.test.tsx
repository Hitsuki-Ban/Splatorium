import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Asset, AssetSceneReference } from '@splatorium/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetDeleteDialog } from './asset-delete-dialog'

afterEach(cleanup)

describe('AssetDeleteDialog', () => {
  it('shows the irreversible copy and confirms an unreferenced deletion', () => {
    const onConfirm = vi.fn()
    renderDialog({ references: [], onConfirm })

    expect(screen.getByText('このアセットを削除します。元に戻せません。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('lists every referencing scene and node count', () => {
    const references: AssetSceneReference[] = [
      { sceneId: 'scene-a', sceneName: '城下町', nodeCount: 2 },
      { sceneId: 'scene-b', sceneName: '地下迷宮', nodeCount: 1 },
    ]
    renderDialog({ references })

    expect(screen.getByText(/参照先の付け替え/)).toBeTruthy()
    expect(screen.getByText('城下町（2 個）')).toBeTruthy()
    expect(screen.getByText('地下迷宮（1 個）')).toBeTruthy()
  })

  it('disables confirmation while loading or after an error and still allows cancel', () => {
    const onCancel = vi.fn()
    const view = renderDialog({ references: null, loading: true, onCancel })
    expect((screen.getByRole('button', { name: '削除' }) as HTMLButtonElement).disabled).toBe(true)

    view.rerender(element({ references: null, error: 'network failed', onCancel }))
    expect(screen.getByRole('alert').textContent).toContain('network failed')
    expect((screen.getByRole('button', { name: '削除' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('allows cancel after a previous confirmation closed and reopened the dialog', () => {
    const onCancel = vi.fn()
    const view = renderDialog({ onCancel })

    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    view.rerender(element({ asset: null, onCancel }))
    view.rerender(element({ onCancel }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })
})

function renderDialog(props: Partial<Parameters<typeof element>[0]> = {}) {
  return render(element(props))
}

function element({
  asset = makeAsset(),
  references = [],
  loading = false,
  deleting = false,
  error = null,
  onCancel = vi.fn(),
  onConfirm = vi.fn(),
}: {
  asset?: Asset | null
  references?: readonly AssetSceneReference[] | null
  loading?: boolean
  deleting?: boolean
  error?: string | null
  onCancel?: () => void
  onConfirm?: () => void
} = {}) {
  return (
    <AssetDeleteDialog
      asset={asset}
      references={references}
      loading={loading}
      deleting={deleting}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

function makeAsset(): Asset {
  return {
    id: 'asset-1',
    kind: 'splat',
    name: '城モデル',
    tags: [],
    files: { main: { path: 'model.spz', size: 1 } },
    createdAt: '2026-07-12T00:00:00.000Z',
  }
}
