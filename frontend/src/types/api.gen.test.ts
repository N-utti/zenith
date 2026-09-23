// @vitest-environment node
import { readFileSync } from 'node:fs'
import openapiTS, { astToString } from 'openapi-typescript'
import { expect, test } from 'vitest'

/**
 * `api.gen.ts` 는 커밋한다. 배포 이미지(infra/caddy)는 frontend 만 복사해 빌드하므로 거기서
 * backend/openapi.json 을 읽어 만들 수 없다. 대신 이 테스트가 명세와 어긋난 채 남는 걸 막는다.
 */
test('api.gen.ts 가 backend/openapi.json 과 같다 (다르면 npm run gen:api)', async () => {
  const spec = new URL('../../../backend/openapi.json', import.meta.url)
  const fresh = astToString(await openapiTS(spec))
  // 머리 주석은 CLI 만 붙인다. git 이 줄바꿈을 CRLF 로 바꿔 받는 PC 도 있다.
  const committed = readFileSync(new URL('./api.gen.ts', import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  )
  expect(committed.endsWith(fresh)).toBe(true)
})
