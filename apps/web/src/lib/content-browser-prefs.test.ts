import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW_PREFS,
  parseViewPrefs,
  readViewPrefs,
  saveViewPrefs,
  VIEW_PREFS_KEY,
} from './content-browser-prefs'

describe('content browser view preferences', () => {
  it('uses the initial preferences only when no record exists', () => {
    const storage = { getItem: () => null, setItem: () => undefined }
    expect(readViewPrefs(storage)).toEqual(DEFAULT_VIEW_PREFS)
  })

  it('round-trips the current schema', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    saveViewPrefs({ mode: 'list', thumbSize: 192 }, storage)
    expect(readViewPrefs(storage)).toEqual({ mode: 'list', thumbSize: 192 })
  })

  it.each([
    '{bad',
    'null',
    '{"mode":"tiles","thumbSize":176}',
    '{"mode":"grid","thumbSize":"176"}',
    '{"mode":"grid","thumbSize":100}',
    '{"mode":"grid","thumbSize":176,"legacy":true}',
  ])('rejects an invalid existing record: %s', (raw) => {
    expect(() => parseViewPrefs(raw)).toThrow(VIEW_PREFS_KEY)
  })

  it('propagates storage write failures', () => {
    const failure = new Error('storage unavailable')
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw failure
      },
    }
    expect(() => saveViewPrefs(DEFAULT_VIEW_PREFS, storage)).toThrow(failure)
  })
})
