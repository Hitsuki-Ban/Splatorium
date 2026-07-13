export const THUMB_MIN = 96
export const THUMB_MAX = 224
export const THUMB_STEP = 16
export const VIEW_PREFS_KEY = 'splatorium-browser-view'

export type ViewMode = 'grid' | 'list'

export interface ViewPrefs {
  mode: ViewMode
  thumbSize: number
}

export const DEFAULT_VIEW_PREFS: ViewPrefs = { mode: 'grid', thumbSize: 176 }

type ViewPrefsStorage = Pick<Storage, 'getItem' | 'setItem'>

function assertViewPrefs(value: unknown): asserts value is ViewPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${VIEW_PREFS_KEY} は JSON オブジェクトである必要があります`)
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 2 || keys[0] !== 'mode' || keys[1] !== 'thumbSize') {
    throw new Error(`${VIEW_PREFS_KEY} には mode と thumbSize だけを指定してください`)
  }
  if (record.mode !== 'grid' && record.mode !== 'list') {
    throw new Error(`${VIEW_PREFS_KEY}.mode は grid または list である必要があります`)
  }
  if (
    !Number.isInteger(record.thumbSize) ||
    (record.thumbSize as number) < THUMB_MIN ||
    (record.thumbSize as number) > THUMB_MAX ||
    ((record.thumbSize as number) - THUMB_MIN) % THUMB_STEP !== 0
  ) {
    throw new Error(
      `${VIEW_PREFS_KEY}.thumbSize は ${THUMB_MIN} から ${THUMB_MAX} まで ${THUMB_STEP}px 刻みである必要があります`,
    )
  }
}

export function parseViewPrefs(raw: string): ViewPrefs {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${VIEW_PREFS_KEY} の JSON が不正です`, { cause: error })
  }
  assertViewPrefs(parsed)
  return parsed
}

export function readViewPrefs(storage: ViewPrefsStorage = localStorage): ViewPrefs {
  const raw = storage.getItem(VIEW_PREFS_KEY)
  return raw === null ? DEFAULT_VIEW_PREFS : parseViewPrefs(raw)
}

export function saveViewPrefs(
  prefs: ViewPrefs,
  storage: ViewPrefsStorage = localStorage,
): void {
  assertViewPrefs(prefs)
  storage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs))
}
