import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'zenith.theme'
const listeners = new Set<() => void>()

function read(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

let current: Theme = read()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setTheme(theme: Theme) {
  current = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(KEY, theme)
  listeners.forEach((fn) => fn())
}

/** `public/theme.js` 가 초기 테마를 이미 확정해 둔다. 여기서는 읽고 토글만 한다. */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'light' as Theme,
  )
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}
