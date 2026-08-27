import type {
  AttendanceSummary,
  AttendanceToday,
  TeamAlert,
  WeekSummary,
} from '@/features/attendance/types'
import type { Announcement } from '@/features/home/types'
import type { User } from '@/types'

// ── 시각 헬퍼 ────────────────────────────────────────────────
// 목 데이터는 "오늘"에 붙어 있어야 화면이 자연스럽다. 고정 날짜를 쓰지 않는다.

function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function todayAt(hour: number, minute: number): string {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function daysAgoDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return ymd(date)
}

/** 이번 주 월요일. 일요일(0)은 지난 월요일로 접는다. */
function weekStart(): string {
  const date = new Date()
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return ymd(date)
}

const WEEK_LIMIT_MINUTES = 52 * 60

/**
 * 퇴근 취소 유예. 이 안에서는 승인 없이 정정되고, 넘기면 보정 신청으로 간다.
 * 실제로는 취업규칙에 맞춰 서버 설정(work_policies)에서 읽어야 할 값이다.
 */
const UNDO_GRACE_MINUTES = 5

// ── 근태 상태 (가변) ─────────────────────────────────────────
// 출근·퇴근 버튼이 실제로 상태를 바꿔야 위젯을 제대로 확인할 수 있다.

interface UserAttendance {
  today: AttendanceToday
  week: WeekSummary
  pendingCorrections: AttendanceSummary['pendingCorrections']
  /** 되돌리기용. 퇴근을 언제 기록했고 주간 누적에 몇 분을 더했는지. */
  lastCheckOut?: { recordedAt: number; regular: number; overtime: number }
}

function week(regular: number, overtime: number, unconfirmed = 0): WeekSummary {
  return {
    weekStart: weekStart(),
    regularMinutes: regular,
    overtimeMinutes: overtime,
    limitMinutes: WEEK_LIMIT_MINUTES,
    unconfirmedDays: unconfirmed,
  }
}

const attendance: Record<string, UserAttendance> = {
  // 지문으로 출근했고 아직 퇴근 전. 어제 퇴근 버튼을 안 눌러 보정 대상이 하나 있다.
  'u-1': {
    today: {
      date: ymd(new Date()),
      checkInAt: todayAt(9, 12),
      checkInSource: 'device',
      checkOutAt: null,
      status: 'working',
      undoCheckOutUntil: null,
    },
    week: week(1930, 0, 1),
    pendingCorrections: [{ date: daysAgoDate(1), reason: 'missing_checkout' }],
  },
  // 동반 입장으로 지문이 누락돼 앱 버튼이 출근 원천이 된 경우 (설계서 L2).
  'u-2': {
    today: {
      date: ymd(new Date()),
      checkInAt: todayAt(8, 47),
      checkInSource: 'app',
      checkOutAt: null,
      status: 'working',
      undoCheckOutUntil: null,
    },
    week: week(2400, 320),
    pendingCorrections: [],
  },
  'u-3': {
    today: {
      date: ymd(new Date()),
      checkInAt: null,
      checkInSource: null,
      checkOutAt: null,
      status: 'not_checked_in',
      undoCheckOutUntil: null,
    },
    week: week(1560, 0),
    pendingCorrections: [],
  },
}

/** 유예가 살아 있으면 마감 시각을, 지났으면 null을 준다. */
function undoDeadline(state: UserAttendance): string | null {
  if (!state.lastCheckOut) return null
  const until = state.lastCheckOut.recordedAt + UNDO_GRACE_MINUTES * 60_000
  return until > Date.now() ? new Date(until).toISOString() : null
}

export function getAttendance(userId: string): AttendanceSummary {
  const state = attendance[userId] ?? attendance['u-1']
  return {
    today: { ...state.today, undoCheckOutUntil: undoDeadline(state) },
    week: state.week,
    pendingCorrections: state.pendingCorrections,
  }
}

export function punchIn(userId: string): AttendanceSummary {
  const state = attendance[userId]
  if (state && !state.today.checkInAt) {
    state.today = {
      ...state.today,
      checkInAt: new Date().toISOString(),
      checkInSource: 'app',
      status: 'working',
    }
  }
  return getAttendance(userId)
}

export function punchOut(userId: string): AttendanceSummary {
  const state = attendance[userId]
  if (state?.today.checkInAt && !state.today.checkOutAt) {
    const now = new Date()
    const worked = Math.floor(
      (now.getTime() - new Date(state.today.checkInAt).getTime()) / 60_000,
    )
    state.today = { ...state.today, checkOutAt: now.toISOString(), status: 'done' }
    // 소정 8시간을 넘는 분은 연장으로 넘긴다 (실제 판정은 서버 §5가 한다).
    const regular = Math.min(worked, 480)
    const overtime = worked - regular
    state.week = {
      ...state.week,
      regularMinutes: state.week.regularMinutes + regular,
      overtimeMinutes: state.week.overtimeMinutes + overtime,
    }
    state.lastCheckOut = { recordedAt: now.getTime(), regular, overtime }
  }
  return getAttendance(userId)
}

export class UndoExpiredError extends Error {}

/**
 * 퇴근 취소. 유예 안에서만 허용한다.
 *
 * 실제 서버는 att_raw_events에서 행을 지우지 않는다 — 무손실 적재가
 * 재계산(replay)의 전제이기 때문이다. 취소 이벤트를 덧붙이고 판정 계층이
 * 이를 무시하는 방식이 된다. 목에서는 그 결과 상태만 재현한다.
 */
export function undoCheckOut(userId: string): AttendanceSummary {
  const state = attendance[userId]
  if (!state?.lastCheckOut || undoDeadline(state) === null) {
    throw new UndoExpiredError()
  }

  const { regular, overtime } = state.lastCheckOut
  state.week = {
    ...state.week,
    regularMinutes: state.week.regularMinutes - regular,
    overtimeMinutes: state.week.overtimeMinutes - overtime,
  }
  state.today = { ...state.today, checkOutAt: null, status: 'working' }
  delete state.lastCheckOut

  return getAttendance(userId)
}

// ── 팀 52시간 경보 ───────────────────────────────────────────

const TEAM_ALERTS: Record<string, TeamAlert[]> = {
  'team-product': [
    { userId: 'u-8', name: '한지우', avatarHue: 95, weekMinutes: 3180, level: 'over' },
    { userId: 'u-9', name: '이정민', avatarHue: 200, weekMinutes: 3005, level: 'warning' },
  ],
  'team-management': [
    { userId: 'u-7', name: '오세라', avatarHue: 330, weekMinutes: 2890, level: 'warning' },
  ],
}

/** lead는 소속 팀만, exec는 전사를 본다 (설계서 §3). */
export function getTeamAlerts(user: User): TeamAlert[] {
  if (user.role === 'exec') return Object.values(TEAM_ALERTS).flat()
  return TEAM_ALERTS[user.team.id] ?? []
}

// ── 콘텐츠 ───────────────────────────────────────────────────

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'a-1',
    title: '2026년 하반기 정기 워크숍 안내',
    boardLevel: 'member',
    authorName: '경영지원팀',
    createdAt: minutesAgo(190),
    pinned: true,
  },
  {
    id: 'a-2',
    title: 'MOA 사내 협업툴 파일럿 참여자 모집',
    boardLevel: 'member',
    authorName: '박동현',
    createdAt: minutesAgo(1180),
    pinned: false,
  },
  {
    id: 'a-3',
    title: '3분기 인사평가 일정 및 평가자 배정',
    boardLevel: 'lead',
    authorName: '경영지원팀',
    createdAt: minutesAgo(2400),
    pinned: false,
  },
  {
    id: 'a-4',
    title: '추석 연휴 근무 일정 · 대체휴무 안내',
    boardLevel: 'member',
    authorName: '경영지원팀',
    createdAt: minutesAgo(3300),
    pinned: false,
  },
  {
    id: 'a-5',
    title: '4분기 예산안 검토 회의 자료',
    boardLevel: 'exec',
    authorName: '최재호',
    createdAt: minutesAgo(4100),
    pinned: false,
  },
]
