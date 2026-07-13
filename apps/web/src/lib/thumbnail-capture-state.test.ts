import { describe, expect, it } from 'vitest'
import { summarizeThumbnailCapture, type ThumbnailCaptureResult } from './thumbnail-capture-state'

describe('thumbnail capture settlement', () => {
  it('waits for every visible model to settle', () => {
    const settled = new Map<string, ThumbnailCaptureResult>([['ready', { ok: true }]])

    expect(summarizeThumbnailCapture(['ready', 'loading'], settled)).toEqual({
      allSettled: false,
      successfulCount: 1,
      firstFailure: undefined,
    })
  })

  it('allows capture when a failed model has a successful sibling', () => {
    const error = new Error('broken model')
    const settled = new Map<string, ThumbnailCaptureResult>([
      ['broken', { ok: false, error }],
      ['ready', { ok: true }],
    ])

    expect(summarizeThumbnailCapture(['broken', 'ready'], settled)).toEqual({
      allSettled: true,
      successfulCount: 1,
      firstFailure: { ok: false, error },
    })
  })

  it('reports the first failure when no model can render', () => {
    const first = new Error('first')
    const settled = new Map<string, ThumbnailCaptureResult>([
      ['first', { ok: false, error: first }],
      ['second', { ok: false, error: new Error('second') }],
    ])

    expect(summarizeThumbnailCapture(['first', 'second'], settled)).toEqual({
      allSettled: true,
      successfulCount: 0,
      firstFailure: { ok: false, error: first },
    })
  })
})
