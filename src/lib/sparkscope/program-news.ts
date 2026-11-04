/**
 * 브리핑 4번 칸 — 스파크랩이 운영하는 사업과 2026 참여기업 소식(2026-11-04 은빛 결정, 송은경 상무 제안).
 *
 * 키워드는 data/program-keywords.json. 이노베이션팀 확인 전 초안이라 아직 MonitoringTarget(수집기)에 넣지 않았다.
 * 그래서 이미 모인 기사에서 찾고, PROGRAM_NEWS_LIVE=1이면 구글 뉴스도 그 자리에서 검색한다(시험 제작용).
 * 구글 RSS에는 본문이 없어 제목으로만 판단한다. 무관한 기사는 뒤의 선정 AI가 한 번 더 거른다.
 */
import { prisma } from '@/lib/prisma';
import { fetchGoogleNews } from './collector';
import data from '../../../data/program-keywords.json';

interface Program { name: string; keywords: string[]; mustAny: string[]; exclude: string[] }
interface Company { name: string; services: string[]; ceo: string; programs: string[]; strict: boolean }

const PROGRAMS = data.programs as Program[];
const COMPANIES = data.companies as Company[];

export interface ProgramHit {
  ref: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  pubDate: Date;
  /** 사업명 또는 「회사(사업명)」 — 선정 AI에게 왜 후보인지 보여 준다 */
  about: string;
}

const squash = (t: string) => t.toLowerCase().replace(/\s+/g, '');
const has = (title: string, word: string) => squash(title).includes(squash(word));

/** 제목이 어느 사업·참여기업 소식인지. 아니면 null. */
export function matchProgramTitle(title: string): string | null {
  for (const p of PROGRAMS) {
    if (!p.keywords.some(k => has(title, k))) continue;
    if (p.exclude.some(k => has(title, k))) continue;
    if (p.mustAny.length > 0 && !p.mustAny.some(k => has(title, k))) continue;
    return p.name;
  }
  for (const c of COMPANIES) {
    const byName = !!c.name && has(title, c.name);
    const byService = c.services.some(s => has(title, s));
    if (!byName && !byService) continue;
    // 흔한 단어와 겹치는 이름은 대표자명·서비스명·「스타트업」이 같이 있어야 인정한다.
    if (c.strict && !(has(title, c.ceo) || (byName && byService) || has(title, '스타트업'))) continue;
    return `${c.name || c.services[0]}(${c.programs[0].replace(/^2026년?\s*/, '')})`;
  }
  return null;
}

async function searchLive(since: Date, until?: Date): Promise<ProgramHit[]> {
  const queries = [...new Set([
    ...PROGRAMS.flatMap(p => p.keywords),
    ...COMPANIES.flatMap(c => [c.name, ...(c.name ? [] : c.services)]).filter(Boolean).map(k => `"${k}"`),
  ])];
  const hits: ProgramHit[] = [];
  let failed = 0;
  for (let i = 0; i < queries.length; i += 6) {
    await Promise.all(queries.slice(i, i + 6).map(async q => {
      try {
        for (const a of await fetchGoogleNews(q)) {
          if (a.pubDate < since || (until && a.pubDate >= until)) continue;
          const about = matchProgramTitle(a.title);
          if (about) hits.push({ ref: a.link, title: a.title, summary: a.title, source: a.source, url: a.link, pubDate: a.pubDate, about });
        }
      } catch { failed++; }
    }));
  }
  console.log(`[program-news] 구글 뉴스 ${queries.length}건 검색(실패 ${failed}) — 후보 ${hits.length}건`);
  return hits;
}

/** 방송 기간의 운영 사업·참여기업 기사. 같은 제목은 하나만. */
export async function loadProgramNews(since: Date, until?: Date): Promise<ProgramHit[]> {
  const rows = await prisma.article.findMany({
    where: { isNoise: false, collectedAt: { gte: since, ...(until ? { lt: until } : {}) } },
    select: { id: true, title: true, link: true, source: true, pubDate: true, oneLiner: true },
    orderBy: { pubDate: 'desc' },
    take: 5000,
  });
  const stored = rows.flatMap(a => {
    const about = matchProgramTitle(a.title);
    return about ? [{ ref: a.id, title: a.title, summary: a.oneLiner || a.title, source: a.source, url: a.link, pubDate: a.pubDate, about }] : [];
  });
  const live = process.env.PROGRAM_NEWS_LIVE === '1' ? await searchLive(since, until) : [];
  const seen = new Set<string>();
  return [...stored, ...live].filter(h => {
    const k = squash(h.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
