'use client';
// 펀드 카드 O/X — 이 카드가 이 탭에 맞게 잡혔는지 한 번 눌러 알려 준다(2026-11-27 벤처1본부 회의).
// 같은 것을 다시 누르면 지운다. 설명은 적고 싶을 때만.
import { useState } from 'react';

export function FundFeedbackButtons({ fundId, shownKind, initial, counts, labels }: {
  fundId: string; shownKind: 'MOTHER' | 'CHILD';
  initial: { verdict: 'O' | 'X'; note: string | null } | null;
  counts: { o: number; x: number };
  labels: { ask: string; o: string; x: string; note: string; save: string; saved: string; fail: string };
}) {
  const [verdict, setVerdict] = useState<'O' | 'X' | null>(initial?.verdict ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<'saved' | 'fail' | null>(null);
  // 남들이 누른 수 — 내 것은 화면 상태로 따로 더한다.
  const others = { O: counts.o - (initial?.verdict === 'O' ? 1 : 0), X: counts.x - (initial?.verdict === 'X' ? 1 : 0) };
  const shown = (v: 'O' | 'X') => others[v] + (verdict === v ? 1 : 0);

  async function send(next: 'O' | 'X' | null, text: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/fund/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fundId, verdict: next, note: text, shownKind }),
      });
      if (!r.ok) throw new Error(String(r.status));
      return true;
    } catch { setMsg('fail'); return false; } finally { setBusy(false); }
  }
  async function pick(v: 'O' | 'X') {
    const next = verdict === v ? null : v;
    const prev = verdict;
    setVerdict(next); setOpen(next === 'X');
    if (!(await send(next, next ? note : ''))) setVerdict(prev);
  }
  const btn = (v: 'O' | 'X', on: string) =>
    `rounded-md border px-2 py-0.5 text-[11px] font-extrabold tabular-nums transition-colors disabled:opacity-60 ${verdict === v ? on : 'border-spark-border bg-white text-spark-ink-soft hover:border-spark-purple/40'}`;

  return (
    <div className="mt-2 border-t border-spark-border/60 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] font-bold text-spark-muted">{labels.ask}</span>
        <button type="button" disabled={busy} onClick={() => pick('O')} className={btn('O', 'border-emerald-600 bg-emerald-600 text-white')} title={labels.o} aria-pressed={verdict === 'O'}>
          O{shown('O') > 0 ? ` ${shown('O')}` : ''}
        </button>
        <button type="button" disabled={busy} onClick={() => pick('X')} className={btn('X', 'border-rose-600 bg-rose-600 text-white')} title={labels.x} aria-pressed={verdict === 'X'}>
          X{shown('X') > 0 ? ` ${shown('X')}` : ''}
        </button>
        {verdict && !open && <button type="button" onClick={() => setOpen(true)} className="text-[10.5px] font-semibold text-spark-purple hover:underline">{labels.note}</button>}
        {msg === 'saved' && <span className="text-[10.5px] text-emerald-700">{labels.saved}</span>}
        {msg === 'fail' && <span className="text-[10.5px] text-red-600">{labels.fail}</span>}
      </div>
      {open && verdict && (
        <div className="mt-1.5 flex gap-1.5">
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder={labels.note}
            className="min-w-0 flex-1 rounded-md border border-spark-border px-2 py-1 text-[12px] outline-none focus:border-spark-purple" />
          <button type="button" disabled={busy} onClick={async () => { if (await send(verdict, note)) { setMsg('saved'); setOpen(false); } }}
            className="rounded-md border border-spark-purple bg-spark-purple px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-60">{labels.save}</button>
        </div>
      )}
    </div>
  );
}
