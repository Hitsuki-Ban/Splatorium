import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSceneStore } from '@/stores/scene-store'
import type { Asset } from '@splatorium/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeTransformFields } from './node-transform-fields'

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastMocks.error } }))

function makeAsset(): Asset {
  return {
    id: 'asset-1',
    kind: 'splat',
    name: 'model.spz',
    tags: [],
    files: { main: { path: 'model.spz', size: 1 } },
    createdAt: '2026-07-11T00:00:00.000Z',
  }
}

function resetStore() {
  const history = useSceneStore.temporal.getState()
  history.pause()
  useSceneStore.setState(useSceneStore.getInitialState(), true)
  history.clear()
  history.resume()
}

/** store の現在ノードを購読して transform 欄に流す（実使用と同じ経路） */
function Harness() {
  const nodes = useSceneStore((state) => state.nodes)
  return <NodeTransformFields node={nodes[0]} />
}

function pastLength() {
  return useSceneStore.temporal.getState().pastStates.length
}

beforeEach(() => {
  toastMocks.error.mockReset()
  resetStore()
  useSceneStore.getState().addModel(makeAsset(), null)
  useSceneStore.temporal.getState().clear()
})
afterEach(() => {
  cleanup()
  resetStore()
})

describe('NodeTransformFields', () => {
  it('commits a position component as one history entry', () => {
    render(<Harness />)
    const input = screen.getByLabelText('位置 X')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '2.5' } })
    fireEvent.blur(input)

    expect(useSceneStore.getState().nodes[0].transform.position).toEqual([2.5, 0, 0])
    expect(pastLength()).toBe(1)
  })

  it('edits rotation in degrees and stores radians', () => {
    render(<Harness />)
    const input = screen.getByLabelText('回転 X（度）')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.blur(input)

    expect(useSceneStore.getState().nodes[0].transform.rotation[0]).toBeCloseTo(Math.PI / 2, 10)
  })

  it('applies uniform scale to all axes and shows 混在 for mixed scales', () => {
    render(<Harness />)
    const uniform = screen.getByLabelText('スケール（ユニフォーム）')

    fireEvent.focus(uniform)
    fireEvent.change(uniform, { target: { value: '2' } })
    fireEvent.blur(uniform)
    expect(useSceneStore.getState().nodes[0].transform.scale).toEqual([2, 2, 2])

    const node = useSceneStore.getState().nodes[0]
    act(() => {
      useSceneStore.getState().commitNodeTransform(node.id, {
        position: [...node.transform.position],
        rotation: [...node.transform.rotation],
        scale: [1, 2, 1],
      })
    })
    expect((screen.getByLabelText('スケール（ユニフォーム）') as HTMLInputElement).value).toBe('')
    expect(
      (screen.getByLabelText('スケール（ユニフォーム）') as HTMLInputElement).placeholder,
    ).toBe('混在')
  })

  it('reveals per-axis scale fields behind the disclosure', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('スケール X')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /軸別に指定/ }))
    const axisX = screen.getByLabelText('スケール X')
    fireEvent.focus(axisX)
    fireEvent.change(axisX, { target: { value: '3' } })
    fireEvent.blur(axisX)

    expect(useSceneStore.getState().nodes[0].transform.scale).toEqual([3, 1, 1])
  })

  it.each(['0', '0.0000009', '-0.0000009'])(
    'rejects a near-zero uniform scale of %s with Japanese feedback',
    (draft) => {
      render(<Harness />)
      const input = screen.getByLabelText('スケール（ユニフォーム）')

      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: draft } })
      fireEvent.blur(input)

      expect(useSceneStore.getState().nodes[0].transform.scale).toEqual([1, 1, 1])
      expect(pastLength()).toBe(0)
      expect(toastMocks.error).toHaveBeenCalledWith(
        'スケールは絶対値 0.000001 以上で入力してください。',
      )
    },
  )

  it('rejects near-zero axis scale and accepts the exact positive and negative boundaries', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /軸別に指定/ }))
    const axisX = screen.getByLabelText('スケール X')

    for (const value of ['0', '-0.0000009']) {
      fireEvent.focus(axisX)
      fireEvent.change(axisX, { target: { value } })
      fireEvent.blur(axisX)
    }
    expect(useSceneStore.getState().nodes[0].transform.scale).toEqual([1, 1, 1])

    fireEvent.focus(axisX)
    fireEvent.change(axisX, { target: { value: '0.000001' } })
    fireEvent.blur(axisX)
    expect(useSceneStore.getState().nodes[0].transform.scale[0]).toBe(0.000001)
    expect((axisX as HTMLInputElement).value).toBe('0.000001')

    fireEvent.focus(axisX)
    fireEvent.change(axisX, { target: { value: '-0.000001' } })
    fireEvent.blur(axisX)
    expect(useSceneStore.getState().nodes[0].transform.scale[0]).toBe(-0.000001)
  })

  it('does not add history when a field is blurred without change', () => {
    render(<Harness />)
    const input = screen.getByLabelText('位置 X')

    fireEvent.focus(input)
    fireEvent.blur(input)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)

    expect(pastLength()).toBe(0)
    expect(useSceneStore.getState().nodes[0].transform.position).toEqual([0, 0, 0])
  })

  it('does not commit a mixed uniform scale on focus and blur', () => {
    const node = useSceneStore.getState().nodes[0]
    useSceneStore.getState().commitNodeTransform(node.id, {
      ...node.transform,
      scale: [1, 2, 1],
    })
    useSceneStore.temporal.getState().clear()
    render(<Harness />)

    const uniform = screen.getByLabelText('スケール（ユニフォーム）')
    fireEvent.focus(uniform)
    fireEvent.blur(uniform)

    expect(useSceneStore.getState().nodes[0].transform.scale).toEqual([1, 2, 1])
    expect(pastLength()).toBe(0)
  })

  it('does not quantize a precise value unless the draft changes', () => {
    const node = useSceneStore.getState().nodes[0]
    useSceneStore.getState().commitNodeTransform(node.id, {
      ...node.transform,
      position: [1.23456, 0, 0],
      rotation: [0.1, 0, 0],
    })
    useSceneStore.temporal.getState().clear()
    render(<Harness />)

    for (const label of ['位置 X', '回転 X（度）']) {
      const input = screen.getByLabelText(label)
      fireEvent.focus(input)
      fireEvent.blur(input)
    }

    expect(useSceneStore.getState().nodes[0].transform.position[0]).toBe(1.23456)
    expect(useSceneStore.getState().nodes[0].transform.rotation[0]).toBe(0.1)
    expect(pastLength()).toBe(0)
  })

  it('cancels Escape and treats an edited blank as invalid', () => {
    render(<Harness />)
    const input = screen.getByLabelText('位置 X')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useSceneStore.getState().nodes[0].transform.position[0]).toBe(0)

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(useSceneStore.getState().nodes[0].transform.position[0]).toBe(0)
    expect(pastLength()).toBe(0)
  })

  it('renders a transient gizmo preview without changing scene history', () => {
    render(<Harness />)
    const node = useSceneStore.getState().nodes[0]

    act(() => {
      useSceneStore.getState().previewNodeTransform(node.id, {
        ...node.transform,
        position: [4.25, 0, 0],
      })
    })

    expect((screen.getByLabelText('位置 X') as HTMLInputElement).value).toBe('4.25')
    expect(useSceneStore.getState().nodes[0].transform.position[0]).toBe(0)
    expect(pastLength()).toBe(0)
  })
})
