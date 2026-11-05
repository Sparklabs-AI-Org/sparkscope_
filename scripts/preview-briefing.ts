/**
 * 오늘 브리핑 시험 제작 — 발행하지 않는다. 메일·잔디·브리핑 페이지·오늘 스냅샷을 건드리지 않고
 * 결과만 파일로 남긴다(out/preview: 영상 + 헤드라인·대본 preview.md). briefing-preview.yml이 부른다.
 *
 *   npx tsx scripts/preview-briefing.ts [--out DIR]
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { buildBriefingVideo } from '../src/lib/briefing-video/build';
import { broadcastFor, kstDateKey, type BriefingSnapshot } from '../src/lib/sparkscope/briefing';
import { pickByTiers, SLOT_LABEL, toHeadline } from '../src/lib/sparkscope/briefing-reco';
import allEdits from '../data/briefing-preview-edits.json';

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const outDir = argOf('--out') ?? 'out/preview';
  mkdirSync(outDir, { recursive: true });
  // 정오가 지나 돌려도 오늘 방송 기준으로 — 오늘 08:30 시점의 창을 쓴다.
  const dateKey = kstDateKey();
  const w = broadcastFor(new Date(`${dateKey}T08:30:00+09:00`));
  console.log(`[preview] ${w.dateKey} 기사 기간 ${w.since.toISOString()} 이후`);
  // 사람이 고른 기사·고친 대본(발행 전 승인 화면이 생기기 전까지 이 파일로 넣는다).
  const edits = (allEdits as Record<string, { drop?: string[]; must?: string[]; script?: Record<string, string> }>)[w.dateKey] ?? {};
  const { picked, tiers } = await pickByTiers(w, edits);

  const lines = [`# ${w.dateKey} 브리핑 시험 제작(발행 안 됨)`, '', '## 헤드라인', ''];
  picked.forEach((c, i) => lines.push(`${i + 1}. [${SLOT_LABEL[tiers[i]] ?? ''}] ${c.title} — ${c.source}`, `   ${c.url}`));
  console.log(lines.join('\n'));

  const snapshot: BriefingSnapshot = {
    dateKey: w.dateKey, program: 'daily', dateLabel: w.dateKey, headlines: picked.map(toHeadline).map(h => {
      const key = Object.keys(edits.script ?? {}).find(k => h.title.includes(k));
      return key ? { ...h, fixedScript: edits.script![key] } : h;
    }), source: 'auto', computedAt: new Date().toISOString(),
  };
  const built = await buildBriefingVideo({ outDir, snapshot });

  const script = built.segments.map(s => `[${s.kind}${s.index ?? ''}] ${s.text}`);
  lines.push('', '## 대본', '', ...script.map(s => `${s}\n`));
  writeFileSync(path.join(outDir, 'preview.md'), lines.join('\n'));
  console.log('\n--- 대본 ---\n' + script.join('\n'));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
