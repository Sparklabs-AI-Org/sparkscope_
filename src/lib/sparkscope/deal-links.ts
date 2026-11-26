// 투자·펀드 분석 그래프 → 근거 표(/dashboard/deals) 연결 주소(2026-11-26 소윤: "막대든 제목이든 누르면 연관 기사로").
// 클라이언트·서버 양쪽에서 쓰므로 prisma 등 서버 전용 모듈을 import 하지 않는다.
export interface DealFilter {
  sec?: string;   // 분야 묶음(deal-stats sectorOf / fund-stats normSector)
  st?: string;    // 딜 단계 칸(SEED/PRE_A/A/B/C+/ETC) 또는 펀드 단계(CLOSED/GP_SELECTED/ANNOUNCED)
  inv?: string;   // 하우스(이름) — 딜 투자사 또는 펀드 GP
  inv2?: string;  // 공동투자 쌍의 두 번째 하우스
  lp?: string;    // 펀드 LP 재원 묶음 id(lpGroup)
  day?: string;   // yyyy-mm-dd (KST)
  week?: string;  // 그 주 월요일 yyyy-mm-dd
  pf?: '1';       // 우리 포트폴리오만
  sized?: '1';    // 금액 공개만
}
export function dealsHref(tab: 'deals' | 'funds', f: DealFilter = {}): string {
  const q = new URLSearchParams({ tab, days: '90' });
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
  return `/dashboard/deals?${q.toString()}`;
}
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
