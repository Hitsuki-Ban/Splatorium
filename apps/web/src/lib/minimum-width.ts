import { useSyncExternalStore } from 'react'

export const MINIMUM_WORKBENCH_WIDTH = 900
export const UNSUPPORTED_WORKBENCH_WIDTH_QUERY = `(max-width: ${MINIMUM_WORKBENCH_WIDTH - 1}px)`

export function isUnsupportedWorkbenchWidth(): boolean {
  return window.matchMedia(UNSUPPORTED_WORKBENCH_WIDTH_QUERY).matches
}

export function useUnsupportedWorkbenchWidth(): boolean {
  return useSyncExternalStore(subscribeUnsupportedWidth, isUnsupportedWorkbenchWidth)
}

function subscribeUnsupportedWidth(onStoreChange: () => void): () => void {
  const media = window.matchMedia(UNSUPPORTED_WORKBENCH_WIDTH_QUERY)
  media.addEventListener('change', onStoreChange)
  return () => media.removeEventListener('change', onStoreChange)
}
