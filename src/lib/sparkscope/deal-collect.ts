/**
 * 투자 딜·펀드 DB 재료 수집 — 투자 전문 매체(플래텀·와우테일)의 투자 기사를 Article로 저장한다(2026-11-24 소윤).
 *
 * 왜 따로 수집하나:
 *   (2026-11-24 소윤 요청으로 더벨도 추가 — 유료라 대부분 제목만 남는다. 아래 QUERIES 주석 참고.)
 *   일반 수집기는 우리 키워드(포트폴리오·경쟁사 등)에 걸린 기사만 가져온다. 2026-11-24 실측(7일)으로
 *   플래텀은 딜 기사 약 32건 중 2건, 와우테일은 약 29건 중 2건만 DB에 있었다. 둘은 거의 겹치지 않아
 *   합치면 주 60건 안팎이다. 벤처스퀘어·비석세스(행사 위주)·더벨(유료라 본문 없음)·유니콘팩토리
 *   (회사 소개 페이지 위주)는 실측에서 딜이 거의 없어 뺐다.
 *
 * 왜 구글뉴스 검색인가:
 *   두 매체 RSS가 서버 요청을 403으로 막는다. 우회하지 않고, 일반 수집기와 같은 구글뉴스 검색(site: 검색)을 쓴다.
 *
 * 어디에 저장하나:
 *   category 'deal_news'. 메일·브리핑은 analyzedAt이 있는 기사·정해진 칸만 읽으므로 여기 기사는 나가지 않는다.
 *   AI 분석(analyzer)도 태우지 않는다 — 딜 판정·항목 추출은 다음 단계(Deal/Fund 추출)에서 따로 한다.
 *   해외 딜(약 40%)도 일단 저장한다. 국내만 고르는 건 추출 단계에서 본문을 보고 판정한다.
 */
import { prisma } from '@/lib/prisma';
import type { RawArticle } from './types';
import { fetchGoogleNews, fillMissingBodies, resolveLinksInPlace, saveMissingBodies, splitStored } from './collector';

export const DEAL_CATEGORY = 'deal_news' as const;

/** 매체 × 검색어. topic은 curationTopic에 그대로 넣어 추출 단계가 딜/펀드 중 무엇을 볼지 힌트로 쓴다. */
const QUERIES: { media: string; domain: string; q: string; topic: 'round' | 'fund' }[] = [
  { media: '플래텀', domain: 'platum.kr', q: '투자유치', topic: 'round' },
  { media: '플래텀', domain: 'platum.kr', q: '펀드 결성 OR 출자사업 OR 운용사 선정', topic: 'fund' },
  { media: '와우테일', domain: 'wowtale.net', q: '투자유치', topic: 'round' },
  { media: '와우테일', domain: 'wowtale.net', q: '펀드 결성 OR 출자사업 OR 운용사 선정', topic: 'fund' },
  // 더벨 — 2026-11-24 소윤 요청으로 추가. 유료 기사가 많아 본문은 무료 기사(thebell Free)에서만 읽힌다(30일 138건 중 본문 3건).
  // 유료 벽은 우회하지 않는다 — 본문이 없으면 추출기가 제목만 보고 판정하고, 근거 문장도 제목에서 찾는다.
  // 펀드 결성·출자사업·GP 선정 소식이 특히 많아 펀드 쪽 재료로 가치가 크다.
  { media: '더벨', domain: 'thebell.co.kr', q: '투자유치', topic: 'round' },
  { media: '더벨', domain: 'thebell.co.kr', q: '펀드 결성 OR 출자사업 OR 운용사 선정 OR GP 선정', topic: 'fund' },
];

/** 투자 소식과 무관한 게 확실한 제목(행사·설명회)만 미리 뺀다. 애매한 건 추출 단계 AI가 판정한다. */
const EVENT_TITLE = /데모데이|IR\s*(행사|피칭)|설명회|개최|모집|세미나|포럼|웨비나/;

export interface DealCollectResult { fetched: number; fresh: number; saved: number; bodies: number }

export async function collectDealArticles(days = 3): Promise<DealCollectResult> {
  const since = Date.now() - days * 86_400_000;
  const byLink = new Map<string, RawArticle & { topic: 'round' | 'fund' }>();
  const seenTitle = new Set<string>();

  for (const { media, domain, q, topic } of QUERIES) {
    let items;
    try {
      items = await fetchGoogleNews(`site:${domain} ${q}`);
    } catch (e) {
      console.error(`[deal-collect] ${media} "${q}" 검색 실패:`, e);
      continue;
    }
    if (items.length === 0) console.warn(`[deal-collect] ${media} "${q}" 0건 — 연속되면 검색어·구글뉴스 확인`);
    for (const it of items) {
      if (it.pubDate.getTime() < since || EVENT_TITLE.test(it.title)) continue;
      const tkey = it.title.replace(/\s+/g, '');
      if (seenTitle.has(tkey) || byLink.has(it.link)) continue;  // 두 검색어에 같은 기사가 걸릴 수 있다
      seenTitle.add(tkey);
      byLink.set(it.link, {
        title: it.title, link: it.link, source: media, pubDate: it.pubDate,
        matchedKeyword: `투자매체:${media}`, category: DEAL_CATEGORY as any, basePriority: 0, topic,
      });
    }
  }

  const raw = [...byLink.values()];
  if (raw.length === 0) return { fetched: 0, fresh: 0, saved: 0, bodies: 0 };

  // 구글 프록시 주소를 원문 주소로 풀어야 일반 수집기가 이미 저장한 같은 기사와 link로 겹친다.
  await resolveLinksInPlace(raw);
  const { fresh, needBody } = await splitStored(raw);
  const bodies = await fillMissingBodies([...fresh, ...needBody]);
  await saveMissingBodies(needBody);

  let saved = 0;
  for (const a of fresh) {
    try {
      await prisma.article.create({
        data: {
          title: a.title, link: a.link, source: a.source, pubDate: a.pubDate,
          matchedKeyword: a.matchedKeyword, category: DEAL_CATEGORY, curationTopic: a.topic,
          priorityScore: 0, bodyText: a.body ? a.body.slice(0, 3000) : null,
        },
      });
      saved++;
    } catch (e: any) {
      if (e?.code !== 'P2002') console.error('[deal-collect] 저장 실패:', a.link, e);  // P2002 = 그 사이 다른 수집기가 저장
    }
  }
  console.log(`[deal-collect] 검색 ${raw.length}건 → 신규 ${saved}건 · 본문 채움 ${bodies}건`);
  return { fetched: raw.length, fresh: fresh.length, saved, bodies };
}
