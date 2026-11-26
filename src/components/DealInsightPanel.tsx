// 투자·펀드 탭 맨 위 "한눈에 보는 요약" — 3줄 요약 · 눈여겨볼 신호 · 지금 할 일(2026-11-26 소윤).
// 매일 07:30 크론이 만든 AI 요약을 읽기만 한다. 아직 없으면 집계 숫자로 만든 기본 요약을 보여주고 출처를 구분해 표시한다.
import Link from 'next/link';
import type { DealInsight, InsightLink, InsightSource } from '@/lib/sparkscope/deal-insight';
import { dealsHref } from '@/lib/sparkscope/deal-links';
import type { T } from './FundAnalysis';
import { InsightRefreshButton } from './InsightRefreshButton';
import type { FundRow } from '@/lib/sparkscope/fund-stats';
import { lpGroup } from '@/lib/sparkscope/fund-stats';
import { krw } from './FundAnalysis';

const FSTAGE: Record<string, { label: string; cls: string; order: number }> = {
  CLOSED: { label: '결성 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', order: 0 },
  GP_SELECTED: { label: 'GP 선정', cls: 'bg-sky-50 text-sky-700 border-sky-200', order: 1 },
  ANNOUNCED: { label: '출자 공고', cls: 'bg-amber-50 text-amber-700 border-amber-200', order: 2 },
};
export type FundFit = { count: number; names: string[]; bucket: string | null };

const LINK_LABEL: Record<string, string> = { sector: '딜 표', stage: '딜 표', house: '딜 표', fundSector: '펀드 표', match: '포폴 매칭', newFunds: '새 펀드' };

export function insightHref(l?: InsightLink): string | null {
  if (!l) return null;
  switch (l.kind) {
    case 'sector': return dealsHref('deals', { sec: l.value });
    case 'stage': return dealsHref('deals', { st: l.value });
    case 'house': return dealsHref('deals', { inv: l.value });
    case 'fundSector': return dealsHref('funds', { sec: l.value });
    case 'match': return `/dashboard?tab=fund&ana=match&sec=${encodeURIComponent(l.value ?? '')}`;
    case 'newFunds': return '/dashboard?tab=fund&ana=match';
    default: return null;
  }
}

function Go({ href, children, className }: { href: string | null; children: React.ReactNode; className?: string }) {
  return href ? <Link href={href} className={`${className ?? ''} group block h-full rounded-lg transition-colors hover:bg-spark-purple/[0.04]`}>{children}</Link> : <div className={`${className ?? ''} h-full`}>{children}</div>;
}

/** 문장 속 [n]을 근거 기사 링크(작은 번호)로 바꾼다. */
function Cite({ text, sources }: { text: string; sources: InsightSource[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return <>{parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    const src = m ? sources.find(s => s.n === Number(m[1])) : null;
    if (m && !src) return null;
    return src ? <a key={i} href={src.link} target="_blank" rel="noopener noreferrer" title={`${src.title} · ${src.source}`}
      className="mx-0.5 align-super text-[10px] font-bold text-spark-purple hover:underline">[{src.n}]</a> : <span key={i}>{p}</span>;
  })}</>;
}

export function DealInsightPanel({ data, fallback, t, funds = [], fits = {} }: {
  data: { insight: DealInsight; computedAt: Date } | null;
  fallback: string[];
  t: T;
  /** 펀드 카드 재료(DB 그대로) — 갓 결성된 펀드가 맨 위(2026-11-26 실무 피드백) */
  funds?: FundRow[];
  /** 펀드 이름 → 분야가 맞는 우리 포폴 */
  fits?: Record<string, FundFit>;
}) {
  const ai = data?.insight;
  const time = data ? new Date(data.computedAt.getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : null;
  const small = ai && ai.basis.deals < 30;
  const srcs = ai?.sources ?? [];

  return (
    <section className="mb-3 rounded-2xl border border-spark-purple/25 bg-gradient-to-br from-spark-purple/[0.06] to-white p-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[19px] font-extrabold tracking-tight">🧭 {t('요즘 돈의 흐름 — 한눈에')}</h2>
        <span className="text-[11.5px] text-spark-muted">
          {ai ? `🤖 ${t('AI 분석 · {d} 기준', { d: time! })}` : `⚙️ ${t('기본 요약 · AI 분석 전')}`}
          {ai && ` · ${t('딜 {d}건 · 펀드 {f}개 바탕', { d: ai.basis.deals, f: ai.basis.funds })}`}
        </span>
        <span className="ml-auto"><InsightRefreshButton computedAt={data ? data.computedAt.toISOString() : null}
          label={{ run: t('AI 분석 실행'), rerun: t('최신으로 다시 분석'), busy: t('분석 중… (30~60초)'), confirm: t('오늘 이미 만든 분석이 있습니다. 다시 분석할까요? (회당 약 200원)') }} /></span>
      </div>
      {small && <p className="mb-2 text-[11.5px] text-amber-700">{t('기록이 아직 적어(딜 30건 미만) 초기 신호로만 보세요.')}</p>}

      {funds.length > 0 && (() => {
        const sorted = [...funds].sort((a, b) => (FSTAGE[a.stage]?.order ?? 9) - (FSTAGE[b.stage]?.order ?? 9) || b.date.localeCompare(a.date));
        const plays = new Map((ai?.fundPlays ?? []).map(p => [p.fund, p]));
        return (
          <div className="mb-4">
            <h3 className="mb-1 text-[15px] font-extrabold text-spark-ink">🆕 {t('갓 결성된 펀드 — 우리 포폴이 투자받을 곳')}</h3>
            <p className="mb-2 text-[11.5px] text-spark-muted">{t('결성 직후 펀드는 투자기간 초기라 돈을 써야 합니다. 결성 완료 → GP 선정 → 출자 공고 순.')}</p>
            <ul className="space-y-2">
              {sorted.map(f => {
                const play = plays.get(f.name);
                const fit = fits[f.name];
                const lpGroups = new Map<string, string[]>();
                for (const l of f.lps) { const g = lpGroup(l).label; lpGroups.set(g, [...(lpGroups.get(g) ?? []), l]); }
                return (
                  <li key={f.id} className="grid grid-cols-1 overflow-hidden rounded-xl border border-spark-border bg-white lg:grid-cols-[1.05fr_1fr]">
                    <div className="p-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${FSTAGE[f.stage]?.cls ?? ''}`}>{t(FSTAGE[f.stage]?.label ?? f.stage)}</span>
                        <span className="text-[11.5px] tabular-nums text-spark-muted">{f.date.slice(5)}</span>
                        <span className="ml-auto text-[15px] font-extrabold tabular-nums text-spark-ink">{f.sizeKrw != null ? krw(f.sizeKrw, t) : '—'}{f.sizeIsTarget && <span className="ml-0.5 text-[10.5px] font-normal text-spark-muted">({t('목표')})</span>}</span>
                      </div>
                      <div className="mt-1 text-[14px] font-extrabold text-spark-ink">
                        {f.link ? <a href={f.link} target="_blank" rel="noopener noreferrer" className="hover:text-spark-purple hover:underline">{f.name} ↗</a> : f.name}
                      </div>
                      {play?.what && <div className="mt-0.5 text-[12.5px] text-spark-ink-soft">{play.what}</div>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                        <span className="text-[10.5px] font-bold text-spark-muted">LP</span>
                        {lpGroups.size ? [...lpGroups].map(([g, names]) => (
                          <span key={g} className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-800" title={names.join(', ')}>{t(g)} · {names[0]}{names.length > 1 ? ` ${t('외 {n}', { n: names.length - 1 })}` : ''}</span>
                        )) : <span className="text-spark-muted">{t('기사에 없음')}</span>}
                        <span className="font-bold text-spark-muted">→</span>
                        <span className="text-[10.5px] font-bold text-spark-muted">GP</span>
                        <span className="rounded bg-spark-purple/10 px-1.5 py-0.5 font-bold text-spark-purple">{f.gps.join(', ') || t('선정 전')}</span>
                      </div>
                      <div className="mt-1.5 text-[11.5px] text-spark-muted">
                        {t('분야')}: {f.sectors.length ? f.sectors.join(' · ') : t('지정 안 됨(블라인드)')}
                      </div>
                    </div>
                    <div className="border-t border-emerald-200 bg-emerald-50/50 p-3.5 lg:border-l lg:border-t-0">
                      <div className="mb-1 text-[11px] font-extrabold tracking-wide text-emerald-800">✅ {t('우리 포지션 · 할 일')}</div>
                      {play ? (
                        <>
                          <p className="text-[12.5px] leading-snug text-emerald-950">{play.position}</p>
                          {play.action && <p className="mt-1.5 text-[12.5px] font-bold text-emerald-900">→ {play.action}</p>}
                        </>
                      ) : <p className="text-[12px] text-emerald-900/70">{ai ? t('이 펀드는 마지막 분석 뒤에 들어왔거나 예전 형식 분석입니다. 다시 분석하면 나옵니다.') : t('AI 분석을 실행하면 우리 포지션과 할 일이 나옵니다.')}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10.5px] font-bold text-emerald-800">{t('소개할 포폴')}</span>
                        {(play?.targets.length ? play.targets : fit?.names.slice(0, 4) ?? []).map(n => <span key={n} className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-900">{n}</span>)}
                        {fit && fit.count > 0
                          ? <Link href={`/dashboard?tab=fund&ana=match${fit.bucket ? `&sec=${encodeURIComponent(fit.bucket)}` : ''}`} className="ml-1 text-[11px] font-bold text-spark-purple hover:underline">{t('분야 맞는 포폴 {n}곳 · 매칭 →', { n: fit.count })}</Link>
                          : <span className="text-[11px] text-emerald-900/70">{t('분야가 정해지지 않아 자동 매칭 없음')}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      <h3 className="mb-1.5 text-[15px] font-extrabold text-spark-ink">🧭 {t('3줄 요약')}</h3>
      <ul className="space-y-1.5 text-[14px] font-semibold leading-snug text-spark-ink">
        {(ai?.summary ?? fallback).map((s, i) => (
          <li key={i} className="flex gap-2"><span className="tabular-nums text-spark-purple">{i + 1}.</span><span>
            <Cite text={s.replace(/^\s*\d+\.\s*/, '')} sources={srcs} />
            {(() => { const l = ai?.summaryLinks?.[i]; const h = insightHref(l ?? undefined); return h && l ? (
              <Link href={h} className="ml-1.5 inline-flex items-center rounded border border-spark-border bg-white px-1.5 py-px align-middle text-[10.5px] font-semibold text-spark-muted hover:border-spark-purple/40 hover:text-spark-purple">📊 {t(LINK_LABEL[l.kind])}{l.value ? ` · ${t(l.value)}` : ''} ›</Link>
            ) : null; })()}
          </span></li>
        ))}
      </ul>

      {ai && ai.insights.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-[15px] font-extrabold text-spark-ink">🔎 {t('눈여겨볼 신호')}</h3>
          <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
            {ai.insights.map((x, i) => {
              const href = insightHref(x.link);
              return (
                <li key={i} className="flex flex-col rounded-lg border border-spark-border bg-white">
                  <Go href={href} className="flex-1 px-3 py-2">
                    <div className="text-[13px] font-bold text-spark-ink group-hover:text-spark-purple">{x.title}{href && <span className="ml-1 text-spark-muted">›</span>}</div>
                    <div className="mt-0.5 text-[12px] leading-snug text-spark-ink-soft"><Cite text={x.detail} sources={srcs} /></div>
                  </Go>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
