'use client';
// 대시보드 어디서나 여는 챗봇 팝업(2026-11-26 소윤: "뭐든지 팔로업 물어볼 수 있게").
// /chat 화면과 같은 /api/chat 에이전트를 쓴다(기사 검색·추이·위기·딜·펀드 DB 등 도구). 지금 보는 화면을 같이 넘겨
// "이거 왜 그래?" 같은 질문도 알아듣게 한다. 대화는 이 창이 열려 있는 동안만 기억한다(새로고침하면 처음부터).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

type Msg = { role: 'user' | 'assistant'; text: string; articles?: { title: string; link: string; source?: string }[]; followUps?: string[]; error?: boolean };

const SUGGEST = ['요즘 어느 분야에 돈이 몰려?', '바이오가 왜 핫한지 근거 기사랑 알려줘', '이번 주 새 펀드랑 맞는 우리 포폴은?', '최근 위기 감지된 포폴사 정리해줘'];

/** 굵게·링크 — 한 줄 안. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return <>{parts.map((p, i) => {
    const b = p.match(/^\*\*([^*]+)\*\*$/);
    if (b) return <strong key={i} className="font-bold text-spark-ink">{b[1]}</strong>;
    const l = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (l) return <a key={i} href={l[2]} target="_blank" rel="noopener noreferrer" className="text-spark-purple underline">{l[1]}</a>;
    return <span key={i}>{p}</span>;
  })}</>;
}

/** 답변용 작은 마크다운: 소제목(#), 글머리표(-·*·•), 번호 목록, 표(|), 빈 줄 = 문단. */
function Md({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i]!.trimEnd();
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { out.push(<p key={k++} className="mt-2 text-[13px] font-extrabold text-spark-ink first:mt-0"><Inline text={h[1]!} /></p>); i++; continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*•]\s+/, ''));
      out.push(<ul key={k++} className="ml-4 list-disc space-y-0.5 marker:text-spark-purple">{items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d+[.)]\s+/, ''));
      out.push(<ol key={k++} className="ml-4 list-decimal space-y-0.5 marker:font-bold marker:text-spark-purple">{items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ol>);
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i++]!.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      out.push(
        <div key={k++} className="overflow-x-auto"><table className="w-full text-[12px]"><tbody>
          {rows.map((r, j) => <tr key={j} className={j === 0 ? 'border-b border-spark-border font-bold' : 'border-b border-spark-border/50'}>{r.map((c, x) => <td key={x} className="px-1.5 py-1 align-top"><Inline text={c} /></td>)}</tr>)}
        </tbody></table></div>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    out.push(<p key={k++}><Inline text={para.join(' ')} /></p>);
  }
  return <div className="space-y-2">{out}</div>;
}

function screenLabel(path: string, sp: URLSearchParams): string {
  if (path.startsWith('/dashboard/deals')) return `투자 딜·펀드 표(${sp.get('tab') === 'funds' ? '펀드 결성' : '투자 유치'})`;
  const tab = sp.get('tab') ?? 'portfolio';
  const map: Record<string, string> = { portfolio: '포트폴리오사', sparklabs: '스파크랩 직접 언급', policy: '정책·지원사업', competitor: '업계 동향', fund: '투자·펀드', articles: '수집 기사 DB' };
  const ana = sp.get('ana');
  const sub = tab === 'fund' ? (ana === 'fund' ? ' > 펀드 결성 분석' : ana === 'match' ? ' > 포폴 매칭' : ' > 투자 유치 분석') : '';
  return `대시보드 ${map[tab] ?? tab} 탭${sub}`;
}

export function ChatPopup() {
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, progress]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history = msgs.filter(m => !m.error).map(m => ({ role: m.role, text: m.text })).slice(-6);
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setInput(''); setBusy(true); setProgress('질문 이해하는 중');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, history, period: 'quarter', scopes: [], modes: ['rich'], context: screenLabel(path, new URLSearchParams(sp.toString())) }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let done = false;
      while (!done) {
        const r = await reader.read(); if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'progress') setProgress(ev.detail ? `${ev.label} · ${ev.detail}` : ev.label);
          else if (ev.type === 'error') { setMsgs(m => [...m, { role: 'assistant', text: ev.error ?? '오류가 났습니다.', error: true }]); done = true; }
          else if (ev.type === 'done') {
            const arts = (ev.result?.articles ?? []).slice(0, 5).map((a: any) => ({ title: a.title, link: a.link, source: a.source }));
            setMsgs(m => [...m, { role: 'assistant', text: ev.summary ?? ev.note ?? '결과를 찾았어요.', articles: arts, followUps: (ev.followUps ?? []).slice(0, 3) }]);
            done = true;
          }
        }
      }
    } catch {
      setMsgs(m => [...m, { role: 'assistant', text: '답을 가져오지 못했어요. 잠시 뒤 다시 물어봐 주세요.', error: true }]);
    } finally { setBusy(false); setProgress(null); }
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}
          className="fixed bottom-20 right-6 z-40 flex items-center gap-1.5 rounded-full bg-spark-ink px-4 py-2.5 text-[13px] font-bold text-white shadow-lg transition hover:bg-spark-purple">
          💬 물어보기
        </button>
      )}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex h-[min(640px,85vh)] flex-col overflow-hidden rounded-2xl border border-spark-border bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[420px]">
          <div className="flex items-center gap-2 border-b border-spark-border bg-spark-subtle/60 px-4 py-2.5">
            <span className="text-[14px] font-extrabold text-spark-ink">💬 SparkScope에게 물어보기</span>
            <Link href="/chat" className="ml-auto text-[11.5px] font-semibold text-spark-muted hover:text-spark-purple">크게 보기 ↗</Link>
            {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="text-[11.5px] font-semibold text-spark-muted hover:text-spark-ink">새 대화</button>}
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="rounded px-1.5 text-[16px] text-spark-muted hover:text-spark-ink">✕</button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {msgs.length === 0 && (
              <div className="text-[12.5px] text-spark-muted">
                <p className="mb-2">수집 기사·포폴사·투자 딜·펀드 데이터를 보고 답합니다. 지금 보는 화면도 같이 넘겨요 — "이거 왜 그래?"처럼 물어도 됩니다.</p>
                <div className="flex flex-col gap-1.5">
                  {SUGGEST.map(s => <button key={s} type="button" onClick={() => ask(s)} className="rounded-lg border border-spark-border px-3 py-1.5 text-left text-[12.5px] text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${m.role === 'user' ? 'bg-spark-purple text-white' : m.error ? 'bg-red-50 text-red-700' : 'bg-spark-subtle text-spark-ink'}`}>
                  {m.role === 'assistant' && !m.error ? <Md text={m.text} /> : <div className="whitespace-pre-wrap">{m.text}</div>}
                  {m.articles && m.articles.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11.5px] font-semibold text-spark-muted">📰 근거 기사 {m.articles.length}</summary>
                      <ul className="mt-1 space-y-0.5">
                        {m.articles.map(a => <li key={a.link} className="truncate text-[11.5px]"><a href={a.link} target="_blank" rel="noopener noreferrer" className="text-spark-purple hover:underline">{a.title}</a>{a.source && <span className="ml-1 text-spark-muted">{a.source}</span>}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                {m.followUps && m.followUps.length > 0 && i === msgs.length - 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.followUps.map(f => <button key={f} type="button" onClick={() => ask(f)} disabled={busy} className="rounded-full border border-spark-border px-2.5 py-0.5 text-[11.5px] text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple">{f}</button>)}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-[12px] text-spark-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-spark-purple" />{progress ?? '생각하는 중'}…</div>}
            <div ref={endRef} />
          </div>

          <form onSubmit={e => { e.preventDefault(); ask(input); }} className="flex items-end gap-2 border-t border-spark-border p-2.5">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={1} placeholder="무엇이든 물어보세요 (Enter 전송, Shift+Enter 줄바꿈)"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); } }}
              className="max-h-28 flex-1 resize-none rounded-lg border border-spark-border px-3 py-2 text-[13px] outline-none focus:border-spark-purple" />
            <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-spark-purple px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40">전송</button>
          </form>
        </div>
      )}
    </>
  );
}
