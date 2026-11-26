// 투자·펀드 탭 맨 위 "펀드 결성 분석" — 몇 개, 얼마, 누가(GP), 어디 돈으로(LP 재원), 무슨 분야(2026-11-26 소윤).
// 집계는 서버(fund-stats.ts)에서 끝내고 여기선 그리기만 한다. 그래프는 외부 라이브러리 없이 막대로.
import Link from 'next/link';
import type { FundStats, FundStage } from '@/lib/sparkscope/fund-stats';

type T = (s: string, v?: Record<string, string | number>) => string;

function krw(v: number, t: T): string {
  if (v >= 1e12) return t('{n}조', { n: (v / 1e12).toFixed(v >= 1e13 ? 0 : 1).replace(/\.0$/, '') });
  if (v >= 1e8) return t('{n}억', { n: Math.round(v / 1e8).toLocaleString() });
  return v > 0 ? t('{n}억', { n: (v / 1e8).toFixed(1) }) : '—';
}

const STAGE: Record<FundStage, { label: string; cls: string; bar: string }> = {
  CLOSED: { label: '결성 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  GP_SELECTED: { label: 'GP 선정', cls: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500' },
  ANNOUNCED: { label: '출자 공고', cls: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400' },
};

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-spark-border bg-white px-4 py-3">
      <div className="text-[11.5px] font-semibold text-spark-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-extrabold tabular-nums tracking-tight text-spark-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-spark-muted">{sub}</div>}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-spark-border bg-white p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-[13.5px] font-extrabold text-spark-ink">{title}</h3>
        {hint && <span className="text-[11px] text-spark-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function HBars({ items, color }: { items: { label: string; value: number; right: string }[]; color: string }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map(i => (
        <li key={i.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[12px]">
          <span className="truncate font-semibold text-spark-ink-soft" title={i.label}>{i.label}</span>
          <span className="h-2.5 rounded-full bg-spark-subtle">
            <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.max(4, (i.value / max) * 100)}%` }} />
          </span>
          <span className="tabular-nums text-spark-muted">{i.right}</span>
        </li>
      ))}
    </ul>
  );
}

export function FundAnalysis({ stats, t }: { stats: FundStats; t: T }) {
  if (stats.total === 0) {
    return (
      <div className="mb-4 rounded-2xl border border-spark-border bg-white p-5 text-[13px] text-spark-muted">
        {t('최근 {d}일 펀드 결성 분석 — 아직 정리된 펀드가 없습니다. 매일 07:30에 기사에서 펀드를 뽑아 쌓습니다.', { d: stats.days })}
      </div>
    );
  }
  const maxWeek = Math.max(1, ...stats.weekly.map(w => w.closed + w.pipeline));
  const maxCount = Math.max(1, ...stats.weekly.map(w => w.count));
  const sizedPct = Math.round((stats.sizedCount / stats.total) * 100);

  return (
    <section className="mb-4 rounded-2xl border border-spark-border bg-spark-subtle/40 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">📊 {t('펀드 결성 분석')}</h2>
        <span className="text-[13px] text-spark-muted">{t('최근 {d}일 · 기사에서 AI가 뽑은 펀드 {n}개', { d: stats.days, n: stats.total })}</span>
        <Link href="/dashboard/deals?tab=funds&days=90" className="ml-auto text-[12px] font-semibold text-spark-purple hover:underline">{t('펀드 전체 표 보기 →')}</Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label={t('펀드 수')} value={String(stats.total)}
          sub={t('결성 {c} · GP선정 {g} · 공고 {a}', { c: stats.byStage.CLOSED, g: stats.byStage.GP_SELECTED, a: stats.byStage.ANNOUNCED })} />
        <Kpi label={t('결성 완료 금액')} value={krw(stats.closedSumKrw, t)} sub={t('결성 완료로 보도된 펀드 합')} />
        <Kpi label={t('조성 예정 금액')} value={krw(stats.targetSumKrw, t)} sub={t('출자 공고·GP 선정 단계 목표액 합')} />
        <Kpi label={t('최대 GP')} value={stats.topGps[0]?.name ?? '—'}
          sub={stats.topGps[0] ? t('{n}개 펀드 · {v}', { n: stats.topGps[0].count, v: krw(stats.topGps[0].sumKrw, t) }) : undefined} />
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <Card title={t('주별 펀드 금액')} hint={t('막대 = 금액(초록 결성 · 회색 예정), 숫자 = 건수')}>
          <div className="flex h-36 items-end gap-1">
            {stats.weekly.map(w => {
              const total = w.closed + w.pipeline;
              const h = total > 0 ? Math.max(4, (total / maxWeek) * 100) : w.count > 0 ? Math.max(4, (w.count / maxCount) * 20) : 0;
              const closedShare = total > 0 ? (w.closed / total) * 100 : 0;
              return (
                <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5"
                  title={`${w.week} · ${w.count}${t('건')} · ${krw(total, t)}`}>
                  {w.count > 0 && <span className="text-[10px] tabular-nums text-spark-muted">{w.count}</span>}
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${h}%` }}>
                    <div className="bg-emerald-500" style={{ height: `${closedShare}%` }} />
                    <div className="flex-1 bg-gray-300" />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-spark-muted">
            <span>{stats.weekly[0]?.week.slice(5)}</span>
            <span>{stats.weekly[stats.weekly.length - 1]?.week.slice(5)}</span>
          </div>
        </Card>

        <Card title={t('하우스(GP) 순위')} hint={t('펀드 수 · 금액(공동 GP는 나눠 계산)')}>
          {stats.topGps.length ? (
            <HBars color="bg-spark-purple"
              items={stats.topGps.map(g => ({ label: g.name, value: g.count, right: `${g.count}${t('개')} · ${krw(g.sumKrw, t)}` }))} />
          ) : <p className="text-[12px] text-spark-muted">{t('GP가 적힌 기사가 아직 없습니다.')}</p>}
        </Card>

        <Card title={t('출자 재원(LP) — 어디 돈인가')} hint={t('그 재원이 들어간 펀드 수')}>
          {stats.lpMix.length ? (
            <HBars color="bg-sky-500"
              items={stats.lpMix.map(l => ({ label: t(l.label), value: l.funds, right: `${l.funds}${t('개')}` }))} />
          ) : <p className="text-[12px] text-spark-muted">{t('LP가 적힌 기사가 아직 없습니다.')}</p>}
        </Card>

        <Card title={t('투자 분야')} hint={t('펀드가 내건 주목적 분야')}>
          {stats.topSectors.length ? (
            <div className="flex flex-wrap gap-1.5">
              {stats.topSectors.map(s => (
                <span key={s.name} className="rounded-lg border border-spark-border bg-white px-2.5 py-1 text-[12px] font-semibold text-spark-ink-soft">
                  {s.name} <span className="tabular-nums text-spark-muted">{s.count}</span>
                </span>
              ))}
            </div>
          ) : <p className="text-[12px] text-spark-muted">{t('분야가 적힌 기사가 아직 없습니다.')}</p>}
        </Card>
      </div>

      <div className="mt-2.5">
      <Card title={t('펀드 목록')} hint={t('금액 있는 펀드 {p}%', { p: sizedPct })}>
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
                  <td className="px-1 py-1.5"><span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${STAGE[r.stage].cls}`}>{t(STAGE[r.stage].label)}</span></td>
                  <td className="px-1 py-1.5 font-semibold text-spark-ink">
                    {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple">{r.name}</a> : r.name}
                  </td>
                  <td className="px-1 py-1.5 text-spark-ink-soft">{r.gps.join(', ') || <span className="text-spark-muted">{t('선정 전')}</span>}</td>
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
