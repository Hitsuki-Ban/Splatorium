import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeMenu } from './theme-menu'

vi.mock('@/lib/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/theme')>()
  return {
    ...actual,
    useTheme: () => ({ theme: 'dark' as const, isDark: true, setTheme: vi.fn() }),
  }
})

afterEach(cleanup)

describe('ThemeMenu', () => {
  it('exposes an accessible name for every theme option', async () => {
    render(<ThemeMenu />)

    fireEvent.pointerDown(screen.getByRole('button', { name: /テーマ切替/ }), {
      button: 0,
      ctrlKey: false,
    })

    for (const name of ['明', '暗', 'システム', '日没時間']) {
      expect(await screen.findByRole('menuitemradio', { name })).toBeTruthy()
    }
  })
})
