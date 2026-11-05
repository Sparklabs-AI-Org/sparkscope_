/**
 * 데일리 브리핑 추천 헤드라인 5개 + 검수 화면의 교체 후보 목록.
 *
 * 추천은 항상 5개, 칸 수를 정해 두고 칸마다 AI가 가장 중요한 기사를 고른다(2026-10-02 소윤 결정):
 *   데일리·위클리 모두  AI 트렌드 2칸 고정(해외 우선) + 나머지 3칸 스파크랩(최대 1) → 포트폴리오
 *   (2026-10-06: 위클리도 데일리와 같은 칸, AI는 해외 우선 — 국내는 해외에서도 다룰 만큼 클 때만)
 * 칸 계산은 quotas(), 선정은 rankWithAI().
 *
 * 바이오는 추천에도 교체 후보에도 넣지 않는다.
 *
 * 수집 1회당 한 번 계산해 DashboardInsight(briefing_reco)에 저장한다 — AI 선정은 부를 때마다
 * 조금씩 다를 수 있고 AI 트렌드 목록도 2시간마다 바뀌므로, 매번 새로 계산하면 "화면에선 A였는데
 * 영상엔 B"가 된다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { buildClusteredPool, isAchievement } from './digest';
import { loadDigestCandidates, buildReviewDigest } from './review';
import { attachInterDigest } from './inter-digest';
import { attachAiSignals } from './signal-digest';
import type { AnalyzedArticle, DigestData } from './types';
import { buildSignalFeed } from './signal-feed';
import { ensureArticleKo } from './translate-content';
import { isBlockedNoise } from './relevance';
import { loadProgramNews } from './program-news';
import { loadAiNews } from './ai-news';
import { BRIEFING_COUNT, broadcastFor, kstDateKey, type BriefingHeadline, type BroadcastWindow, type BriefingProgram } from './briefing';

const KIND_RECO = 'briefing_reco';
const RANK_MODEL = 'gpt-4.1';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
/** 교체 후보 중 해외 기사 창 — 검수 화면 후보와 같은 7일 */
const PICKER_WINDOW_DAYS = 7;

const CATEGORY_LABEL: Record<string, string> = {
  sparklabs_self: '🏢 스파크랩 뉴스',
  portfolio_company: '💼 포트폴리오사',
  portfolio_company_tw: '💼 포트폴리오사 · 대만',
  portfolio_company_gv: '💼 포트폴리오사 · 글로벌',
  competitor: '🤝 AC·VC 업계 동향',
  industry_trend: '🌐 스타트업계 뉴스',
  policy_support: '🏛️ 정책·지원사업',
};
const IMPORTANCE_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const TREND_LABEL = '📈 이번 주 AI 트렌드';
const ALUMNI_LABEL = '🎓 알럼나이';
const AI_LABEL = '🤖 AI 소식';
const PROGRAM_LABEL = '🤝 운영 사업·참여기업';
const INDUSTRY_LABEL = '🌐 스타트업 업계 동향';
/** 다른 AC·VC 기사 중 브리핑에 실을 만한 공개 사건(2026-11-02 대표님 — 운영사 선정·탈락 같은 경쟁 소식을 추적). 칸 이름은 「업계 동향」. */
const COMPETITOR_EVENT = /선정|최종|운영사|주관기관|탈락|데모데이|펀드|출자|협약|MOU/i;
/**
 * 주가 시황 기사 — 추천에서만 뺀다(교체 후보에는 남긴다). 분석이 이런 기사에도 HIGH를 줘서,
 * 같은 사건 묶음의 대표로 "스카이랩스 주가 2.51% 하락"이 "타임 헬스테크 500 선정" 대신 뽑혔다
 * (2026-09-28). 묶기 전에 빼야 진짜 뉴스가 대표가 된다.
 */
// "상장 초기 16.98% 하락"처럼 등락률만 다룬 기사도(2026-10-01 위클리 시험에서 포트폴리오 칸에 뽑힘).
const STOCK_TICKER = /주가|특징주|급등락|상한가|하한가|장중|시황|[‘'"]上[’'"]|[‘'"]下[’'"]|\d+(\.\d+)?%\s*(하락|상승|급락|급등)/;
/**
 * 업계 칸(스타트업계·국내 AI)에 올리기엔 약한 기사 — 2026-10-02 데일리 5번에 "안광현 경기대 산학협력부총장
 * 취임"이 스타트업계 소식으로 나갔다(소윤: 오탐).
 *  - 인사·동정(취임·선임·임명·부고): 업계 흐름이 아니라 개인 소식
 *  - 요약이 "○○ 관련 — 매체" 기본 문구: AI가 내용을 못 읽어 대본 재료가 없는 기사
 * 스파크랩·포트폴리오 칸에는 적용하지 않는다 — 우리 회사 대표 선임은 중요한 소식이다.
 */
const PERSONNEL = /취임|선임|임명|신임\s|부임|인사\]|\[인사|동정|부고|별세|영입/;
function weakForBriefing(a: { title: string; oneLiner?: string | null }): boolean {
  return PERSONNEL.test(a.title) || /관련\s*[—-]\s*\S+\s*$/.test(a.oneLiner ?? '');
}
const INTER_LABEL = '🔭 해외 트렌드 · AI';

/** 교체 후보 한 줄 — 헤드라인 + 화면에 보여줄 보조 정보 */
export interface BriefingCandidate extends BriefingHeadline {
  pubDate: string;
  /** 국내: CRITICAL/HIGH/MEDIUM/LOW. 해외·트렌드는 없음 */
  importance?: string;
  /** 해외: 연결된 포트폴리오사 수 */
  matchCount?: number;
}

export interface BriefingRecommendation {
  headlines: BriefingHeadline[];
  program?: BriefingProgram;
  /** 'quota' — 칸 수 + 칸별 AI 선정(9/30~). 'rule'·'ai'는 예전 방식으로 만든 캐시 */
  method: 'ai' | 'rule' | 'quota';
  /** 헤드라인마다 어느 칸(1 스파크랩·2 포트폴리오·3 AI 국내·4 AI 글로벌·5 스타트업계)인지 — headlines와 같은 순서 */
  tiers?: number[];
  /** 이 추천의 근거가 된 수집 완료 시각(ISO) — 바뀌면 다시 계산한다 */
  basis: string;
  computedAt: string;
}

type IntraCandidate = BriefingCandidate & { category: string; company: string };

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** 교체 후보(국내) — 검수 화면 후보 전체, 묶지 않고 중요도 순. 묶으면 대표 1건만 남아 원하는 매체 기사를 못 고른다. */
async function loadIntraPicker(): Promise<IntraCandidate[]> {
  const all = await loadDigestCandidates();
  return [...all]
    .sort((a, b) =>
      (IMPORTANCE_RANK[b.importance] ?? 0) - (IMPORTANCE_RANK[a.importance] ?? 0)
      || b.priorityScore - a.priorityScore)
    .map(a => ({
      kind: 'intra' as const,
      ref: a.id,
      title: a.title,
      summary: a.oneLiner || a.title,
      source: a.source,
      url: a.link,
      label: CATEGORY_LABEL[a.category] ?? a.category,
      pubDate: new Date(a.pubDate).toISOString(),
      importance: a.importance,
      category: a.category,
      company: a.matchedKeyword,
    }));
}

/** 해외 후보 — 관련 판정된 Inter 기사 중 AI만(바이오 제외). 포트폴리오 연결이 많은 것 → 최신 순. */
async function loadInter(windowDays: number): Promise<BriefingCandidate[]> {
  const rows = await prisma.interNewsVerdict.findMany({
    where: { relevant: true, domain: 'ai', news: { publishedAt: { gte: daysAgo(windowDays) } } },
    select: {
      titleKo: true, reason: true,
      news: { select: { title: true, url: true, source: true, publishedAt: true } },
      _count: { select: { matches: true } },
    },
  });
  const seen = new Set<string>();
  return rows
    .filter(r => (seen.has(r.news.url) ? false : (seen.add(r.news.url), true)))
    .sort((a, b) => b._count.matches - a._count.matches
      || b.news.publishedAt.getTime() - a.news.publishedAt.getTime())
    .map(r => ({
      kind: 'inter' as const,
      ref: r.news.url,
      title: r.titleKo || r.news.title,
      summary: r.reason,
      source: r.news.source,
      url: r.news.url,
      label: INTER_LABEL,
      pubDate: r.news.publishedAt.toISOString(),
      matchCount: r._count.matches,
    }));
}

/** 이번 주 AI 트렌드 — 메일의 AI 트렌드 TOP 5와 같은 목록(사전계산을 읽으므로 빠르다). */
async function loadTrends(): Promise<BriefingCandidate[]> {
  const feed = await buildSignalFeed('ai');
  return feed.items.map(it => ({
    kind: 'trend' as const,
    ref: it.url,
    title: it.titleKo || it.title,
    summary: it.summaryKo || it.title,
    source: it.source,
    url: it.url,
    label: TREND_LABEL,
    pubDate: it.publishedAt ?? feed.generatedAt,
  }));
}

/** 화면·저장용 헤드라인만 남긴다(보조 정보 제거). */
export function toHeadline(c: BriefingCandidate & Partial<IntraCandidate>): BriefingHeadline {
  const { pubDate: _p, importance: _i, matchCount: _m, category: _c, company: _k, ...h } = c;
  // 포트폴리오·알럼나이 기사는 회사명을 넘긴다 — 대본이 그 회사를 주어로 쓴다(script.ts).
  return _k && /포트폴리오|알럼나이/.test(c.label) ? { ...h, companies: [_k] } : h;
}
function toCandidate(c: IntraCandidate): BriefingCandidate {
  const { category: _c, company: _k, ...rest } = c;
  return rest;
}

/** 검수 화면 교체 후보 전체. 국내(7일) → AI 트렌드 → 해외 AI(7일). 바이오는 없다. */
export async function loadBriefingCandidates(): Promise<BriefingCandidate[]> {
  const [intra, trends, inter] = await Promise.all([
    loadIntraPicker(),
    loadTrends().catch(() => [] as BriefingCandidate[]),
    loadInter(PICKER_WINDOW_DAYS),
  ]);
  return [...intra.map(toCandidate), ...trends, ...inter];
}

async function currentBasis(): Promise<string> {
  const last = await prisma.runLog.findFirst({
    where: { runType: 'daily-collect', status: 'SUCCESS', finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return last?.finishedAt?.toISOString() ?? 'none';
}

/**
 * 최근 7일 동안 이미 브리핑에 나간 기사 url — 발송 때 저장된 스냅샷(daily_briefing)에서 읽는다.
 * 포트폴리오를 7일까지 넓혀 찾으므로, 이게 없으면 수요일에 나간 기사가 금·월에 또 나간다.
 * 오늘 스냅샷은 빼고 본다(오늘 재발송·재계산 때 자기 자신을 지우지 않게).
 */
/**
 * 같은 기사라도 주소가 바뀌어 들어온다 — 구글 뉴스 중계 주소였다가 원문 주소로 풀리거나, 같은 보도를
 * 다른 매체가 옮겨 싣는다(2026-10-01: 9/30 브리핑의 스카이랩스·국대 AI 기사가 주소만 바뀌어 다시 추천됨).
 * 그래서 주소와 함께 제목(공백·기호·" - 매체" 제거)으로도 맞춘다.
 */
export function titleKey(title: string): string {
  return title.replace(/\s+-\s+[^-]+$/, '').replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase();
}

interface Briefed {
  has(url: string, title?: string): boolean;
  /** 최근 7일 브리핑에 나간 기사 제목 — 같은 사건 비교용 */
  titles: string[];
}

async function recentlyBriefed(): Promise<Briefed> {
  const urls = await recentlyBriefedUrls();
  return {
    has: (url, title) => urls.urls.has(url) || (!!title && urls.titles.has(titleKey(title))),
    titles: urls.list,
  };
}

async function recentlyBriefedUrls(): Promise<{ urls: Set<string>; titles: Set<string>; list: string[] }> {
  const today = kstDateKey();
  const keys = Array.from({ length: 7 }, (_, i) => kstDateKey(new Date(Date.now() - (i + 1) * 864e5)));
  const rows = await prisma.dashboardInsight.findMany({
    where: { kind: 'daily_briefing', key: { in: keys.filter(k => k !== today) } },
    select: { value: true },
  });
  const urls = new Set<string>();
  const titles = new Set<string>();
  const list: string[] = [];
  for (const r of rows) {
    try {
      for (const h of (JSON.parse(r.value).headlines ?? [])) { urls.add(h.url); titles.add(titleKey(h.title ?? '')); if (h.title) list.push(h.title); }
    } catch { /* 깨진 행은 무시 */ }
  }
  titles.delete('');
  return { urls, titles, list: [...new Set(list)] };
}

/**
 * 다이제스트에 실린 기사만 재료로 쓴다(2026-09-28 소윤 결정 — "다이제스트에 나온 것 중 뽑는다,
 * 기간도 다이제스트를 그대로 따라간다"). 예전엔 여기서 3일·7일 창을 따로 잘라서, 다이제스트에
 * 버젓이 실린 스파크랩 기사 3건(9/21~22)이 추천에서는 빠졌다.
 * 검수 화면 미리보기와 같은 조립(review.ts buildReviewDigest)을 쓴다 — 편집자가 보는 메일이 기준.
 */
/** 데일리는 메일과 같은 수집 시각 창(review.ts sendArticleWindow), 위클리는 발행 시각 창. */
function digestWindow(w: BroadcastWindow) {
  return { since: w.since, until: w.until, byCollected: w.program === 'daily' };
}

async function buildDigestForBriefing(w: BroadcastWindow): Promise<DigestData> {
  const candidates = await loadDigestCandidates(digestWindow(w));
  return attachAiSignals(await attachInterDigest(buildReviewDigest(candidates)));
}

function fromArticle(a: AnalyzedArticle & { id?: string }, idByLink: Map<string, string>): IntraCandidate {
  // 구글 뉴스 경유 기사는 제목 끝에 " - 조선비즈" 같은 매체명이 붙어 온다 — 화면·낭독에서 뗀다.
  const title = a.title.replace(/\s+-\s+[^-]{1,20}$/, '').trim() || a.title;
  return {
    kind: 'intra',
    ref: idByLink.get(a.link) ?? a.id ?? a.link,
    title,
    summary: a.oneLiner || a.title,
    source: a.source,
    url: a.link,
    label: CATEGORY_LABEL[a.category] ?? a.category,
    pubDate: new Date(a.pubDate).toISOString(),
    importance: a.importance,
    category: a.category,
    company: a.matchedKeyword,
  };
}

/** 제목에 한글이 있는가 — 영문 기사(같은 사건의 영문판)를 국내 단계에서 거르는 용도 */
const isKorean = (t: string) => /[가-힣]/.test(t);

/** 국내 AI 기업·업계 기사를 가려내는 1차 필터(최종 판단은 AI가 한다). */
const AI_TOPIC = /AI|인공지능|생성형|LLM|GPT|에이전트|챗봇|딥러닝|머신러닝|파운데이션 ?모델|NPU|AI반도체|거대언어/i;

/** 추천 칸 종류 — 화면의 "추천①~⑤"가 이 순서다. */
export const SLOT_LABEL: Record<number, string> = {
  1: '스파크랩', 2: '국내 포트폴리오', 3: '알럼나이', 4: '글로벌 포트폴리오', 5: '운영 사업', 6: '업계 동향', 7: '정책·지원사업', 8: 'AI·글로벌',
};

type Group = 'S' | 'P' | 'E' | 'D' | 'R' | 'T' | 'Y' | 'G';
const GROUP_TIER: Record<Group, number> = { S: 1, P: 2, E: 3, D: 4, R: 5, T: 6, Y: 7, G: 8 };
const GROUP_NAME: Record<Group, string> = {
  S: '스파크랩 자사 소식', P: '국내 포트폴리오사 소식', E: '알럼나이(엑싯한 포트폴리오사) 소식', D: '글로벌 포트폴리오사 소식(대만·미국 등 스파크랩코리아 외 그룹 해외 포트폴리오)',
  R: '스파크랩이 운영하는 사업과 참여기업 소식', T: '스타트업 업계 동향(투자·펀드, AC·VC 소식)', Y: '정부·지자체 지원사업 공고·정책', G: '글로벌 AI 기업·업계 소식',
};

/**
 * 칸 수 — 데일리 12개(2026-11-04 은빛 결정: 0 스파크랩 → 1 국내 포폴 → 2 알럼나이 → 3 글로벌 포폴(스파크랩코리아 외 그룹 해외 포트폴리오 전체) → 4 운영 사업 →
 * 5 스타트업 업계 동향(T·Y) → 6 AI·글로벌). 위쪽 칸부터 채우고, 맨 아래 AI·글로벌은 소식이 있으면 2칸을 남긴다.
 * 칸마다 상한을 지키고, 남는 칸을 다른 칸에 나눠 주지 않는다 — 소식이 적은 날은 짧게 간다(2026-11-05 은빛).
 */
/** AI가 고른 기사만 싣는 칸 */
const AI_ONLY: Group[] = ['D', 'R', 'T', 'Y', 'G'];
const SLOT_CAPS: [Group, number][] = [['S', 2], ['P', 3], ['E', 2], ['D', 3], ['R', 2], ['T', 2], ['Y', 2]];
function quotas(avail: Record<Group, number>, total: number): Record<Group, number> {
  const q: Record<Group, number> = { S: 0, P: 0, E: 0, D: 0, R: 0, T: 0, Y: 0, G: 0 };
  q.G = Math.min(4, avail.G);
  let room = total - q.G;
  for (const [g, cap] of SLOT_CAPS) { q[g] = Math.min(cap, avail[g], room); room -= q[g]; }
  q.G += Math.min(room, 1, avail.G - q.G);
  return q;
}

const RANK_SYSTEM = `당신은 스파크랩(한국의 스타트업 액셀러레이터·VC)의 아침 브리핑 편집자입니다.
임직원이 출근길에 들을 헤드라인을 고릅니다. 그룹마다 정해진 개수만큼, 그 그룹 안에서 가장 중요한 기사를 고르세요.

중요도 기준
- 스파크랩·포트폴리오사에 직접 영향을 주는 사건 > 업계 전반에 큰 사건 > 일반 소식.
- 투자 유치·인수합병·상장·대형 계약·신제품 출시·규제 변화처럼 "사건"이 있는 기사를 우선합니다.
- 주가 등락·행사 스케치·인터뷰·칼럼은 뒤로 미룹니다. 기자 체험기("~해 보았다")·해설 기획("~하는 이유")·후원 콘텐츠는 고르지 마세요.
- 같은 사건을 다룬 기사는 그룹이 달라도 하나만 고릅니다(국내 기사와 해외 기사가 같은 사건일 수 있음).
- "AI" 그룹은 네 가지를 고릅니다.
  ① 판도 변화: 10억 달러급 라운드·M&A·IPO, 빅테크 AI 투자가 실적·주가에 준 영향, 인프라·전력·공급망의 병목.
  ② 정치·규제: 선거·행정명령·규제가 AI 산업과 시장에 주는 영향. 이 때문에 증시·반도체가 크게 움직였다면 주가 기사여도 고릅니다.
  ③ 조직의 AI 전환: 대기업·그룹이 임직원 교육, 해커톤, 사내 플랫폼으로 일하는 방식을 바꾸는 사례.
  ④ 일의 변화: 직원이 AI로 직접 해내는 업무의 변화, AI 활용의 위험과 한계, AI 인력 시장, 에이전트 같은 새 업무 도구의 흐름.
  단순 기능 업데이트, 소규모 기업의 도입 홍보, 빅테크의 작은 스타트업 인수, 잘 알려지지 않은 회사 소식, 평범한 시황은 고르지 마세요. AI타임스·IT조선 기사를 우선합니다. 해외 AI 소식이 원칙입니다(OpenAI·Anthropic·구글·메타·엔비디아 등). [국내] 표시 기사는
  "삼성이 Anthropic에 투자"처럼 해외 주요 매체도 크게 다룰 사건일 때만, 그것도 최대 1건입니다. 국내 기업의 제품 출시·행사·
  협약·전시회 소식은 고르지 마세요.
- "스타트업 업계 동향" 그룹은 업계 전반에 영향을 주는 소식만 고릅니다 — 중소벤처기업부·금융위 등 정부 정책과 예산, 모태펀드·대형 펀드 결성,
  벤처투자 시장 통계, 규제 변화, AC·VC가 정부 사업 운영사에 선정된 소식, 업계를 이끄는 큰 회사의 결정적 사건.
  단일 스타트업의 투자 유치·창업·제품 소식, 유명인의 창업 소식은 고르지 마세요. 맞는 기사가 없으면 빈 배열로 두세요.

- "정책·지원사업" 그룹에서 해외 사례 소개·기획 기사는 고르지 마세요. 스타트업이 지원할 수 있는 정부·지자체 지원사업 공고를 먼저 고르세요 — 데모데이의 주간 창업공고·
  인기 지원사업 정리 글이 1순위입니다. 그다음이 지원 정책 변화·모태펀드 출자 같은 소식입니다. 칼럼·인터뷰·행사 스케치는 고르지 마세요.

- "글로벌 포트폴리오사" 그룹은 스파크랩코리아 외 그룹 해외 포트폴리오사(대만·미국 등) 소식입니다. [회사: …]가 기사의 실제 주인공일 때만 고르세요. 주가·매출 조회 페이지, 회사명만 우연히 겹친 기사(날씨·일반 명사 등)는 고르지 마세요.

- "알럼나이" 그룹은 엑싯한 포트폴리오사 소식입니다. 주가 기사와 회사명만 겹친 기사는 고르지 마세요.

- "스파크랩이 운영하는 사업과 참여기업" 그룹은 [회사: …]에 적힌 사업이나 참여기업이 기사의 실제 주인공일 때만 고르세요. 이름만 겹친 기사,
  같은 이름의 다른 회사 기사는 고르지 마세요. 맞는 기사가 없으면 빈 배열로 두어도 됩니다.

- "스타트업 업계 동향" 그룹에는 다른 AC·VC 소식도 있습니다. 어느 AC·VC가 정부 사업 운영사·주관기관에 선정됐는지, 펀드를 만들었는지처럼
  공개 기사로 확인되는 사건을 고르세요.

JSON으로만 답하세요: {"picks": {"S": ["S0"], "P": ["P2","P0"], "E": ["E0"], "D": ["D1"], "R": ["R0"], "T": ["T3"], "Y": ["Y1"], "G": ["G0"]}}
요청한 개수는 최대치입니다. 기준에 맞는 기사만 고르고, 없으면 줄여도 됩니다. 요청하지 않은 그룹은 빈 배열로 두세요.`;

async function rankWithAI(
  pools: Record<Group, BriefingCandidate[]>, q: Record<Group, number>, aiEither: boolean,
): Promise<Record<Group, BriefingCandidate[]> | null> {
  const lines: string[] = [];
  (Object.keys(pools) as Group[]).forEach(g => {
    if (q[g] === 0) return;
    lines.push(`\n## ${GROUP_NAME[g]} — ${aiEither && (g === 'D' || g === 'G') ? '국내·글로벌 AI 합쳐 1개' : `${q[g]}개`}`);
    pools[g].forEach((c, i) => lines.push(`${g}${i}. ${c.label.includes('국내') ? '[국내] ' : ''}${(g === 'D' || g === 'R') && (c as Partial<IntraCandidate>).company ? `[회사: ${(c as Partial<IntraCandidate>).company}] ` : ''}${c.title} — ${c.summary}${c.importance ? ` [${c.importance}]` : ''}`));
  });
  const resp = await openai.chat.completions.create({
    model: RANK_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: RANK_SYSTEM }, { role: 'user', content: lines.join('\n') }],
  });
  const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as { picks?: Partial<Record<Group, string[]>> };
  if (!parsed.picks) return null;
  const out = { S: [], P: [], E: [], D: [], R: [], T: [], Y: [], G: [] } as Record<Group, BriefingCandidate[]>;
  (Object.keys(out) as Group[]).forEach(g => {
    for (const id of parsed.picks?.[g] ?? []) {
      const c = pools[g][Number(String(id).replace(/^\D+/, ''))];
      if (c && !out[g].includes(c)) out[g].push(c);
    }
  });
  return out;
}

/**
 * 해외 AI 칸 규칙(2026-10-29 소윤) — "VC·금융 쪽 사람이 오늘 점심 자리에서 숫자와 함께 꺼낼 수 있는 이야기인가".
 * 남기는 것: ① AI 쪽 돈의 흐름(1억 달러 이상 라운드·기업가치·M&A·IPO·대형 펀드) ② 빅테크 AI 투자가 실적·주가에 준 영향
 * ③ 경쟁 구도 변화(가격 경쟁·수익 모델·대형 계약·판도 바꾸는 제휴) ④ 인프라·공급망(칩·데이터센터·전력 대형 계약·공급 부족)
 * ⑤ 규제·지정학(규제·수출 통제·반독점) ⑥ 글로벌 VC 움직임(주요 투자사 AI 펀드·테제·대형 베팅).
 * 모델 출시는 선두 연구소의 대표 모델이거나 가격·성능이 시장 구도를 바꿀 때만.
 * 빼는 것: 보도자료성 제품·기능 출시, 개별 기업 도입 사례(대형 계약 제외), 해설·기획·체험기·칼럼·후원 콘텐츠, 숫자 없는 트렌드 기사.
 * 남길 번호 집합을 돌려준다. 실패하면 전부 남긴다(선정은 그대로).
 */
const FINANCE_RULES = `AI를 업무에 활발히 쓰는 VC·액셀러레이터 임직원이 아침 브리핑에서 들을 AI 뉴스를 고릅니다.
기준 질문: "그래서 누가 돈을 벌고 누가 잃나"로 이어지거나, "내가 AI로 일하는 방식에 도움이 되는가".

남길 것
1. AI 쪽 돈의 흐름: 10억 달러급 투자 라운드, 업계 선두 회사의 기업가치 변화, 판도를 바꾸는 대형 인수합병, IPO·상장 준비, 대형 펀드 결성
2. 빅테크 AI 투자가 실적·주가에 준 영향: 설비투자 규모, 현금 소진, 실적·가이던스, 주가 반응
3. 경쟁 구도 변화: 가격 인하 경쟁, 수익 모델 변화, 수억 달러 이상 고객 계약, 판도를 바꾸는 제휴
4. 인프라·공급망: 칩·데이터센터·전력의 대규모 계약, 공급 부족, 가격 변동
5. 규제·지정학: 미국·EU·중국 AI 규제, 반도체 수출 통제, 반독점 조사
6. 글로벌 VC 움직임: 주요 투자사(a16z·세쿼이아·소프트뱅크 등)의 AI 펀드·투자 테제·대형 베팅
7. 일의 변화: 직원이 AI로 직접 해내는 업무, AI 활용의 위험과 한계(판단력 약화·보안), AI 인력 시장, 에이전트 같은 새 업무 도구의 흐름
8. 정치·선거·행정명령이 AI 산업과 시장에 주는 영향(이 때문에 증시·반도체가 크게 움직인 기사 포함)
9. 대기업·그룹의 AI 전환: 임직원 교육, 해커톤, 사내 플랫폼, 공정 자동화처럼 조직 전체가 일하는 방식을 바꾸는 사례
- 모델 출시는 OpenAI·앤스로픽·구글·메타·xAI 등 선두 연구소의 대표 모델이거나, 가격·성능이 시장 구도를 바꿀 때만
  (오픈소스가 상용 모델을 따라잡음, 가격이 절반 이하 등)

뺄 것
- 보도자료성 제품·기능 출시, 일반 모델·특화 모델 공개, 연구 데모, 벤치마크 자랑
- 소규모 기업의 AI 도입 홍보(9번의 대기업·그룹 차원 전환은 남긴다)
- 해설·기획("~하는 이유", "~할 때 일어나는 일"), 기자 체험기, 칼럼·의견, 인터뷰, 기업 후원·제휴 콘텐츠
- 7~9번에 해당하지 않는, 금액·기업가치·점유율 같은 숫자가 없는 트렌드 기사
- 빅테크의 작은 스타트업 인수, 일반인이 모르는 회사 소식, 특정 회사가 낸 분석·리포트 소개(2026-11-05 은빛: "임직원이 알아서 뭐하나")`;

async function financeRelevant(items: BriefingCandidate[]): Promise<Set<number>> {
  const all = new Set(items.map((_, i) => i));
  if (items.length === 0) return all;
  try {
    const resp = await openai.chat.completions.create({
      model: RANK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${FINANCE_RULES}\n\n위 기준을 통과하는 후보의 번호만 고르세요. 애매하면 빼세요. JSON으로만: {"keep":[번호,...]}` },
        { role: 'user', content: items.map((c, i) => `${i}. [${c.source}] ${c.title} — ${c.summary}`).join('\n') },
      ],
    });
    const keep = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').keep ?? []) as number[];
    return new Set(keep.filter(n => Number.isInteger(n) && n >= 0 && n < items.length));
  } catch (e) {
    console.warn('[briefing-reco] 금융 관련성 판정 실패(전부 남김):', e);
    return all;
  }
}

/** 본문을 읽을 수 있는 판 — 원래 기사가 되면 그대로, 아니면 같은 사건 다른 매체 기사로 바꾼 것, 둘 다 안 되면 null. */
async function readableVersion(c: BriefingCandidate): Promise<BriefingCandidate | null> {
  const { articleExcerpt } = await import('../briefing-video/article-text');
  // 해외 기사는 원문 제목으로 대조한다 — 한국어 번역 제목을 주면 영문 본문과 낱말이 안 겹쳐 맞는 본문도 버린다(script.ts와 같은 이유).
  const original = (await prisma.interNews.findUnique({ where: { url: c.url }, select: { title: true } }).catch(() => null))?.title
    ?? (/[가-힣]/.test(c.title) && c.kind !== 'intra' ? '' : c.title);
  if ((await articleExcerpt(c.url, original).catch(() => '')).length >= 150) return c;
  for (const alt of await sameEventElsewhere(c)) {
    const url = alt.url;
    if ((await articleExcerpt(url).catch(() => '')).length >= 150) {
      console.log(`[briefing-reco] 페이월 대체: ${c.source} → ${alt.source} (${c.title.slice(0, 30)})`);
      return { ...c, url, ref: c.kind === 'intra' ? c.ref : url, source: alt.source };
    }
  }
  return null;
}

/**
 * 같은 사건을 다룬 다른 매체 기사 — 빙 뉴스 검색 결과에서 AI가 고른다. 제목 낱말 겹침으로는 못 찾는다
 * (FT "Google shares tumble…" ↔ 로이터 "Alphabet stock sinks…" — 같은 사건인데 낱말이 다르다, 2026-10-29).
 */
async function sameEventElsewhere(c: BriefingCandidate): Promise<{ source: string; url: string }[]> {
  try {
    // 해외 트렌드 카드는 제목이 한국어 번역이라 원문 제목으로 찾는다.
    const original = (await prisma.interNews.findUnique({ where: { url: c.url }, select: { title: true } }).catch(() => null))?.title ?? c.title;
    // 제목 그대로 검색하면 그 매체 글만 나온다 — 짧은 영문 검색어(다른 표기 포함)를 만든다(FT 'Google shares tumble…' → 'Alphabet shares fall AI spending cash burn').
    const qResp = await openai.chat.completions.create({
      model: RANK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '뉴스 제목을 보고 같은 사건을 다룬 다른 매체 기사를 찾을 영어 검색어를 4~6단어로 만드세요. 회사는 다른 매체가 쓸 법한 이름(예: Google 실적이면 Alphabet)으로, 숫자·인용·수식어는 빼고 사건의 핵심 낱말만. JSON으로만: {"q":"..."}' },
        { role: 'user', content: original },
      ],
    });
    const short = String(JSON.parse(qResp.choices[0]?.message?.content ?? '{}').q ?? '').trim();
    // 구글 뉴스 검색은 찾긴 하지만 링크가 중계 주소라 실제 기사로 못 푼다(resolveGoogleNewsUrl이 null, 2026-10-29) —
    // 빙 뉴스 RSS는 링크 안에 실제 주소(url=)를 담아 준다.
    const q = (short || original).replace(/["'`“”‘’]/g, ' ').slice(0, 110);
    const res = await fetch('https://www.bing.com/news/search?' + new URLSearchParams({ q, format: 'rss' }), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparkScope/1.0)' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const decode = (t: string) => t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const hits = (xml.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, 10).map(b => {
      const link = decode(b.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
      const url = (() => { try { return new URL(link).searchParams.get('url') ?? link; } catch { return ''; } })();
      const source = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      return { title: decode(b.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''), source, url };
    }).filter(h => h.url && h.source && !c.url.includes(h.source));
    if (hits.length === 0) return [];
    const resp = await openai.chat.completions.create({
      model: RANK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '[기준 기사]와 같은 사건(같은 발표·실적·거래)을 다룬 [후보] 번호를 고르세요. 회사 이름 표기가 달라도(Google/Alphabet) 같은 사건이면 고릅니다. 다른 회사·다른 사건이면 고르지 마세요. JSON으로만: {"same":[번호,...]}' },
        { role: 'user', content: `[기준 기사] ${original}\n\n[후보]\n${hits.map((h, i) => `${i}. ${h.title} (${h.source})`).join('\n')}` },
      ],
    });
    const same = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').same ?? []) as number[];
    return same.filter(n => Number.isInteger(n) && hits[n]).slice(0, 4).map(n => ({ source: hits[n]!.source, url: hits[n]!.url }));
  } catch (e) {
    console.warn('[briefing-reco] 같은 사건 다른 매체 찾기 실패:', e);
    return [];
  }
}

/**
 * 고른 기사 중 같은 사건을 다룬 것 — 앞 칸(우선순위 높은 쪽)을 남기고 뒤 칸 번호를 돌려준다. 실패하면 빈 집합(선정은 그대로).
 */
async function sameEventDuplicates(items: BriefingCandidate[]): Promise<Set<number>> {
  if (items.length < 2) return new Set();
  try {
    const resp = await openai.chat.completions.create({
      model: RANK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '뉴스 목록에서 같은 사건(같은 발표·사고·거래·발견)을 다룬 항목끼리 묶으세요. 매체·언어·표현이 달라도 같은 사건이면 같은 묶음입니다. 같은 회사의 다른 소식, 같은 주제의 다른 사건은 묶지 마세요. JSON으로만: {"groups":[[0,3],[2,5]]} — 같은 사건이 없으면 {"groups":[]}' },
        { role: 'user', content: items.map((c, i) => `${i}. ${c.title} — ${c.summary}`).join('\n') },
      ],
    });
    const groups = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').groups ?? []) as number[][];
    const drop = new Set<number>();
    for (const g of groups) {
      const ids = [...new Set(g.filter(n => Number.isInteger(n) && n >= 0 && n < items.length))].sort((a, b) => a - b);
      ids.slice(1).forEach(n => drop.add(n));
    }
    return drop;
  } catch (e) {
    console.warn('[briefing-reco] 같은 사건 확인 실패(건너뜀):', e);
    return new Set();
  }
}

/**
 * 최근 7일 브리핑에서 이미 다룬 사건 — 주소·제목이 달라도(다른 매체·후속 기사) 같은 사건이면 다시 넣지 않는다
 * (2026-10-26: 루센트블록 인가 탈락이 10/09~10/26 사이 여섯 번 다른 기사로 나감). 새 진전(새 발표·결정)이 있으면 다른 사건으로 본다.
 * 실패하면 빈 집합(선정은 그대로).
 */
async function alreadyBriefedEvents(items: BriefingCandidate[], history: string[]): Promise<Set<number>> {
  if (items.length === 0 || history.length === 0) return new Set();
  try {
    const resp = await openai.chat.completions.create({
      model: RANK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '[후보] 뉴스 중 [이미 방송한 뉴스]와 같은 사건을 다룬 것을 고르세요. 매체·언어·표현이 달라도 같은 발표·사고·거래·논란이면 같은 사건입니다. 같은 회사라도 새 발표·새 결정·새 거래처럼 새로운 진전이면 다른 사건입니다. JSON으로만: {"same":[후보 번호,...]} — 없으면 {"same":[]}' },
        { role: 'user', content: `[이미 방송한 뉴스]\n${history.map(t => `- ${t}`).join('\n')}\n\n[후보]\n${items.map((c, i) => `${i}. ${c.title} — ${c.summary}`).join('\n')}` },
      ],
    });
    const same = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').same ?? []) as number[];
    return new Set(same.filter(n => Number.isInteger(n) && n >= 0 && n < items.length));
  } catch (e) {
    console.warn('[briefing-reco] 지난 브리핑 사건 확인 실패(건너뜀):', e);
    return new Set();
  }
}

/**
 * 칸 수에 맞춰 5칸을 채운다 — 재료는 방송 기간(broadcastFor)의 다이제스트 섹션과 AI 트렌드·해외 트렌드.
 * 위클리도 "최근 7일 브리핑에 나간 기사·회사·사건 제외"를 한다(2026-10-26부터).
 */
export async function pickByTiers(w: BroadcastWindow): Promise<{ picked: BriefingCandidate[]; tiers: number[] }> {
  const [briefed, data, candidates] = await Promise.all([
    recentlyBriefed(),
    buildDigestForBriefing(w),
    loadDigestCandidates(digestWindow(w)),
  ]);
  const idByLink = new Map(candidates.map(a => [a.link, a.id]));
  // 엑싯(Exit·Written-off)한 포트폴리오사 — 기사가 많이 나오지만 우선순위를 낮춘다(대표님 피드백 2026-10).
  // 국내·해외 포폴 칸에서 빼고(성과 기사는 예외), 빈 자리는 아래 칸 규칙대로 AI·스타트업계가 채운다.
  const exitTargets = await prisma.monitoringTarget.findMany({
    where: { portfolioStatus: { in: ['Exit', 'Written-off'] } }, select: { name: true, portfolioStatus: true },
  });
  const exitNames = new Set(exitTargets.map(t => t.name));
  // 알럼나이는 엑싯까지(2026-11-04 은빛) — 사업을 접은 회사(Written-off)는 넣지 않는다.
  const alumniNames = new Set(exitTargets.filter(t => t.portfolioStatus === 'Exit').map(t => t.name));
  const notExit = (c: { company?: string; title: string }) => !c.company || !exitNames.has(c.company) || isAchievement(c.title);
  const rankOf = (a: { importance?: string | null }) => IMPORTANCE_RANK[a.importance ?? ''] ?? 0;
  const weekly = w.program === 'weekly';
  // 위클리도 최근 7일(지난주 데일리·지난 위클리) 브리핑에 나간 기사·회사는 다시 넣지 않는다(2026-10-26 소윤 결정 B —
  // 위클리가 지난주 데일리를 절반가량 그대로 다시 쓰고 매주 비슷하다는 의견). 예전엔 한 주 정리라 이 규칙을 껐다.
  const fresh = (c: BriefingCandidate) => !briefed.has(c.url, c.title);

  // 스파크랩 — 다이제스트 섹션(한국·대만·글로벌벤처스 모두). 지난 브리핑에 나간 기사는 다시 넣지 않는다
  // (2026-10-07 소윤 결정 — 화~금 매일 나가므로 중복을 무조건 막는다. 10-01의 "메일과 맞춰 다시 넣기"를 대체).
  // 같은 사건의 한·영 기사가 두 칸을 차지하지 않게 한국어 기사를 앞에 둔다(1칸만 쓴다).
  // 스파크랩 칸은 제목에 스파크랩(자사 이름·프로그램·대표)이 있는 기사만 — 본문 참여기관 목록에 한 번 나온 타 AC·VC 기사가
  // "스파크랩 뉴스"로 맨 앞에 서던 문제(2026-10-23 1번 "노틸러스인베스트먼트, … NGG 프로그램" — 본문에 "SparkLabs Taiwan 등 현지 VC").
  const selfTargets = await prisma.monitoringTarget.findMany({
    where: { category: 'sparklabs_self' }, select: { name: true, englishName: true, primaryKeyword: true, helperKeywords: true },
  });
  const squash = (t: string) => t.toLowerCase().replace(/\s+/g, '');
  const selfKeys = [...new Set(selfTargets.flatMap(t => [t.name, t.englishName, t.primaryKeyword, ...(t.helperKeywords ?? '').split(',')])
    .map(k => squash(k ?? '')).filter(k => k.length >= 2))];
  const selfInTitle = (title: string) => selfKeys.some(k => squash(title).includes(k));
  const S = [...data.sparklabsArticles]
    .sort((x, y) => Number(isKorean(y.title)) - Number(isKorean(x.title)))
    .map(a => fromArticle(a, idByLink)).filter(a => fresh(a) && selfInTitle(a.title));

  // 포트폴리오 — 다이제스트 섹션(회사당 1건). 주가 기사면 같은 회사 다른 기사로. 지난 7일 브리핑에 나간 회사 제외.
  const briefedCompanies = new Set(candidates.filter(a => briefed.has(a.link, a.title)).map(a => a.matchedKeyword));
  const byCompany = (company: string) => candidates
    .filter(c => c.matchedKeyword === company && !STOCK_TICKER.test(c.title) && isKorean(c.title))
    .sort((x, y) => rankOf(y) - rankOf(x) || y.priorityScore - x.priorityScore)[0];
  const P = data.portfolioArticles
    .map(a => (STOCK_TICKER.test(a.title) || !isKorean(a.title) ? byCompany(a.matchedKeyword) : a))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map(a => fromArticle(a, idByLink))
    .filter(a => !briefedCompanies.has(a.company) && fresh(a) && notExit(a) && !alumniNames.has(a.company))
    .sort((x, y) => rankOf(y) - rankOf(x))
    .slice(0, 8);

  // 알럼나이 — 엑싯한 국내 포트폴리오사. 회사당 1건, 중요도 순.
  const seenAlumni = new Set<string>();
  const E = candidates
    .filter(a => a.category === 'portfolio_company' && alumniNames.has(a.matchedKeyword) && !STOCK_TICKER.test(a.title) && isKorean(a.title))
    .sort((x, y) => rankOf(y) - rankOf(x) || y.priorityScore - x.priorityScore)
    .filter(a => (seenAlumni.has(a.matchedKeyword) ? false : (seenAlumni.add(a.matchedKeyword), true)))
    .map(a => ({ ...fromArticle(a, idByLink), label: ALUMNI_LABEL }))
    .filter(a => !briefedCompanies.has(a.company) && fresh(a))
    .slice(0, 8);

  // 운영 사업·참여기업(program-news.ts). 제목에 스파크랩이 있으면 맨 앞 스파크랩 칸으로 올린다.
  const programNews = (await loadProgramNews(w.since, w.until)).map(h => ({
    kind: 'intra' as const, ref: h.ref, title: h.title, summary: h.summary, source: h.source, url: h.url,
    label: PROGRAM_LABEL, pubDate: h.pubDate.toISOString(), category: 'program', company: h.about,
  })).filter(fresh);
  S.push(...programNews.filter(c => selfInTitle(c.title)).map(c => ({ ...c, label: CATEGORY_LABEL.sparklabs_self })));
  const R = programNews.filter(c => !selfInTitle(c.title)).slice(0, 20);

  // 해외 포트폴리오(대만·글로벌벤처스) — 후보 중 회사당 1건, 중요도 순. 제목은 한국어 번역(titleKo)으로 보여 준다.
  // 주가·매출 조회·투자자 목록 같은 페이지는 뺀다(2026-10-07 실측: "稜研科技(7812)營收查詢", "OpenSea - Funding Rounds & List of Investors").
  const OVERSEAS_JUNK = /營收|股市|股價|股票|Funding Rounds|List of Investors|Stock Price|Share Price/i;
  // 다이제스트 후보(우선순위 상위 500건)에 넣으면 국내 기사에 밀려 빠지고, 이름 가드도 한자 제목("耐能")에선
  // 영문 회사명을 못 찾아 떨어진다 — 그래서 따로 읽는다. 무관한 동명 기사("Rain Timecast")는 선정 AI가 거른다.
  const overseasRows = (await prisma.article.findMany({
    where: {
      category: { in: ['portfolio_company_tw', 'portfolio_company_gv'] },
      // 메일과 같은 기준(review.ts sendArticleWindow) — 이번에 수집됐고 사흘 안에 나온 기사. 발행 시각으로만 자르면
      // 해외 기사는 시차·색인 지연으로 창 앞에 걸려 거의 다 빠졌다(2026-11-05 GV 7건 수집, 브리핑 0건).
      collectedAt: { gte: w.since, ...(w.until ? { lt: w.until } : {}) },
      pubDate: { gte: new Date(w.since.getTime() - 72 * 3600e3) },
      isNoise: false, analyzedAt: { not: null },
    },
    orderBy: { priorityScore: 'desc' },
    take: 60,
  })).filter(a => !isBlockedNoise(a) && !STOCK_TICKER.test(a.title) && !OVERSEAS_JUNK.test(a.title)
    // 제목이 너무 짧으면(단어 3개 이하·한자 10자 미만) 기사 제목이 아니라 페이지 이름일 때가 많다("Rain Timecast").
    && (a.title.split(/\s+/).length > 3 || /[\u3400-\u9FFF]{10,}/.test(a.title)))
    .map(a => ({ ...a, importance: a.importance ?? 'LOW', oneLiner: a.oneLiner ?? a.title, priorityScore: a.priorityScore ?? 0 }));
  await ensureArticleKo(overseasRows, { max: 40 }).catch(e => console.warn('[briefing-reco] 해외 제목 번역 실패(원문 사용):', e));
  const seenOverseas = new Set<string>();
  const D = overseasRows
    .sort((x, y) => rankOf(y) - rankOf(x) || y.priorityScore - x.priorityScore)
    .filter(a => (seenOverseas.has(a.matchedKeyword) ? false : (seenOverseas.add(a.matchedKeyword), true)))
    .map(a => ({ ...fromArticle(a as unknown as AnalyzedArticle & { id: string }, idByLink), title: a.titleKo || a.title }))
    .filter(a => !briefedCompanies.has(a.company) && fresh(a) && notExit(a))
    .slice(0, 12);

  // 국내 AI — 72시간 후보 중 AI 주제의 국내 기사(업계·경쟁사), 같은 사건 묶고 중요도 순.
  const domesticAi = buildClusteredPool(candidates.filter(a =>
    (a.category === 'industry_trend' || a.category === 'competitor')
    && isKorean(a.title) && AI_TOPIC.test(a.title) && !STOCK_TICKER.test(a.title) && !weakForBriefing(a)));
  const DA = domesticAi
    .map(a => ({ ...fromArticle(a, idByLink), label: '🇰🇷 국내 AI' }))
    .filter(fresh)
    .sort((x, y) => rankOf(y) - rankOf(x))
    .slice(0, 8);

  // 글로벌 AI — 메일의 AI 트렌드 TOP 5 + 해외 트렌드 AI 카드
  const G: BriefingCandidate[] = [
    ...(data.aiSignals?.items ?? []).map(it => ({
      kind: 'trend' as const, ref: it.url, title: it.titleKo || it.title, summary: it.summaryKo || it.title,
      source: it.source, url: it.url, label: TREND_LABEL, pubDate: it.publishedAt ?? data.aiSignals!.generatedAt,
    })),
    ...(data.inter?.cards ?? []).filter(c => c.domainLabel === 'AI').map(c => ({
      kind: 'inter' as const, ref: c.url, title: c.title, summary: c.cellLabel, source: c.media, url: c.url,
      label: INTER_LABEL, pubDate: new Date().toISOString(), companies: c.companies.map(x => x.name),
    })),
    // 해외 AI 기사 전체(해외 트렌드 판정 통과분) — TOP 5와 카드 3장만으로는 국내 AI를 막으면 10칸이 안 찼다(2026-10-28).
    // 이 기간 기사 중 최신 40건을 후보로 넣고, 무엇이 중요한지는 선정 AI가 고른다. 요약 칸은 분류 사유라 대본 재료로 쓰지 않는다.
    ...(await prisma.interNewsVerdict.findMany({
      where: { relevant: true, domain: 'ai', news: { publishedAt: { gte: w.since, ...(w.until ? { lt: w.until } : {}) } } },
      include: { news: { select: { title: true, url: true, source: true, publishedAt: true } } },
      orderBy: { news: { publishedAt: 'desc' } },
      take: 40,
    })).map(v => ({
      kind: 'inter' as const, ref: v.news.url, title: v.titleKo || v.news.title, summary: v.reason, source: v.news.source,
      url: v.news.url, label: INTER_LABEL, pubDate: v.news.publishedAt.toISOString(),
    })),
  ].filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i).filter(fresh)
    // 여러 소식을 묶은 뉴스레터("주요 뉴스: 앤스로픽 IPO 전망, 스마트 전력망, …" — MIT Tech Review The Download)는 한 사건이 아니라 뺀다.
    .filter(c => !/^(주요 뉴스|The Download)\s*[:：]/i.test(c.title));
  // VC·금융 업계 사람에게 쓸모 있는 것만 남긴다(2026-10-29 소윤 규칙 — financeRelevant 머리말). 보도자료성 모델·기능 출시,
  // 개별 도입 사례, 체험기·기획·후원 콘텐츠, 숫자 없는 트렌드 기사는 뺀다.
  const aiNews = (await loadAiNews(w.since, w.until))
    .map(a => ({ kind: 'intra' as const, ref: a.url, title: a.title, summary: a.summary, source: a.source, url: a.url, label: AI_LABEL, pubDate: a.pubDate.toISOString() }))
    .filter(fresh);
  const AI = [...aiNews, ...G];
  const keepFinance = await financeRelevant(AI);
  const GE = AI.filter((_, i) => keepFinance.has(i));

  // 스타트업계 — 다이제스트 "스타트업계 뉴스" 섹션(국내 AI 칸과 겹치지 않게 AI 주제는 뺀다).
  // 투자·펀드 소식 — 스타트업계·AC·VC 기사 중 제목에 투자 유치·투자 집행·펀드 결성이 드러나는 것(2026-10-28 소윤).
  // 예전 '스타트업계' 칸은 일반 업계 소식이라 쓸데없는 기사가 많았다.
  // 엑시트·인수합병·M&A·IPO·상장은 뺐다 — 사모펀드·대기업 거래가 걸려 들어왔다(2026-10-29 10번 "IPO 약속 깼다" 골프존홀딩스 vs MBK 매각 분쟁).
  // 이 칸은 스타트업이 투자를 받거나 벤처펀드가 만들어지는 소식만이다.
  // 단일 스타트업 투자 유치는 뺐다(2026-11-05 은빛: "무빈 100억 투자 유치는 사소하다"). 업계 전반의 사건만.
  const DEAL = /펀드\s?(결성|조성|출범|출자|모집|클로징)|출자\s?(사업|선정)|모태펀드|벤처펀드|벤처투자\s?(시장|규모|실적|동향)|한국벤처투자|중소벤처기업부|중기부|금융위|스타트업\s?(정책|규제|지원)|창업\s?(정책|예산|지원)|벤처\S*\s?(정책|세제|법)|유니콘/i;
  const NOT_STARTUP_DEAL = /MBK|사모펀드|PEF|경영권|매각|인수금융|바이아웃|먹튀/;
  // 깡프로·데모데이에서 나눈 투자·펀드 기사(policy-classify.ts → fund_invest)를 앞에 둔다 — 사람이 고른 큐레이션이다.
  const fundRows = (await prisma.article.findMany({
    // 수집 시각 기준 — 깡프로 글은 새벽(01시께)에 올라오고 정책 수집은 10:10이라, 발행 시각으로 거르면 늘 창 앞에 걸려 빠졌다(2026-10-29).
    where: { category: 'fund_invest', isNoise: false, collectedAt: { gte: w.since, ...(w.until ? { lt: w.until } : {}) } },
    select: { id: true, title: true, link: true, source: true, pubDate: true, bodyText: true, curationTopic: true },
    orderBy: { pubDate: 'desc' },
    take: 20,
  })).filter(a => !STOCK_TICKER.test(a.title) && a.curationTopic !== 'round').map(a => ({
    kind: 'intra' as const, ref: a.id, title: a.title, summary: a.bodyText ? a.bodyText.replace(/\s+/g, ' ').slice(0, 160) : a.title,
    source: a.source, url: a.link, label: '💰 투자·펀드', pubDate: a.pubDate.toISOString(), category: 'fund_invest',
  }));
  const industryRows = (await prisma.article.findMany({
    where: { category: { in: ['industry_trend', 'competitor', 'policy_support'] }, isNoise: false, collectedAt: { gte: w.since, ...(w.until ? { lt: w.until } : {}) } },
    select: { id: true, title: true, link: true, source: true, pubDate: true, oneLiner: true, importance: true },
    orderBy: { pubDate: 'desc' },
    take: 400,
  })).filter(a => isKorean(a.title) && DEAL.test(a.title) && !NOT_STARTUP_DEAL.test(a.title) && !STOCK_TICKER.test(a.title) && !weakForBriefing(a))
    .sort((x, y) => rankOf(y) - rankOf(x))
    .map(a => ({
      kind: 'intra' as const, ref: a.id, title: a.title.replace(/\s+-\s+[^-]{1,20}$/, '').trim() || a.title, summary: a.oneLiner || a.title,
      source: a.source, url: a.link, label: INDUSTRY_LABEL, pubDate: a.pubDate.toISOString(),
    }));
  const T = [...fundRows, ...industryRows,
  ...buildClusteredPool(candidates.filter(a =>
    a.category === 'competitor' && isKorean(a.title) && COMPETITOR_EVENT.test(a.title) && !STOCK_TICKER.test(a.title) && !weakForBriefing(a)))
    .map(a => ({ ...fromArticle(a, idByLink), label: INDUSTRY_LABEL }))
    .sort((x, y) => rankOf(y) - rankOf(x))]
    .filter(fresh)
    .filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i)
    .slice(0, 16);

  // 정책·지원사업 — 깡프로·데모데이에서 나눈 기사(policy-classify.ts → policy_support).
  // 위클리: 데모데이 주간 공고 정리 최신 회차 2편(K-Startup 주간 창업공고 TOP 10 · 정부지원사업 TOP 100)을 고정 2칸으로(2026-10-28 소윤).
  //   본문(순위표)은 브리핑 워크플로의 fill-demoday-roundups.ts가 채운다. 데일리가 다루지 않으므로 '최근 브리핑 제외'를 하지 않는다.
  // 데일리: 지원사업 공고·정책·제도 기사 중 중요도 순(공고 정리 글은 위클리 몫이라 뺀다). 생태계·동향은 뒤로.
  const ROUNDUP = /TOP\s?\d+/i;
  const toPolicy = (a: { id: string; title: string; link: string; source: string; pubDate: Date; bodyText: string | null }) => ({
    kind: 'intra' as const, ref: a.id, title: a.title.replace(/\s+-\s+[^-]{1,20}$/, '').trim() || a.title,
    summary: a.bodyText ? a.bodyText.replace(/\s+/g, ' ').slice(0, 160) : a.title,
    source: a.source, url: a.link, label: CATEGORY_LABEL.policy_support, pubDate: a.pubDate.toISOString(), category: 'policy_support',
  });
  const policySelect = { id: true, title: true, link: true, source: true, pubDate: true, bodyText: true, importance: true, curationTopic: true } as const;
  const Y = weekly
    ? (await prisma.article.findMany({
        where: { category: 'policy_support', isNoise: false, source: '데모데이', title: { contains: 'TOP' }, pubDate: { gte: new Date((w.until ?? new Date()).getTime() - 8 * 864e5), ...(w.until ? { lt: w.until } : {}) } },
        select: policySelect, orderBy: { pubDate: 'desc' }, take: 2,
      })).sort((x, y) => Number(/TOP\s?10\b/.test(y.title)) - Number(/TOP\s?10\b/.test(x.title))).map(toPolicy)
    : (await prisma.article.findMany({
        // 수집 시각 기준(투자·펀드와 같은 이유)
        where: { category: 'policy_support', isNoise: false, collectedAt: { gte: w.since, ...(w.until ? { lt: w.until } : {}) } },
        select: policySelect, orderBy: { pubDate: 'desc' }, take: 40,
      })).filter(a => !ROUNDUP.test(a.title) && !STOCK_TICKER.test(a.title) && !PERSONNEL.test(a.title))
        .sort((x, y) => Number(y.curationTopic !== 'ecosystem') - Number(x.curationTopic !== 'ecosystem') || rankOf(y) - rankOf(x))
        .map(toPolicy)
        .filter(fresh)
        .filter((c, i, arr) => arr.findIndex(x => x.url === c.url) === i)
        .slice(0, 20);

  // AI 칸은 해외 우선 — 국내 AI는 [국내] 표시를 달아 글로벌 그룹 뒤에 붙인다(AI가 해외 매체급일 때만 고른다).
  // 국내 AI도 같은 기준 — 금융·투자 쪽 사람에게 쓸모 있는 것만(10/29 '애딧 렌즈 모두의 창업 선정'이 AI 칸에 들어감).
  const keepDomestic = await financeRelevant(DA);
  const GA = [...GE, ...DA.filter((_, i) => keepDomestic.has(i))];
  const pools: Record<Group, BriefingCandidate[]> = { S, P, E, D, R, T, Y, G: GA };
  const counts = { S: S.length, P: P.length, E: E.length, D: D.length, R: R.length, T: T.length, Y: Y.length, G: GA.length };
  console.log('[briefing-reco] 칸별 후보 수', JSON.stringify(counts));
  const total = BRIEFING_COUNT[w.program];
  const q = quotas(counts, total);
  const aiEither = false; // 국내·글로벌 AI "둘 중 하나" 칸은 없어졌다(10-06부터 한 그룹)

  let chosen: Record<Group, BriefingCandidate[]> | null = null;
  try {
    chosen = await rankWithAI(pools, q, aiEither);
  } catch (e) {
    console.error('[briefing-reco] AI 선정 실패 — 그룹별 중요도 순으로 대신합니다:', e);
  }
  // AI 답을 칸 수에 맞춰 다듬는다(모자라면 그룹 앞에서부터 채우고, 넘치면 자른다).
  const want = { ...q };
  const picked: BriefingCandidate[] = [];
  const tiers: number[] = [];
  const used = new Set<string>();
  const usedLeads = new Set<string>();
  // 국내 AI는 최대 1건 — AI 트렌드는 해외 중심(2026-10-28 소윤: 국내 AI 5건이 다 쓸데없었다).
  let domesticAiTaken = 0;
  const take = (g: Group, c: BriefingCandidate): boolean => {
    if (used.has(c.url)) return false;
    if (g === 'G' && c.label.includes('국내')) {
      if (domesticAiTaken >= 1) return false;
      domesticAiTaken++;
    }
    // AI 칸에 같은 회사 소식이 둘 들어가지 않게("구글, 제미나이 4 발표"·"구글, 새 제미니 모델 발표" — 같은 사건).
    const lead = g === 'G' ? c.title.split(/[,，·…\s]/)[0] : '';
    if (lead && usedLeads.has(lead)) return false;
    if (lead) usedLeads.add(lead);
    used.add(c.url);
    picked.push(c);
    tiers.push(GROUP_TIER[g]);
    return true;
  };
  (['S', 'P', 'E', 'D', 'R', 'T', 'Y', 'G'] as Group[]).forEach(g => {
    // 아래 칸은 AI가 고른 것만 쓴다 — 동명 기사나 사소한 기사가 남은 칸 채우기로 끼어들지 않게. 기준에 맞는 기사가 없으면 칸을 비운다.
    const order = AI_ONLY.includes(g) && chosen ? [...chosen[g]] : [...(chosen?.[g] ?? []), ...pools[g]];
    let n = 0;
    for (const c of order) {
      if (n >= want[g]) break;
      if (take(g, c)) n++;
    }
  });
  // 같은 사건이 두 칸에 들어가지 않게 — 국내 기사와 번역된 해외 기사는 제목 낱말이 달라 위의 중복 제거로 못 잡는다
  // (2026-10-26 위클리 3번 "PHP 보안 취약점 … KISA 권고"·7번 ITmedia "PHP 중대 취약점 … 긴급 패치").
  // 뒤쪽(우선순위 낮은) 칸을 빼고 다시 채운다. 두 번까지.
  const tierGroup = Object.fromEntries(Object.entries(GROUP_TIER).map(([g, t]) => [t, g])) as Record<number, Group>;
  for (let round = 0; round < 2; round++) {
    const drop = new Set([...(await sameEventDuplicates(picked)), ...(await alreadyBriefedEvents(picked, briefed.titles))]
      // 위클리 공고 정리 2칸은 고정 — 지난주 회차와 제목이 비슷해 '같은 사건'으로 잡히지 않게.
      .filter(i => !(weekly && tiers[i] === GROUP_TIER.Y)));
    if (drop.size === 0) break;
    const removedGroups: Group[] = [];
    for (let i = picked.length - 1; i >= 0; i--) {
      if (!drop.has(i)) continue;
      console.log(`[briefing-reco] 같은 사건 중복 제외: ${picked[i].title.slice(0, 40)}`);
      removedGroups.push(tierGroup[tiers[i]]);
      picked.splice(i, 1);
      tiers.splice(i, 1);
    }
    // 빠진 칸은 한 칸씩 같은 그룹에서 채운다 — 예전처럼 그룹째로 채우면 먼저 도는 그룹이 빈자리를 다 가져갔다
    // (2026-10-28 정책 칸이 6개, AI가 2개). 같은 그룹에 없으면 국내 포폴 → AI·정책 중 적은 쪽 → 투자 순.
    const fillOne = (g: Group) => [...(chosen?.[g] ?? []), ...(AI_ONLY.includes(g) ? [] : pools[g])].some(c => take(g, c));
    const count = (g: Group) => tiers.filter(t => t === GROUP_TIER[g]).length;
    for (const g of removedGroups) {
      if (picked.length >= total) break;
      if (fillOne(g) || fillOne('P')) continue;
      const [first, second] = count('G') <= count('Y') ? ['G', 'Y'] as Group[] : ['Y', 'G'] as Group[];
      if (!fillOne(first) && !fillOne(second)) fillOne('T');
    }
  }
  // 칸 순서대로(스파크랩 → 국내 포폴 → 해외 포폴 → AI → 스타트업계) 보이게 정렬
  // 페이월(FT·WSJ·블룸버그 등)로 본문을 못 읽는 해외 AI 기사 — 같은 사건을 다룬 다른 매체에서 본문을 찾아 그 기사로 바꾼다.
  // 없으면 빼고 같은 칸 다음 후보로 채운다(제목만으로 대본을 쓰면 숫자를 지어낼 위험, 2026-10-29 소윤 규칙).
  for (let i = 0; i < picked.length; i++) {
    if (tiers[i] !== GROUP_TIER.G) continue;
    const swapped = await readableVersion(picked[i]!);
    if (swapped) { picked[i] = swapped; continue; }
    console.log(`[briefing-reco] 본문 없음·대체 기사 없음 — 제외: ${picked[i]!.title.slice(0, 40)}`);
    picked.splice(i, 1); tiers.splice(i, 1); i--;
    for (const c of chosen?.G ?? pools.G) {
      if (picked.length >= total) break;
      if (used.has(c.url)) continue;
      const ok = await readableVersion(c);
      if (ok && take('G', ok)) break;
    }
  }
  // 칸이 비어도 12건을 억지로 채우지 않는다 — 사소한 기사로 채우지 않는다(2026-11-05 은빛).
  // 같은 칸 안에서는 고른 순서 그대로 — 위클리 공고 정리만 창업공고 TOP 10을 TOP 100보다 앞에.
  const top10First = (c: BriefingCandidate) => Number(weekly && /TOP\s?10\b/.test(c.title));
  const order = picked.map((c, i) => ({ c, t: tiers[i] })).sort((a, b) => a.t - b.t || top10First(b.c) - top10First(a.c));
  picked.splice(0, picked.length, ...order.map(x => x.c));
  tiers.splice(0, tiers.length, ...order.map(x => x.t));
  return { picked, tiers };
}

/**
 * 오늘의 추천 5개. 같은 수집 결과로 이미 계산해 둔 게 있으면 그대로 돌려준다.
 * force=true면 새로 계산한다(검수 화면의 "추천 다시 받기").
 */
export async function getBriefingRecommendation(force = false): Promise<BriefingRecommendation> {
  // 다음 방송(월=위클리, 수·금=데일리) 기준. 캐시 키도 방송일 — 목요일에 보는 검수 화면은 금요일 방송분.
  const w = broadcastFor();
  const dateKey = w.dateKey;
  const basis = `${await currentBasis()}|${w.program}|${w.since.toISOString()}`;
  if (!force) {
    const row = await prisma.dashboardInsight.findUnique({
      where: { kind_key: { kind: KIND_RECO, key: dateKey } },
      select: { value: true },
    });
    if (row) {
      try {
        const cached = JSON.parse(row.value) as BriefingRecommendation;
        // 'ai'는 예전 방식으로 만든 캐시 — 규칙이 바뀌었으니 다시 계산한다.
        if (cached.basis === basis && cached.method === 'quota' && cached.headlines?.length > 0) return cached;
      } catch { /* 깨진 캐시는 새로 계산 */ }
    }
  }

  const { picked, tiers } = await pickByTiers(w);
  const rec: BriefingRecommendation = {
    program: w.program,
    headlines: picked.map(toHeadline),
    method: 'quota',
    tiers,
    basis,
    computedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(rec);
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: KIND_RECO, key: dateKey } },
    create: { kind: KIND_RECO, key: dateKey, value },
    update: { value },
  });
  return rec;
}
