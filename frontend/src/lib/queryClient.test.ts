import { afterEach, expect, test, vi } from 'vitest'
import { meQueryKey } from '@/features/auth/queries'
import { ApiError } from './api'
import { queryClient } from './queryClient'

afterEach(() => {
  delete window.__TAURI__
  queryClient.clear()
})

test('서버가 세션을 끊으면(401) 익명으로 바꾸고 데스크톱 알림 센터도 비운다', async () => {
  const invoke = vi.fn(() => Promise.resolve())
  window.__TAURI__ = { core: { invoke } }
  queryClient.setQueryData(meQueryKey, { id: 'u1' })

  await queryClient
    .fetchQuery({ queryKey: ['boards'], queryFn: () => Promise.reject(new ApiError(401, '만료')) })
    .catch(() => undefined)

  expect(queryClient.getQueryData(meQueryKey)).toBeNull()
  expect(invoke).toHaveBeenCalledWith('clear_notifications')
})
