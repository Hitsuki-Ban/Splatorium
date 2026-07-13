import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UNSUPPORTED_WORKBENCH_WIDTH_QUERY,
  isUnsupportedWorkbenchWidth,
  useUnsupportedWorkbenchWidth,
} from './minimum-width'

describe('minimum workbench width', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the CSS media boundary as the single JavaScript decision source', () => {
    const media = installMatchMedia(false)
    expect(isUnsupportedWorkbenchWidth()).toBe(false)
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 899px)')

    media.setMatches(true)
    expect(isUnsupportedWorkbenchWidth()).toBe(true)
    expect(UNSUPPORTED_WORKBENCH_WIDTH_QUERY).toBe('(max-width: 899px)')
  })

  it('subscribes to media-query changes instead of resize events', () => {
    const media = installMatchMedia(false)
    const { result, unmount } = renderHook(() => useUnsupportedWorkbenchWidth())
    expect(result.current).toBe(false)

    act(() => media.setMatches(true))
    expect(result.current).toBe(true)

    unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const media = {
    get matches() {
      return matches
    },
    media: UNSUPPORTED_WORKBENCH_WIDTH_QUERY,
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setMatches(next: boolean) {
      matches = next
      for (const listener of listeners) listener()
    },
  }
  vi.stubGlobal('matchMedia', vi.fn(() => media as unknown as MediaQueryList))
  return media
}
