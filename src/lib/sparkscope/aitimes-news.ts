/**
 * 브리핑 AI 칸의 메인 소스 — AI타임스 전체기사 RSS(2026-11-05 은빛).
 * 구글 뉴스 프록시가 아니라 원문 링크라 본문을 바로 읽을 수 있다. 무엇을 실을지는 선정 AI가 정한다.
 */
import { parseStringPromise } from 'xml2js';

const FEED = 'https://www.aitimes.com/rss/allArticle.xml';

export interface AiTimesItem { title: string; url: string; summary: string; pubDate: Date }

export async function loadAiTimes(since: Date, until?: Date): Promise<AiTimesItem[]> {
  const res = await fetch(FEED, { headers: { 'User-Agent': 'Mozilla/5.0 SparkScope/0.1' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`AI타임스 RSS ${res.status}`);
  const parsed = await parseStringPromise(await res.text());
  const items: any[] = parsed?.rss?.channel?.[0]?.item ?? [];
  return items.flatMap(it => {
    const title = String(it.title?.[0] ?? '').trim();
    const url = String(it.link?.[0] ?? '').trim();
    const pubDate = new Date(it.pubDate?.[0] ?? '');
    if (!title || !url || isNaN(pubDate.getTime()) || pubDate < since || (until && pubDate >= until)) return [];
    const summary = String(it.description?.[0] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    return [{ title, url, summary: summary || title, pubDate }];
  });
}
