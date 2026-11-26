// 투자·펀드 탭 맨 위 "한눈에 보는 요약"(2026-11-26 소윤): 요즘 돈의 흐름 3줄 + 눈여겨볼 신호(연관성·추이) + 지금 할 일.
// 투자 유치·펀드 결성·포폴 매칭 집계를 사실 묶음으로 만들어 AI에 한 번 넘기고, 결과를 DashboardInsight에 저장한다.
// 자동으로 돌지 않는다 — 화면의 "최신으로 다시 분석" 버튼을 누를 때만 계산해 저장하고, 평소엔 마지막 결과를 읽기만 한다
// (2026-11-26 소윤: 상위 모델은 비싸고 사실상 대표님 위주 기능이라 클릭할 때만). 모델은 Claude Opus 5.5 — GPT 3종과 같은 입력으로
// 비교해 가장 구체적이었다(회당 약 $0.12~0.20).
// AI는 사실 묶음에 있는 숫자·이름만 쓸 수 있고, 링크 대상(분야·하우스 등)도 묶음에 있는 값만 남긴다.
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { getDealStats, STAGES, SECTORS, sectorOf } from './deal-stats';
import { lpGroup } from './fund-stats';
import { getFundStats } from './fund-stats';
import { getMatchStats } from './match-stats';

const KIND = 'deal_insight';
const KEY = 'latest';
const MODEL = 'claude-opus-5-5';

export type InsightLinkKind = 'sector' | 'stage' | 'house' | 'fundSector' | 'match' | 'newFunds';
export interface InsightLink { kind: InsightLinkKind; value?: string }
export interface InsightSource { n: number; title: string; source: string; date: string; link: string }
export interface DealInsight {
  summary: string[];
  /** summary 줄마다 데이터 근거 화면(뉴스 근거는 문장 속 [n]). 없으면 null. */
  summaryLinks?: (InsightLink | null)[];
  /** 돈의 이동 — 어디서(LP 재원·하우스) 어디로(분야·단계) */
  flows?: { from: string; to: string; detail: string; link?: InsightLink }[];
  /** 왜 지금 그 분야인가 — 일반 뉴스 근거 */
  why?: { topic: string; reason: string; sources: number[]; link?: InsightLink }[];
  sources?: InsightSource[];
  insights: { title: string; detail: string; link?: InsightLink }[];
  actions?: { title: string; why: string; link?: InsightLink }[];
  /** 펀드별 우리 대응(2026-11-26 실무 피드백: 갓 결성된 펀드가 가장 중요 — VC 입장에서 투자받을 곳). fund = 펀드 이름(FundRow.name과 같음) */
  fundPlays?: { fund: string; what: string; position: string; targets: string[]; action: string }[];
  basis: { deals: number; funds: number; since: string | null };
}

async function buildFacts() {
  const [deal, fund, match] = await Promise.all([getDealStats(90), getFundStats(90), getMatchStats({ days: 90 })]);
  const stageLabel = (id: string) => STAGES.find(s => s.id === id)?.label ?? id;
  const last7 = deal.daily.slice(-7).reduce((s, d) => s + d.count, 0);
  const firstDay = deal.daily[0]?.day ?? null;
  const pipeCounts: Record<string, number> = {};
  for (const p of match.pipeline) pipeCounts[p.status] = (pipeCounts[p.status] ?? 0) + 1;
  // ── 돈의 이동 재료: 펀드(LP 재원 → GP → 분야), 딜(하우스 → 분야·단계)
  // 펀드마다 분야가 맞는 우리 포폴(이름 15곳까지) — AI가 "어느 포폴을 소개할지"를 고르는 재료.
  const fundTargets = new Map<string, string[]>();
  const fundFlows = fund.rows.map(r => {
    const buckets = new Set(r.sectors.map(s => sectorOf(s)).filter(b => b !== '기타' && b !== '미상'));
    const fit = match.companies.filter(c => buckets.has(c.bucket));
    fundTargets.set(r.name, fit.map(c => c.name));
    return { 펀드: r.name, 단계: r.stage, 날짜: r.date, 규모억: r.sizeKrw ? Math.round(r.sizeKrw / 1e8) : null, 목표액여부: r.sizeIsTarget,
      LP: r.lps, LP재원: [...new Set(r.lps.map(l => lpGroup(l).label))], GP: r.gps, 분야: r.sectors,
      분야맞는우리포폴수: fit.length, 분야맞는우리포폴: fit.slice(0, 15).map(c => `${c.name}(${c.sector ?? c.bucket})`) };
  });
  const dealFlows = deal.rows.slice(0, 40).map(r => ({ 회사: r.company, 분야: r.sector, 단계: stageLabel(r.stage), 금액억: r.amountKrw ? Math.round(r.amountKrw / 1e8) : null,
    리드: r.investors.filter(i => i.role === 'LEAD').map(i => i.name), 참여: r.investors.map(i => i.name) }));

  // ── 일반 뉴스 근거: 딜·펀드가 몰린 분야의 최근 30일 기사(업계 동향·정책·투자 매체) + 벤처 자금 시장 전반.
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const cats = ['industry_trend', 'policy_support', 'fund_invest', 'deal_news'];
  const hotSectors = deal.matrix.filter(m => m.sector !== '미상' && m.sector !== '기타').slice(0, 3).map(m => m.sector);
  for (const s of fund.topSectors.slice(0, 2)) { const b = SECTORS.find(x => x.re.test(s.name))?.id; if (b && !hotSectors.includes(b)) hotSectors.push(b); }
  const sources: InsightSource[] = [];
  const news: Record<string, { n: number; 제목: string; 매체: string; 날짜: string; 요지: string }[]> = {};
  const seen = new Set<string>();
  const pull = async (label: string, words: string[], take: number) => {
    const rows = await prisma.article.findMany({
      where: { pubDate: { gte: since30 }, category: { in: cats }, bodyText: { not: null }, OR: words.map(w => ({ title: { contains: w } })) },
      select: { title: true, link: true, source: true, pubDate: true, bodyText: true }, orderBy: { pubDate: 'desc' }, take: 60,
    });
    const out: (typeof news)[string] = [];
    for (const a of rows) {
      const k = a.title.replace(/\s|\[.*?\]/g, '').slice(0, 18);
      if (seen.has(k)) continue; seen.add(k);
      const n = sources.length + 1;
      sources.push({ n, title: a.title, source: a.source, date: a.pubDate.toISOString().slice(0, 10), link: a.link });
      out.push({ n, 제목: a.title, 매체: a.source, 날짜: a.pubDate.toISOString().slice(0, 10), 요지: (a.bodyText ?? '').replace(/\s+/g, ' ').slice(0, 280) });
      if (out.length >= take) break;
    }
    news[label] = out;
  };
  for (const sec of hotSectors) {
    const words = (SECTORS.find(x => x.id === sec)?.re.source ?? sec).split('|').filter(w => w.length >= 2).slice(0, 6);
    await pull(sec, words, 7);
  }
  await pull('벤처자금시장', ['모태펀드', '정책펀드', '벤처투자', '출자사업', 'VC', '벤처캐피탈', 'IPO', '세컨더리'], 8);

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
    펀드별_LP에서GP로: fundFlows,
    돈의이동_딜: dealFlows,
    관련뉴스: news,
  };
  const allowed = {
    sector: new Set(deal.matrix.map(m => m.sector)),
    stage: new Set(STAGES.map(s => s.id)),
    house: new Set(deal.investors.map(i => i.name).concat(fund.topGps.map(g => g.name))),
    fundSector: new Set(fund.topSectors.map(s => s.name)),
    match: new Set(match.buckets.map(b => b.id)),
  };
  return { facts, allowed, sources, fundTargets, basis: { deals: deal.total, funds: fund.total, since: firstDay } };
}

const PROMPT = `너는 벤처캐피털(스파크랩) 투자팀의 시니어 애널리스트다. "사실 묶음"에는 최근 기사에서 뽑은 국내 펀드 결성(LP → GP, 분야, 분야가 맞는 우리 포폴),
투자 유치 집계, 우리 포트폴리오 분포, 관련 분야 최근 뉴스(관련뉴스, 번호 n)가 들어 있다.

가장 중요한 것은 "갓 결성된 펀드"다. 결성 직후 펀드는 투자기간 초기라 돈을 써야 하므로, 우리 포트폴리오사가 투자를 받을 수 있는 곳이다.
그다음이 GP 선정(곧 결성), 출자 공고 순이다. 누구 돈(LP)이 어느 운용사(GP)로 갔는지가 핵심이고, GP가 어느 기업에 투자했는지는 부차적이다.

규칙:
- 숫자·회사·하우스·펀드·포폴 이름은 사실 묶음에 있는 것만. 새 숫자(비율·증감률)를 계산해 만들지 마라.
- 딜 30건 미만이면 단정하지 말고 "초기 신호"로 표현한다.
- 투자유치 딜은 국내 시장 전체의 딜이다. '우리 딜'이라고 쓰지 마라(우리 포폴 딜은 '우리포폴딜' 숫자뿐).
- 한국어 보고서체, 짧고 구체적으로.
- link: kind/value는 아래 중에서만, value는 사실 묶음 값 그대로 —
  sector(투자유치.분야별의 분야) / stage(SEED·PRE_A·A·B·C+·ETC) / house(하우스·GP 이름) / fundSector(펀드결성.분야 이름) / match(우리포폴의 분야) / newFunds(value 없음).

JSON으로만:
{"fundPlays": [펀드별_LP에서GP로의 모든 펀드(결성 완료 → GP 선정 → 출자 공고 순) {
   "fund": 펀드 이름(사실 묶음의 '펀드' 값 글자 그대로),
   "what": 무엇을 위한 펀드인지 한 줄(분야·성격, 블라인드면 블라인드라고, 정책·공제회 자금이면 그 성격까지),
   "position": 이 펀드 결성으로 스파크랩이 취할 포지션 1~2문장(우리 포폴 다음 라운드 소개처인지, 분야가 안 맞으면 어떻게 접근할지, 공동투자·출자 가능성 등),
   "targets": [이 펀드 GP에 먼저 소개할 우리 포폴 이름 0~5개 — '분야맞는우리포폴'에 있는 이름만, 괄호 앞 회사명 그대로],
   "action": 이번 주 바로 할 일 한 줄(누구에게 무엇을)}],
 "summary": [3줄 — 지금 돈이 어디서 어디로 움직이고 우리에게 무슨 의미인지. 뉴스 근거가 있으면 [n]],
 "summaryLinks": [summary와 같은 순서·개수 {"kind","value"}],
 "insights": [2~3개 {"title", "detail", "link"}] — 연관성·어긋남(예: 펀드 분야와 우리 포폴 분포의 어긋남, 특정 LP 재원의 쏠림)}`;

function cleanLink(l: any, allowed: Awaited<ReturnType<typeof buildFacts>>['allowed']): InsightLink | undefined {
  if (!l || typeof l.kind !== 'string') return undefined;
  if (l.kind === 'newFunds') return { kind: 'newFunds' };
  const set = (allowed as any)[l.kind] as Set<string> | undefined;
  return set && typeof l.value === 'string' && set.has(l.value) ? { kind: l.kind, value: l.value } : undefined;
}

export async function computeAndStoreDealInsight(): Promise<DealInsight | null> {
  const { facts, allowed, sources, fundTargets, basis } = await buildFacts();
  if (basis.deals + basis.funds === 0) return null;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  const client = new Anthropic();
  // 생각(thinking)까지 출력 토큰으로 나가므로 넉넉히 + 스트리밍(긴 응답 타임아웃 방지).
  // 안전 분류기가 거절하면 서버가 다른 모델로 이어 받게 한다(fallbacks: default).
  const msg = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: `${PROMPT}\n\n반드시 JSON 객체 하나만 출력한다(코드블록·설명 없이).`,
    messages: [{ role: 'user', content: `사실 묶음:\n${JSON.stringify(facts)}` }],
  } as any).finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('모델이 분석을 거절했습니다.');
  if (msg.stop_reason === 'max_tokens') throw new Error('응답이 길이 제한에 걸려 잘렸습니다.');
  const text = msg.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
  const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}');
  const str = (v: any, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const insight: DealInsight = {
    summary: (Array.isArray(out.summary) ? out.summary : []).map((s: any) => str(s, 240)).filter(Boolean).slice(0, 3),
    summaryLinks: (Array.isArray(out.summaryLinks) ? out.summaryLinks : []).slice(0, 3).map((l: any) => cleanLink(l, allowed) ?? null),
    insights: (Array.isArray(out.insights) ? out.insights : []).slice(0, 4)
      .map((x: any) => ({ title: str(x?.title, 120), detail: str(x?.detail, 300), link: cleanLink(x?.link, allowed) })).filter((x: any) => x.title),
    // 펀드 이름이 실제 펀드와 같을 때만, 소개 대상은 그 펀드 분야에 맞는 우리 포폴일 때만 남긴다.
    fundPlays: (Array.isArray(out.fundPlays) ? out.fundPlays : []).slice(0, 12)
      .filter((x: any) => typeof x?.fund === 'string' && fundTargets.has(x.fund))
      .map((x: any) => ({ fund: x.fund, what: str(x?.what, 200), position: str(x?.position, 400), action: str(x?.action, 200),
        targets: (Array.isArray(x?.targets) ? x.targets : []).map(String).filter((n: string) => fundTargets.get(x.fund)!.includes(n)).slice(0, 5) })),
    basis,
  };
  // 본문에 실제로 인용된 기사만 남긴다(요약 문장 안의 [n] + why.sources).
  const cited = new Set<number>();
  for (const line of [...insight.summary, ...insight.insights.map(i => i.detail)]) for (const m of line.matchAll(/\[(\d+)\]/g)) cited.add(Number(m[1]));
  insight.sources = sources.filter(s => cited.has(s.n));
  if (!insight.summary.length) return null;
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND, key: KEY } },
    create: { kind: KIND, key: KEY, value: JSON.stringify(insight) },
    update: { value: JSON.stringify(insight), computedAt: new Date() },
  });
  return insight;
}

export async function getDealInsight(_opts: { liveIfStale?: boolean } = {}): Promise<{ insight: DealInsight; computedAt: Date } | null> {
  const row = await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: KIND, key: KEY } } });
  let parsed: { insight: DealInsight; computedAt: Date } | null = null;
  if (row) try { parsed = { insight: JSON.parse(row.value), computedAt: row.computedAt }; } catch { parsed = null; }
  return parsed;
}
