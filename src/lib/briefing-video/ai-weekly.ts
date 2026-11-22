/**
 * 스파크랩 AI 위클리 — 매주 월요일 오전 'AI 미팅'을 시작할 때 회의실 화면에 띄워 전 임직원이 함께 보는 지난 한 주 주요 AI 소식
 * (2026-11-23 첫 회, 김호민 대표님 요청). 데일리 브리핑과 별개 프로그램이다 — 데일리 스냅샷·영상 기록·게시 경로를 건드리지 않는다.
 *
 * 재료는 사람이 확정한 data/ai-weekly/<월요일 날짜>.json 하나뿐이다(기사·화면 헤드라인·대본 모두 사람이 쓴 그대로).
 * AI가 대본을 쓰지 않으므로 OpenAI를 부르지 않는다.
 *
 * 형식(2026-11-22 은빛 확정):
 * - 최장 3분. 기사마다 사실 1문장 + AC·VC 관점 인사이트 1문장. 글로벌 → 국내 → 실무 AI 순.
 * - 진행은 스파크클로 캐릭터 클로이(Claw-e). 회의실 앞 화면에 띄우는 영상이라 기사 사진을 크게 쓴다(사내 미팅 전용, 외부 공개 없음).
 * - 마무리: "인상 깊게 본 소식이 있다면, 이어지는 회의에서 함께 공유해 주세요."
 *
 * 만드는 길은 둘로 나뉜다. 기사 사진이 공개 저장소(GitHub)를 거치지 않게 하려는 것이다.
 *   1) 음성(GitHub Actions, ai-weekly-preview.yml): synthesizeAiWeekly → voice/seg-NN.wav + voice.json
 *   2) 화면·영상(이 PC): renderAiWeekly — 사진을 내려받아 1)의 음성과 합친다.
 */
import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { BriefingHeadline } from '../sparkscope/briefing';
import { checkAlignment, type ScriptSegment } from './script';
import { synthesizeAll, wavSeconds, type VoiceSpec } from './tts';
import { ensureFonts, drawLogo, hangulize, W, H } from './slides';
import { renderVideo, probeSeconds, silentWav, GAP_SECONDS, type Clip } from './render';
import { sectionOf, SECTION_COLOR } from './sections';

const BOARD_BACKGROUND = path.join(process.cwd(), 'assets/briefing/bg-city.mp4');
const NEWS_BED = path.join(process.cwd(), 'assets/briefing/news-bed.m4a');
const CLAWE = path.join(process.cwd(), 'assets/newsdesk/claw-e.png');
const ENDING_GIF = path.join(process.cwd(), 'assets/newsdesk/ending.gif');
const BED_VOLUME = 0.1;
export const PROGRAM = 'AI 위클리';
/** 3분 상한(2026-11-22 은빛). 사람이 확정한 목록이라 기사를 자동으로 빼지 않고, 넘으면 실패시켜 대본을 줄이게 한다. */
export const MAX_SECONDS = 180;

/** 클로이 목소리 — 뉴스데스크 때 정한 Leda(밝은 여성 진행자). 3분에 맞추려고 속도는 데일리(1.25)와 같게. */
export const CLAWE_VOICE: VoiceSpec = {
  model: 'gemini-2.5-flash-tts',
  name: 'Leda',
  style: '밝고 친근한 사내 AI 뉴스 진행자처럼, 또렷하고 경쾌하게 읽어 주세요.',
  speed: 1.25,
};

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
/** 화면 칸 이름(이모지 없이) */
const CHIP: Record<string, string> = {
  [sectionOf({ label: LABEL_GLOBAL })]: '글로벌 AI',
  [sectionOf({ label: LABEL_DOMESTIC })]: '국내 AI·업계',
  [sectionOf({ label: LABEL_PRACTICAL })]: '실무 AI',
};

export interface AiWeeklyItem {
  label: string;
  title: string;
  url: string;
  source: string;
  /** 화면 헤드라인(20~32자) */
  headline: string;
  /** 읽을 대본 — 사실 1문장(원문 본문에서 확인한 것만) + 인사이트 1문장 */
  script: string;
  /** 기사 날짜(KST, YYYY-MM-DD) */
  date?: string;
  /** 기사 대표 사진 주소(og:image). 이 PC에서 렌더할 때 내려받는다. 없으면 색 배경. */
  image?: string;
  /** 함께 볼 기사(위클리 페이지용) */
  related?: { source: string; title: string; url: string }[];
}

export interface AiWeeklyFixed {
  /** 방송(미팅) 날짜 — 월요일 */
  dateKey: string;
  /** 화면의 기간 — "11월 16일~22일" */
  rangeLabel: string;
  rangeSpoken?: string;
  items: AiWeeklyItem[];
}

const COUNT_WORD = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두'];

export function aiWeeklySegments(fixed: AiWeeklyFixed): ScriptSegment[] {
  const n = fixed.items.length;
  const firstGlobal = fixed.items[0] && sectionOf(fixed.items[0]) === sectionOf({ label: LABEL_GLOBAL });
  const segments: ScriptSegment[] = [{
    kind: 'intro',
    text: `안녕하세요, 스파크랩 AI 위클리를 전해 드릴 클로이입니다! 지난 한 주 주요 AI 소식 ${COUNT_WORD[n] ?? n} 가지를 정리했어요.${firstGlobal ? ' 글로벌 소식부터 보겠습니다.' : ''}`,
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
    text: '이번 주 AI 위클리는 여기까지입니다. 이 밖에도 지난주 인상 깊게 본 소식이 있다면, 이어지는 회의에서 함께 공유해 주세요.',
  });
  return segments;
}

export function aiWeeklyHeadlines(fixed: AiWeeklyFixed): BriefingHeadline[] {
  return fixed.items.map(it => ({
    kind: 'intra', ref: it.url, title: it.title, url: it.url, source: it.source, label: it.label,
    summary: it.script, fixedScript: it.script, fixedHeadline: it.headline, headline: it.headline,
  }));
}

function checked(fixed: AiWeeklyFixed): ScriptSegment[] {
  const segments = aiWeeklySegments(fixed);
  // 화면 제목과 말이 같은 기사인지 — 데일리와 같은 대조(대본 앞 150자에 제목 낱말 2개 이상).
  const problems = checkAlignment(segments, aiWeeklyHeadlines(fixed));
  if (problems.length > 0) throw new Error(`대본·화면 대조 실패:\n${problems.join('\n')}`);
  return segments;
}

export interface VoiceManifest {
  dateKey: string;
  voice: string;
  segments: { kind: ScriptSegment['kind']; index?: number; text: string; file: string; seconds: number }[];
}

/** 1) 음성만 만든다(GitHub Actions) — voice/seg-NN.wav와 voice.json. 사진은 다루지 않는다. */
export async function synthesizeAiWeekly(opts: { outDir: string; fixed: AiWeeklyFixed }): Promise<VoiceManifest> {
  const segments = checked(opts.fixed);
  const synth = await synthesizeAll(segments.map(s => s.text), CLAWE_VOICE);
  mkdirSync(opts.outDir, { recursive: true });
  const manifest: VoiceManifest = {
    dateKey: opts.fixed.dateKey,
    voice: synth.voice,
    segments: segments.map((s, i) => {
      const file = `seg-${String(i).padStart(2, '0')}.wav`;
      writeFileSync(path.join(opts.outDir, file), synth.speeches[i].wav);
      return { kind: s.kind, index: s.index, text: s.text, file, seconds: synth.speeches[i].seconds };
    }),
  };
  writeFileSync(path.join(opts.outDir, 'voice.json'), JSON.stringify(manifest, null, 2));
  const total = manifest.segments.reduce((n, s) => n + s.seconds + GAP_SECONDS, 0);
  console.log(`[ai-weekly] 음성 ${synth.voice} · ${manifest.segments.length}개 · 약 ${total.toFixed(1)}초`);
  if (total > MAX_SECONDS) throw new Error(`3분 상한 초과(${total.toFixed(1)}초) — 대본을 줄여 다시 만드세요`);
  return manifest;
}

// ── 화면 ─────────────────────────────────────────────────────────────

function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxWidth) { cur = t; continue; }
    if (!cur) return null;
    lines.push(cur);
    cur = w;
    if (ctx.measureText(cur).width > maxWidth) return null;
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

/** 글자 크기를 줄여 가며 maxLines 안에 맞춘다 */
function fit(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number, sizes: number[], weight = 'ExtraBold') {
  for (const size of sizes) {
    ctx.font = `${size}px "Pretendard ${weight}"`;
    const lines = wrapLines(ctx, text, maxWidth, maxLines);
    if (lines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `${size}px "Pretendard ${weight}"`;
  return { size, lines: wrapLines(ctx, text, maxWidth, 99)?.slice(0, maxLines) ?? [text] };
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 위 띠 — 로고 · AI 위클리 · 기간. 사진 위에서도 읽히게 위쪽을 어둡게 깐다. */
function topBar(ctx: SKRSContext2D, rangeLabel: string) {
  const g = ctx.createLinearGradient(0, 0, 0, 150);
  g.addColorStop(0, 'rgba(8,8,14,0.72)');
  g.addColorStop(1, 'rgba(8,8,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 150);
  const right = drawLogo(ctx, 56, 56, 52, true);
  ctx.font = '24px "Pretendard Bold"';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(PROGRAM, right + 16, 64);
  ctx.textAlign = 'right';
  ctx.fillText(rangeLabel, W - 56, 64);
  ctx.textAlign = 'left';
}

/** 클로이 — 오른쪽 아래 진행자 자리 */
function drawHost(ctx: SKRSContext2D, host: Image, h: number, right: number, bottom: number) {
  const w = (host.width / host.height) * h;
  ctx.drawImage(host, right - w, bottom - h, w, h);
  return right - w;
}

/** 사진을 1280×720으로 꽉 차게 자른다(가운데 기준). 사진이 없으면 칸 색 그라데이션. */
async function photoFrame(file: string | null, color: string): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  if (file) {
    const img = await loadImage(readFileSync(file));
    const s = Math.max(W / img.width, H / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#141418');
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return canvas.toBuffer('image/png');
}

/** 기사 화면 위에 얹는 투명 PNG — 칸 표시 · 번호 · 헤드라인 · 매체 · 클로이 */
function itemOverlay(fixed: AiWeeklyFixed, i: number, host: Image): Buffer {
  ensureFonts();
  const it = fixed.items[i];
  const sec = sectionOf(it);
  const color = SECTION_COLOR[sec];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // 아래쪽을 어둡게 — 헤드라인이 사진 위에서 읽히게
  const g = ctx.createLinearGradient(0, H * 0.38, 0, H);
  g.addColorStop(0, 'rgba(8,8,14,0)');
  g.addColorStop(0.45, 'rgba(8,8,14,0.62)');
  g.addColorStop(1, 'rgba(8,8,14,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.38, W, H * 0.62);
  topBar(ctx, fixed.rangeLabel);

  const hostLeft = drawHost(ctx, host, 270, W - 28, H - 6);
  const left = 64;
  const maxW = hostLeft - left - 24;
  // 헤드라인(최대 2줄)
  const t = fit(ctx, hangulize(it.headline), maxW, 2, [58, 54, 50, 46, 42, 38]);
  const lineH = Math.round(t.size * 1.22);
  const headTop = H - 70 - t.lines.length * lineH;
  // 칸 표시 + 번호
  ctx.font = '24px "Pretendard ExtraBold"';
  const chip = CHIP[sec] ?? it.label;
  const chipW = ctx.measureText(chip).width + 32;
  const chipY = headTop - 62;
  ctx.fillStyle = color.fill;
  roundRect(ctx, left, chipY, chipW, 42, 21);
  ctx.fill();
  ctx.fillStyle = color.ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(chip, left + 16, chipY + 22);
  ctx.font = '24px "Pretendard Bold"';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(`${i + 1} / ${fixed.items.length}`, left + chipW + 16, chipY + 22);
  // 헤드라인
  ctx.font = `${t.size}px "Pretendard ExtraBold"`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  t.lines.forEach((ln, k) => ctx.fillText(ln, left, headTop + (k + 1) * lineH - Math.round(lineH * 0.22)));
  ctx.shadowBlur = 0;
  // 매체 · 날짜
  const [, m, d] = (it.date ?? '').split('-').map(Number);
  ctx.font = '22px "Pretendard SemiBold"';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${it.source}${m && d ? ` · ${m}월 ${d}일` : ''}`, left, H - 34);
  return canvas.toBuffer('image/png');
}

/** 첫 화면 — 도시 배경 영상 위에 제목과 클로이(크게) */
function introOverlay(fixed: AiWeeklyFixed, host: Image): Buffer {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(8,8,14,0.82)');
  g.addColorStop(0.62, 'rgba(8,8,14,0.45)');
  g.addColorStop(1, 'rgba(8,8,14,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  drawLogo(ctx, 80, 150, 64, true);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '108px "Pretendard ExtraBold"';
  ctx.fillText('AI 위클리', 76, 318);
  ctx.globalAlpha = 0.7;
  ctx.fillRect(84, 360, 120, 4);
  ctx.globalAlpha = 1;
  ctx.font = '38px "Pretendard Bold"';
  ctx.fillText(fixed.rangeLabel, 84, 425);
  ctx.font = '26px "Pretendard SemiBold"';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillText('지난 한 주 주요 AI 소식 · 글로벌 · 국내 · 실무', 84, 474);
  // 진행자 이름표
  ctx.font = '24px "Pretendard ExtraBold"';
  const tag = '진행  클로이';
  const tw = ctx.measureText(tag).width + 36;
  ctx.fillStyle = '#F80054';
  roundRect(ctx, 84, 528, tw, 46, 23);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, 102, 552);
  ctx.textBaseline = 'alphabetic';
  drawHost(ctx, host, 560, W - 40, H - 30);
  return canvas.toBuffer('image/png');
}

/** 마무리 — 서울 야경 엔딩 GIF(클로이가 왼쪽에 서 있다) 오른쪽 위 하늘에 인사 */
function outroOverlay(): Buffer {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const x = 690, y = 56, w = 550, h = 200;
  ctx.fillStyle = 'rgba(8,8,14,0.72)';
  roundRect(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '36px "Pretendard ExtraBold"';
  ctx.fillText('이번 주 AI 위클리는 여기까지', x + 36, y + 76);
  ctx.font = '25px "Pretendard SemiBold"';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('인상 깊게 본 소식이 있다면', x + 36, y + 126);
  ctx.fillText('이어지는 회의에서 함께 공유해 주세요', x + 36, y + 162);
  return canvas.toBuffer('image/png');
}

/** 기사 사진 — imagesDir/item-N 이 있으면 그것, 없으면 image 주소에서 내려받아 둔다. */
async function itemPhoto(it: AiWeeklyItem, i: number, imagesDir: string): Promise<string | null> {
  const base = path.join(imagesDir, `item-${i + 1}`);
  if (existsSync(base)) return base;
  if (!it.image) return null;
  try {
    const r = await fetch(it.image, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' } });
    if (!r.ok) throw new Error(String(r.status));
    mkdirSync(imagesDir, { recursive: true });
    writeFileSync(base, Buffer.from(await r.arrayBuffer()));
    return base;
  } catch (e) {
    console.warn(`[ai-weekly] ${i + 1}번 사진 못 받음(색 배경으로): ${e}`);
    return null;
  }
}

export interface BuiltAiWeekly { file: string; seconds: number; segments: VoiceManifest['segments'] }

/**
 * 2) 화면·영상(이 PC) — voiceDir의 음성(1에서 만든 것)과 기사 사진으로 mp4를 만든다.
 * voiceDir 없이 silent=true면 글자 수로 길이를 어림한 무음으로 화면만 미리 본다.
 */
export async function renderAiWeekly(opts: { fixed: AiWeeklyFixed; outDir: string; imagesDir: string; voiceDir?: string; silent?: boolean }): Promise<BuiltAiWeekly> {
  const { fixed } = opts;
  const segments = checked(fixed);
  let voice: VoiceManifest['segments'];
  if (opts.voiceDir) {
    const m = JSON.parse(readFileSync(path.join(opts.voiceDir, 'voice.json'), 'utf8')) as VoiceManifest;
    if (m.segments.length !== segments.length || m.segments.some((s, i) => s.text !== segments[i].text)) {
      throw new Error('음성(voice.json)의 대본이 지금 확정 파일과 다릅니다 — 음성을 다시 만드세요');
    }
    voice = m.segments;
  } else if (opts.silent) {
    voice = segments.map(s => ({ kind: s.kind, index: s.index, text: s.text, file: '', seconds: Math.max(2, s.text.length / 9.8) }));
  } else throw new Error('voiceDir 또는 silent가 필요합니다');

  const host = await loadImage(readFileSync(CLAWE));
  const work = path.join(opts.outDir, 'work');
  mkdirSync(work, { recursive: true });
  const wavOf = (i: number) => (opts.voiceDir ? readFileSync(path.join(opts.voiceDir, voice[i].file)) : silentWav(voice[i].seconds));
  const clips: Clip[] = [];
  let at = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const wav = wavOf(i);
    const seconds = opts.voiceDir ? wavSeconds(wav) : voice[i].seconds;
    const bgm = { file: NEWS_BED, start: at, volume: BED_VOLUME, fadeOut: i === segments.length - 1 };
    if (s.kind === 'intro') {
      clips.push({ png: introOverlay(fixed, host), backgroundVideo: BOARD_BACKGROUND, wav, seconds, bgm });
    } else if (s.kind === 'outro') {
      clips.push({ png: outroOverlay(), backgroundGif: ENDING_GIF, gifOverlayPng: true, wav, seconds, bgm });
    } else {
      const it = fixed.items[s.index!];
      const photo = await itemPhoto(it, s.index!, opts.imagesDir);
      const frame = path.join(work, `photo-${s.index}.png`);
      writeFileSync(frame, await photoFrame(photo, SECTION_COLOR[sectionOf(it)].fill));
      clips.push({ png: itemOverlay(fixed, s.index!, host), backgroundImage: frame, wav, seconds, bgm });
    }
    at += seconds + GAP_SECONDS;
  }
  const file = path.join(opts.outDir, `AI위클리_${fixed.dateKey}${opts.silent ? '_무음미리보기' : ''}.mp4`);
  const seconds = await renderVideo(clips, work, file);
  const actual = await probeSeconds(file);
  if (Math.abs(actual - seconds) > 1) throw new Error(`영상 길이 불일치 — 장면 합 ${seconds.toFixed(2)}초 · 파일 ${actual.toFixed(2)}초(싱크 깨짐)`);
  console.log(`[ai-weekly] 영상 ${seconds.toFixed(1)}초 → ${file}`);
  if (seconds > MAX_SECONDS) console.warn(`[ai-weekly] 3분 상한 초과(${seconds.toFixed(1)}초)`);
  return { file, seconds, segments: voice };
}
