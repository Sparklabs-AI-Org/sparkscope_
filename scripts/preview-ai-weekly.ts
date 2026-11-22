/**
 * 스파크랩 AI 위클리 영상 만들기 — 발행하지 않는다(대시보드·잔디·메일·데일리 기록을 건드리지 않음).
 * ai-weekly-preview.yml이 부른다. 결과: out/ai-weekly/ai-weekly-<날짜>.mp4, preview.md, segments.json, seconds.txt
 *
 *   npx tsx scripts/preview-ai-weekly.ts data/ai-weekly/2026-11-23.json [--out DIR] [--check]
 *
 * --check: 영상을 만들지 않고 대조 검사·글자 수만 본다(로컬에서 푸시 전에 확인, 자격 증명 불필요).
 */
import './_env';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
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
  const { aiWeeklyHeadlines, aiWeeklySegments, buildAiWeeklyVideo } = await import('../src/lib/briefing-video/ai-weekly');
  const { checkAlignment } = await import('../src/lib/briefing-video/script');
  if (process.argv.includes('--check')) {
    const segments = aiWeeklySegments(fixed);
    const problems = checkAlignment(segments, aiWeeklyHeadlines(fixed));
    segments.forEach(s => console.log(`[${s.kind}${s.index ?? ''}] (${s.text.length}자) ${s.text}`));
    const chars = segments.reduce((n, s) => n + s.text.length, 0);
    // 데일리 실측(11/20: 1,111자 → 120.3초, 장면 사이 0.6초 포함)으로 어림잡은 길이
    console.log(`\n총 ${chars}자 · 예상 약 ${Math.round(chars / 10 + segments.length * 0.6)}초 (상한 180초)`);
    console.log(problems.length ? `대조 실패:\n${problems.join('\n')}` : '대조 통과');
    process.exit(problems.length ? 1 : 0);
  }
  const outDir = argOf('--out') ?? 'out/ai-weekly';
  mkdirSync(outDir, { recursive: true });
  const built = await buildAiWeeklyVideo({ outDir, fixed });
  const lines = [`# 스파크랩 AI 위클리 ${fixed.rangeLabel} (${fixed.dateKey} 미팅용, 발행 안 됨)`, '', `길이 ${built.seconds.toFixed(1)}초`, '', '## 기사', ''];
  fixed.items.forEach((it, i) => lines.push(`${i + 1}. [${it.label}] ${it.headline} — ${it.source}`, `   ${it.url}`));
  lines.push('', '## 대본', '', ...built.segments.map(s => `[${s.kind}${s.index ?? ''}] ${s.text}\n`));
  writeFileSync(path.join(outDir, 'preview.md'), lines.join('\n'));
  writeFileSync(path.join(outDir, 'segments.json'), JSON.stringify(built.segments, null, 2));
  writeFileSync(path.join(outDir, 'seconds.txt'), built.seconds.toFixed(1));
  console.log(lines.join('\n'));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
