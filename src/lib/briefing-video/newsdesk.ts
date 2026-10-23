/**
 * Claw-e 뉴스데스크(위클리 브리핑) — 매주 월요일 09:45, 데일리 대신 나간다.
 *
 * 기사 선정은 데일리와 같은 곳(briefing-reco.ts)에서 한다 — 월요일 방송은 broadcastFor()가
 * program='weekly'로 잡고, 지난주 화 00:00 ~ 일 24:00 기사에서 스파크랩·포트폴리오 우선,
 * 데일리와 같은 칸 규칙으로 10개를 고른다. 2026-10-23부터 대본·화면·길이도 데일리와 같다(소윤) — 사실만 전달하는
 * 더벨식 대본(헤드라인·리드·라벨 사실 + 원문 대조), 헤드라인 보드 화면, 3분 10~20초(4분 넘으면 뒤 칸부터 제외).
 * 그래서 검수 화면의 [바꾸기]·저장도 데일리와 똑같이 먹고, 스냅샷·영상 기록·잔디 전송도 같은 길로 간다.
 *
 * 데일리와 다른 건 목소리(Leda)·인사말·오프닝 타이틀 GIF·마무리 서울 야경 GIF뿐이다. 에셋: assets/newsdesk/.
 * 기사 화면은 헤드라인 보드라 Claw-e 그림은 오프닝·마무리에만 남는다(보드 오른쪽 분류 글자와 겹쳐서).
 */
import path from 'path';
import { loadImage } from '@napi-rs/canvas';
import { broadcastFor, type BriefingSnapshot } from '../sparkscope/briefing';
import { writeBriefingScript, checkAlignment, WEEKLY_LENGTH, type ScriptSegment } from './script';
import { synthesizeAll, type VoiceSpec } from './tts';
import { boardSlide, outroSlide } from './slides';
import { renderVideo, silentWav, GAP_SECONDS, type Clip } from './render';
import { NEWS_BGM, OPENING_SECONDS, MAX_VIDEO_SECONDS, trimToLimit, buildOverview } from './build';

const ASSETS = path.join(process.cwd(), 'assets/newsdesk');
const PROGRAM = 'Claw-e 뉴스데스크';

/** 목소리 — 2026-10-01 소윤·이수 확정: Leda(밝은 여성 앵커), 1.12배속. Orus·Achird·앵커 톤 시안과 비교해 고름. */
export const NEWSDESK_VOICE: VoiceSpec = {
  model: 'gemini-2.5-flash-tts',
  name: 'Leda',
  style: '밝고 친근한 주간 뉴스 진행자처럼, 또렷하고 경쾌하게 읽어 주세요.',
  speed: 1.12,
};

/** 방송일(월) → "9월 29일부터 10월 4일까지" */
export function weekLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return broadcastFor(new Date(Date.UTC(y, m - 1, d, -1))).label; // 그날 08:00 KST 기준
}

export interface BuiltNewsdesk {
  snapshot: BriefingSnapshot;
  segments: ScriptSegment[];
  file: string;
  seconds: number;
  overview?: string;
}

export async function buildNewsdeskVideo(opts: { outDir: string; snapshot: BriefingSnapshot }): Promise<BuiltNewsdesk> {
  const { snapshot } = opts;
  const label = weekLabel(snapshot.dateKey);
  console.log(`[newsdesk] ${label} · ${snapshot.headlines.length}개`);

  // 대본은 데일리와 같은 지시(사실만)에 글자 수만 조금 줄인 WEEKLY_LENGTH + 헤드라인·리드·라벨 사실·원문 대조(withHeadline).
  const written = await writeBriefingScript(snapshot, {
    // 2026-10-01 소윤 확정 문구
    intro: `안녕하세요, 클로이 뉴스데스크의 클로이입니다! ${label}, 지난 한 주 꼭 짚어야 할 소식을 모아 왔어요.`,
    length: WEEKLY_LENGTH,
    withHeadline: true,
    // 인사·마무리가 데일리보다 10초 가까이 길어 기사당 글자를 조금 줄인다(10/19 샘플: 125~140자 → 3분 28초).
    chars: { min: 100, max: 140, target: '115~130' },
    outro: '오늘의 위클리 브리핑은 여기까지입니다. 자세한 내용은 이메일로 보내드린 스파크스코프에서 확인해 주세요. 함께해 주셔서 감사합니다. 다음 브리핑에서 뵙겠습니다!',
  });
  const problems = checkAlignment(written, snapshot.headlines);
  if (problems.length > 0) throw new Error(`대본·화면 대조 실패 — 발행 중단:\n${problems.join('\n')}`);

  const synth = await synthesizeAll(written.map(s => s.text), NEWSDESK_VOICE);
  console.log(`[newsdesk] 음성 ${synth.voice}`);
  // 4분 상한 — 데일리와 같다(뒤 칸 기사부터 제외, 음성 재합성 없음).
  const trimmed = trimToLimit(snapshot.headlines, written, synth.speeches);
  const { segments, speeches } = trimmed;
  trimmed.headlines = trimmed.headlines.map(h => ({ ...h }));
  segments.forEach(s => {
    if (s.kind !== 'item') return;
    const h = trimmed.headlines[s.index!];
    if (s.headline) h.headline = s.headline;
    if (s.brief) h.brief = s.brief;
    if (s.points) h.points = s.points;
  });
  snapshot.headlines = trimmed.headlines;
  const overview = buildOverview(snapshot.dateKey, trimmed.headlines, '스파크스코프 위클리 주요 뉴스');

  // Claw-e는 오프닝·마무리에만(정지 그림) — 기사 화면은 헤드라인 보드라 오른쪽 분류 글자와 겹친다.
  const host = { program: PROGRAM, hostSpace: true, hostImage: await loadImage(path.join(ASSETS, 'claw-e.png')) };
  const clips: Clip[] = [
    // 오프닝 — 타이틀 GIF 위로 뉴스 배경음악만(OPENING_SECONDS), 인사 동안엔 낮게 깔았다가 줄인다.
    { png: boardSlide(label, trimmed.headlines, -1, PROGRAM), wav: silentWav(OPENING_SECONDS), seconds: OPENING_SECONDS,
      backgroundGif: path.join(ASSETS, 'title.gif'), bgm: { file: NEWS_BGM, start: 0, volume: 0.9 } },
    ...segments.map((s, i): Clip => ({
      png: s.kind === 'intro' ? boardSlide(label, trimmed.headlines, -1, PROGRAM)
        : s.kind === 'outro' ? outroSlide(label, host)
        : boardSlide(label, trimmed.headlines, s.index!, PROGRAM),
      wav: speeches[i].wav,
      seconds: speeches[i].seconds,
      // 오프닝은 타이틀 GIF, 마무리는 서울 야경 엔딩 GIF.
      ...(s.kind === 'intro' ? { backgroundGif: path.join(ASSETS, 'title.gif'), bgm: { file: NEWS_BGM, start: OPENING_SECONDS + GAP_SECONDS, volume: 0.15, fadeOut: true } }
        : s.kind === 'outro' ? { backgroundGif: path.join(ASSETS, 'ending.gif') }
        : {}),
    }))];

  const file = path.join(opts.outDir, `newsdesk-${snapshot.dateKey}.mp4`);
  const seconds = await renderVideo(clips, path.join(opts.outDir, 'work'), file);
  console.log(`[newsdesk] 영상 ${seconds.toFixed(1)}초 → ${file}`);
  if (seconds > MAX_VIDEO_SECONDS) console.warn(`[newsdesk] 상한 초과(${Math.round(seconds)}초) — 최소 기사 수까지 줄여도 넘었다`);
  return { snapshot, segments, file, seconds, overview };
}
