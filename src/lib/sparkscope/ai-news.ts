/**
 * 브리핑 AI 칸의 메인 소스 — AI타임스·IT조선 전체기사 RSS(2026-11-05 은빛).
 * 구글 뉴스 프록시가 아니라 원문 링크라 본문을 바로 읽을 수 있다. 무엇을 실을지는 선정 AI가 정한다.
 * IT조선은 AI 외 기사도 많아 AI 관련 기사만 후보로 둔다.
 */
import { parseStringPromise } from 'xml2js';

const FEEDS = [
  { source: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml', aiOnly: false },
  { source: 'IT조선', url: 'https://it.chosun.com/rss/allArticle.xml', aiOnly: true },
];
const AI_RELATED = /AI|인공지능|생성형|에이전트|에이전틱|LLM|챗GPT|클로드|제미나이|데이터센터|반도체/i;

export interface AiNewsItem { source: string; title: string; url: string; summary: string; pubDate: Date }

async function loadFeed(feed: typeof FEEDS[number], since: Date, until?: Date): Promise<AiNewsItem[]> {
  const res = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 SparkScope/0.1' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`${feed.source} RSS ${res.status}`);
  const parsed = await parseStringPromise(await res.text());
  const items: any[] = parsed?.rss?.channel?.[0]?.item ?? [];
  return items.flatMap(it => {
    const title = String(it.title?.[0] ?? '').trim();
    const url = String(it.link?.[0] ?? '').trim();
    const pubDate = new Date(it.pubDate?.[0] ?? '');
    if (!title || !url || isNaN(pubDate.getTime()) || pubDate < since || (until && pubDate >= until)) return [];
    const summary = String(it.description?.[0] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (feed.aiOnly && !AI_RELATED.test(`${title} ${summary}`)) return [];
    return [{ source: feed.source, title, url, summary: summary || title, pubDate }];
  });
}

/** 한 곳이 실패해도 다른 곳은 쓴다. */
export async function loadAiNews(since: Date, until?: Date): Promise<AiNewsItem[]> {
  const results = await Promise.all(FEEDS.map(f => loadFeed(f, since, until).catch(e => {
    console.warn(`[ai-news] ${f.source} 읽기 실패:`, e);
    return [] as AiNewsItem[];
  })));
  const all = results.flat();
  console.log(`[ai-news] 후보 ${all.length}건`);
  return all;
}
