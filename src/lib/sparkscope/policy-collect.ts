/**
 * 깡프로 스타트업 뉴스 수집 — 네이버 블로그 RSS + 글 본문 파싱.
 *
 * 무엇을 수집하는가:
 *   블로그 글 자체가 아니라 **그 글이 고른 기사들**을 수집한다. 이 블로그는 매일 아침
 *   정부지원사업·벤처투자·스타트업 기사를 15~20건 골라 번호를 붙여 올린다. 가치는
 *   큐레이션에 있으므로, 글 하나를 기사 하나로 저장하면 정작 그 안의 기사들을 잃는다.
 *   그래서 글을 파싱해 항목마다 Article 한 행을 만든다(2026-10-26 실측: 글 1개 → 19건).
 *
 * 왜 RSS만으로 안 되는가:
 *   rss.blog.naver.com의 <description>은 454자에서 잘린다(실측). 앞의 6~7건만 들어 있어
 *   나머지를 통째로 놓친다. 그래서 RSS는 "새 글이 올라왔나"를 아는 데만 쓰고, 항목은
 *   글 본문에서 읽는다.
 *
 * 왜 PostView.naver인가:
 *   blog.naver.com/{id}/{logNo}는 본문이 iframe 안에 있는 껍데기다. 실제 본문은
 *   PostView.naver가 돌려준다. 본문 영역은 스마트에디터ONE의 .se-main-container 하나다.
 *
 * naver.me 단축링크:
 *   고른 기사 상당수가 naver.me 단축주소다. 그대로 저장하면 (1) 같은 기사를 다른 주소로
 *   중복 저장하고 (2) 매체명을 알 수 없다. 리다이렉트를 따라가 n.news.naver.com 주소로
 *   펴서 저장하고, 매체명은 그 페이지의 언론사 로고 alt에서 읽는다.
 *
 * ── 데모데이(demoday.co.kr/policy) ──────────────────────────────────────────
 *
 * 깡프로와 달리 남의 기사를 모아주는 곳이 아니라 **자기가 쓴 글**이다(정부지원사업
 * TOP100·K-Startup 주간 공고 등). 그래서 글 하나를 기사 하나로 저장한다.
 *
 * 목록을 어떻게 아는가 — sitemap/1.xml:
 *   RSS가 없고 /policy 목록 페이지는 자바스크립트로 그려져 HTML에 주소가 없다.
 *   대신 사이트맵에 /policy/ 주소가 232개(2026-10-26) 들어 있다. robots.txt는
 *   /policy를 허용하고 /api/는 막고 있어, 내부 API는 쓰지 않고 사이트맵만 쓴다.
 *
 * lastmod는 못 믿는다:
 *   232개가 전부 같은 값이다(사이트맵을 만든 시각). 신선도 판단에 쓸 수 없어,
 *   **이미 저장한 주소를 빼는 방식**으로 새 글만 읽는다. 발행일은 글 페이지의
 *   JSON-LD datePublished에서 가져온다.
 *
 * 한계:
 *   - 블로그 글 형식(번호 + 제목 + 다음 줄에 링크)에 기대고 있다. 글쓴이가 형식을 바꾸면
 *     파싱이 0건이 된다 — 조용히 죽지 않도록 호출부에서 0건을 경고로 남긴다.
 *   - 같은 기사를 일반 수집기가 매체 자체 주소로 이미 가져왔을 수 있다. link가 서로 달라
 *     (n.news.naver.com vs 매체 도메인) 중복 제거가 안 된다. 제목 기준 중복 제거는
 *     파이프라인을 건너뛰므로 별건으로 둔다.
 *   - pubDate는 그 기사의 발행일이 아니라 **글이 올라온 날**이다. 본문에 기사 날짜가
 *     없어서다. 당일 아침에 고른 기사들이라 하루 이내 오차다.
 */
import * as cheerio from 'cheerio';
import { parseStringPromise } from 'xml2js';
import type { RawArticle } from './types';
import { normalizeSource } from './media';

export const POLICY_CATEGORY = 'policy_support' as const;

/** 큐레이션 출처 이름 — matchedKeyword에 넣어 화면에서 출처를 구분한다. */
export const POLICY_CURATOR = '깡프로 스타트업 뉴스';

const RSS_URL = 'https://rss.blog.naver.com/startupventure.xml';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchText(url: string, redirect: RequestRedirect = 'follow'): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, redirect });
  } catch (e) {
    console.error('[policy-collect] 요청 실패:', url, e);
    return null;
  }
}

export interface PolicyPost {
  logNo: string;
  title: string;
  pubDate: Date;
}

/** RSS에서 최근 글 목록을 얻는다. days 이내만. */
export async function fetchRecentPosts(days: number): Promise<PolicyPost[]> {
  const res = await fetchText(RSS_URL);
  if (!res?.ok) return [];
  const xml = await res.text();
  const parsed = await parseStringPromise(xml).catch(() => null);
  const items: any[] = parsed?.rss?.channel?.[0]?.item ?? [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const posts: PolicyPost[] = [];
  for (const it of items) {
    const link: string = it.link?.[0] ?? '';
    const m = link.match(/blog\.naver\.com\/[^/]+\/(\d+)/);
    if (!m) continue;
    const pub = new Date(it.pubDate?.[0] ?? '');
    if (isNaN(pub.getTime()) || pub.getTime() < cutoff) continue;
    posts.push({ logNo: m[1]!, title: (it.title?.[0] ?? '').trim(), pubDate: pub });
  }
  return posts;
}

export interface PickedItem {
  no: number;
  title: string;
  url: string;
}

/** 글 본문을 읽어 "번호. 제목 / 다음 줄 링크" 항목들을 뽑는다. */
export async function parsePost(logNo: string): Promise<PickedItem[]> {
  const url =
    `https://blog.naver.com/PostView.naver?blogId=startupventure&logNo=${logNo}` +
    `&redirect=Dlog&widgetTypeCall=true&directAccess=false`;
  const res = await fetchText(url);
  if (!res?.ok) return [];
  const $ = cheerio.load(await res.text());
  const body = $('.se-main-container');
  if (body.length === 0) return [];

  // 블록마다 줄을 만든다. 링크가 제목 바로 다음 줄에 오는 구조라 줄 순서가 중요하다.
  const lines: string[] = [];
  body.find('p, div.se-module-text, a').each((_, el) => {
    const t = $(el).text().replace(/​/g, '').trim();
    if (t) lines.push(t);
  });

  const picks: PickedItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\d{1,2})\.\s+(.{6,})$/);
    if (!m) continue;
    const next = lines[i + 1] ?? '';
    const link = next.match(/^(https?:\/\/\S+)$/)?.[1];
    if (!link) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    picks.push({ no: Number(m[1]), title: m[2]!.trim(), url: link });
  }
  return picks;
}

/** naver.me 단축주소를 펴고, 네이버 뉴스면 매체명까지 읽어 온다. */
export async function resolveLink(url: string): Promise<{ url: string; source: string }> {
  let finalUrl = url;
  if (/^https?:\/\/naver\.me\//.test(url)) {
    const res = await fetchText(url);
    if (res?.url) finalUrl = res.url;
  }
  finalUrl = finalUrl.split('#')[0]!.replace(/[?&](fromRss|trackingCode)=[^&]*/g, '');

  if (/n\.news\.naver\.com/.test(finalUrl)) {
    const res = await fetchText(finalUrl);
    if (res?.ok) {
      const $ = cheerio.load(await res.text());
      // 언론사 로고 <img>는 지연 로딩이라 src/alt가 비어 있다(실측). 메타 태그를 쓴다.
      // twitter:creator가 매체명만 담고, og:article:author는 "연합뉴스 | 네이버" 꼴이다.
      const name =
        $('meta[name="twitter:creator"]').attr('content')?.trim() ||
        $('meta[property="og:article:author"]').attr('content')?.split('|')[0]?.trim() ||
        '';
      if (name) return { url: finalUrl, source: normalizeSource(name) };
    }
    return { url: finalUrl, source: '네이버뉴스' };
  }

  const host = (() => {
    try {
      return new URL(finalUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  return { url: finalUrl, source: normalizeSource(host) };
}

/**
 * 최근 days일치 글에서 고른 기사들을 RawArticle로 만든다.
 * 저장은 호출부(크론 라우트)가 한다 — 다른 수집기와 같은 모양.
 */
export async function collectPolicyArticles(days = 3): Promise<RawArticle[]> {
  const posts = await fetchRecentPosts(days);
  const out: RawArticle[] = [];
  const seen = new Set<string>();

  for (const post of posts) {
    const picks = await parsePost(post.logNo);
    if (picks.length === 0) {
      console.warn(`[policy-collect] 본문 파싱 0건 — 글 형식이 바뀌었을 수 있다: ${post.logNo}`);
      continue;
    }
    for (const p of picks) {
      const { url, source } = await resolveLink(p.url);
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        title: p.title,
        link: url,
        source,
        pubDate: post.pubDate,
        matchedKeyword: POLICY_CURATOR,
        category: POLICY_CATEGORY,
        basePriority: 0,
      });
    }
  }
  return out;
}

// ── 데모데이 ────────────────────────────────────────────────────────────────

export const DEMODAY_SOURCE = '데모데이';
const DEMODAY_SITEMAP = 'https://demoday.co.kr/sitemap/1.xml';

/** 사이트맵에서 /policy/ 글 주소를 모두 얻는다(최신 id가 뒤). */
export async function fetchDemodayUrls(): Promise<string[]> {
  const res = await fetchText(DEMODAY_SITEMAP);
  if (!res?.ok) return [];
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>(https:\/\/demoday\.co\.kr\/policy\/\d+)<\/loc>/g)].map(m => m[1]!);
  // id 오름차순으로 정렬해 호출부가 뒤에서부터(최신부터) 집어가게 한다.
  return [...new Set(urls)].sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()));
}

/** 글 한 편에서 제목과 발행일을 읽는다. */
export async function fetchDemodayPost(url: string): Promise<{ title: string; pubDate: Date } | null> {
  const res = await fetchText(url);
  if (!res?.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().replace(/\s*\|\s*데모데이\s*$/, '').trim();
  if (!title) return null;
  // 발행일은 JSON-LD에 있다. og:article:published_time은 이 사이트에 없다(실측).
  const iso = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  const pubDate = iso ? new Date(iso) : null;
  if (!pubDate || isNaN(pubDate.getTime())) return null;
  return { title, pubDate };
}

/**
 * 아직 저장하지 않은 글만 최신순으로 최대 max편 읽는다.
 * knownLinks를 호출부가 넘긴다 — 수집기가 DB를 직접 보지 않게 해서 다른 수집기와 모양을 맞춘다.
 */
export async function collectDemodayArticles(knownLinks: Set<string>, max = 30): Promise<RawArticle[]> {
  const urls = await fetchDemodayUrls();
  if (urls.length === 0) {
    console.warn('[policy-collect] 데모데이 사이트맵 0건 — 주소나 형식이 바뀌었을 수 있다');
    return [];
  }
  const fresh = urls.filter(u => !knownLinks.has(u)).reverse().slice(0, max);
  const out: RawArticle[] = [];
  for (const url of fresh) {
    const post = await fetchDemodayPost(url);
    if (!post) continue;
    out.push({
      title: post.title,
      link: url,
      source: DEMODAY_SOURCE,
      pubDate: post.pubDate,
      matchedKeyword: DEMODAY_SOURCE,
      category: POLICY_CATEGORY,
      basePriority: 0,
    });
  }
  return out;
}
