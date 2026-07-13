import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import { isNightAt, nextSunsetTransition } from './theme'

const at = (hour: number, minute = 0) => new Date(2026, 6, 9, hour, minute)

function readBootstrapScript(): string {
  const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script) {
    throw new Error('index.html のテーマ初期化スクリプトが見つかりません')
  }
  return script
}

const bootstrapScript = readBootstrapScript()

function runBootstrap(storedTheme: string | null): boolean {
  let dark = false
  const classList = {
    toggle: (name: string, force: boolean) => {
      if (name === 'dark') dark = force
    },
    add: (name: string) => {
      if (name === 'dark') dark = true
    },
  }
  const execute = new Function('localStorage', 'matchMedia', 'document', 'Date', bootstrapScript)
  execute(
    { getItem: () => storedTheme },
    () => ({ matches: false }),
    { documentElement: { classList } },
    class {
      getHours() {
        return 12
      }
    },
  )
  return dark
}

describe('isNightAt', () => {
  it('18:00 以降と 6:00 前を夜と判定する', () => {
    expect(isNightAt(at(18, 0))).toBe(true)
    expect(isNightAt(at(23, 59))).toBe(true)
    expect(isNightAt(at(0, 0))).toBe(true)
    expect(isNightAt(at(5, 59))).toBe(true)
  })

  it('6:00 以降 18:00 前を昼と判定する', () => {
    expect(isNightAt(at(6, 0))).toBe(false)
    expect(isNightAt(at(11, 30))).toBe(false)
    expect(isNightAt(at(17, 59))).toBe(false)
  })
})

describe('nextSunsetTransition', () => {
  it('昼の間は当日 18:00 を返す', () => {
    const next = nextSunsetTransition(at(11, 30))
    expect(next.getDate()).toBe(9)
    expect(next.getHours()).toBe(18)
    expect(next.getMinutes()).toBe(0)
  })

  it('深夜 0:00〜6:00 前は当日 6:00 を返す', () => {
    const next = nextSunsetTransition(at(2, 15))
    expect(next.getDate()).toBe(9)
    expect(next.getHours()).toBe(6)
  })

  it('18:00 以降は翌日 6:00 を返す', () => {
    const next = nextSunsetTransition(at(21, 45))
    expect(next.getDate()).toBe(10)
    expect(next.getHours()).toBe(6)
  })

  it('切替時刻ちょうどでも常に未来の時刻を返す', () => {
    expect(nextSunsetTransition(at(6, 0)).getHours()).toBe(18)
    expect(nextSunsetTransition(at(18, 0)).getDate()).toBe(10)
  })
})

describe('index.html theme bootstrap', () => {
  it('保存値が不正な場合も React 側と同じ dark 既定値を適用する', () => {
    expect(runBootstrap('invalid-theme')).toBe(true)
  })

  it('保存値が light の場合は dark を適用しない', () => {
    expect(runBootstrap('light')).toBe(false)
  })
})
