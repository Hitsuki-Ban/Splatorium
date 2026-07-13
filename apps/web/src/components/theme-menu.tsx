import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SUNRISE_HOUR, SUNSET_HOUR, useTheme, type Theme } from '@/lib/theme'
import { Monitor, Moon, Sun, Sunset } from 'lucide-react'

const MODES: { value: Theme; icon: typeof Sun; label: string; hint?: string }[] = [
  { value: 'light', icon: Sun, label: '明' },
  { value: 'dark', icon: Moon, label: '暗' },
  { value: 'system', icon: Monitor, label: 'システム' },
  {
    value: 'sunset',
    icon: Sunset,
    label: '日没時間',
    hint: `${SUNSET_HOUR}:00–${SUNRISE_HOUR}:00 を暗に`,
  },
]

export function ThemeMenu() {
  const { theme, isDark, setTheme } = useTheme()
  const ActiveIcon = MODES.find((m) => m.value === theme)?.icon ?? Moon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={`テーマ切替（現在: ${MODES.find((m) => m.value === theme)?.label}・${isDark ? '暗' : '明'}適用中）`}
          title="テーマ切替"
        >
          <ActiveIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
        >
          {MODES.map(({ value, icon: Icon, label, hint }) => (
            <DropdownMenuRadioItem key={value} value={value} aria-label={label}>
              <Icon />
              {label}
              {hint && <span className="ml-auto pl-3 text-xs text-muted-foreground">{hint}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
