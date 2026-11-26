// 투자·펀드 탭 "포폴 매칭" — 왼쪽에서 분야·포폴사를 고르면 오른쪽에 맞는 하우스·펀드가 이유와 함께(2026-11-26 소윤).
// 투자팀용 읽기 전용 화면. 계산은 match-stats.ts.
import Link from 'next/link';
import type { MatchStats } from '@/lib/sparkscope/match-stats';
import { Card, krw, type T } from './FundAnalysis';
import { MatchActionButtons } from './MatchActionButtons';
import { dealsHref } from '@/lib/sparkscope/deal-links';

const ACT: Record<string, { label: string; cls: string }> = {
  INTERESTED: { label: '관심', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  CONTACTED: { label: '연락함', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  MEETING: { label: '미팅', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PASSED: { label: '보류', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
};

const FUND_STAGE: Record<string, { label: string; cls: string }> = {
  CLOSED: { label: '결성 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  GP_SELECTED: { label: 'GP 선정', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  ANNOUNCED: { label: '출자 공고', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export function MatchAnalysis({ stats, t, hrefFor, bucket }: {
  stats: MatchStats; t: T; hrefFor: (p: { sec?: string; pc?: string }) => string; bucket: string | null;
}) {
  const active = stats.selected?.bucket ?? bucket;
  const list = active ? stats.companies.filter(c => c.bucket === active) : [];
  const maxDeals = Math.max(1, ...stats.buckets.map(b => b.deals));
  const btnLabels = Object.fromEntries(['관심', '연락함', '미팅', '보류', '저장 실패'].map(k => [k, t(k)]));
  const sel = stats.selected;

  return (
    <section className="mb-4 rounded-2xl border border-spark-border bg-spark-subtle/40 p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">🤝 {t('포폴 매칭')}</h2>
        <span className="text-[13px] text-spark-muted">{t('최근 {d}일 실제 딜·펀드 기준 — 포폴사를 고르면 지금 그 분야에 돈을 쓰는 하우스와 펀드', { d: stats.days })}</span>
      </div>
      <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
        {t('지금은 분야로만 맞춥니다. 포폴사 투자 단계(SLAB)가 연결되면 단계까지 맞춰 정확도가 올라갑니다.')}
      </p>

      {stats.newFunds.length > 0 && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
          <div className="mb-1.5 text-[13px] font-extrabold text-emerald-800">🆕 {t('이번 주 새 펀드 {n}개', { n: stats.newFunds.length })}</div>
          <ul className="space-y-1">
            {stats.newFunds.slice(0, 5).map(f => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                <span className={`rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${FUND_STAGE[f.stage]?.cls ?? ''}`}>{t(FUND_STAGE[f.stage]?.label ?? f.stage)}</span>
                {f.link ? <a href={f.link} target="_blank" rel="noopener noreferrer" className="font-bold text-spark-ink hover:text-spark-purple">{f.name}</a> : <span className="font-bold">{f.name}</span>}
                <span className="text-spark-muted">{f.gps.join(', ') || t('GP 미정')}{f.sizeKrw != null && ` · ${krw(f.sizeKrw, t)}`}</span>
                {f.buckets.length > 0 ? (
                  <span className="text-emerald-800">→ {f.buckets.map(b => (
                    <Link key={b} href={hrefFor({ sec: b })} scroll={false} className="mr-1 font-semibold underline-offset-2 hover:underline">{t(b)}</Link>
                  ))}{t('포폴 {n}곳과 분야 일치', { n: f.matchCount })}</span>
                ) : <span className="text-spark-muted">{t('분야 미기재')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.pipeline.length > 0 && (
        <div className="mb-3 rounded-xl border border-spark-border bg-white px-4 py-3">
          <div className="mb-1.5 text-[13px] font-extrabold text-spark-ink">📋 {t('팀 진행 현황')} <span className="text-[11px] font-normal text-spark-muted">{t('최근 기록 · 보류 제외')}</span></div>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
            {stats.pipeline.map((p, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px]">
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${ACT[p.status]?.cls ?? ''}`}>{t(ACT[p.status]?.label ?? p.status)}</span>
                <Link href={hrefFor({ pc: p.targetId })} scroll={false} className="truncate font-semibold text-spark-ink hover:text-spark-purple">{p.targetName}</Link>
                <span className="text-spark-muted">↔</span>
                <span className="truncate text-spark-ink-soft">{p.counterName}</span>
                <span className="ml-auto shrink-0 tabular-nums text-[10.5px] text-spark-muted" title={p.by ?? undefined}>{p.at.slice(5)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-2.5">
          <Card title={t('분야별 돈의 흐름')} hint={t('막대 = 딜 수 · 포폴 / 펀드')}>
            <ul className="space-y-1">
              {stats.buckets.map(b => (
                <li key={b.id}>
                  <Link href={hrefFor({ sec: b.id })} scroll={false}
                    className={`grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 text-[12px] ${active === b.id ? 'bg-spark-purple/10 font-bold text-spark-purple' : 'text-spark-ink-soft hover:bg-white'}`}>
                    <span className="truncate">{t(b.id)}</span>
                    <span className="h-2 rounded-full bg-spark-subtle"><span className="block h-full rounded-full bg-spark-purple" style={{ width: `${b.deals ? Math.max(6, (b.deals / maxDeals) * 100) : 0}%` }} /></span>
                    <span className="tabular-nums text-spark-muted">{b.deals} · {b.companies}/{b.funds}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {active && (
            <Card title={t('{s} 포폴사', { s: t(active) })} hint={t('{n}곳', { n: list.length })}>
              <ul className="max-h-80 space-y-0.5 overflow-y-auto">
                {list.map(c => (
                  <li key={c.id}>
                    <Link href={hrefFor({ sec: active, pc: c.id })} scroll={false}
                      className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[12.5px] ${stats.selected?.id === c.id ? 'bg-spark-purple text-white' : 'text-spark-ink hover:bg-spark-subtle'}`}>
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className={`shrink-0 text-[10.5px] ${stats.selected?.id === c.id ? 'text-white/80' : 'text-spark-muted'}`}>{c.sector}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-2.5">
          {!active ? (
            <div className="rounded-xl border border-dashed border-spark-border bg-white p-6 text-center text-[13px] text-spark-muted">
              {t('왼쪽에서 분야를 고르세요. 포폴사까지 고르면 그 회사 기준으로 맞춥니다.')}
            </div>
          ) : (
            <>
              {stats.selected && (
                <div className="rounded-xl border border-spark-border bg-white px-4 py-3">
                  <div className="text-[16px] font-extrabold text-spark-ink">{stats.selected.name}</div>
                  <div className="mt-0.5 text-[12px] text-spark-muted">
                    {stats.selected.sector ?? t('분야 미상')} · {t('단계: SLAB 연결 후 표시')}
                    {stats.selected.lastDeal && <> · {t('최근 투자 기사 {d}', { d: stats.selected.lastDeal.date })}{stats.selected.lastDeal.investors.length > 0 && ` (${stats.selected.lastDeal.investors.join(', ')})`}</>}
                  </div>
                </div>
              )}
              <Card title={t('맞는 하우스')} hint={t('같은 분야 딜 ×3 · 리드 ×2 · 최근 30일 +2 · 우리 포폴 투자 +1')}>
                {stats.houses.length ? (
                  <ol className="space-y-1.5">
                    {stats.houses.map((h, i) => (
                      <li key={h.name} className="flex items-start gap-2.5 rounded-lg border border-spark-border/70 px-2.5 py-2">
                        <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] font-bold tabular-nums text-spark-muted">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <Link href={dealsHref('deals', { inv: h.name })} className="truncate text-[13px] font-bold text-spark-ink hover:text-spark-purple hover:underline">{h.name}</Link>
                            <span className="text-[11px] text-spark-muted">{t('주력 {s}', { s: t(h.topStage) })} · {h.recent}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {h.reasons.map(r => <span key={r} className="rounded bg-spark-subtle px-1.5 py-0.5 text-[10.5px] font-semibold text-spark-ink-soft">{r}</span>)}
                          </div>
                          {sel && <MatchActionButtons targetId={sel.id} kind="HOUSE" counterKey={h.key} counterName={h.name}
                            initial={stats.actions[`HOUSE|${h.key}`]?.status ?? null} by={stats.actions[`HOUSE|${h.key}`]?.by} labels={btnLabels} />}
                        </div>
                        <span className="shrink-0 rounded-md bg-spark-purple/10 px-2 py-0.5 text-[12px] font-extrabold tabular-nums text-spark-purple">{h.score}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-[12px] text-spark-muted">{t('최근 이 분야에 투자한 하우스가 기사에 아직 없습니다.')}</p>}
              </Card>
              <Card title={t('맞는 펀드')} hint={t('이 분야를 주목적으로 내건 펀드 — 결성 완료가 먼저')}>
                {stats.funds.length ? (
                  <ul className="space-y-1.5">
                    {stats.funds.map(f => (
                      <li key={f.id} className="rounded-lg border border-spark-border/70 px-2.5 py-2 text-[12.5px]">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${FUND_STAGE[f.stage]?.cls ?? ''}`}>{t(FUND_STAGE[f.stage]?.label ?? f.stage)}</span>
                          {f.link ? <a href={f.link} target="_blank" rel="noopener noreferrer" className="font-bold text-spark-ink hover:text-spark-purple">{f.name}</a> : <span className="font-bold">{f.name}</span>}
                          <span className="text-spark-muted">{f.gps.join(', ') || t('GP 미정')}</span>
                          <span className="ml-auto tabular-nums font-semibold">{f.sizeKrw != null ? krw(f.sizeKrw, t) : '—'}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {f.reasons.map(r => <span key={r} className="rounded bg-spark-subtle px-1.5 py-0.5 text-[10.5px] font-semibold text-spark-ink-soft">{r}</span>)}
                        </div>
                        {sel && <MatchActionButtons targetId={sel.id} kind="FUND" counterKey={f.id} counterName={f.name}
                          initial={stats.actions[`FUND|${f.id}`]?.status ?? null} by={stats.actions[`FUND|${f.id}`]?.by} labels={btnLabels} />}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-[12px] text-spark-muted">{t('이 분야를 내건 펀드가 기사에 아직 없습니다.')}</p>}
              </Card>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
