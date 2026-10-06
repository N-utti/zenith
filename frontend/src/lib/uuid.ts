/**
 * `crypto.randomUUID` 는 보안 컨텍스트(https·localhost) 전용이다. 사내망 평문 주소
 * (`http://<LAN IP>:5180`, infra/README)로 열면 없다. 서버가 uuid 로 파싱하는 자리(AI `session_id`)가
 * 있어 모양은 v4 로 맞춘다.
 */
export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
