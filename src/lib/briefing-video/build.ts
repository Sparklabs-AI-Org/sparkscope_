/**
 * 데일리 브리핑 영상 한 편을 만든다 — 스냅샷 준비 → 대본 → 음성 → 슬라이드 → MP4.
 * GitHub Actions(daily-briefing.yml)와 로컬(scripts/build-briefing.ts)이 같은 함수를 쓴다.
 */
import path from 'path';
import { loadSendArticles, buildDigestForSend } from '../sparkscope/runner';
import { publishBriefingSnapshot, loadBriefingSnapshot, kstDateKey, type BriefingSnapshot } from '../sparkscope/briefing';
import { getBriefingRecommendation } from '../sparkscope/briefing-reco';
import type { AnalyzedArticle } from '../sparkscope/types';
import { writeBriefingScript, checkAlignment, spokenDate, longDate, DAILY_LENGTH, type ScriptSegment } from './script';
import type { BriefingHeadline } from '../sparkscope/briefing';
import { synthesizeAll } from './tts';
import { boardSlide, outroSlide, openingSlide } from './slides';
import { renderVideo, probeSeconds, silentWav, GAP_SECONDS, type Clip } from './render';

/** 오프닝 배경음악 — scripts/make-news-bgm.py로 만든 자체 제작 음원(저작권 걱정 없음). 다른 음원을 쓰려면 이 파일만 바꾸면 된다. */
export const NEWS_BGM = path.join(process.cwd(), 'assets/briefing/news-bgm.wav');
export const OPENING_SECONDS = 3.2;
/** 영상 전체 상한 — 목표 3분 30초 내외, 4분(240초)을 넘으면 우선순위가 낮은(뒤 칸) 기사부터 뺀다(2026-10-22). */
export const MAX_VIDEO_SECONDS = 240;
const MIN_ITEMS = 6;

/**
 * 오늘 헤드라인 스냅샷을 새로 만든다 — 09:30 메일과 같은 재료·같은 조립(buildDigestForSend)에서
 * 편집자 저장 → 추천 → 메일 TOP3 순으로 고른다. 영상은 이 시점의 결과로 확정된다.
 */
export async function prepareSnapshot(): Promise<BriefingSnapshot> {
  const raw = await loadSendArticles();
  const analyzed: AnalyzedArticle[] = (raw as any[]).map(a => ({
    ...a,
    relatedCompanies: typeof a.relatedCompanies === 'string' ? JSON.parse(a.relatedCompanies) : (a.relatedCompanies ?? []),
  }));
  const data = await buildDigestForSend(analyzed);
  const reco = await getBriefingRecommendation().catch(e => {
    console.error('[briefing] 추천 실패 — 메일 TOP3 기반으로 대신합니다:', e);
    return null;
  });
  return publishBriefingSnapshot(data, reco?.headlines ?? null);
}

export interface BuiltBriefing {
  snapshot: BriefingSnapshot;
  segments: ScriptSegment[];
  file: string;
  seconds: number;
  /** 더벨 데일리 브리핑 형식의 개요 한 문단(영상 설명·페이지용) */
  overview?: string;
}

/**
 * 같은 기사를 두 번 싣지 않는다 — 주소가 같거나, 제목 앞부분(한글·영문·숫자만)이 같으면 뒤의 것을 뺀다.
 * 2026-10-13 사고: 화웨이·밀레니얼웍스가 헤드라인에 두 번씩 들어가 영상에도 두 번 나갔다.
 */
export function dedupeHeadlines<T extends { url: string; title: string }>(hs: T[]): T[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  return hs.filter(h => {
    const t = h.title.replace(/\[[^\]]*\]/g, '').replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase().slice(0, 20);
    if (urls.has(h.url) || (t && titles.has(t))) return false;
    urls.add(h.url);
    if (t) titles.add(t);
    return true;
  });
}

/** "2026년 10월 22일 (목)" — 오프닝 타이틀 날짜. */
function openingDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

/** 더벨 형식 개요 — "○○ 주요 뉴스의 핵심 내용은? A, B, … 그리고 N." 제목을 그대로 나열하므로 새 사실이 들어가지 않는다. */
export function buildOverview(dateKey: string, headlines: BriefingHeadline[]): string {
  const titles = headlines.map(h => h.headline ?? h.title);
  const list = titles.length > 1 ? `${titles.slice(0, -1).join(', ')}, 그리고 ${titles[titles.length - 1]}` : titles[0] ?? '';
  return `${longDate(dateKey)} 스파크스코프 주요 뉴스의 핵심 내용은? ${list} 소식입니다.`;
}

/** 영상 총 길이 추정 — render.ts와 같은 규칙(장면마다 음성 + GAP). 오프닝 포함. */
function estimateSeconds(speeches: { seconds: number }[]): number {
  return OPENING_SECONDS + GAP_SECONDS + speeches.reduce((n, sp) => n + sp.seconds + GAP_SECONDS, 0);
}

/**
 * 5분 상한 맞추기. 기사는 칸 순서(스파크랩 → 국내 포폴 → 해외 포폴 → AI → 스타트업계)로 정렬돼 있어
 * 뒤에서부터 빼면 우선순위가 낮은 것부터 빠진다. 최소 MIN_ITEMS건은 남긴다.
 * 빠진 기사에 붙어 있던 섹션 전환 멘트는 그 기사와 함께 사라지므로 남은 칸의 대본은 그대로 맞는다.
 */
export function trimToLimit<T extends { seconds: number }>(
  headlines: BriefingHeadline[], segments: ScriptSegment[], speeches: T[],
): { headlines: BriefingHeadline[]; segments: ScriptSegment[]; speeches: T[] } {
  let keep = headlines.map((_, i) => i);
  const pick = () => {
    const kept = new Set(keep);
    const idx = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'item' || kept.has(s.index!));
    return idx;
  };
  let cur = pick();
  while (estimateSeconds(cur.map(({ i }) => speeches[i])) > MAX_VIDEO_SECONDS && keep.length > MIN_ITEMS) {
    const dropped = keep[keep.length - 1];
    keep = keep.slice(0, -1);
    cur = pick();
    console.warn(`[briefing] 5분 상한 — ${dropped + 1}번째 기사 제외(${headlines[dropped].title.slice(0, 30)})`);
  }
  const remap = new Map(keep.map((old, n) => [old, n] as [number, number]));
  return {
    headlines: keep.map(i => headlines[i]),
    segments: cur.map(({ s }) => (s.kind === 'item' ? { ...s, index: remap.get(s.index!)! } : s)),
    speeches: cur.map(({ i }) => speeches[i]),
  };
}

export async function buildBriefingVideo(opts: { outDir: string; prepare?: boolean; snapshot?: BriefingSnapshot }): Promise<BuiltBriefing> {
  // snapshot을 직접 넘기면 DB를 읽거나 쓰지 않는다(시험 제작용).
  const loaded = opts.snapshot
    ? opts.snapshot
    : opts.prepare
    ? await prepareSnapshot()
    : (await loadBriefingSnapshot()) ?? (await prepareSnapshot());
  const snapshot = { ...loaded, headlines: dedupeHeadlines(loaded.headlines) };
  if (snapshot.headlines.length === 0) throw new Error('헤드라인이 없습니다 — 영상을 만들 수 없음');
  console.log(`[briefing] ${snapshot.program ?? 'daily'} 헤드라인 ${snapshot.headlines.length}건 (${snapshot.source})`);
  // 월요일은 위클리(Claw-e 뉴스데스크) — 같은 스냅샷을 다른 화면·목소리로.
  if (snapshot.program === 'weekly') {
    const { buildNewsdeskVideo } = await import('./newsdesk');
    return buildNewsdeskVideo({ outDir: opts.outDir, snapshot });
  }

  const written = await writeBriefingScript(snapshot, { length: DAILY_LENGTH, withHeadline: true });
  console.log(`[briefing] 대본 ${written.reduce((n, s) => n + s.text.length, 0)}자`);
  // 화면과 말이 어긋나면 영상을 만들지 않는다 — 잘못된 영상이 잔디·브리핑 페이지로 나가는 것을 막는다.
  const problems = checkAlignment(written, snapshot.headlines);
  if (problems.length > 0) {
    throw new Error(`대본·화면 대조 실패 — 발행 중단:\n${problems.join('\n')}`);
  }

  const dateLabel = spokenDate(snapshot.dateKey);
  // 음성은 하나씩 — 동시에 보내면 Gemini TTS 분당 한도(429)에 걸린다(tts.ts synthesizeAll).
  const synth = await synthesizeAll(written.map(s => s.text));
  console.log(`[briefing] 음성 ${synth.voice}`);
  // 5분 상한 — 넘으면 뒤 칸(우선순위 낮은) 기사부터 뺀다. 이미 만든 음성을 그대로 쓰므로 다시 합성하지 않는다.
  const trimmed = trimToLimit(snapshot.headlines, written, synth.speeches);
  const { segments, speeches } = trimmed;
  // 화면용 헤드라인·글용 요약을 헤드라인에 붙인다 — 슬라이드·브리핑 페이지·잔디가 이 값을 읽는다.
  trimmed.headlines = trimmed.headlines.map(h => ({ ...h }));
  segments.forEach(s => {
    if (s.kind !== 'item') return;
    const h = trimmed.headlines[s.index!];
    if (s.headline) h.headline = s.headline;
    if (s.brief) h.brief = s.brief;
    if (s.points) h.points = s.points;
  });
  const overview = buildOverview(snapshot.dateKey, trimmed.headlines);
  snapshot.headlines = trimmed.headlines;
  const clips: Clip[] = [
    // 오프닝 — 말 없이 뉴스 배경음악 + 타이틀 화면(OPENING_SECONDS), 이어지는 인사 동안 음악을 낮게 깔고 끝에서 줄인다.
    { png: openingSlide(openingDate(snapshot.dateKey), '데일리 브리핑', 'image/png', '스파크스코프 주요 뉴스'), wav: silentWav(OPENING_SECONDS), seconds: OPENING_SECONDS, bgm: { file: NEWS_BGM, start: 0, volume: 0.9 } },
    ...segments.map((s, i): Clip => ({
      png: s.kind === 'intro' ? boardSlide(dateLabel, trimmed.headlines, -1)
        : s.kind === 'outro' ? outroSlide(dateLabel)
        : boardSlide(dateLabel, trimmed.headlines, s.index!),
      wav: speeches[i].wav,
      seconds: speeches[i].seconds,
      ...(s.kind === 'intro' ? { bgm: { file: NEWS_BGM, start: OPENING_SECONDS + GAP_SECONDS, volume: 0.15, fadeOut: true } } : {}),
    })),
  ];

  const file = path.join(opts.outDir, `briefing-${snapshot.dateKey || kstDateKey()}.mp4`);
  const seconds = await renderVideo(clips, path.join(opts.outDir, 'work'), file);
  // 싱크 확인 — 완성 파일 길이가 장면 길이 합과 1초 넘게 다르면 화면과 음성이 어긋난 것이므로 발행을 막는다.
  const actual = await probeSeconds(file);
  if (Math.abs(actual - seconds) > 1) {
    throw new Error(`영상 길이 불일치 — 장면 합 ${seconds.toFixed(2)}초 · 파일 ${actual.toFixed(2)}초. 싱크가 깨졌으니 발행하지 않습니다.`);
  }
  console.log(`[briefing] 싱크 확인 통과 — 파일 ${actual.toFixed(2)}초`);
  console.log(`[briefing] 영상 ${seconds.toFixed(1)}초 → ${file}`);
  if (seconds > MAX_VIDEO_SECONDS) console.warn(`[briefing] 상한 초과(${Math.round(seconds)}초) — 기사 ${MIN_ITEMS}건까지 줄여도 상한을 넘었다`);
  return { snapshot, segments, file, seconds, overview };
}
