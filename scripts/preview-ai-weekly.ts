/**
 * 스파크랩 AI 위클리 영상 만들기 — 발행하지 않는다(대시보드·잔디·메일·데일리 기록을 건드리지 않음). src/lib/briefing-video/ai-weekly.ts 참고.
 *
 *   검사(이 PC, 자격 증명 불필요):  npx tsx scripts/preview-ai-weekly.ts data/ai-weekly/<날짜>.json --check
 *   1) 음성(GitHub Actions):        npx tsx scripts/preview-ai-weekly.ts <json> --voice --out out/ai-weekly/voice
 *   2) 영상(이 PC):                 npx tsx scripts/preview-ai-weekly.ts <json> --render <음성 폴더> --images <사진 폴더> --out <출력 폴더>
 *      화면만 미리 보기(무음):       npx tsx scripts/preview-ai-weekly.ts <json> --silent --images <사진 폴더> --out <출력 폴더>
 */
import './_env';
import { readFileSync } from 'fs';
import type { AiWeeklyFixed } from '../src/lib/briefing-video/ai-weekly';

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const from = process.argv[2];
  if (!from || from.startsWith('--')) throw new Error('확정 파일을 넣으세요. 예: data/ai-weekly/2026-11-23.json');
  const fixed = JSON.parse(readFileSync(from, 'utf8')) as AiWeeklyFixed;
  // script.ts는 불러질 때 OpenAI 클라이언트를 만들어 키가 없으면 죽는다. 위클리는 OpenAI를 부르지 않으므로 없으면 빈 값을 채운다.
  process.env.OPENAI_API_KEY ||= 'unused-by-ai-weekly';
  const w = await import('../src/lib/briefing-video/ai-weekly');
  const { checkAlignment } = await import('../src/lib/briefing-video/script');

  if (process.argv.includes('--check')) {
    const segments = w.aiWeeklySegments(fixed);
    const problems = checkAlignment(segments, w.aiWeeklyHeadlines(fixed));
    segments.forEach(s => console.log(`[${s.kind}${s.index ?? ''}] (${s.text.length}자) ${s.text}`));
    const chars = segments.reduce((n, s) => n + s.text.length, 0);
    // 데일리 실측(11/20: 1,111자 → 120.3초, 장면 사이 0.6초 포함)으로 어림잡은 길이
    console.log(`\n총 ${chars}자 · 예상 약 ${Math.round(chars / 9.8 + segments.length * 0.6)}초 (상한 ${w.MAX_SECONDS}초)`);
    console.log(problems.length ? `대조 실패:\n${problems.join('\n')}` : '대조 통과');
    process.exit(problems.length ? 1 : 0);
  }
  const outDir = argOf('--out') ?? 'out/ai-weekly';
  if (process.argv.includes('--voice')) {
    await w.synthesizeAiWeekly({ outDir, fixed });
    process.exit(0);
  }
  const imagesDir = argOf('--images') ?? `${outDir}/images`;
  const built = await w.renderAiWeekly({ fixed, outDir, imagesDir, voiceDir: argOf('--render'), silent: process.argv.includes('--silent') });
  console.log(`완성: ${built.file} (${built.seconds.toFixed(1)}초)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
