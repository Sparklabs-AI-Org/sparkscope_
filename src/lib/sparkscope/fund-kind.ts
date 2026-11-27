// 모펀드 / 자펀드 구분 (2026-11-27 벤처1본부 회의 — 이희윤 상무·이준행 매니저).
//   MOTHER: 모펀드·출자사업. 여기 돈이 생기면 몇 달 뒤 자펀드 출자 공고가 나온다 → 대표님이 큰 돈의 흐름을 보는 용도.
//   CHILD : GP가 스타트업에 투자하려고 만든 펀드 → 실무가 포폴 후속 투자를 연결할 곳을 찾는 용도.
// 기사에서 뽑은 Fund 표에는 둘이 섞여 있다(예: "국민성장펀드"라는 사업명으로 저장된 웰투시의 자펀드).
// 사람이 Fund.kind를 정해 두면 그게 먼저다. 없으면 아래 규칙으로 나눈다 — 틀린 것은 카드의 O/X로 모아 규칙을 고친다.
import { prisma } from '@/lib/prisma';

export type FundKind = 'MOTHER' | 'CHILD';

const MOTHER_NAME = /모펀드|출자\s*사업|재간접|fund\s*of\s*funds/i;

export function inferFundKind(f: { fundName: string | null; programName: string | null; stage: string; gps: string[] }): FundKind {
  const name = `${f.fundName ?? ''} ${f.programName ?? ''}`;
  // 이름에 모펀드·출자사업이 있어도 GP 한 곳이 결성까지 마쳤으면 그 사업에서 나온 자펀드다.
  if (MOTHER_NAME.test(name) && !(f.stage === 'CLOSED' && f.gps.length === 1)) return 'MOTHER';
  // 정식 펀드명이 있으면 GP가 만든 펀드다.
  if (f.fundName) return 'CHILD';
  // GP가 없으면 아직 운용사를 뽑기 전인 출자 재원이다(지역 모펀드, 출자 공고).
  if (f.gps.length === 0) return 'MOTHER';
  // 한 사업에 GP 여러 곳이 뽑힌 소식은 출자사업 결과다. 공동 GP(2곳)가 결성까지 마친 펀드는 자펀드로 둔다.
  if (f.gps.length >= 3) return 'MOTHER';
  if (f.gps.length === 2 && f.stage !== 'CLOSED') return 'MOTHER';
  return 'CHILD';
}

/** 사람이 정해 둔 구분. 열이 아직 없으면(마이그레이션 전) 빈 표를 돌려준다. */
export async function getFundKindOverrides(): Promise<Map<string, FundKind>> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; kind: string | null }[]>`SELECT "id", "kind" FROM "Fund" WHERE "kind" IS NOT NULL`;
    return new Map(rows.filter(r => r.kind === 'MOTHER' || r.kind === 'CHILD').map(r => [r.id, r.kind as FundKind]));
  } catch {
    return new Map();
  }
}

export interface FundFeedbackState {
  /** 표가 있어 저장할 수 있는가(마이그레이션 전이면 false → 버튼을 숨긴다) */
  ready: boolean;
  /** 내가 남긴 것 */
  mine: Record<string, { verdict: 'O' | 'X'; note: string | null }>;
  /** 펀드별 O/X 수(모두) */
  counts: Record<string, { o: number; x: number }>;
}

export async function getFundFeedback(userEmail: string | null): Promise<FundFeedbackState> {
  try {
    const rows = await prisma.$queryRaw<{ fundId: string; userEmail: string; verdict: string; note: string | null }[]>`
      SELECT "fundId", "userEmail", "verdict", "note" FROM "FundFeedback"`;
    const mine: FundFeedbackState['mine'] = {};
    const counts: FundFeedbackState['counts'] = {};
    for (const r of rows) {
      const c = counts[r.fundId] ?? (counts[r.fundId] = { o: 0, x: 0 });
      if (r.verdict === 'O') c.o++; else if (r.verdict === 'X') c.x++;
      if (userEmail && r.userEmail === userEmail && (r.verdict === 'O' || r.verdict === 'X')) mine[r.fundId] = { verdict: r.verdict, note: r.note };
    }
    return { ready: true, mine, counts };
  } catch {
    return { ready: false, mine: {}, counts: {} };
  }
}
