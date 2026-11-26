// 투자·펀드 탭 맨 위 "펀드 결성 분석" — 몇 개, 얼마, 누가(GP), 어디 돈으로(LP 재원), 무슨 분야(2026-11-26 소윤).
// 집계는 서버(fund-stats.ts)에서 끝내고 여기선 그리기만 한다. 그래프는 외부 라이브러리 없이 막대로.
import Link from 'next/link';
import type { FundStats, FundStage } from '@/lib/sparkscope/fund-stats';
import { dealsHref } from '@/lib/sparkscope/deal-links';

export type T = (s: string, v?: Record<string, string | number>) => string;

export function krw(v: number, t: T): string {
  if (v >= 1e12) return t('{n}조', { n: (v / 1e12).toFixed(v >= 1e13 ? 0 : 1).replace(/\.0$/, '') });
  if (v >= 1e8) return t('{n}억', { n: Math.round(v / 1e8).toLocaleString() });
  return v > 0 ? t('{n}억', { n: (v / 1e8).toFixed(1) }) : '—';
}

const STAGE: Record<FundStage, { label: string; cls: string; bar: string }> = {
  CLOSED: { label: '결성 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  GP_SELECTED: { label: 'GP 선정', cls: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500' },
  ANNOUNCED: { label: '출자 공고', cls: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400' },
};

export function Kpi({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <div className={`rounded-xl border border-spark-border bg-white px-4 py-3 ${href ? 'h-full transition-colors hover:border-spark-purple/50 hover:bg-spark-purple/[0.03]' : ''}`}>
      <div className="text-[11.5px] font-semibold text-spark-muted">{label}</div>
      <div className="mt-0.5 truncate text-[22px] font-extrabold tabular-nums tracking-tight text-spark-ink" title={value}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-spark-muted">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Card({ title, hint, children, href }: { title: string; hint?: string; children: React.ReactNode; href?: string }) {
  return (
    <div className="rounded-xl border border-spark-border bg-white p-4">
      <div className="mb-3 flex items-baseline gap-2">
        {href ? <Link href={href} className="text-[13.5px] font-extrabold text-spark-ink hover:text-spark-purple">{title} <span className="text-spark-muted">›</span></Link>
          : <h3 className="text-[13.5px] font-extrabold text-spark-ink">{title}</h3>}
        {hint && <span className="text-[11px] text-spark-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function HBars({ items, color }: { items: { label: string; value: number; right: string; href?: string }[]; color: string }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map(i => (
        <li key={i.label}>
          <Link href={i.href ?? '#'} className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-spark-subtle">
            <span className="truncate font-semibold text-spark-ink-soft group-hover:text-spark-purple" title={i.label}>{i.label}</span>
            <span className="h-2.5 rounded-full bg-spark-subtle">
              <span className={`block h-full rounded-full ${color} group-hover:opacity-80`} style={{ width: `${Math.max(4, (i.value / max) * 100)}%` }} />
            </span>
            <span className="tabular-nums text-spark-muted">{i.right}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 추이 막대 — 쌓인 기간이 4주 미만이면 일별, 넘으면 주별. 앞쪽 빈 기간은 잘라낸다(2026-11-26: 수집 시작 전 12주가 0이라 막대가 오른쪽 끝에 몰렸다). */
export interface TrendPoint { key: string; segs: { v: number; color: string }[]; title: string; href?: string }
export function TrendBars({ weekly, daily, t }: { weekly: TrendPoint[]; daily: TrendPoint[]; t: T }) {
  const sum = (p: TrendPoint) => p.segs.reduce((a, x) => a + x.v, 0);
  const firstW = weekly.findIndex(p => sum(p) > 0);
  const weeks = firstW < 0 ? [] : weekly.slice(firstW);
  const byDay = weeks.length < 4;
  const pts = byDay ? daily.slice(-31) : weeks;
  if (!pts.length) return <p className="text-[12px] text-spark-muted">{t('아직 쌓인 기록이 없습니다.')}</p>;
  const max = Math.max(1, ...pts.map(sum));
  const showEach = pts.length <= 16;
  return (
    <div>
      <div className="mb-1 text-[10.5px] text-spark-muted">{byDay ? t('일별 · 기록이 4주 쌓이면 주별로 바뀝니다') : t('주별')}</div>
      <div className="flex h-32 items-end justify-center gap-1.5">
        {pts.map(p => {
          const total = sum(p);
          return (
            <Link key={p.key} href={total > 0 && p.href ? p.href : '#'} scroll={total > 0}
              className={`flex h-full max-w-[2.75rem] flex-1 flex-col items-center justify-end gap-0.5 ${total > 0 ? 'hover:opacity-75' : 'pointer-events-none'}`} title={p.title}>
              {total > 0 && <span className="text-[10px] tabular-nums text-spark-muted">{total}</span>}
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${total ? Math.max(4, (total / max) * 100) : 0}%` }}>
                {p.segs.map((x, i) => x.v > 0 && <div key={i} style={{ height: `${(x.v / total) * 100}%`, background: x.color }} />)}
              </div>
            </Link>
          );
        })}
      </div>
      <div className={`mt-1 flex gap-1.5 text-[10px] tabular-nums text-spark-muted ${showEach ? 'justify-center' : 'justify-between'}`}>
        {showEach ? pts.map(p => <span key={p.key} className="max-w-[2.75rem] flex-1 text-center">{p.key.slice(5)}</span>)
          : <><span>{pts[0]!.key.slice(5)}</span><span>{pts[pts.length - 1]!.key.slice(5)}</span></>}
      </div>
    </div>
  );
}

const STAGE_HEX: Record<FundStage, string> = { CLOSED: '#10b981', GP_SELECTED: '#0ea5e9', ANNOUNCED: '#fbbf24' };
const ORDER: FundStage[] = ['CLOSED', 'GP_SELECTED', 'ANNOUNCED'];

export function FundAnalysis({ stats, t }: { stats: FundStats; t: T }) {
  if (stats.total === 0) {
    return (
      <div className="mb-4 rounded-2xl border border-spark-border bg-white p-5 text-[13px] text-spark-muted">
        {t('최근 {d}일 펀드 결성 분석 — 아직 정리된 펀드가 없습니다. 매일 07:30에 기사에서 펀드를 뽑아 쌓습니다.', { d: stats.days })}
      </div>
    );
  }
  const stageTitle = (k: string, n: Record<FundStage, number>) => `${k} · ${ORDER.filter(s => n[s]).map(s => `${t(STAGE[s].label)} ${n[s]}`).join(' · ')}`;
  const legend = (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-spark-muted">
      {ORDER.map(s => <span key={s} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STAGE_HEX[s] }} />{t(STAGE[s].label)}</span>)}
    </div>
  );
  const maxSec = Math.max(1, ...stats.topSectors.map(x => x.count));
  const sizedPct = Math.round((stats.sizedCount / stats.total) * 100);

  return (
    <section className="mb-4 rounded-2xl border border-spark-border bg-spark-subtle/40 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">📊 {t('펀드 결성 분석')}</h2>
        <span className="text-[13px] text-spark-muted">{t('최근 {d}일 · 기사에서 AI가 뽑은 펀드 {n}개', { d: stats.days, n: stats.total })}</span>
        <Link href="/dashboard/deals?tab=funds&days=90" className="ml-auto text-[12px] font-semibold text-spark-purple hover:underline">{t('펀드 전체 표 보기 →')}</Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label={t('펀드 수')} value={String(stats.total)} href={dealsHref('funds')}
          sub={t('결성 {c} · GP선정 {g} · 공고 {a}', { c: stats.byStage.CLOSED, g: stats.byStage.GP_SELECTED, a: stats.byStage.ANNOUNCED })} />
        <Kpi href={dealsHref('funds', { st: 'CLOSED' })} label={t('결성 완료 금액')} value={krw(stats.closedSumKrw, t)} sub={t('결성 완료로 보도된 펀드 합')} />
        <Kpi href={dealsHref('funds', { st: 'PIPE' })} label={t('조성 예정 금액')} value={krw(stats.targetSumKrw, t)} sub={t('출자 공고·GP 선정 단계 목표액 합')} />
        <Kpi href={stats.topGps[0] ? dealsHref('funds', { inv: stats.topGps[0].name }) : undefined} label={t('최대 GP')} value={stats.topGps[0]?.name ?? '—'}
          sub={stats.topGps[0] ? t('{n}개 펀드 · {v}', { n: stats.topGps[0].count, v: krw(stats.topGps[0].sumKrw, t) }) : undefined} />
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <Card href={dealsHref('funds')} title={t('펀드 소식 추이')} hint={t('막대 = 펀드 수 · 색 = 단계 · 마우스 올리면 내역')}>
          {legend}
          <TrendBars t={t}
            weekly={stats.weekly.map(w => ({ key: w.week, segs: ORDER.map(s => ({ v: w.n[s], color: STAGE_HEX[s] })), title: stageTitle(w.week, w.n), href: dealsHref('funds', { week: w.week }) }))}
            daily={stats.daily.map(d => ({ key: d.day, segs: ORDER.map(s => ({ v: d.n[s], color: STAGE_HEX[s] })), title: stageTitle(d.day, d.n), href: dealsHref('funds', { day: d.day }) }))} />
        </Card>

        <Card title={t('하우스(GP) 순위')} hint={t('펀드 수 · 금액(공동 GP는 나눠 계산)')}>
          {stats.topGps.length ? (
            <HBars color="bg-spark-purple"
              items={stats.topGps.map(g => ({ label: g.name, value: g.count, right: `${g.count}${t('개')} · ${krw(g.sumKrw, t)}`, href: dealsHref('funds', { inv: g.name }) }))} />
          ) : <p className="text-[12px] text-spark-muted">{t('GP가 적힌 기사가 아직 없습니다.')}</p>}
        </Card>

        <Card title={t('출자 재원(LP) — 어디 돈인가')} hint={t('그 재원이 들어간 펀드 수')}>
          {stats.lpMix.length ? (
            <HBars color="bg-sky-500"
              items={stats.lpMix.map(l => ({ label: t(l.label), value: l.funds, right: `${l.funds}${t('개')}`, href: dealsHref('funds', { lp: l.id }) }))} />
          ) : <p className="text-[12px] text-spark-muted">{t('LP가 적힌 기사가 아직 없습니다.')}</p>}
        </Card>

        <Card title={t('투자 분야')} hint={t('펀드가 내건 주목적 분야 · 막대 = 펀드 수, 색 = 단계')}>
          {stats.topSectors.length ? (
            <ul className="space-y-1.5">
              {stats.topSectors.map(x => (
                <li key={x.name} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 text-[12px]">
                  <Link href={dealsHref('funds', { sec: x.name })} className="truncate font-semibold text-spark-ink-soft hover:text-spark-purple hover:underline" title={x.name}>{x.name}</Link>
                  <span className="flex h-4 overflow-hidden rounded" style={{ width: `${Math.max(6, (x.count / maxSec) * 100)}%` }} title={stageTitle(x.name, x.n)}>
                    {ORDER.map(s => x.n[s] > 0 && <Link key={s} href={dealsHref('funds', { sec: x.name, st: s })} title={`${x.name} · ${t(STAGE[s].label)} ${x.n[s]}`} className="h-full border-r border-white/70 last:border-0 hover:opacity-75" style={{ width: `${(x.n[s] / x.count) * 100}%`, background: STAGE_HEX[s] }} />)}
                  </span>
                  <span className="text-right font-bold tabular-nums text-spark-ink">{x.count}{t('개')}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-spark-muted">{t('분야가 적힌 기사가 아직 없습니다.')}</p>}
        </Card>
      </div>

      <div className="mt-2.5">
      <Card href={dealsHref('funds')} title={t('펀드 목록')} hint={t('금액 있는 펀드 {p}%', { p: sizedPct })}>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="border-b border-spark-border text-left text-[11px] text-spark-muted">
                <th className="px-1 py-1.5 font-semibold">{t('날짜')}</th>
                <th className="px-1 py-1.5 font-semibold">{t('단계')}</th>
                <th className="px-1 py-1.5 font-semibold">{t('펀드')}</th>
                <th className="px-1 py-1.5 font-semibold">{t('운용사(GP)')}</th>
                <th className="px-1 py-1.5 text-right font-semibold">{t('규모')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.slice(0, 12).map(r => (
                <tr key={r.id} className="border-b border-spark-border/60 last:border-0">
                  <td className="whitespace-nowrap px-1 py-1.5 tabular-nums text-spark-muted">{r.date.slice(5)}</td>
                  <td className="px-1 py-1.5"><Link href={dealsHref('funds', { st: r.stage })} className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-bold hover:opacity-80 ${STAGE[r.stage].cls}`}>{t(STAGE[r.stage].label)}</Link></td>
                  <td className="px-1 py-1.5 font-semibold text-spark-ink">
                    {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple">{r.name}</a> : r.name}
                  </td>
                  <td className="px-1 py-1.5 text-spark-ink-soft">{r.gps.length ? r.gps.map((g, k) => <span key={g}>{k > 0 && ', '}<Link href={dealsHref('funds', { inv: g })} className="hover:text-spark-purple hover:underline">{g}</Link></span>) : <span className="text-spark-muted">{t('선정 전')}</span>}</td>
                  <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums font-semibold">
                    {r.sizeKrw != null ? <>{krw(r.sizeKrw, t)}{r.sizeIsTarget && <span className="ml-0.5 text-[10.5px] font-normal text-spark-muted">({t('목표')})</span>}</> : <span className="text-spark-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </div>
    </section>
  );
}
