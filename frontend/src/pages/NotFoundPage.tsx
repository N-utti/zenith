import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="py-20 text-center">
      <p className="text-subtle font-mono text-sm">404</p>
      <h1 className="text-fg mt-2 text-xl font-semibold">없는 화면입니다</h1>
      <p className="text-muted mt-1 text-sm">주소를 확인하거나 홈으로 돌아가세요.</p>
      <Link
        to="/"
        className="text-accent mt-6 inline-block text-sm font-medium hover:underline"
      >
        홈으로 →
      </Link>
    </div>
  )
}
