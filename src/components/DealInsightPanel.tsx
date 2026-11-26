// 투자·펀드 탭 맨 위 "한눈에 보는 요약" — 3줄 요약 · 눈여겨볼 신호 · 지금 할 일(2026-11-26 소윤).
// 매일 07:30 크론이 만든 AI 요약을 읽기만 한다. 아직 없으면 집계 숫자로 만든 기본 요약을 보여주고 출처를 구분해 표시한다.
import Link from 'next/link';
import type { DealInsight, InsightLink, InsightSource } from '@/lib/sparkscope/deal-insight';
import { dealsHref } from '@/lib/sparkscope/deal-links';
import type { T } from './FundAnalysis';

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
  return href ? <Link href={href} className={`${className ?? ''} group block rounded-lg transition-colors hover:bg-spark-purple/[0.04]`}>{children}</Link> : <div className={className}>{children}</div>;
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

export function DealInsightPanel({ data, fallback, t }: {
  data: { insight: DealInsight; computedAt: Date } | null;
  fallback: string[];
  t: T;
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
          {ai ? `🤖 ${t('AI 요약 · {d} 기준', { d: time! })}` : `⚙️ ${t('기본 요약 · AI 분석 전')}`}
          {ai && ` · ${t('딜 {d}건 · 펀드 {f}개 바탕', { d: ai.basis.deals, f: ai.basis.funds })}`}
        </span>
      </div>
      {small && <p className="mb-2 text-[11.5px] text-amber-700">{t('기록이 아직 적어(딜 30건 미만) 초기 신호로만 보세요.')}</p>}

      <ul className="space-y-1.5 text-[14.5px] font-semibold leading-snug text-spark-ink">
        {(ai?.summary ?? fallback).map((s, i) => (
          <li key={i} className="flex gap-2"><span className="tabular-nums text-spark-purple">{i + 1}.</span><span>
            <Cite text={s.replace(/^\s*\d+\.\s*/, '')} sources={srcs} />
            {(() => { const l = ai?.summaryLinks?.[i]; const h = insightHref(l ?? undefined); return h && l ? (
              <Link href={h} className="ml-1.5 inline-flex items-center rounded border border-spark-border bg-white px-1.5 py-px align-middle text-[10.5px] font-semibold text-spark-muted hover:border-spark-purple/40 hover:text-spark-purple">📊 {t(LINK_LABEL[l.kind])}{l.value ? ` · ${t(l.value)}` : ''} ›</Link>
            ) : null; })()}
          </span></li>
        ))}
      </ul>

      {ai && ((ai.flows?.length ?? 0) > 0 || (ai.why?.length ?? 0) > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(ai.flows?.length ?? 0) > 0 && (
            <div>
              <h3 className="mb-2 text-[15px] font-extrabold text-spark-ink">💸 {t('돈의 이동 — 어디서 어디로')}</h3>
              <ul className="space-y-1.5">
                {ai.flows!.map((x, i) => (
                  <li key={i} className="rounded-lg border border-spark-border bg-white">
                    <Go href={insightHref(x.link)} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold">
                        <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">{x.from}</span>
                        <span className="text-spark-muted">→</span>
                        <span className="rounded bg-spark-purple/10 px-1.5 py-0.5 text-spark-purple">{x.to}</span>
                      </div>
                      <div className="mt-1 text-[12px] leading-snug text-spark-ink-soft"><Cite text={x.detail} sources={srcs} /></div>
                    </Go>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(ai.why?.length ?? 0) > 0 && (
            <div>
              <h3 className="mb-2 text-[15px] font-extrabold text-spark-ink">❓ {t('왜 지금 이 분야인가 — 뉴스 근거')}</h3>
              <ul className="space-y-1.5">
                {ai.why!.map((x, i) => (
                  <li key={i} className="rounded-lg border border-spark-border bg-white px-3 py-2">
                    {insightHref(x.link) ? <Link href={insightHref(x.link)!} className="text-[13px] font-bold text-spark-ink hover:text-spark-purple">{x.topic} ›</Link>
                      : <div className="text-[13px] font-bold text-spark-ink">{x.topic}</div>}
                    <div className="mt-0.5 text-[12px] leading-snug text-spark-ink-soft"><Cite text={x.reason} sources={srcs} /></div>
                    <details className="group/src mt-1.5">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-spark-border px-2 py-0.5 text-[11px] font-semibold text-spark-muted hover:border-spark-purple/40 hover:text-spark-purple [&::-webkit-details-marker]:hidden">
                        📰 {t('기사 보기 {n}', { n: x.sources.length })}
                        <span className="transition-transform group-open/src:rotate-180">▾</span>
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 border-l-2 border-spark-purple/20 pl-2">
                        {x.sources.map(n => srcs.find(s => s.n === n)).filter(Boolean).map(s => (
                          <li key={s!.n} className="truncate text-[11px]">
                            <a href={s!.link} target="_blank" rel="noopener noreferrer" className="text-spark-purple hover:underline">[{s!.n}] {s!.title}</a>
                            <span className="ml-1 text-spark-muted">{s!.source} · {s!.date.slice(5)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {ai && (ai.insights.length > 0 || ai.actions.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h3 className="mb-2 text-[15px] font-extrabold text-spark-ink">🔎 {t('눈여겨볼 신호')}</h3>
            <ul className="space-y-1.5">
              {ai.insights.map((x, i) => {
                const href = insightHref(x.link);
                return (
                  <li key={i} className="rounded-lg border border-spark-border bg-white">
                    <Go href={href} className="px-3 py-2">
                      <div className="text-[13px] font-bold text-spark-ink group-hover:text-spark-purple">{x.title}{href && <span className="ml-1 text-spark-muted">›</span>}</div>
                      <div className="mt-0.5 text-[12px] leading-snug text-spark-ink-soft"><Cite text={x.detail} sources={srcs} /></div>
                    </Go>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-[15px] font-extrabold text-spark-ink">✅ {t('지금 할 일')}</h3>
            <ul className="space-y-1.5">
              {ai.actions.map((x, i) => {
                const href = insightHref(x.link);
                return (
                  <li key={i} className="rounded-lg border border-emerald-200 bg-emerald-50/50">
                    <Go href={href} className="px-3 py-2">
                      <div className="text-[13px] font-bold text-emerald-900 group-hover:text-spark-purple">{x.title}{href && <span className="ml-1 text-emerald-700/70">→</span>}</div>
                      <div className="mt-0.5 text-[12px] leading-snug text-emerald-900/80">{x.why}</div>
                    </Go>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
