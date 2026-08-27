/**
 * 근태 타입. 설계서(docs/10-근태-모듈-설계서.md) §5 판정 규칙을 그대로 반영한다.
 * 특히 "기록 없음"을 0으로 접지 않고 null·unknown으로 남기는 것이 핵심이다.
 */

/** 출근 시각의 출처. 설계서 L2 — 출근 = min(지문 첫 이벤트, 앱 출근 버튼). */
export type CheckInSource = 'device' | 'app'

export type DayStatus =
  /** 아직 출근 기록이 없다 */
  | 'not_checked_in'
  /** 출근했고 퇴근 기록이 아직 없다 */
  | 'working'
  /** 출퇴근이 모두 기록됐다 */
  | 'done'

export interface AttendanceToday {
  date: string
  checkInAt: string | null
  checkInSource: CheckInSource | null
  checkOutAt: string | null
  status: DayStatus
  /**
   * 퇴근 취소가 가능한 마감 시각. 유예를 넘겼거나 취소할 게 없으면 null.
   *
   * 유예 안의 취소는 오조작 "정정"이라 승인이 필요 없다. 아직 팀 집계나
   * 52시간 경보가 이 기록을 참조하기 전이기 때문이다. 유예를 넘기면
   * 보정 신청 + 팀장 승인 경로로 간다 (설계서 §5.2).
   *
   * 유예 길이는 서버가 정한다 — 취업규칙에 따라 바뀔 수 있는 정책값이다.
   */
  undoCheckOutUntil: string | null
}

export interface WeekSummary {
  weekStart: string
  /** 소정근로 */
  regularMinutes: number
  /** 연장근로 */
  overtimeMinutes: number
  /** 주 52시간 = 3120분. 서버가 근무제 설정에서 내려준다. */
  limitMinutes: number
  /**
   * 기록이 불완전해 판정하지 못한 근무일 수.
   * 설계서 L4 — 결근으로 확정하지 않는다.
   */
  unconfirmedDays: number
}

/** 설계서 §5.2 D2 플래그 — 다음날 보정을 유도할 대상. */
export interface PendingCorrection {
  date: string
  reason: 'missing_checkout' | 'missing_checkin'
}

export interface AttendanceSummary {
  today: AttendanceToday
  week: WeekSummary
  pendingCorrections: PendingCorrection[]
}

/** lead 이상에게만 내려간다 (설계서 NFR-ATT-02). */
export interface TeamAlert {
  userId: string
  name: string
  avatarHue: number
  weekMinutes: number
  level: 'warning' | 'over'
}
