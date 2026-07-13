import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Group } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateUniformScaleFactor, UniformScaleControl } from './uniform-scale-control'

const fiber = vi.hoisted(() => ({
  state: null as unknown as {
    controls: { enabled: boolean }
    gl: { domElement: HTMLCanvasElement }
  },
}))

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: (selector: (state: typeof fiber.state) => unknown) => selector(fiber.state),
}))

interface ScaleControlHarness {
  canvas: HTMLCanvasElement
  controls: { enabled: boolean }
  object: Group
  onCommit: ReturnType<typeof vi.fn>
  onDragStart: ReturnType<typeof vi.fn>
  onObjectChange: ReturnType<typeof vi.fn>
  mesh: HTMLElement
  capturedPointers: Set<number>
  getHandleColor: () => number
  replaceObject: () => Group
  rerender: () => void
  unmount: () => void
}

beforeEach(() => {
  fiber.state = {
    controls: { enabled: true },
    gl: { domElement: document.createElement('canvas') },
  }
})

afterEach(cleanup)

function renderScaleControl(): ScaleControlHarness {
  const object = new Group()
  object.scale.set(2, 3, 4)
  const onCommit = vi.fn()
  const onDragStart = vi.fn()
  const onObjectChange = vi.fn()
  const result = render(
    createElement(UniformScaleControl, {
      object,
      snapping: false,
      scaleSnap: 0.1,
      onCommit,
      onDragStart,
      onObjectChange,
    }),
  )
  const mesh = result.container.querySelector('mesh')
  if (!(mesh instanceof HTMLElement)) throw new Error('uniform scale handle did not render')

  const capturedPointers = new Set<number>()
  Object.assign(mesh, {
    setPointerCapture: vi.fn((pointerId: number) => capturedPointers.add(pointerId)),
    hasPointerCapture: vi.fn((pointerId: number) => capturedPointers.has(pointerId)),
    releasePointerCapture: vi.fn((pointerId: number) => capturedPointers.delete(pointerId)),
  })

  return {
    canvas: fiber.state.gl.domElement,
    controls: fiber.state.controls,
    object,
    onCommit,
    onDragStart,
    onObjectChange,
    mesh,
    capturedPointers,
    getHandleColor: () => {
      const material = result.container.querySelector('meshbasicmaterial')
      if (!(material instanceof HTMLElement)) throw new Error('scale handle material did not render')
      return Number(material.getAttribute('color'))
    },
    replaceObject: () => {
      const replacement = new Group()
      replacement.scale.set(5, 5, 5)
      result.rerender(
        createElement(UniformScaleControl, {
          object: replacement,
          snapping: false,
          scaleSnap: 0.1,
          onCommit: () => onCommit(),
          onDragStart: () => onDragStart(),
          onObjectChange: () => onObjectChange(),
        }),
      )
      return replacement
    },
    rerender: () => {
      result.rerender(
        createElement(UniformScaleControl, {
          object,
          snapping: true,
          scaleSnap: 0.1,
          onCommit: () => onCommit(),
          onDragStart: () => onDragStart(),
          onObjectChange: () => onObjectChange(),
        }),
      )
    },
    unmount: result.unmount,
  }
}

function startScaleDrag(harness: ScaleControlHarness): void {
  fireEvent.pointerDown(harness.mesh, {
    button: 0,
    clientX: 100,
    clientY: 100,
    pointerId: 7,
  })
  fireEvent.pointerMove(harness.mesh, {
    clientX: 150,
    clientY: 100,
    pointerId: 7,
  })
  expect(harness.object.scale.toArray()).toEqual([3, 4.5, 6])
  expect(harness.controls.enabled).toBe(false)
}

function dispatchPointerEvent(target: EventTarget, type: string, pointerId: number): void {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  target.dispatchEvent(event)
}

describe('calculateUniformScaleFactor', () => {
  it('maps right/up drag to growth and left/down drag to shrinkage', () => {
    expect(calculateUniformScaleFactor(100, 100, 150, 100, null)).toBe(1.5)
    expect(calculateUniformScaleFactor(100, 100, 100, 150, null)).toBe(0.5)
    expect(calculateUniformScaleFactor(100, 100, -1_000, 1_000, null)).toBe(0.01)
  })

  it('applies the configured scale snap and rejects invalid snap values', () => {
    expect(calculateUniformScaleFactor(0, 0, 14, 0, 0.1)).toBe(1.1)
    expect(() => calculateUniformScaleFactor(0, 0, 0, 0, 0)).toThrow(/must be positive/)
  })
})

describe('UniformScaleControl drag lifecycle', () => {
  it.each(['pointercancel', 'lostpointercapture'])(
    'rolls back on native %s before the fiber event layer handles it',
    (eventType) => {
      const harness = renderScaleControl()
      startScaleDrag(harness)

      dispatchPointerEvent(harness.canvas, eventType, 7)

      expect(harness.object.scale.toArray()).toEqual([2, 3, 4])
      expect(harness.controls.enabled).toBe(true)
      expect(harness.capturedPointers).not.toContain(7)
      expect(harness.onObjectChange).toHaveBeenCalledTimes(2)
      expect(harness.onCommit).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['window blur', () => fireEvent.blur(window)],
  ])('rolls back on %s', (_label, cancel) => {
    const harness = renderScaleControl()
    startScaleDrag(harness)

    cancel()

    expect(harness.object.scale.toArray()).toEqual([2, 3, 4])
    expect(harness.controls.enabled).toBe(true)
    expect(harness.onCommit).toHaveBeenCalledTimes(1)
  })

  it('rolls back an active drag when the control unmounts', () => {
    const harness = renderScaleControl()
    startScaleDrag(harness)

    harness.unmount()

    expect(harness.object.scale.toArray()).toEqual([2, 3, 4])
    expect(harness.controls.enabled).toBe(true)
    expect(harness.onCommit).toHaveBeenCalledTimes(1)
  })

  it('keeps the changed scale on pointer up and commits once', () => {
    const harness = renderScaleControl()
    fireEvent.pointerOver(harness.mesh, { pointerId: 7 })
    startScaleDrag(harness)
    expect(harness.getHandleColor()).toBe(0xf59e0b)

    fireEvent.pointerUp(harness.mesh, { pointerId: 7 })

    expect(harness.object.scale.toArray()).toEqual([3, 4.5, 6])
    expect(harness.controls.enabled).toBe(true)
    expect(harness.onCommit).toHaveBeenCalledTimes(1)
    expect(harness.getHandleColor()).toBe(0xffffff)
  })

  it('keeps an active drag across parent rerenders with new callback identities', () => {
    const harness = renderScaleControl()
    startScaleDrag(harness)

    harness.rerender()

    expect(harness.object.scale.toArray()).toEqual([3, 4.5, 6])
    expect(harness.controls.enabled).toBe(false)
    expect(harness.capturedPointers).toContain(7)
    expect(harness.onCommit).not.toHaveBeenCalled()

    fireEvent.pointerUp(harness.mesh, { pointerId: 7 })

    expect(harness.object.scale.toArray()).toEqual([3, 4.5, 6])
    expect(harness.controls.enabled).toBe(true)
    expect(harness.onCommit).toHaveBeenCalledTimes(1)
  })

  it('clears the drag state when the controlled object changes', () => {
    const harness = renderScaleControl()
    fireEvent.pointerOver(harness.mesh, { pointerId: 7 })
    startScaleDrag(harness)
    expect(harness.getHandleColor()).toBe(0xf59e0b)

    const replacement = harness.replaceObject()

    expect(harness.object.scale.toArray()).toEqual([2, 3, 4])
    expect(replacement.scale.toArray()).toEqual([5, 5, 5])
    expect(harness.controls.enabled).toBe(true)
    expect(harness.capturedPointers).not.toContain(7)
    expect(harness.onCommit).toHaveBeenCalledTimes(1)
    expect(harness.getHandleColor()).toBe(0xffffff)

    fireEvent.pointerDown(harness.mesh, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 8,
    })
    expect(harness.getHandleColor()).toBe(0xf59e0b)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(harness.getHandleColor()).toBe(0xffffff)
  })
})
