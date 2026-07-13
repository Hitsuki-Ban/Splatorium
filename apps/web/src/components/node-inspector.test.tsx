import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSceneStore } from '@/stores/scene-store'
import type { Asset, SceneGroupNode, SceneModelNode } from '@splatorium/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeInspector } from './node-inspector'

const node: SceneModelNode = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'model',
  name: 'Model node',
  visible: true,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  assetId: 'asset-1',
}

const asset: Asset = {
  id: 'asset-1',
  kind: 'splat',
  name: 'Model.spz',
  tags: [],
  files: { main: { path: 'Model.spz', size: 1 } },
  createdAt: '2026-07-10T00:00:00.000Z',
}

const replacement: Asset = {
  ...asset,
  id: 'asset-2',
  name: 'Replacement.spz',
  files: { main: { path: 'Replacement.spz', size: 1 } },
}

afterEach(() => {
  cleanup()
  useSceneStore.setState(useSceneStore.getInitialState(), true)
  useSceneStore.temporal.getState().clear()
})

describe('NodeInspector', () => {
  it('opens replacement for a broken model', () => {
    useSceneStore.setState({ nodes: [node] })
    render(renderInspectorElement(node, [replacement]))

    expect(screen.getByRole('alert').textContent).toContain('参照先のアセットが削除されています')
    fireEvent.click(screen.getByRole('button', { name: '参照先を変更…' }))

    expect(screen.getByRole('dialog', { name: '参照先を変更' })).toBeTruthy()
    expect(screen.getByText(replacement.name)).toBeTruthy()
  })

  it('opens replacement for a live model and applies the store command successfully', () => {
    useSceneStore.setState({ nodes: [node] })
    render(renderInspectorElement(node, [asset, replacement]))

    fireEvent.click(screen.getByRole('button', { name: '参照先を変更…' }))
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(replacement.name) }))
    fireEvent.click(screen.getByRole('radio', { name: /このノードのみ/ }))
    fireEvent.click(screen.getByRole('button', { name: '変更を適用' }))

    expect((useSceneStore.getState().nodes[0] as SceneModelNode).assetId).toBe(replacement.id)
    expect(screen.queryByRole('dialog', { name: '参照先を変更' })).toBeNull()
  })

  it('accepts 255 characters and keeps editing with Japanese feedback for 256', () => {
    useSceneStore.setState({ nodes: [node] })
    const view = renderInspector()

    fireEvent.click(screen.getByRole('button', { name: 'ノード名を編集' }))
    let input = screen.getByRole('textbox', { name: 'ノード名' }) as HTMLInputElement
    expect(input.maxLength).toBe(255)
    fireEvent.change(input, { target: { value: 'a'.repeat(255) } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('textbox', { name: 'ノード名' })).toBeNull()
    expect(useSceneStore.getState().nodes[0].name).toBe('a'.repeat(255))

    view.rerender(renderInspectorElement({ ...node, name: 'a'.repeat(255) }))
    fireEvent.click(screen.getByRole('button', { name: 'ノード名を編集' }))
    input = screen.getByRole('textbox', { name: 'ノード名' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'b'.repeat(256) } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: 'ノード名' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('ノード名は 255 文字以内')
    expect(useSceneStore.getState().nodes[0].name).toBe('a'.repeat(255))
  })

  it('cancels rename through the button click emitted by keyboard activation', () => {
    render(
      <NodeInspector
        nodes={[node]}
        nodeId={node.id}
        assets={[asset]}
        importedSceneUpdate={undefined}
        checkingImportedScene={false}
        reimportingImportedScene={false}
        onCheckImportedScene={vi.fn()}
        onReimportScene={vi.fn()}
        onUnlinkImportedScene={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ノード名を編集' }))
    const input = screen.getByRole('textbox', { name: 'ノード名' })
    fireEvent.change(input, {
      target: { value: 'Changed draft' },
    })
    const cancel = screen.getByRole('button', { name: 'キャンセル' })
    fireEvent.blur(input, { relatedTarget: cancel })
    expect(screen.getByRole('textbox', { name: 'ノード名' })).toBeTruthy()
    fireEvent.click(cancel, { detail: 0 })

    expect(screen.queryByRole('textbox', { name: 'ノード名' })).toBeNull()
    expect(screen.getByRole('button', { name: node.name })).toBeTruthy()
  })

  it('clears validation errors when Escape or the cancel button closes rename', () => {
    useSceneStore.setState({ nodes: [node] })
    renderInspector()

    const createError = () => {
      fireEvent.click(screen.getByRole('button', { name: 'ノード名を編集' }))
      const input = screen.getByRole('textbox', { name: 'ノード名' })
      fireEvent.change(input, { target: { value: 'x'.repeat(256) } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(screen.getByRole('alert')).toBeTruthy()
      return input
    }

    fireEvent.keyDown(createError(), { key: 'Escape' })
    expect(screen.queryByRole('alert')).toBeNull()

    createError()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ノード名を編集' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows imported scene state and routes refresh, reimport, and unlink actions', () => {
    const imported: SceneGroupNode = {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'group',
      name: 'Imported scene',
      visible: true,
      transform: node.transform,
      children: [node],
      importedFrom: {
        sceneId: 'scene-source',
        sourceHash: 'a'.repeat(64),
        contentHash: 'b'.repeat(64),
      },
    }
    const source: Asset = {
      ...asset,
      id: 'scene-source',
      kind: 'scene',
      name: 'Source scene',
      files: { main: { path: 'scene.json', size: 1 } },
    }
    const onCheck = vi.fn()
    const onReimport = vi.fn()
    const onUnlink = vi.fn()
    render(
      <NodeInspector
        nodes={[imported]}
        nodeId={imported.id}
        assets={[asset, source]}
        importedSceneUpdate={{ status: 'updateAvailableAndModified' }}
        checkingImportedScene={false}
        reimportingImportedScene={false}
        onCheckImportedScene={onCheck}
        onReimportScene={onReimport}
        onUnlinkImportedScene={onUnlink}
      />,
    )

    expect(screen.getByText('更新あり')).toBeTruthy()
    expect(screen.getByText('ローカル変更')).toBeTruthy()
    expect(screen.getByText('Source scene')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }))
    fireEvent.click(screen.getByRole('button', { name: '最新を取り込む' }))
    fireEvent.click(screen.getByRole('button', { name: 'リンク解除' }))
    expect(onCheck).toHaveBeenCalledWith(imported.id)
    expect(onReimport).toHaveBeenCalledWith(imported.id)
    expect(onUnlink).toHaveBeenCalledWith(imported.id)
  })
})

function renderInspector() {
  return render(renderInspectorElement(node))
}

function renderInspectorElement(currentNode: SceneModelNode, assets: Asset[] = [asset]) {
  return (
    <NodeInspector
      nodes={[currentNode]}
      nodeId={currentNode.id}
      assets={assets}
      importedSceneUpdate={undefined}
      checkingImportedScene={false}
      reimportingImportedScene={false}
      onCheckImportedScene={vi.fn()}
      onReimportScene={vi.fn()}
      onUnlinkImportedScene={vi.fn()}
    />
  )
}
