/**
 * 투자 딜·펀드 추출기 — 기사에서 "실제 국내 딜·펀드인가"를 판정하고 항목을 뽑아 Deal/Fund 테이블에 넣는다(2026-11-24 소윤).
 *
 * 재료:
 *   - category 'deal_news'(투자 전문 매체 수집, deal-collect.ts) 전부
 *   - 깡프로·데모데이 큐레이션이 투자·펀드(fund_invest)로 나눈 기사(분류는 건드리지 않고 읽기만)
 *   - 그 밖의 분류라도 제목이 투자 유치·펀드 결성처럼 보이는 기사(2026-11-24 실측: 30일 571건이 여러 분류에 흩어져 있었다)
 *   한 번 본 기사는 Article.dealCheckedAt으로 표시해 다시 LLM에 넘기지 않는다.
 *
 * 왜 2단계(제목 → AI)인가:
 *   실측에서 "투자 유치" 제목의 약 60%가 IR 행사·지자체 투자유치·통계 기사였다. 제목으로 넓게 모으고 AI가 가른다.
 *
 * 검증(지어낸 값 막기):
 *   - 근거 문장(evidence)이 제목·본문에 실제로 있어야 저장한다. 없으면 UNVERIFIED로 남기고 저장하지 않는다.
 *   - 금액은 원문 표기(amountText)의 숫자가 원문에 있어야 쓴다. 없으면 금액만 비운다.
 *   - "어떤 펀드로"는 기사에 거의 없다(실측 0/5). 원문에 그 펀드명이 있을 때만 넣는다.
 *
 * 합치기(같은 소식을 여러 매체가 보도):
 *   - 딜: 같은 회사 + 같은 라운드(둘 중 하나가 비면 같은 것으로) + 발표일 60일 이내
 *   - 펀드: 같은 사업명/펀드명, 또는 GP가 겹치고 규모가 ±10% 이내 — 180일 이내
 *   합칠 때는 빈 칸만 채우고, 펀드 단계는 더 뒤 단계(공고 → GP선정 → 결성)로만 올린다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { DEAL_CATEGORY } from './deal-collect';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = 'gpt-4.1';

/** 일반 수집 기사 중 후보로 볼 제목. 넓게 잡는다 — 거르는 건 AI 몫. */
const CANDIDATE_TITLE = /투자\s*유치|시리즈\s*[A-Z]|프리\s*(A|IPO|시리즈)|시드\s*투자|브릿지\s*투자|펀드\s*결성|결성\s*총회|출자\s*사업|운용사\s*선정|GP\s*선정/;

type Verdict = 'DEAL' | 'FUND' | 'NONE' | 'OVERSEAS' | 'UNVERIFIED' | 'ERROR';
const STAGE_ORDER = ['ANNOUNCED', 'GP_SELECTED', 'CLOSED'] as const;
const ROUNDS = ['SEED', 'PRE_A', 'A', 'B', 'C', 'D_PLUS', 'BRIDGE', 'PRE_IPO', 'STRATEGIC', 'MA', 'OTHER'] as const;

interface LlmInvestor { name: string; role?: string | null; fund?: string | null }
interface LlmDeal {
  company: string; ceoName?: string | null; foundedYear?: number | null; description?: string | null; sector?: string | null;
  round?: string | null; amountText?: string | null; amountKrw?: number | null; reportedCumulativeKrw?: number | null;
  investors?: LlmInvestor[];
}
interface LlmOut {
  kind: 'deal' | 'fund' | 'none';
  overseas: boolean;
  evidence: string;
  deal?: LlmDeal | LlmDeal[];
  fund?: {
    programName?: string | null; fundName?: string | null; stage?: string | null;
    targetSizeKrw?: number | null; closedSizeKrw?: number | null; sizeText?: string | null; sectors?: string[];
    gps?: { name: string; role?: string | null; amountKrw?: number | null }[];
    lps?: { name: string; amountKrw?: number | null }[];
  };
}

const PROMPT = `너는 한국 벤처투자 기사에서 딜·펀드 정보를 뽑는 분석가다. 기사 하나를 보고 JSON 하나만 돌려줘.

kind:
- "deal": 특정 회사 하나(또는 같이 보도된 몇 곳)가 투자를 받았다는 소식. M&A·전략적 투자 포함.
- "fund": 벤처·사모 펀드의 출자사업 공고, 운용사(GP) 선정, 펀드 결성 소식.
- "none": 그 밖의 전부 — IR·데모데이 행사, 지자체·국가 투자유치(외국인 직접투자·공장 유치), 통계·동향·주간 정리, 대기업 회사채·데이터센터 자금 조달, 인터뷰, 상장 공모 자체.
overseas: 투자받은 회사(deal) 또는 펀드 운용사(fund)가 한국 회사가 아니면 true.
evidence: 판단 근거가 된 문장 하나를 기사에서 **글자 그대로** 복사(고쳐 쓰지 마라).

deal: company(회사명, 괄호 영문 빼고), ceoName(대표자 이름만, 없으면 null), foundedYear, description(무엇을 하는 회사인지 한 줄), sector,
  round: ${ROUNDS.join('/')} 중 하나(시리즈D 이상은 D_PLUS, 모르면 null),
  amountText(기사 표기 그대로, 예: "338억 원"), amountKrw(원 단위 정수, 비공개면 null), reportedCumulativeKrw(기사에 "누적 ○○억"이 있을 때만),
  investors: [{name, role: LEAD/FOLLOW/NEW/EXISTING 또는 null, fund: 기사에 펀드명이 적혀 있을 때만, 아니면 null}]
fund: programName(출자사업·사업명), fundName(정식 펀드명이 있을 때만), stage: ANNOUNCED(출자 공고)/GP_SELECTED(운용사 선정)/CLOSED(결성 완료),
  targetSizeKrw, closedSizeKrw, sizeText, sectors[], gps: [{name, role: SOLE/CO_GP, amountKrw}], lps: [{name, amountKrw}]

규칙: 한 기사에 투자받은 회사가 여럿이면 deal을 배열로 줘. 투자 '협약'·MOU·검토·'추진' 단계(아직 투자를 받지 않음)는 딜이 아니다 — 빼라. 회사채·공모채·상장 공모도 딜이 아니다. 기사에 없는 값은 null. 추측 금지. 금액은 "1500억" → 150000000000. amount는 이번 라운드에 들어온 투자금만 — 기업가치·몸값·밸류에이션·누적 투자액·매출은 amount가 아니다(투자금이 안 적혀 있으면 null). kind가 none이면 deal·fund를 넣지 마라.`;

const norm = (s: string) => s.replace(/\s+/g, '').replace(/[“”"'‘’·.,…]/g, '');
const normName = (s: string) =>
  s.replace(/\(.*?\)/g, '').replace(/주식회사|㈜|\(주\)|\s+/g, '').trim();

function inText(needle: string | null | undefined, hay: string): boolean {
  if (!needle) return false;
  const n = norm(needle);
  return n.length >= 6 ? norm(hay).includes(n) : false;
}
/** amountText 안의 숫자("338")가 원문에 있는지 — 금액을 지어내는 것만 막는다. */
function amountInText(amountText: string | null | undefined, hay: string): boolean {
  const num = amountText?.match(/[\d,.]+/)?.[0]?.replace(/,/g, '');
  return !!num && hay.replace(/,/g, '').includes(num);
}
/** 금액 숫자 바로 앞이 "기업가치·몸값·밸류"면 투자금이 아니다(2026-11-26 퓨리오사AI 8,200억 — 기업가치를 투자금으로 저장). */
function looksLikeValuation(amountText: string | null | undefined, hay: string): boolean {
  const num = amountText?.match(/[\d,.]+/)?.[0]?.replace(/,/g, '');
  if (!num) return false;
  const re = new RegExp(`(기업\\s*가치|몸값|밸류에이션|평가\\s*가치|가치를|가치로|가치는)[^.。\\n]{0,20}${num.replace(/[.]/g, '\\.')}`);
  return re.test(hay.replace(/,/g, ''));
}
const big = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? BigInt(Math.round(n)) : null);

async function findOrCreateInvestor(name: string): Promise<string | null> {
  const key = normName(name);
  if (key.length < 2) return null;
  const hit = await prisma.investor.findFirst({ where: { OR: [{ name: key }, { aliases: { has: key } }, { aliases: { has: name.trim() } }] }, select: { id: true } });
  if (hit) return hit.id;
  const created = await prisma.investor.upsert({ where: { name: key }, create: { name: key, aliases: name.trim() !== key ? [name.trim()] : [] }, update: {}, select: { id: true } });
  return created.id;
}

async function findOrCreateCompany(d: LlmDeal): Promise<string | null> {
  const key = normName(d.company ?? '');
  if (key.length < 2) return null;
  const existing = await prisma.company.findFirst({ where: { OR: [{ name: key }, { aliases: { has: key } }] } });
  // 포트폴리오사·경쟁사와 이어 둔다 — "우리 포폴 투자 소식"을 바로 걸러 보려고.
  const target = await prisma.monitoringTarget.findFirst({ where: { name: key }, select: { id: true } });
  const fill = {
    ceoName: d.ceoName ?? undefined, foundedYear: d.foundedYear ?? undefined,
    description: d.description ?? undefined, sector: d.sector ?? undefined, monitoringTargetId: target?.id ?? undefined,
  };
  if (existing) {
    // 빈 칸만 채운다 — 먼저 들어온 값(사람이 고쳤을 수도 있다)을 덮지 않는다.
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fill)) if (v != null && (existing as any)[k] == null) data[k] = v;
    if (Object.keys(data).length) await prisma.company.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  return (await prisma.company.create({ data: { name: key, ...fill }, select: { id: true } })).id;
}

async function saveDeal(articleId: string, pubDate: Date, out: LlmOut, text: string): Promise<boolean> {
  // 한 기사에 여러 회사가 같이 보도되면 배열로 온다(2026-11-24 시험: 경과원 성과공유회 기사).
  const list = (Array.isArray(out.deal) ? out.deal : out.deal ? [out.deal] : []).filter(d => d?.company);
  let any = false;
  for (const d of list) if (await saveOneDeal(articleId, pubDate, d, out, text)) any = true;
  return any;
}

async function saveOneDeal(articleId: string, pubDate: Date, d: LlmDeal, out: LlmOut, text: string): Promise<boolean> {
  const companyId = await findOrCreateCompany(d);
  if (!companyId) return false;
  const round = ROUNDS.includes(d.round as any) ? d.round! : null;
  const amountOk = amountInText(d.amountText, text) && !looksLikeValuation(d.amountText, text);
  const amountKrw = amountOk ? big(d.amountKrw) : null;

  const win = 60 * 86_400_000;
  const near = await prisma.deal.findMany({
    where: { companyId, announcedAt: { gte: new Date(pubDate.getTime() - win), lte: new Date(pubDate.getTime() + win) } },
  });
  let deal = near.find(x => !x.round || !round || x.round === round);
  if (deal) {
    const data: Record<string, unknown> = {};
    if (!deal.round && round) data.round = round;
    if (deal.amountKrw == null && amountKrw != null) { data.amountKrw = amountKrw; data.amountText = d.amountText; }
    if (deal.reportedCumulativeKrw == null && big(d.reportedCumulativeKrw)) data.reportedCumulativeKrw = big(d.reportedCumulativeKrw);
    if (Object.keys(data).length) deal = await prisma.deal.update({ where: { id: deal.id }, data });
  } else {
    deal = await prisma.deal.create({
      data: {
        companyId, round, amountKrw, amountText: amountOk ? d.amountText ?? null : null, announcedAt: pubDate,
        reportedCumulativeKrw: big(d.reportedCumulativeKrw),
      },
    });
  }

  for (const inv of d.investors ?? []) {
    const investorId = inv?.name ? await findOrCreateInvestor(inv.name) : null;
    if (!investorId) continue;
    // 펀드명은 원문에 있을 때만 — 기사에 거의 안 나오는 칸이라 지어내기 쉽다.
    let fundId: string | null = null;
    const fundName = inv.fund && inText(inv.fund, text) ? inv.fund : null;
    if (fundName) {
      const f = await prisma.fund.findFirst({ where: { OR: [{ fundName: inv.fund }, { programName: inv.fund }] }, select: { id: true } });
      fundId = f?.id ?? null;
    }
    const role = ['LEAD', 'FOLLOW', 'NEW', 'EXISTING'].includes(inv.role ?? '') ? inv.role! : null;
    await prisma.dealInvestor.upsert({
      where: { dealId_investorId: { dealId: deal.id, investorId } },
      create: { dealId: deal.id, investorId, role, fundId, fundName },
      update: { ...(role ? { role } : {}), ...(fundId ? { fundId } : {}), ...(fundName ? { fundName } : {}) },
    });
  }
  await prisma.dealSource.upsert({
    where: { dealId_articleId: { dealId: deal.id, articleId } },
    create: { dealId: deal.id, articleId, evidence: out.evidence, extracted: out as any },
    update: {},
  });
  return true;
}

async function saveFund(articleId: string, pubDate: Date, out: LlmOut, text: string): Promise<boolean> {
  const f = out.fund;
  if (!f || (!f.programName && !f.fundName && !(f.gps?.length))) return false;
  const stage = STAGE_ORDER.includes(f.stage as any) ? (f.stage as (typeof STAGE_ORDER)[number]) : 'CLOSED';
  const sizeOk = amountInText(f.sizeText, text);
  const target = sizeOk ? big(f.targetSizeKrw) : null;
  const closed = sizeOk ? big(f.closedSizeKrw) : null;
  const size = closed ?? target;

  const gpIds = (await Promise.all((f.gps ?? []).map(g => (g?.name ? findOrCreateInvestor(g.name) : null)))).filter(Boolean) as string[];
  const win = 180 * 86_400_000;
  const recent = await prisma.fund.findMany({
    where: { OR: [{ announcedAt: { gte: new Date(pubDate.getTime() - win) } }, { closedAt: { gte: new Date(pubDate.getTime() - win) } }] },
    include: { gps: { select: { investorId: true } } },
  });
  const sameName = (a?: string | null, b?: string | null) => !!a && !!b && norm(a) === norm(b);
  // 사업명만 같다고 합치면 안 된다 — 출자사업 하나에서 GP 여럿이 각자 펀드를 만든다(2026-11-24 시험: 웰투시는
  // "국민성장펀드 1차 출자사업" 이름으로 나왔다). 사업명이 같으면 GP도 겹치거나 한쪽에 GP가 아직 없어야 같은 펀드다.
  const gpOverlap = (x: { gps: { investorId: string }[] }) => x.gps.length === 0 || gpIds.length === 0 || x.gps.some(g => gpIds.includes(g.investorId));
  let fund = recent.find(x =>
    (sameName(x.programName, f.programName) && gpOverlap(x)) || sameName(x.fundName, f.fundName) ||
    (gpIds.length > 0 && x.gps.some(g => gpIds.includes(g.investorId)) && size != null &&
      (x.closedSizeKrw ?? x.targetSizeKrw) != null &&
      Math.abs(Number((x.closedSizeKrw ?? x.targetSizeKrw)!) - Number(size)) <= Number(size) * 0.1),
  );

  if (fund) {
    const data: Record<string, unknown> = {};
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(fund.stage as any)) data.stage = stage;
    if (!fund.programName && f.programName) data.programName = f.programName;
    if (!fund.fundName && f.fundName) data.fundName = f.fundName;
    if (fund.targetSizeKrw == null && target) data.targetSizeKrw = target;
    if (fund.closedSizeKrw == null && closed) data.closedSizeKrw = closed;
    if (!fund.sizeText && sizeOk) data.sizeText = f.sizeText;
    if (stage === 'CLOSED' && !fund.closedAt) data.closedAt = pubDate;
    if (!fund.sectors.length && f.sectors?.length) data.sectors = f.sectors;
    if (Object.keys(data).length) await prisma.fund.update({ where: { id: fund.id }, data });
  } else {
    fund = await prisma.fund.create({
      data: {
        programName: f.programName ?? null, fundName: f.fundName ?? null, stage,
        targetSizeKrw: target, closedSizeKrw: closed, sizeText: sizeOk ? f.sizeText ?? null : null,
        sectors: f.sectors ?? [], announcedAt: pubDate, closedAt: stage === 'CLOSED' ? pubDate : null,
      },
      include: { gps: { select: { investorId: true } } },
    });
  }

  for (const [i, g] of (f.gps ?? []).entries()) {
    const investorId = gpIds[i] ?? (g?.name ? await findOrCreateInvestor(g.name) : null);
    if (!investorId) continue;
    const role = g.role === 'CO_GP' || g.role === 'SOLE' ? g.role : null;
    await prisma.fundGP.upsert({
      where: { fundId_investorId: { fundId: fund.id, investorId } },
      create: { fundId: fund.id, investorId, role, amountKrw: big(g.amountKrw) },
      update: {},
    });
  }
  for (const l of f.lps ?? []) {
    const investorId = l?.name ? await findOrCreateInvestor(l.name) : null;
    if (!investorId) continue;
    await prisma.fundLP.upsert({
      where: { fundId_investorId: { fundId: fund.id, investorId } },
      create: { fundId: fund.id, investorId, amountKrw: big(l.amountKrw) },
      update: {},
    });
  }
  await prisma.fundSource.upsert({
    where: { fundId_articleId: { fundId: fund.id, articleId } },
    create: { fundId: fund.id, articleId, evidence: out.evidence, extracted: out as any },
    update: {},
  });
  return true;
}

/** 기사 하나를 LLM에 보여 판정한다(DB에 쓰지 않음). 근거 문장이 원문에 없으면 UNVERIFIED. */
export async function judgeArticle(a: { title: string; bodyText: string | null; source: string; pubDate: Date }): Promise<{ verdict: Verdict; out: LlmOut }> {
  const text = `${a.title}\n${a.bodyText ?? ''}`;
  const resp = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: `매체: ${a.source}\n발행일: ${a.pubDate.toISOString().slice(0, 10)}\n제목: ${a.title}\n본문:\n${(a.bodyText ?? '(본문 없음 — 제목만으로 판단)').slice(0, 3000)}` },
    ],
  });
  const out = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as LlmOut;
  const verdict: Verdict =
    out.kind === 'none' || !out.kind ? 'NONE'
    : out.overseas ? 'OVERSEAS'
    : !inText(out.evidence, text) ? 'UNVERIFIED'
    : out.kind === 'deal' ? 'DEAL' : 'FUND';
  return { verdict, out };
}

export interface DealExtractResult { checked: number; byVerdict: Record<string, number> }

/** days 이내에 수집된 미처리 후보를 최대 limit건 처리한다. dryRun이면 LLM 결과만 돌려주고 DB에 쓰지 않는다. */
export async function extractDeals(opts: { days?: number; limit?: number; dryRun?: boolean; fundInvestOnly?: boolean; budgetMs?: number } = {}): Promise<DealExtractResult & { samples?: unknown[] }> {
  const days = opts.days ?? 3;
  const limit = opts.limit ?? 150;
  const since = new Date(Date.now() - days * 86_400_000);
  const pool = await prisma.article.findMany({
    where: { collectedAt: { gte: since }, dealCheckedAt: null, isNoise: false },
    select: { id: true, title: true, bodyText: true, pubDate: true, category: true, curationTopic: true, source: true },
    orderBy: { collectedAt: 'asc' },
  });
  // 깡프로·데모데이가 이미 투자·펀드(fund_invest)로 나눈 기사도 재료로 쓴다 — 기존 분류는 그대로 두고 읽기만 한다.
  const candidates = pool
    .filter(a => !opts.fundInvestOnly || a.category === 'fund_invest')
    .filter(a => a.category === DEAL_CATEGORY || (a.category === 'fund_invest' && a.curationTopic !== 'market') || CANDIDATE_TITLE.test(a.title))
    .slice(0, limit);

  const byVerdict: Record<string, number> = {};
  const samples: unknown[] = [];
  const started = Date.now();
  for (const a of candidates) {
    // 크론 300초 한도 — 시간이 모자라면 남은 건 다음 실행으로 넘긴다(표시 안 했으니 다시 후보가 된다).
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break;
    const text = `${a.title}\n${a.bodyText ?? ''}`;
    let verdict: Verdict = 'ERROR';
    try {
      const j = await judgeArticle(a);
      verdict = j.verdict;
      if ((verdict === 'DEAL' || verdict === 'FUND') && !opts.dryRun) {
        const ok = verdict === 'DEAL' ? await saveDeal(a.id, a.pubDate, j.out, text) : await saveFund(a.id, a.pubDate, j.out, text);
        if (!ok) verdict = 'UNVERIFIED';
      }
      if (opts.dryRun) samples.push({ title: a.title, verdict, out: j.out });
    } catch (e) {
      console.error('[deal-extract] 실패:', a.id, e);
    }
    byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;
    // ERROR는 표시하지 않는다 — 다음 실행에서 다시 본다.
    if (!opts.dryRun && verdict !== 'ERROR') {
      await prisma.article.update({ where: { id: a.id }, data: { dealCheckedAt: new Date(), dealVerdict: verdict } });
    }
  }
  console.log(`[deal-extract] 후보 ${candidates.length}건`, byVerdict);
  return { checked: candidates.length, byVerdict, ...(opts.dryRun ? { samples } : {}) };
}
