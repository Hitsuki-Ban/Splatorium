export type ThumbnailCaptureResult = { ok: true } | { ok: false; error: unknown }

export interface ThumbnailCaptureSummary {
  allSettled: boolean
  successfulCount: number
  firstFailure?: { ok: false; error: unknown }
}

export function summarizeThumbnailCapture(
  keys: readonly string[],
  settled: ReadonlyMap<string, ThumbnailCaptureResult>,
): ThumbnailCaptureSummary {
  const results = keys.map((key) => settled.get(key))
  return {
    allSettled: keys.length > 0 && results.every((result) => result !== undefined),
    successfulCount: results.reduce((count, result) => count + (result?.ok ? 1 : 0), 0),
    firstFailure: results.find(
      (result): result is { ok: false; error: unknown } => result?.ok === false,
    ),
  }
}
