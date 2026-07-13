import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ASSET_DRAG_MIME } from '@/lib/scene-dnd'
import { useSceneStore } from '@/stores/scene-store'
import type { Asset, SceneGroupNode, SceneModelNode } from '@splatorium/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneTreePanel } from './scene-tree-panel'

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastMocks.error } }))

const node: SceneModelNode = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'model',
  name: 'Model',
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

const sceneAsset: Asset = {
  id: 'scene-1',
  kind: 'scene',
  name: 'Nested scene',
  tags: [],
  files: { main: { path: 'scene.json', size: 1 } },
  createdAt: '2026-07-10T00:00:00.000Z',
}

const group: SceneGroupNode = {
  id: '00000000-0000-4000-8000-000000000002',
  kind: 'group',
  name: 'Group',
  visible: true,
  transform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  children: [],
}

afterEach(() => {
  cleanup()
  toastMocks.error.mockReset()
  useSceneStore.setState(useSceneStore.getInitialState(), true)
  useSceneStore.temporal.getState().clear()
})

describe('SceneTreePanel', () => {
  it('marks a model whose asset is unavailable as a broken reference', () => {
    useSceneStore.setState({ nodes: [node] })
    render(
      <SceneTreePanel
        nodes={[node]}
        selectedNodeId={node.id}
        availableAssetIds={new Set()}
        assets={[]}
        onImportScene={vi.fn()}
        importedSceneUpdates={new Map()}
        checkingImportedNodeIds={new Set()}
      />,
    )

    expect(screen.getByText('参照切れ').getAttribute('title')).toContain(node.assetId)
    expect(screen.getByRole('treeitem', { name: node.name })).toBeTruthy()
  })

  it('exposes treeitem selection and expansion semantics', () => {
    useSceneStore.setState({ nodes: [group, node] })
    render(
      <SceneTreePanel
        nodes={[group, node]}
        selectedNodeId={node.id}
        availableAssetIds={new Set([asset.id])}
        assets={[asset]}
        onImportScene={vi.fn()}
        importedSceneUpdates={new Map()}
        checkingImportedNodeIds={new Set()}
      />,
    )

    expect(screen.getByRole('tree', { name: 'シーンツリー' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: node.name, selected: true })).toBeTruthy()
    const groupItem = screen.getByRole('treeitem', { name: group.name, selected: false })
    expect(groupItem.getAttribute('aria-level')).toBe('1')
    expect(groupItem.getAttribute('aria-expanded')).toBe('true')
    expect(groupItem.getAttribute('aria-posinset')).toBe('1')
    expect(groupItem.getAttribute('aria-setsize')).toBe('2')
    expect(screen.getByRole('treeitem', { name: node.name }).getAttribute('aria-posinset')).toBe('2')
    expect(screen.getByRole('treeitem', { name: node.name }).getAttribute('aria-setsize')).toBe('2')

    groupItem.focus()
    fireEvent.keyDown(groupItem, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: node.name }))
    expect(useSceneStore.getState().selectedNodeId).toBe(node.id)
  })

  it('keeps a visible treeitem in the tab order when the selected node is collapsed', () => {
    const child = { ...node, name: 'Child' }
    const parent = { ...group, children: [child] }
    render(
      <SceneTreePanel
        nodes={[parent]}
        selectedNodeId={child.id}
        availableAssetIds={new Set([asset.id])}
        assets={[asset]}
        onImportScene={vi.fn()}
        importedSceneUpdates={new Map()}
        checkingImportedNodeIds={new Set()}
      />,
    )

    expect(screen.getByRole('treeitem', { name: child.name }).tabIndex).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '折りたたみ' }))

    expect(screen.queryByRole('treeitem', { name: child.name })).toBeNull()
    expect(screen.getByRole('treeitem', { name: parent.name }).tabIndex).toBe(0)
  })

  it('reports sibling position for nested rows in the flat tree DOM', () => {
    const firstChild = { ...node, name: 'First child' }
    const secondChild = {
      ...node,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Second child',
    }
    const parent = { ...group, children: [firstChild, secondChild] }
    render(
      <SceneTreePanel
        nodes={[parent]}
        selectedNodeId={null}
        availableAssetIds={new Set([asset.id])}
        assets={[asset]}
        onImportScene={vi.fn()}
        importedSceneUpdates={new Map()}
        checkingImportedNodeIds={new Set()}
      />,
    )

    const firstItem = screen.getByRole('treeitem', { name: firstChild.name })
    const secondItem = screen.getByRole('treeitem', { name: secondChild.name })
    expect(firstItem.getAttribute('aria-posinset')).toBe('1')
    expect(firstItem.getAttribute('aria-setsize')).toBe('2')
    expect(secondItem.getAttribute('aria-posinset')).toBe('2')
    expect(secondItem.getAttribute('aria-setsize')).toBe('2')
  })

  it('returns focus to the treeitem after confirming or cancelling F2 rename', () => {
    useSceneStore.setState({ nodes: [node] })
    renderTree(node)
    const treeItem = screen.getByRole('treeitem', { name: node.name })

    treeItem.focus()
    fireEvent.keyDown(treeItem, { key: 'F2' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ノード名' }), { key: 'Enter' })
    expect(document.activeElement).toBe(treeItem)

    fireEvent.keyDown(treeItem, { key: 'F2' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ノード名' }), { key: 'Escape' })
    expect(document.activeElement).toBe(treeItem)
  })

  it('advertises F2 in the row name tooltip', () => {
    renderTree(node)

    expect(screen.getByText(node.name).getAttribute('title')).toContain('F2')
  })

  it('accepts 255 characters and keeps the rename editor open for 256', () => {
    useSceneStore.setState({ nodes: [node] })
    const view = renderTree(node)

    fireEvent.keyDown(screen.getByRole('treeitem', { name: node.name }), { key: 'F2' })
    let input = screen.getByRole('textbox', { name: 'ノード名' }) as HTMLInputElement
    expect(input.maxLength).toBe(255)
    fireEvent.change(input, { target: { value: 'a'.repeat(255) } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('textbox', { name: 'ノード名' })).toBeNull()
    expect(useSceneStore.getState().nodes[0].name).toBe('a'.repeat(255))

    view.rerender(renderTreeElement({ ...node, name: 'a'.repeat(255) }))
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'a'.repeat(255) }), { key: 'F2' })
    input = screen.getByRole('textbox', { name: 'ノード名' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'b'.repeat(256) } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: 'ノード名' })).toBeTruthy()
    expect(toastMocks.error).toHaveBeenCalledWith('ノード名は 255 文字以内で入力してください。')
    expect(useSceneStore.getState().nodes[0].name).toBe('a'.repeat(255))
  })

  it('keeps row actions visible for the selected node', () => {
    render(
      <SceneTreePanel
        nodes={[node]}
        selectedNodeId={node.id}
        availableAssetIds={new Set([asset.id])}
        assets={[asset]}
        onImportScene={vi.fn()}
        importedSceneUpdates={new Map()}
        checkingImportedNodeIds={new Set()}
      />,
    )

    const actions = screen.getByRole('button', { name: 'ノードを削除' }).parentElement
    expect(actions?.className.split(/\s+/)).toContain('opacity-100')
  })

  it('lets OS file drops bubble to the application-level import handler', () => {
    const onDrop = vi.fn()
    render(
      <div onDrop={onDrop}>
        <SceneTreePanel
          nodes={[node]}
          selectedNodeId={null}
          availableAssetIds={new Set([asset.id])}
          assets={[asset]}
          onImportScene={vi.fn()}
          importedSceneUpdates={new Map()}
          checkingImportedNodeIds={new Set()}
        />
      </div>,
    )

    fireEvent.drop(screen.getByRole('treeitem', { name: node.name }), {
      dataTransfer: { types: ['Files'], getData: () => '' },
    })

    expect(onDrop).toHaveBeenCalledOnce()
  })

  it('routes a dropped scene asset to copy import at the target group', () => {
    const onImportScene = vi.fn()
    render(
      <SceneTreePanel
        nodes={[group]}
        selectedNodeId={null}
        availableAssetIds={new Set()}
        assets={[sceneAsset]}
        onImportScene={onImportScene}
        importedSceneUpdates={new Map()}
        checkingImportedNodeIds={new Set()}
      />,
    )

    fireEvent.drop(screen.getByRole('treeitem', { name: group.name }), {
      dataTransfer: {
        types: [ASSET_DRAG_MIME],
        getData: (type: string) =>
          type === ASSET_DRAG_MIME ? JSON.stringify({ assetId: sceneAsset.id }) : '',
      },
    })

    expect(onImportScene).toHaveBeenCalledWith(sceneAsset, group.id)
  })

  it('routes a dropped scene asset to copy import at the root', () => {
    const onImportScene = vi.fn()
    render(
      <SceneTreePanel
        nodes={[]}
        selectedNodeId={null}
        availableAssetIds={new Set()}
        assets={[sceneAsset]}
        onImportScene={onImportScene}
        importedSceneUpdates={new Map()}
        checkingImportedNodeIds={new Set()}
      />,
    )

    fireEvent.drop(
      screen.getByText('モデルをここへドラッグ、または倉庫の「＋」で追加').parentElement!,
      {
        dataTransfer: {
          types: [ASSET_DRAG_MIME],
          getData: (type: string) =>
            type === ASSET_DRAG_MIME ? JSON.stringify({ assetId: sceneAsset.id }) : '',
        },
      },
    )

    expect(onImportScene).toHaveBeenCalledWith(sceneAsset, null)
  })

  it('lets OS file drops on the root bubble without starting scene import', () => {
    const onDrop = vi.fn()
    const onImportScene = vi.fn()
    render(
      <div onDrop={onDrop}>
        <SceneTreePanel
          nodes={[]}
          selectedNodeId={null}
          availableAssetIds={new Set()}
          assets={[sceneAsset]}
          onImportScene={onImportScene}
          importedSceneUpdates={new Map()}
          checkingImportedNodeIds={new Set()}
        />
      </div>,
    )

    fireEvent.drop(
      screen.getByText('モデルをここへドラッグ、または倉庫の「＋」で追加').parentElement!,
      { dataTransfer: { types: ['Files'], getData: () => '' } },
    )

    expect(onDrop).toHaveBeenCalledOnce()
    expect(onImportScene).not.toHaveBeenCalled()
  })

  it('shows update and local modification badges on imported groups', () => {
    const imported = {
      ...group,
      importedFrom: {
        sceneId: sceneAsset.id,
        sourceHash: 'a'.repeat(64),
        contentHash: 'b'.repeat(64),
      },
    }
    render(
      <SceneTreePanel
        nodes={[imported]}
        selectedNodeId={null}
        availableAssetIds={new Set()}
        assets={[sceneAsset]}
        onImportScene={vi.fn()}
        importedSceneUpdates={new Map([
          [imported.id, { status: 'updateAvailableAndModified' } as const],
        ])}
        checkingImportedNodeIds={new Set()}
      />,
    )

    // 1 行 1 バッジ原則: 合成状態は単一バッジ（内訳はインスペクタで並記）
    expect(screen.getByText('更新+編集')).toBeTruthy()
    expect(screen.queryByText('更新あり')).toBeNull()
    expect(screen.queryByText('ローカル変更')).toBeNull()
  })
})

function renderTree(currentNode: SceneModelNode) {
  return render(renderTreeElement(currentNode))
}

function renderTreeElement(currentNode: SceneModelNode) {
  return (
    <SceneTreePanel
      nodes={[currentNode]}
      selectedNodeId={null}
      availableAssetIds={new Set([asset.id])}
      assets={[asset]}
      onImportScene={vi.fn()}
      importedSceneUpdates={new Map()}
      checkingImportedNodeIds={new Set()}
    />
  )
}
