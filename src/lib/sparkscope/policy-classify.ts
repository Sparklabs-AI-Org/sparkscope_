/**
 * 깡프로 스타트업 뉴스·데모데이 글을 대시보드 칸으로 나눈다(2026-10-28 소윤).
 *
 * 예전엔 전부 policy_support(정책·지원사업) 한 통에 들어가서 정책·AC·VC 동향·투자 유치·펀드 결성·
 * 관계없는 기사("월 1만3000원이면 내 식당, 구글도 4조 쏟아부은 괴물 주방")가 섞여 있었다.
 * 일반 수집처럼 칸별로 보낸다:
 *
 *   sparklabs_self    제목에 스파크랩(자사 이름·프로그램)이 있으면 — 규칙
 *   portfolio_company 제목에 포트폴리오사 이름이 있으면 — 규칙(짧은 이름은 문맥어가 본문에 있어야)
 *   competitor        AC·VC·CVC가 주체인 소식(matchedKeyword = 그 하우스 이름) — AI
 *   policy_support    정부·지자체 지원사업 공고, 창업·벤처 정책·제도 — AI
 *   fund_invest       스타트업 투자 유치, 펀드 결성·출자(모태펀드 등) — AI
 *   (노이즈)          스타트업·투자와 관계없는 기사 — AI, isNoise로 저장
 *
 * 실패하면 policy_support로 둔다(예전 동작) — 수집을 막지 않는다.
 */
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

const MODEL = 'gpt-4.1';
const BATCH = 20;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type PolicyBucket = 'sparklabs_self' | 'portfolio_company' | 'competitor' | 'policy_support' | 'fund_invest' | 'noise';

export interface ClassifyItem { title: string; body?: string | null }
export interface ClassifyResult { category: PolicyBucket; matchedKeyword?: string }

const SYSTEM = `스파크랩(한국의 액셀러레이터·VC) 대시보드에 스타트업 뉴스 큐레이션 기사를 칸별로 나눕니다.
각 기사를 아래 넷 중 하나로 분류하세요.

- "policy": 정부·지자체·공공기관의 창업·중소기업 지원사업 공고·모집, 창업·벤처 정책·제도·규제 변화,
  지원사업 순위·공고 정리 글
- "fund": 스타트업이 투자를 유치한 소식(금액·라운드·투자사), 벤처펀드 결성·조성·출자(모태펀드·성장펀드 LP 출자,
  GP 선정 포함), 벤처투자 시장 통계
- "acvc": 액셀러레이터·VC·CVC·창업기획자가 주체인 소식(투자사 전략·인사·대표 인터뷰·프로그램·데모데이·투자 집행).
  이 경우 "house"에 그 투자사 이름을 한국어로 적으세요(예: "해시드", "a16z", "한국벤처투자").
  펀드 결성·출자가 주제면 acvc가 아니라 fund입니다.
- "none": 스타트업·벤처투자·창업 지원과 관계없는 기사 — 일반 기업·빅테크 사업, 소비자 서비스·생활 기사,
  일반 산업·과학·의료 기사, 상장사 실적·주가. 대기업·상장사가 보유 지분의 평가이익·IPO 수혜를 보는 기사
  ("앤트로픽 IPO에 SKT·네이버 함박웃음"), 빅테크 IPO 자체 기사도 none입니다 — fund는 스타트업이 투자를 받거나
  벤처펀드가 만들어지는 소식만입니다.

JSON으로만: {"items":[{"i":0,"c":"policy"},{"i":1,"c":"acvc","house":"해시드"},...]} — 모든 번호를 빠짐없이.`;

async function classifyWithAI(items: ClassifyItem[]): Promise<ClassifyResult[]> {
  const out: ClassifyResult[] = [];
  for (let s = 0; s < items.length; s += BATCH) {
    const chunk = items.slice(s, s + BATCH);
    const fallback = chunk.map((): ClassifyResult => ({ category: 'policy_support' }));
    try {
      const resp = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: chunk.map((a, n) => `${n}. ${a.title}${a.body ? ` — ${a.body.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n') },
        ],
      });
      const rows = (JSON.parse(resp.choices[0]?.message?.content ?? '{}').items ?? []) as { i: number; c: string; house?: string }[];
      for (const r of rows) {
        if (!Number.isInteger(r.i) || r.i < 0 || r.i >= chunk.length) continue;
        if (r.c === 'fund') fallback[r.i] = { category: 'fund_invest' };
        else if (r.c === 'none') fallback[r.i] = { category: 'noise' };
        else if (r.c === 'acvc' && r.house?.trim()) fallback[r.i] = { category: 'competitor', matchedKeyword: r.house.trim() };
      }
    } catch (e) {
      console.warn('[policy-classify] 분류 실패 — 이 묶음은 정책·지원사업으로 둔다:', e);
    }
    out.push(...fallback);
  }
  return out;
}

/** 감시 대상 이름으로 자사·포트폴리오사를 먼저 가른다. 짧은(2자 이하) 이름은 문맥어가 제목·본문에 있어야 한다. */
async function matchTargets(items: ClassifyItem[]): Promise<(ClassifyResult | null)[]> {
  const targets = await prisma.monitoringTarget.findMany({
    where: { category: { in: ['sparklabs_self', 'portfolio_company'] } },
    select: { name: true, primaryKeyword: true, category: true, contextWords: true, excludeWords: true },
  });
  const words = (s?: string | null) => (s ?? '').split(',').map(w => w.trim()).filter(Boolean);
  return items.map(a => {
    const text = `${a.title} ${a.body ?? ''}`;
    // 자사가 먼저 — "스파크랩 육성 기업 ○○" 기사는 자사 칸이다.
    for (const cat of ['sparklabs_self', 'portfolio_company']) {
      for (const t of targets.filter(x => x.category === cat)) {
        const key = t.primaryKeyword || t.name;
        if (!key || !a.title.includes(key)) continue;
        if (words(t.excludeWords).some(w => text.includes(w))) continue;
        const ctx = words(t.contextWords);
        if (key.length <= 2 && !ctx.some(w => text.includes(w))) continue;
        return { category: cat as PolicyBucket, matchedKeyword: key };
      }
    }
    return null;
  });
}

export async function classifyPolicyItems(items: ClassifyItem[]): Promise<ClassifyResult[]> {
  if (items.length === 0) return [];
  const byTarget = await matchTargets(items);
  const rest = items.map((a, i) => ({ a, i })).filter(x => !byTarget[x.i]);
  const ai = await classifyWithAI(rest.map(x => x.a));
  const out = byTarget.slice() as (ClassifyResult | null)[];
  rest.forEach((x, n) => { out[x.i] = ai[n]!; });
  return out as ClassifyResult[];
}
