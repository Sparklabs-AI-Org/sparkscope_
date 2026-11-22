/**
 * 스파크랩 AI 위클리 — 매주 월요일 오전 'AI 미팅'을 시작할 때 전 임직원이 함께 보는 지난 한 주 주요 AI 소식(2026-11-23 첫 회,
 * 김호민 대표님 요청). 데일리 브리핑과 별개 프로그램이다 — 데일리 스냅샷·영상 기록·게시 경로를 건드리지 않는다.
 *
 * 재료는 사람이 확정한 data/ai-weekly/<월요일 날짜>.json 하나뿐이다(기사·화면 헤드라인·대본 모두 사람이 쓴 그대로).
 * AI가 대본을 쓰지 않으므로 OpenAI를 부르지 않는다. 목소리·배경 영상·배경음악은 데일리와 같다(2026-11-22 은빛).
 *
 * 형식(2026-11-22 은빛 확정): 최장 3분, 데일리처럼 짧게(기사당 1~2문장), 글로벌 → 국내 순.
 * 마무리는 "이야기 나눠 보자"가 아니라 "이 밖에 인상 깊었던 소식이 있다면 공유해 달라"(작위적이지 않게).
 */
import path from 'path';
import type { BriefingHeadline } from '../sparkscope/briefing';
import { checkAlignment, type ScriptSegment } from './script';
import { synthesizeAll } from './tts';
import { boardSlide, outroOverVideo } from './slides';
import { renderVideo, probeSeconds, GAP_SECONDS, type Clip } from './render';
import { sectionOf } from './sections';

const BOARD_BACKGROUND = path.join(process.cwd(), 'assets/briefing/bg-city.mp4');
const NEWS_BED = path.join(process.cwd(), 'assets/briefing/news-bed.m4a');
const BED_VOLUME = 0.1;
export const PROGRAM = 'AI 위클리';
/** 3분 상한(2026-11-22 은빛). 사람이 확정한 목록이라 기사를 자동으로 빼지 않고, 넘으면 실패시켜 대본을 줄이게 한다. */
export const MAX_SECONDS = 180;

/**
 * 화면 칸 — 색은 데일리 섹션 색을 빌린다(sections.ts sectionOf가 라벨로 고른다).
 * '글로벌 AI' → A(하늘색), '국내 AI·업계 동향' → T(남색), '실무 AI' → P(주황). 라벨에 '업계 동향'이 있어야 T로 잡힌다.
 */
export const LABEL_GLOBAL = '🌐 글로벌 AI';
export const LABEL_DOMESTIC = '🇰🇷 국내 AI·업계 동향';
/** 실무에 AI를 쓰는 임직원에게 바로 쓸모 있는 소식(도구 변화·보안 경고·다른 회사 사례) — 주황(P). 2026-11-22 은빛 추가 */
export const LABEL_PRACTICAL = '🛠 실무 AI';
const LEAD: Record<string, string> = {
  [sectionOf({ label: LABEL_GLOBAL })]: '글로벌 소식입니다.',
  [sectionOf({ label: LABEL_DOMESTIC })]: '이어서 국내 소식입니다.',
  [sectionOf({ label: LABEL_PRACTICAL })]: '끝으로 실무에 쓸 만한 소식입니다.',
};

export interface AiWeeklyItem {
  label: string;
  title: string;
  url: string;
  source: string;
  /** 화면 헤드라인(20~32자) */
  headline: string;
  /** 읽을 대본 — 원문 본문에서 확인한 사실만 */
  script: string;
  /** 기사 날짜(KST, YYYY-MM-DD) — 페이지·기록용 */
  date?: string;
}

export interface AiWeeklyFixed {
  /** 방송(미팅) 날짜 — 월요일 */
  dateKey: string;
  /** 화면·인사말의 기간 — "11월 16일~22일" */
  rangeLabel: string;
  /** 인사말에서 읽는 기간 — "11월 16일부터 22일까지" */
  rangeSpoken: string;
  items: AiWeeklyItem[];
}

const COUNT_WORD = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두'];

export function aiWeeklySegments(fixed: AiWeeklyFixed): ScriptSegment[] {
  const n = fixed.items.length;
  const firstGlobal = fixed.items[0] && sectionOf(fixed.items[0]) === sectionOf({ label: LABEL_GLOBAL });
  const segments: ScriptSegment[] = [{
    kind: 'intro',
    text: `안녕하세요, 스파크랩 AI 위클리입니다. ${fixed.rangeSpoken}, 지난 한 주 AI 업계를 흔든 소식 ${COUNT_WORD[n] ?? n} 가지를 정리했습니다.${firstGlobal ? ' 글로벌 소식부터 보겠습니다.' : ''}`,
  }];
  let prev: string | null = null;
  fixed.items.forEach((it, i) => {
    const sec = sectionOf(it);
    // 첫 칸은 인사말이 "글로벌 소식부터"라고 했으니 붙이지 않는다. 칸이 바뀔 때만 한마디.
    const lead = prev === null || sec === prev ? '' : LEAD[sec] ?? '';
    prev = sec;
    segments.push({ kind: 'item', index: i, text: lead ? `${lead} ${it.script}` : it.script, headline: it.headline });
  });
  segments.push({
    kind: 'outro',
    text: '이번 주 AI 위클리는 여기까지입니다. 이 밖에도 지난주 인상 깊게 본 소식이 있다면 함께 공유해 주세요.',
  });
  return segments;
}

export function aiWeeklyHeadlines(fixed: AiWeeklyFixed): BriefingHeadline[] {
  return fixed.items.map(it => ({
    kind: 'intra', ref: it.url, title: it.title, url: it.url, source: it.source, label: it.label,
    summary: it.script, fixedScript: it.script, fixedHeadline: it.headline, headline: it.headline,
  }));
}

export interface BuiltAiWeekly {
  segments: ScriptSegment[];
  headlines: BriefingHeadline[];
  file: string;
  seconds: number;
}

export async function buildAiWeeklyVideo(opts: { outDir: string; fixed: AiWeeklyFixed }): Promise<BuiltAiWeekly> {
  const { fixed } = opts;
  const headlines = aiWeeklyHeadlines(fixed);
  const segments = aiWeeklySegments(fixed);
  // 화면 제목과 말이 같은 기사인지 — 데일리와 같은 대조(대본 앞 150자에 제목 낱말 2개 이상).
  const problems = checkAlignment(segments, headlines);
  if (problems.length > 0) throw new Error(`대본·화면 대조 실패:\n${problems.join('\n')}`);
  console.log(`[ai-weekly] ${fixed.rangeLabel} · ${headlines.length}건 · 대본 ${segments.reduce((n, s) => n + s.text.length, 0)}자`);

  const synth = await synthesizeAll(segments.map(s => s.text));
  console.log(`[ai-weekly] 음성 ${synth.voice}`);
  const { speeches } = synth;
  const clips: Clip[] = segments.map((s, i): Clip => ({
    png: s.kind === 'outro'
      ? outroOverVideo('이번 주 AI 위클리는 여기까지', '인상 깊었던 소식이 있다면 함께 공유해 주세요')
      : boardSlide(fixed.rangeLabel, headlines, s.kind === 'intro' ? -1 : s.index!, PROGRAM, true),
    backgroundVideo: BOARD_BACKGROUND,
    wav: speeches[i].wav,
    seconds: speeches[i].seconds,
    bgm: { file: NEWS_BED, start: speeches.slice(0, i).reduce((n, sp) => n + sp.seconds + GAP_SECONDS, 0), volume: BED_VOLUME, fadeOut: i === segments.length - 1 },
  }));

  const file = path.join(opts.outDir, `ai-weekly-${fixed.dateKey}.mp4`);
  const seconds = await renderVideo(clips, path.join(opts.outDir, 'work'), file);
  const actual = await probeSeconds(file);
  if (Math.abs(actual - seconds) > 1) {
    throw new Error(`영상 길이 불일치 — 장면 합 ${seconds.toFixed(2)}초 · 파일 ${actual.toFixed(2)}초(싱크 깨짐)`);
  }
  console.log(`[ai-weekly] 영상 ${seconds.toFixed(1)}초 → ${file}`);
  if (seconds > MAX_SECONDS) throw new Error(`3분 상한 초과(${seconds.toFixed(1)}초) — 대본을 줄여 다시 만드세요`);
  return { segments, headlines, file, seconds };
}
