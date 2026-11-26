// 투자·펀드 탭 맨 위 "한눈에 보는 요약"(2026-11-26 소윤): 요즘 돈의 흐름 3줄 + 눈여겨볼 신호(연관성·추이) + 지금 할 일.
// 투자 유치·펀드 결성·포폴 매칭 집계를 사실 묶음으로 만들어 AI에 한 번 넘기고, 결과를 DashboardInsight에 저장한다.
// 하루 1회(deal-extract 크론 끝)만 계산하고 대시보드는 읽기만 한다 — 대시보드 AI 요약 사전계산 규칙(CLAUDE.md)과 같다.
// AI는 사실 묶음에 있는 숫자·이름만 쓸 수 있고, 링크 대상(분야·하우스 등)도 묶음에 있는 값만 남긴다.
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { getDealStats, STAGES } from './deal-stats';
import { getFundStats } from './fund-stats';
import { getMatchStats } from './match-stats';

const KIND = 'deal_insight';
const KEY = 'latest';
const MODEL = 'gpt-4.1';

export type InsightLinkKind = 'sector' | 'stage' | 'house' | 'fundSector' | 'match' | 'newFunds';
export interface InsightLink { kind: InsightLinkKind; value?: string }
export interface DealInsight {
  summary: string[];
  insights: { title: string; detail: string; link?: InsightLink }[];
  actions: { title: string; why: string; link?: InsightLink }[];
  basis: { deals: number; funds: number; since: string | null };
}

async function buildFacts() {
  const [deal, fund, match] = await Promise.all([getDealStats(90), getFundStats(90), getMatchStats({ days: 90 })]);
  const stageLabel = (id: string) => STAGES.find(s => s.id === id)?.label ?? id;
  const last7 = deal.daily.slice(-7).reduce((s, d) => s + d.count, 0);
  const firstDay = deal.daily[0]?.day ?? null;
  const pipeCounts: Record<string, number> = {};
  for (const p of match.pipeline) pipeCounts[p.status] = (pipeCounts[p.status] ?? 0) + 1;
  const facts = {
    기간: `최근 90일 (딜 기록 시작 ${firstDay ?? '없음'})`,
    투자유치: {
      딜수: deal.total, 최근7일: last7, 금액공개: deal.sized, 중간값억: deal.medianKrw ? Math.round(deal.medianKrw / 1e8) : null,
      우리포폴딜: deal.portfolioDeals,
      분야별: deal.matrix.map(m => ({ 분야: m.sector, 건수: m.total, 단계: Object.fromEntries(Object.entries(m.cells).map(([k, c]) => [stageLabel(k), c.count])) })),
      단계별금액억: deal.stageAmounts.map(s => ({ 단계: s.label, 건수: s.n, 최소: Math.round(s.min / 1e8), 중간: Math.round(s.median / 1e8), 최대: Math.round(s.max / 1e8) })),
      활발한하우스: deal.investors.slice(0, 8).map(i => ({ 이름: i.name, 참여: i.deals, 리드: i.leads, 주력단계: i.topStage, 주력분야: i.topSector, 우리포폴투자: i.portfolioDeals })),
      공동투자쌍: deal.pairs.map(p => `${p.a}+${p.b} ${p.count}회`),
    },
    펀드결성: {
      펀드수: fund.total, 단계별: fund.byStage, 결성완료합억: Math.round(fund.closedSumKrw / 1e8), 조성예정합억: Math.round(fund.targetSumKrw / 1e8),
      GP: fund.topGps.slice(0, 6).map(g => `${g.name} ${g.count}개`), LP재원: fund.lpMix.map(l => `${l.label} ${l.funds}개`),
      분야: fund.topSectors.map(s => `${s.name} ${s.count}개`),
      이번주새펀드: match.newFunds.map(f => ({ 이름: f.name, 단계: f.stage, GP: f.gps, 규모억: f.sizeKrw ? Math.round(f.sizeKrw / 1e8) : null, 분야: f.buckets, 맞는포폴수: f.matchCount })),
    },
    우리포폴: match.buckets.map(b => ({ 분야: b.id, 포폴수: b.companies, 최근90일딜: b.deals, 그분야펀드: b.funds })),
    매칭진행: pipeCounts,
  };
  const allowed = {
    sector: new Set(deal.matrix.map(m => m.sector)),
    stage: new Set(STAGES.map(s => s.id)),
    house: new Set(deal.investors.map(i => i.name).concat(fund.topGps.map(g => g.name))),
    fundSector: new Set(fund.topSectors.map(s => s.name)),
    match: new Set(match.buckets.map(b => b.id)),
  };
  return { facts, allowed, basis: { deals: deal.total, funds: fund.total, since: firstDay } };
}

const PROMPT = `너는 벤처캐피털(스파크랩) 투자팀을 돕는 애널리스트다. 아래 "사실 묶음"은 최근 기사에서 뽑은 국내 투자 유치·펀드 결성 집계와 우리 포트폴리오 분포다.
투자팀 실무자가 아침에 10초 보고 판단할 수 있게 써라.

규칙:
- 숫자·회사·하우스 이름은 사실 묶음에 있는 것만 쓴다. 계산해서 새 숫자를 만들지 마라(비율·증감률 금지).
- 표본이 적으면(딜 30건 미만) 단정하지 말고 "초기 신호"라고 표현한다.
- 한국어, 짧은 문장, 존댓말 없이 보고서체.
- link는 화면 이동용이다. kind와 value는 아래 중에서만 고르고, value는 사실 묶음에 적힌 값 그대로:
  sector(투자유치.분야별의 분야) / stage(SEED·PRE_A·A·B·C+·ETC) / house(하우스·GP 이름) / fundSector(펀드결성.분야의 이름) /
  match(우리포폴의 분야 — 그 분야 포폴 매칭 화면) / newFunds(value 없음 — 이번 주 새 펀드).

JSON으로만 답한다:
{"summary": [요즘 돈의 흐름 3줄 — 어디로(분야·단계), 누가(하우스·GP), 새로 생긴 돈(펀드)],
 "insights": [3~4개 {"title": 한 줄, "detail": 근거 숫자를 넣은 1~2문장, "link": {"kind","value"}}] — 연관성(예: 어떤 하우스가 어떤 분야·단계에 몰림, 펀드 분야와 딜 분야가 겹침/어긋남, 우리 포폴이 많은 분야인데 돈이 없음) 위주,
 "actions": [2~3개 {"title": 투자팀이 오늘 할 일 한 줄, "why": 이유 한 문장, "link": {"kind","value"}}] — 포폴 매칭 제안은 그중 하나일 뿐이다(하우스 미팅 준비, 다음 라운드 규모 기준 잡기, 새 펀드 GP 접촉 등).}`;

function cleanLink(l: any, allowed: Awaited<ReturnType<typeof buildFacts>>['allowed']): InsightLink | undefined {
  if (!l || typeof l.kind !== 'string') return undefined;
  if (l.kind === 'newFunds') return { kind: 'newFunds' };
  const set = (allowed as any)[l.kind] as Set<string> | undefined;
  return set && typeof l.value === 'string' && set.has(l.value) ? { kind: l.kind, value: l.value } : undefined;
}

export async function computeAndStoreDealInsight(): Promise<DealInsight | null> {
  const { facts, allowed, basis } = await buildFacts();
  if (basis.deals + basis.funds === 0) return null;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await openai.chat.completions.create({
    model: MODEL, temperature: 0.2, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: `사실 묶음:\n${JSON.stringify(facts)}` }],
  });
  const out = JSON.parse(resp.choices[0]?.message?.content ?? '{}');
  const str = (v: any, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const insight: DealInsight = {
    summary: (Array.isArray(out.summary) ? out.summary : []).map((s: any) => str(s, 200)).filter(Boolean).slice(0, 3),
    insights: (Array.isArray(out.insights) ? out.insights : []).slice(0, 4)
      .map((x: any) => ({ title: str(x?.title, 120), detail: str(x?.detail, 300), link: cleanLink(x?.link, allowed) })).filter((x: any) => x.title),
    actions: (Array.isArray(out.actions) ? out.actions : []).slice(0, 3)
      .map((x: any) => ({ title: str(x?.title, 120), why: str(x?.why, 300), link: cleanLink(x?.link, allowed) })).filter((x: any) => x.title),
    basis,
  };
  if (!insight.summary.length) return null;
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND, key: KEY } },
    create: { kind: KIND, key: KEY, value: JSON.stringify(insight) },
    update: { value: JSON.stringify(insight), computedAt: new Date() },
  });
  return insight;
}

export async function getDealInsight(): Promise<{ insight: DealInsight; computedAt: Date } | null> {
  const row = await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: KIND, key: KEY } } });
  if (!row) return null;
  try { return { insight: JSON.parse(row.value), computedAt: row.computedAt }; } catch { return null; }
}
