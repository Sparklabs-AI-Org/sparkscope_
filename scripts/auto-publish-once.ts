/**
 * 사람 검토 없이 브리핑을 한 번만 자동으로 만들고 게시한다 — 2026-11-19(목) 은빛 귀국 비행용 1회 예외.
 * publish-prebuilt.yml이 date 입력 'auto-2026-11-19'(실제)·'rehearsal'(리허설)일 때 부른다.
 *
 *   npx tsx scripts/auto-publish-once.ts --date 2026-11-19 --live      실제: 선정 → 제작 → 대조 → 게시 → 잔디
 *   npx tsx scripts/auto-publish-once.ts --rehearsal                   리허설: 오늘 방송 기준으로 선정·제작·대조까지만(게시·잔디 없음)
 *
 * - 일시 정지 스위치(briefing_pause·digest_pause)는 건드리지 않는다. 이 스크립트는 그 스위치를 보지 않고 직접 게시·잔디를 한다.
 *   메일은 보내지 않는다(메일은 Vercel 크론 몫이고 digest_pause로 멈춰 있다).
 * - 실제 게시는 ALLOWED_LIVE_DATES에 있는 날짜만, 그 날 12시(KST) 전까지만 — 그 뒤엔 아무것도 하지 않는다(11/20부터 원래 수동 흐름).
 * - 기사 선정은 기존 자동 경로(briefing-reco.ts pickByTiers)와 같다. 여기서 더 거르는 것:
 *   직전 방송(11/17·11/18 확정본) 기사, 포트폴리오·알럼나이 칸인데 제목에 그 회사 이름이 없는 기사(동음이의어 오매칭), 13건 초과분.
 * - 대본·화면 대조(checkAlignment)에 걸리면 그 기사만 빼고 다시 만든다(최대 3번). 6건 미만이 되면 게시하지 않는다.
 * - 잔디: 환경변수 JANDI_WEBHOOK_URL(GitHub 시크릿)이 있을 때만, 08:30 KST 이후에 은빛 소개글 형식으로 한 번 보낸다.
 */
import './_env';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { buildBriefingVideo, dedupeHeadlines, type BuiltBriefing } from '../src/lib/briefing-video/build';
import { publishBriefingVideo, loadBriefingVideo } from '../src/lib/briefing-video/publish';
import { broadcastFor, kstDateKey, type BriefingHeadline, type BriefingSnapshot } from '../src/lib/sparkscope/briefing';
import { pickByTiers, SLOT_LABEL, toHeadline, titleKey, type BriefingCandidate, type BriefingEdits } from '../src/lib/sparkscope/briefing-reco';
import allEdits from '../data/briefing-preview-edits.json';
import notices from '../data/briefing-notices.json';

const ALLOWED_LIVE_DATES = ['2026-11-19'];
/** 이 시각(KST) 이후엔 실제 게시를 시작하지 않는다 — 늦게 돈 실행이 오후에 영상을 올리지 않게. */
const LIVE_CUTOFF_HOUR = 12;
/** 수집(daily-collect)을 이 시각까지 기다리고, 그래도 안 끝났으면 있는 기사로 만든다. */
const COLLECT_WAIT_UNTIL_MIN = 9 * 60;
const JANDI_NOT_BEFORE_MIN = 8 * 60 + 30;
const MAX_ITEMS = 13;
const MIN_ITEMS = 6;
const SITE = 'https://sparkscope.vercel.app';
/** 직전 방송 — 이 확정본에 있는 기사는 다시 넣지 않는다. */
const PREVIOUS_FIXED = ['data/briefing-fixed-2026-11-17.json', 'data/briefing-fixed-2026-11-18.json'];

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const live = process.argv.includes('--live');
const kstMinutes = () => { const k = new Date(Date.now() + 9 * 3600e3); return k.getUTCHours() * 60 + k.getUTCMinutes(); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const squash = (t: string) => t.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
/** 사람이라면 빼는 기사 — 부고·인사 동정(리허설 11/18: "[부음] 센스톤 대표 부친상"이 포트폴리오 칸에 들어옴). */
const OBITUARY_PERSONNEL = /부음|부고|별세|부친상|모친상|빙부상|빙모상|장인상|장모상|\[인사\]|인사\]|\[동정\]/;
/** 여러 소식을 묶은 정리 글 — 한 사건이 아니다(리허설 11/18: "한국 비즈니스 브리핑 — 2026년 11월 17일"). */
const ROUNDUP_TITLE = /브리핑\s*[—–-]\s*\d{4}년|뉴스\s*브리핑|^(주요 뉴스|오늘의 뉴스|모닝|이브닝)|\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*$|주간\s*(뉴스|이슈|동향)\s*$/;
/** 칸 안내("알럼나이 소식입니다." 등)를 뺀 문장 수 — 기사당 한 문장 규칙(아주 중요할 때 두 문장)을 넘으면 그 칸을 뺀다. */
function bodySentences(text: string): number {
  return text.split(/(?<=[다요]\.)\s+/).map(s => s.trim()).filter(s => s && !/(소식|동향)입니다\.$|^이어서/.test(s)).length;
}

async function waitForCollect(): Promise<void> {
  for (;;) {
    const k = new Date(Date.now() + 9 * 3600e3);
    const todayStartUtc = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600e3);
    const done = await prisma.runLog.count({ where: { runType: 'daily-collect', status: 'SUCCESS', startedAt: { gte: todayStartUtc } } });
    const running = await prisma.runLog.count({ where: { runType: 'daily-collect', status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 3 * 3600e3) } } });
    if (done > 0 && running === 0) { console.log('[auto] 오늘 수집 완료 확인'); return; }
    if (kstMinutes() >= COLLECT_WAIT_UNTIL_MIN) { console.warn('[auto] 09:00 KST까지 수집 완료 기록 없음 — 있는 기사로 진행'); return; }
    console.log(`[auto] ${k.toISOString().slice(11, 16)} KST 수집 대기 중(완료 ${done} · 진행 중 ${running})`);
    await sleep(60_000);
  }
}

function previousBroadcast(): { urls: Set<string>; titles: Set<string> } {
  const urls = new Set<string>();
  const titles = new Set<string>();
  for (const f of PREVIOUS_FIXED) {
    if (!existsSync(f)) continue;
    const fixed = JSON.parse(readFileSync(f, 'utf8')) as { items: { url: string; title: string }[] };
    for (const it of fixed.items) { urls.add(it.url); titles.add(titleKey(it.title)); }
  }
  return { urls, titles };
}

/** company — 국내 기사 후보에만 있는 회사 이름(briefing-reco.ts IntraCandidate) */
interface Pick { c: BriefingCandidate & { company?: string }; tier: number }

/** 기존 자동 선정 + 추가 거르기. */
async function select(dateKey: string): Promise<Pick[]> {
  const w = broadcastFor(new Date(`${dateKey}T08:30:00+09:00`));
  if (w.dateKey !== dateKey) throw new Error(`방송 날짜가 맞지 않습니다: ${w.dateKey} ≠ ${dateKey}`);
  console.log(`[auto] ${w.dateKey} 기사 기간 ${w.since.toISOString()} 이후`);
  const edits = ((allEdits as Record<string, BriefingEdits>)[w.dateKey]) ?? {};
  const { picked, tiers } = await pickByTiers(w, edits);
  const prev = previousBroadcast();
  const out: Pick[] = [];
  (picked as Pick['c'][]).forEach((c, i) => {
    const tier = tiers[i];
    if (prev.urls.has(c.url) || prev.titles.has(titleKey(c.title))) { console.log(`[auto] 직전 방송과 겹침 — 제외: ${c.title.slice(0, 40)}`); return; }
    if (OBITUARY_PERSONNEL.test(c.title)) { console.log(`[auto] 부고·인사 — 제외: ${c.title.slice(0, 40)}`); return; }
    if (ROUNDUP_TITLE.test(c.title)) { console.log(`[auto] 여러 소식 묶음 글 — 제외: ${c.title.slice(0, 40)}`); return; }
    // 국내 포트폴리오·알럼나이 칸은 제목에 그 회사 이름이 있어야 한다(키워드 오매칭·동명 회사 방지 — 사람 검토의 '회사 확인' 대신).
    if ((tier === 2 || tier === 3) && c.company && !squash(c.title).includes(squash(c.company))) {
      console.log(`[auto] 제목에 회사 이름(${c.company}) 없음 — 동음이의어 의심, 제외: ${c.title.slice(0, 40)}`);
      return;
    }
    out.push({ c, tier });
  });
  if (out.length > MAX_ITEMS) {
    for (const p of out.splice(MAX_ITEMS)) console.log(`[auto] ${MAX_ITEMS}건 상한 — 제외: ${p.c.title.slice(0, 40)}`);
  }
  return out;
}

function snapshotOf(dateKey: string, picks: Pick[]): BriefingSnapshot {
  return {
    dateKey, program: 'daily', dateLabel: dateKey, source: 'auto', computedAt: new Date().toISOString(),
    headlines: picks.map(p => toHeadline(p.c)),
  };
}

/** 제작 — 대조 실패한 칸은 빼고 다시 만든다. */
async function buildWithRetry(dateKey: string, initial: Pick[], outDir: string): Promise<{ built: BuiltBriefing; picks: Pick[] }> {
  // build.ts가 먼저 중복을 지우므로, 칸 번호가 맞게 여기서 같은 규칙으로 미리 지운다.
  const keepUrls = new Set(dedupeHeadlines(initial.map(p => ({ url: p.c.url, title: p.c.title }))).map(h => h.url));
  let picks = initial.filter((p, i, arr) => keepUrls.has(p.c.url) && arr.findIndex(x => x.c.url === p.c.url) === i);
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (picks.length < MIN_ITEMS) throw new Error(`기사 ${picks.length}건 — ${MIN_ITEMS}건 미만이라 게시하지 않습니다`);
    console.log(`[auto] 제작 ${attempt}회차 — ${picks.length}건`);
    try {
      const built = await buildBriefingVideo({ outDir, snapshot: snapshotOf(dateKey, picks) });
      // 기사당 한 문장(두 문장까지 허용)·200자 이내 — 넘는 칸은 빼고 다시 만든다.
      const long = new Set(built.segments.filter(s => s.kind === 'item' && (bodySentences(s.text) > 2 || s.text.length > 200))
        .map(s => built.snapshot.headlines[s.index!]?.url).filter(Boolean));
      if (long.size > 0) {
        for (const p of picks.filter(p => long.has(p.c.url))) console.warn(`[auto] 대본이 너무 김 — 빼고 다시 만듦: ${p.c.title.slice(0, 40)}`);
        picks = picks.filter(p => !long.has(p.c.url));
        continue;
      }
      return { built, picks };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes('대본·화면 대조 실패')) {
        const bad = new Set([...msg.matchAll(/^(\d+)번 (?:칸|기사)/gm)].map(m => Number(m[1])));
        if (bad.size === 0) throw e;
        console.warn(`[auto] 대조 실패 — 해당 기사 빼고 다시 만듦:\n${msg}`);
        picks = picks.filter((_, i) => !bad.has(i));
        continue;
      }
      if (msg.includes('영상 길이 불일치') && attempt === 1) { console.warn(`[auto] ${msg} — 한 번 더 만듦`); continue; }
      throw e;
    }
  }
  throw new Error('대조 실패가 계속됨 — 게시하지 않습니다');
}

function writeOutputs(outDir: string, built: BuiltBriefing, picks: Pick[]) {
  const tierOf = new Map(picks.map(p => [p.c.url, p.tier] as [string, number]));
  const lines = [`# ${built.snapshot.dateKey} 자동 브리핑 (${built.snapshot.headlines.length}건, ${built.seconds.toFixed(1)}초)`, '', '## 헤드라인', ''];
  built.snapshot.headlines.forEach((h, i) => lines.push(`${i + 1}. [${SLOT_LABEL[tierOf.get(h.url) ?? 0] ?? h.label}] ${h.headline ?? h.title} — ${h.source}`, `   ${h.title}`, `   ${h.url}`));
  lines.push('', '## 대본', '', ...built.segments.map(s => `[${s.kind}${s.index ?? ''}] ${s.text}\n`));
  writeFileSync(path.join(outDir, 'preview.md'), lines.join('\n'));
  writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(built.snapshot, null, 2));
  writeFileSync(path.join(outDir, 'segments.json'), JSON.stringify(built.segments, null, 2));
  writeFileSync(path.join(outDir, 'seconds.txt'), String(built.seconds));
}

/** 은빛 소개글 형식(메모리 sparkscope-jandi-message-format) — 사람이 쓰던 문장을 칸 정보로 조립한다. */
export function jandiText(built: BriefingSnapshot & { seconds: number }, picks: Pick[], hasAudio: boolean): string {
  const [y, m, d] = built.dateKey.split('-').map(Number);
  const dow = '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const sec = Math.round(built.seconds);
  const byUrl = new Map(picks.map(p => [p.c.url, p] as [string, Pick]));
  const hs = built.headlines.map(h => ({ h, p: byUrl.get(h.url) }));
  const portfolio = hs.filter(x => x.p && x.p.tier >= 2 && x.p.tier <= 4)
    .map(x => x.p!.c.company || (x.h.headline ?? x.h.title).split(/[,，]/)[0]).filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 2);
  // 업계 1건 + AI 2건(없으면 있는 대로) — 헤드라인 안에도 쉼표가 있어 작은따옴표로 묶는다.
  const short = (x: { h: BriefingHeadline }) => `‘${(x.h.headline ?? x.h.title).split('…')[0].replace(/[.。]$/, '').trim()}’`;
  const others = hs.filter(x => x.p && x.p.tier >= 5);
  const ind = others.filter(x => x.p!.tier < 8);
  const ai = others.filter(x => x.p!.tier === 8);
  const industry = [...ind.slice(0, 1), ...ai.slice(0, 2), ...ind.slice(1), ...ai.slice(2)].slice(0, 3).map(short);
  const n = built.headlines.length;
  const body: string[] = [`🎧 ${m}월 ${d}일(${dow}) 스파크스코프 브리핑이 올라왔습니다 (${Math.floor(sec / 60)}분 ${sec % 60}초)`, ''];
  if (portfolio.length && industry.length) {
    body.push(`${portfolio.join('·')} 등 포트폴리오·알럼나이 소식과 함께`, `${industry.join(', ')} 등 업계·AI 소식까지 ${n}건 담았어요.`);
  } else if (portfolio.length) {
    body.push(`${portfolio.join('·')} 등 포트폴리오·알럼나이 소식 ${n}건 담았어요.`);
  } else {
    body.push(`${industry.join(', ')} 등 업계·AI 소식까지 ${n}건 담았어요.`);
  }
  for (const nt of (notices as { from: string; to: string; screen: string[] }[]).filter(x => x.from <= built.dateKey && built.dateKey <= x.to)) {
    body.push(`📢 ${nt.screen.join(' · ')}`);
  }
  body.push(`▶ ${SITE}/briefing/${built.dateKey}`);
  body.push(hasAudio ? '화면을 꺼도 소리로 들을 수 있어요. 기사마다 👍👎 남겨 주시면 매주 커피를 드립니다 ☕' : '기사마다 👍👎 남겨 주시면 매주 커피를 드립니다 ☕');
  return body.join('\n');
}

async function sendJandi(dateKey: string, text: string): Promise<void> {
  const url = process.env.JANDI_WEBHOOK_URL;
  if (!url) { console.warn('[auto] JANDI_WEBHOOK_URL 시크릿 없음 — 잔디는 보내지 않음(영상은 게시됨)'); return; }
  const done = await prisma.dashboardInsight.findUnique({ where: { kind_key: { kind: 'briefing_notified', key: dateKey } } });
  if (done) { console.log('[auto] 오늘 잔디는 이미 보냄 — 건너뜀'); return; }
  while (kstMinutes() < JANDI_NOT_BEFORE_MIN) { console.log('[auto] 08:30 KST 잔디 전송 대기'); await sleep(60_000); }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/vnd.tosslab.jandi-v2+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: text }),
  });
  if (!r.ok) throw new Error(`잔디 전송 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  // 보낸 기록 — 나중에 일시 정지를 풀어도 Vercel 잔디 알림(briefing-notify)이 같은 날 또 보내지 않게.
  await prisma.dashboardInsight.upsert({
    where: { kind_key: { kind: 'briefing_notified', key: dateKey } },
    create: { kind: 'briefing_notified', key: dateKey, value: JSON.stringify({ at: new Date().toISOString(), withVideo: true, by: 'auto-publish-once' }) },
    update: {},
  });
  console.log('[auto] 잔디 전송 완료');
}

(async () => {
  const outDir = arg('--out') ?? 'out/auto';
  mkdirSync(outDir, { recursive: true });
  const dateKey = live ? arg('--date') ?? '' : kstDateKey();
  if (live) {
    if (!ALLOWED_LIVE_DATES.includes(dateKey)) throw new Error(`자동 게시는 ${ALLOWED_LIVE_DATES.join(', ')}만 허용 — ${dateKey}는 하지 않습니다`);
    if (kstDateKey() !== dateKey || kstMinutes() >= LIVE_CUTOFF_HOUR * 60) {
      console.log(`[auto] 지금(${kstDateKey()} ${Math.floor(kstMinutes() / 60)}시 KST)은 ${dateKey} 오전이 아님 — 아무것도 하지 않음`);
      process.exit(0);
    }
    if (await loadBriefingVideo(dateKey)) {
      console.log(`[auto] ${dateKey} 영상이 이미 게시돼 있음 — 아무것도 하지 않음`);
      process.exit(0);
    }
    await waitForCollect();
  } else {
    console.log(`[auto] 리허설 — ${dateKey} 방송 기준, 게시·잔디·DB 기록 없음`);
  }

  const initial = await select(dateKey);
  console.log(`[auto] 선정 ${initial.length}건\n` + initial.map((p, i) => `  ${i + 1}. [${SLOT_LABEL[p.tier]}] ${p.c.title} — ${p.c.source}`).join('\n'));
  const { built, picks } = await buildWithRetry(dateKey, initial, outDir);
  writeOutputs(outDir, built, picks);
  console.log('\n--- 대본 ---\n' + built.segments.map(s => `[${s.kind}${s.index ?? ''}] ${s.text}`).join('\n'));

  if (!live) {
    const text = jandiText({ ...built.snapshot, seconds: built.seconds }, picks, true);
    writeFileSync(path.join(outDir, 'jandi.txt'), text);
    console.log(`\n--- 잔디 메시지(리허설 — 보내지 않음) ---\n${text}\n\nJANDI_WEBHOOK_URL 시크릿: ${process.env.JANDI_WEBHOOK_URL ? '있음' : '없음'}`);
    process.exit(0);
  }

  // 게시 직전에 한 번 더 — 그사이 사람이 수동으로 올렸으면 덮어쓰지 않는다.
  if (await loadBriefingVideo(dateKey)) { console.log('[auto] 제작 중에 영상이 게시됨 — 덮어쓰지 않음'); process.exit(0); }
  const url = await publishBriefingVideo(built);
  console.log(`[auto] 게시: ${url}`);
  const record = await loadBriefingVideo(dateKey);
  const text = jandiText({ ...built.snapshot, seconds: built.seconds }, picks, !!record?.audioUrl);
  writeFileSync(path.join(outDir, 'jandi.txt'), text);
  console.log(`\n--- 잔디 메시지 ---\n${text}`);
  await sendJandi(dateKey, text);
  process.exit(0);
})().catch(async e => {
  console.error('[auto] 실패 — 게시하지 않음:', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
