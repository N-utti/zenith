// 화면 코드(src/mocks/inlineRelay.ts)가 가져다 쓰는 만큼만. 몸체는 chat.js.
export function handleChatRequest(req: unknown, res: unknown, url: URL): Promise<void>
export function handleChatConnection(conn: unknown, userId: string): void
export function sessionUserId(req: { headers: { cookie?: string } }): string | null
