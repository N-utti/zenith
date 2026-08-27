import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardEmpty, CardHeader } from '@/components/ui/Card'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatMinutes } from '@/lib/datetime'
import { useTeamAlerts } from '@/features/attendance/api'

/**
 * 팀 주 52시간 경보. lead 이상에게만 렌더한다 (설계서 NFR-ATT-02).
 * member가 URL을 직접 쳐도 서버가 403을 준다 — 이 컴포넌트는 UI 편의일 뿐이다.
 */
export function TeamAlertsCard() {
  const { data, isPending, isError } = useTeamAlerts(true)

  return (
    <Card>
      <CardHeader title="팀 주 52시간 경보" to="/attendance" linkLabel="팀 근태" />

      {isPending && <SkeletonRows rows={2} />}
      {isError && <CardEmpty>팀 근태를 불러오지 못했습니다.</CardEmpty>}

      {data &&
        (data.alerts.length === 0 ? (
          <CardEmpty>한도에 근접한 팀원이 없습니다.</CardEmpty>
        ) : (
          <ul className="px-2 pb-2">
            {data.alerts.map((alert) => (
              <li
                key={alert.userId}
                className="flex items-center gap-3 rounded-lg px-3 py-2"
              >
                <Avatar name={alert.name} hue={alert.avatarHue} size="sm" />
                <span className="text-fg min-w-0 flex-1 truncate text-sm">{alert.name}</span>
                <span className="text-muted text-sm tabular-nums">
                  {formatMinutes(alert.weekMinutes)}
                </span>
                <Badge tone={alert.level === 'over' ? 'danger' : 'warning'}>
                  {alert.level === 'over' ? '한도 초과' : '한도 임박'}
                </Badge>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  )
}
