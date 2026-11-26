'use client';
// 포폴 매칭 진행 버튼 — 관심 / 연락함 / 미팅 / 보류. 같은 걸 다시 누르면 기록을 지운다(2026-11-26).
import { useState } from 'react';

const OPTS = [
  { id: 'INTERESTED', label: '관심', on: 'bg-amber-500 text-white border-amber-500' },
  { id: 'CONTACTED', label: '연락함', on: 'bg-sky-600 text-white border-sky-600' },
  { id: 'MEETING', label: '미팅', on: 'bg-emerald-600 text-white border-emerald-600' },
  { id: 'PASSED', label: '보류', on: 'bg-gray-500 text-white border-gray-500' },
] as const;

export function MatchActionButtons({ targetId, kind, counterKey, counterName, initial, labels, by }: {
  targetId: string; kind: 'HOUSE' | 'FUND'; counterKey: string; counterName: string;
  initial: string | null; labels: Record<string, string>; by?: string | null;
}) {
  const [status, setStatus] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  async function pick(next: string) {
    const value = status === next ? null : next;
    const prev = status;
    setStatus(value); setBusy(true); setErr(false);
    try {
      const r = await fetch('/api/match/action', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId, kind, counterKey, counterName, status: value }),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch { setStatus(prev); setErr(true); } finally { setBusy(false); }
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" title={by ?? undefined}>
      {OPTS.map(o => (
        <button key={o.id} type="button" disabled={busy} onClick={() => pick(o.id)}
          className={`rounded-md border px-2 py-0.5 text-[10.5px] font-bold transition-colors disabled:opacity-60 ${status === o.id ? o.on : 'border-spark-border bg-white text-spark-ink-soft hover:border-spark-purple/40'}`}>
          {labels[o.label] ?? o.label}
        </button>
      ))}
      {err && <span className="text-[10.5px] text-red-600">{labels['저장 실패'] ?? '저장 실패'}</span>}
    </div>
  );
}
