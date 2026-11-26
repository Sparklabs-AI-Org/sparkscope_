// 분석 그래프를 누르면 그 자리 아래에 펼쳐지는 "해당 딜·펀드 목록"(2026-11-26 소윤: 새 화면 대신 드롭다운으로).
// 서버에서 그린다 — 주소의 ?dd=(조건)만 바뀌고 페이지 위치는 그대로(#drill로 이 칸까지 내려온다).
// 20건까지만 보여주고 나머지는 전체 표(/dashboard/deals)로 넘긴다.
import Link from 'next/link';
import type { DealStats } from '@/lib/sparkscope/deal-stats';
import { investorKey, STAGES } from '@/lib/sparkscope/deal-stats';
import type { FundStats } from '@/lib/sparkscope/fund-stats';
import { lpGroup, normSector } from '@/lib/sparkscope/fund-stats';
import { dealsHref, mondayOf, type DealFilter } from '@/lib/sparkscope/deal-links';
import { krw, type T } from './FundAnalysis';

const LIMIT = 20;
const LP_LABEL: Record<string, string> = { mother: '모태펀드', growth: '성장금융·산업은행', local: '지자체·지역', pension: '연기금·공제회', finance: '은행·증권·금융지주', corp: '기업(CVC·대기업)', other: '기타' };
const FUND_STAGE: Record<string, { label: string; cls: string }> = {
  CLOSED: { label: '결성 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  GP_SELECTED: { label: 'GP 선정', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  ANNOUNCED: { label: '출자 공고', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PIPE: { label: '출자 공고·GP 선정', cls: '' },
};

/** ?dd= 값(JSON) → 조건. 깨진 값은 무시. */
export function parseDrill(raw?: string): DealFilter | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw); if (!o || typeof o !== 'object') return null;
    const f: DealFilter = {};
    for (const k of ['sec', 'st', 'inv', 'inv2', 'lp', 'day', 'week', 'pf', 'sized'] as const) if (typeof o[k] === 'string') (f as any)[k] = o[k].slice(0, 100);
    return f;
  } catch { return null; }
}
export const sameDrill = (a: DealFilter | null | undefined, b: DealFilter | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function label(f: DealFilter, t: T): string {
  const st = f.st ? (STAGES.find(s => s.id === f.st)?.label ?? FUND_STAGE[f.st]?.label ?? f.st) : null;
  return [f.sec && t(f.sec), st && t(st), f.inv, f.inv2 && `+ ${f.inv2}`, f.lp && t(LP_LABEL[f.lp] ?? f.lp), f.day, f.week && t('{d} 주', { d: f.week }),
    f.pf && t('우리 포트폴리오'), f.sized && t('금액 공개')].filter(Boolean).join(' · ') || t('전체');
}

function Shell({ title, count, close, full, t, children }: { title: string; count: number; close: string; full: string; t: T; children: React.ReactNode }) {
  return (
    <div id="drill" className="mt-2.5 scroll-mt-20 rounded-xl border-2 border-spark-purple/30 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-extrabold text-spark-ink">▾ {title}</span>
        <span className="text-[12px] text-spark-muted">{t('{n}건', { n: count })}</span>
        <Link href={full} className="ml-auto text-[12px] font-semibold text-spark-purple hover:underline">{t('전체 표로 보기 →')}</Link>
        <Link href={close} scroll={false} className="rounded-md border border-spark-border px-2 py-0.5 text-[11.5px] font-semibold text-spark-muted hover:text-spark-ink">{t('접기')} ✕</Link>
      </div>
      {children}
      {count > LIMIT && <p className="mt-2 text-[11.5px] text-spark-muted">{t('{n}건 중 최근 {m}건만 보여줍니다.', { n: count, m: LIMIT })}</p>}
    </div>
  );
}

export function DealDrill({ stats, f, close, t }: { stats: DealStats; f: DealFilter; close: string; t: T }) {
  const has = (names: string[], want?: string) => !want || names.some(n => investorKey(n) === investorKey(want));
  const rows = stats.rows.filter(r => (!f.sec || r.sector === f.sec) && (!f.st || r.stage === f.st)
    && has(r.investors.map(i => i.name), f.inv) && has(r.investors.map(i => i.name), f.inv2)
    && (!f.day || r.date === f.day) && (!f.week || mondayOf(r.date) === f.week) && (!f.pf || r.portfolio) && (!f.sized || r.amountKrw != null));
  return (
    <Shell title={label(f, t)} count={rows.length} close={close} full={dealsHref('deals', f)} t={t}>
      {rows.length === 0 ? <p className="text-[12px] text-spark-muted">{t('해당하는 딜이 없습니다.')}</p> : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[620px] text-[12.5px]">
            <tbody>
              {rows.slice(0, LIMIT).map(r => (
                <tr key={r.id} className="border-b border-spark-border/60 align-top last:border-0">
                  <td className="whitespace-nowrap px-1 py-1.5 tabular-nums text-spark-muted">{r.date.slice(5)}</td>
                  <td className="px-1 py-1.5 font-semibold text-spark-ink">
                    {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple hover:underline">{r.company} ↗</a> : r.company}
                    {r.portfolio && <span className="ml-1.5 rounded bg-spark-purple/10 px-1.5 py-0.5 text-[10px] font-bold text-spark-purple">{t('포폴')}</span>}
                  </td>
                  <td className="whitespace-nowrap px-1 py-1.5 text-spark-ink-soft">{t(r.sector)} · {t(STAGES.find(s => s.id === r.stage)?.label ?? r.stage)}</td>
                  <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums font-semibold">{r.amountKrw != null ? krw(r.amountKrw, t) : <span className="font-normal text-spark-muted">{t('비공개')}</span>}</td>
                  <td className="px-1 py-1.5 text-[12px] text-spark-ink-soft">
                    {r.investors.length ? r.investors.map((i, k) => <span key={i.name}>{k > 0 && ', '}<span className={i.role === 'LEAD' ? 'font-bold text-spark-ink' : ''}>{i.name}</span></span>) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

export function FundDrill({ stats, f, close, t }: { stats: FundStats; f: DealFilter; close: string; t: T }) {
  const has = (names: string[], want?: string) => !want || names.some(n => investorKey(n) === investorKey(want));
  const rows = stats.rows.filter(r => (!f.sec || r.sectors.some(s => normSector(s) === f.sec))
    && (!f.st || r.stage === f.st || (f.st === 'PIPE' && r.stage !== 'CLOSED')) && has(r.gps, f.inv)
    && (!f.lp || r.lps.some(l => lpGroup(l).id === f.lp)) && (!f.day || r.date === f.day) && (!f.week || mondayOf(r.date) === f.week)
    && (!f.sized || r.sizeKrw != null));
  return (
    <Shell title={label(f, t)} count={rows.length} close={close} full={dealsHref('funds', f)} t={t}>
      {rows.length === 0 ? <p className="text-[12px] text-spark-muted">{t('해당하는 펀드가 없습니다.')}</p> : (
        <ul className="divide-y divide-spark-border/60">
          {rows.slice(0, LIMIT).map(r => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-[12.5px]">
              <span className="tabular-nums text-spark-muted">{r.date.slice(5)}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${FUND_STAGE[r.stage]?.cls ?? ''}`}>{t(FUND_STAGE[r.stage]?.label ?? r.stage)}</span>
              {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-spark-ink hover:text-spark-purple hover:underline">{r.name} ↗</a> : <span className="font-semibold">{r.name}</span>}
              <span className="text-spark-ink-soft">{r.gps.join(', ') || t('GP 미정')}</span>
              {r.lps.length > 0 && <span className="text-[11.5px] text-spark-muted">LP: {r.lps.slice(0, 4).join(', ')}{r.lps.length > 4 ? ' …' : ''}</span>}
              <span className="ml-auto tabular-nums font-semibold">{r.sizeKrw != null ? krw(r.sizeKrw, t) : '—'}{r.sizeIsTarget && <span className="ml-0.5 text-[10.5px] font-normal text-spark-muted">({t('목표')})</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
