import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * テーマ 4 モード（明 / 暗 / システム / 日没時間）。
 * sunset はマシンのローカル時刻の固定スケジュールで明暗を自動切替する
 * （位置情報・外部 API は使わない。完全ローカル実行の前提を守る）。
 */
export type Theme = 'light' | 'dark' | 'system' | 'sunset'

export const THEME_STORAGE_KEY = 'splatorium-theme'
const DEFAULT_THEME: Theme = 'dark'

/** sunset モードの切替時刻（ローカル時刻・時単位） */
export const SUNSET_HOUR = 18
export const SUNRISE_HOUR = 6

export function isNightAt(date: Date): boolean {
  const hour = date.getHours()
  return hour >= SUNSET_HOUR || hour < SUNRISE_HOUR
}

/** 次に明暗が切り替わるローカル時刻（今日/明日の 18:00 または 6:00） */
export function nextSunsetTransition(now: Date): Date {
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  const hour = now.getHours()
  if (hour < SUNRISE_HOUR) {
    next.setHours(SUNRISE_HOUR)
  } else if (hour < SUNSET_HOUR) {
    next.setHours(SUNSET_HOUR)
  } else {
    next.setDate(next.getDate() + 1)
    next.setHours(SUNRISE_HOUR)
  }
  return next
}

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system' || value === 'sunset'
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function resolveIsDark(theme: Theme, systemPrefersDark: boolean, now: Date): boolean {
  if (theme === 'light') return false
  if (theme === 'dark') return true
  if (theme === 'system') return systemPrefersDark
  return isNightAt(now)
}

interface ThemeContextValue {
  theme: Theme
  /** 現在実際に適用されている明暗（system/sunset の解決結果） */
  isDark: boolean
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)
  const [isDark, setIsDark] = useState(() =>
    resolveIsDark(
      readStoredTheme(),
      window.matchMedia('(prefers-color-scheme: dark)').matches,
      new Date(),
    ),
  )

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // localStorage が使えない環境ではセッション内のみ有効
    }
  }, [])

  // 明暗の解決と、モードごとの追従（system: OS 設定変更 / sunset: 次の切替時刻）
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setIsDark(resolveIsDark(theme, media.matches, new Date()))
    apply()

    if (theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    if (theme === 'sunset') {
      // ポーリングせず、次の切替時刻ちょうどに 1 本だけ予約する（スリープ復帰等での
      // ずれは再評価時に吸収される）。実行後は theme 依存の再実行で次を予約し直す
      let timer: number
      const schedule = () => {
        const delay = nextSunsetTransition(new Date()).getTime() - Date.now()
        timer = window.setTimeout(() => {
          apply()
          schedule()
        }, Math.max(delay, 1000))
      }
      schedule()
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme }}>{children}</ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme は ThemeProvider 配下でのみ使用できます')
  }
  return context
}
