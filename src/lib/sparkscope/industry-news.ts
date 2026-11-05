/**
 * 브리핑 업계 동향 칸의 후보 — 수집기 키워드에 걸린 기사만으로는 하루 한두 건뿐이라(2026-11-05),
 * 정부 정책·벤처투자 시장 주제로 구글 뉴스를 직접 찾는다. 무엇을 실을지는 선정 AI가 정한다.
 */
import { fetchGoogleNews } from './collector';

const TOPICS = ['중소벤처기업부 스타트업', '중기부 벤처', '모태펀드', '벤처투자 시장', '창업 지원 정책', '액셀러레이터 선정', '팁스 운영사', '벤처펀드 결성'];

export interface IndustryNewsItem { title: string; url: string; source: string; pubDate: Date }

export async function loadIndustryNews(since: Date, until?: Date): Promise<IndustryNewsItem[]> {
  const results = await Promise.all(TOPICS.map(t => fetchGoogleNews(t).catch(e => {
    console.warn(`[industry-news] ${t} 검색 실패:`, e);
    return [];
  })));
  const seen = new Set<string>();
  return results.flat().flatMap(a => {
    const key = a.title.replace(/\s+/g, '');
    if (a.pubDate < since || (until && a.pubDate >= until) || seen.has(key)) return [];
    seen.add(key);
    return [{ title: a.title, url: a.link, source: a.source, pubDate: a.pubDate }];
  });
}
