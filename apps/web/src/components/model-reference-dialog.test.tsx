import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Asset } from '@splatorium/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelReferenceDialog } from './model-reference-dialog'

const current = modelAsset('current', 'Current model', 'splat')
const splat = modelAsset('splat-target', 'Cherry Splat', 'splat')
const mesh = modelAsset('mesh-target', 'Azure Mesh', 'mesh')
const image: Asset = {
  ...modelAsset('image-target', 'Reference image', 'splat'),
  kind: 'image',
  files: { main: { path: 'reference.png', size: 1 } },
}
const scene: Asset = {
  ...modelAsset('scene-target', 'Reference scene', 'splat'),
  kind: 'scene',
  files: { main: { path: 'scene.json', size: 1 } },
}

afterEach(cleanup)

describe('ModelReferenceDialog', () => {
  it('disables apply until a model is selected and excludes current and non-model assets', () => {
    renderDialog()

    expect((screen.getByRole('button', { name: '変更を適用' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.queryByText(current.name)).toBeNull()
    expect(screen.getByText(splat.name)).toBeTruthy()
    expect(screen.getByText(mesh.name)).toBeTruthy()
    expect(screen.queryByText(image.name)).toBeNull()
    expect(screen.queryByText(scene.name)).toBeNull()
  })

  it('searches model candidates by name and Asset ID', () => {
    renderDialog()
    const search = screen.getByRole('textbox', { name: 'モデルを検索' })

    fireEvent.change(search, { target: { value: 'cherry' } })
    expect(screen.getByText(splat.name)).toBeTruthy()
    expect(screen.queryByText(mesh.name)).toBeNull()

    fireEvent.change(search, { target: { value: 'MESH-TARGET' } })
    expect(screen.queryByText(splat.name)).toBeNull()
    expect(screen.getByText(mesh.name)).toBeTruthy()
  })

  it('cannot apply a selection that the current search hides', () => {
    const onApply = vi.fn()
    renderDialog(onApply)
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(splat.name) }))

    fireEvent.change(screen.getByRole('textbox', { name: 'モデルを検索' }), {
      target: { value: mesh.name },
    })

    const apply = screen.getByRole('button', { name: '変更を適用' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()
  })

  it.each([
    ['シーン内のすべて', 'scene'],
    ['同じグループ内のみ', 'group'],
    ['このノードのみ', 'node'],
  ] as const)('routes the %s scope with the selected model', (scopeLabel, scope) => {
    const onApply = vi.fn()
    renderDialog(onApply)

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(splat.name) }))
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(scopeLabel) }))
    fireEvent.click(screen.getByRole('button', { name: '変更を適用' }))

    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply).toHaveBeenCalledWith(splat, scope)
  })
})

function renderDialog(onApply = vi.fn()) {
  return render(
    <ModelReferenceDialog
      open
      currentAssetId={current.id}
      assets={[current, splat, mesh, image, scene]}
      onCancel={vi.fn()}
      onApply={onApply}
    />,
  )
}

function modelAsset(id: string, name: string, kind: 'splat' | 'mesh'): Asset {
  return {
    id,
    kind,
    name,
    tags: [],
    files: { main: { path: `${id}.${kind === 'splat' ? 'spz' : 'glb'}`, size: 1 } },
    createdAt: '2026-07-12T00:00:00.000Z',
  }
}
