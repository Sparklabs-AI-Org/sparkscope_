'use client';
// AI 요약 "최신으로 다시 분석" 버튼(2026-11-26). 오늘 이미 만든 분석이 있으면 비용이 드니 한 번 더 묻는다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function InsightRefreshButton({ computedAt, label }: { computedAt: string | null; label: { run: string; rerun: string; busy: string; confirm: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kst = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  async function run() {
    if (computedAt && kst(new Date(computedAt)) === kst(new Date()) && !window.confirm(label.confirm)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/deal-insight', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error ?? String(r.status));
      router.refresh();
    } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={run} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-spark-purple/40 bg-white px-2.5 py-1 text-[12px] font-bold text-spark-purple hover:bg-spark-purple hover:text-white disabled:opacity-60">
        {busy ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-spark-purple border-t-transparent" />{label.busy}</> : <>🔄 {computedAt ? label.rerun : label.run}</>}
      </button>
      {err && <span className="text-[11.5px] text-red-600">{err}</span>}
    </span>
  );
}
