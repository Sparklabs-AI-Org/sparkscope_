'use client';
// 브리핑 기사 카드의 👍👎. children(기사 제목 줄) 오른쪽에 버튼을 두고, 👎를 누르면 아래에 사유·의견 칸이 열린다.
// 같은 버튼을 다시 누르면 취소된다.
import { useState, type ReactNode } from 'react';
import { FEEDBACK_REASONS, type FeedbackVote } from '@/lib/briefing-video/feedback-reasons';

interface Props {
  dateKey: string;
  url: string;
  token?: string;
  initial?: { vote: FeedbackVote; reason?: string; comment?: string };
  children: ReactNode;
}

export default function BriefingFeedback({ dateKey, url, token, initial, children }: Props) {
  const [vote, setVote] = useState<FeedbackVote | null>(initial?.vote ?? null);
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [saved, setSaved] = useState(initial?.comment ?? '');
  const [failed, setFailed] = useState(false);

  const send = async (next: { vote: FeedbackVote | null; reason?: string; comment?: string }) => {
    setFailed(false);
    const res = await fetch('/api/briefing/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dateKey, url, token, ...next }),
    }).catch(() => null);
    setFailed(!res?.ok);
  };

  const pick = (v: FeedbackVote) => {
    const next = vote === v ? null : v;
    setVote(next);
    if (next !== 'down') { setReason(''); setComment(''); setSaved(''); }
    send({ vote: next, reason: next === 'down' ? reason : undefined, comment: next === 'down' ? comment : undefined });
  };
  const chooseReason = (r: string) => {
    setReason(r);
    send({ vote: 'down', reason: r, comment });
  };
  const saveComment = () => {
    if (comment === saved) return;
    setSaved(comment);
    send({ vote: 'down', reason, comment });
  };

  const button = (v: FeedbackVote, icon: string, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={vote === v}
      onClick={() => pick(v)}
      className={`flex h-9 w-9 items-center justify-center rounded-full border text-base ${vote === v ? 'border-spark-purple bg-spark-light-purple' : 'border-spark-border bg-white'}`}
    >
      {icon}
    </button>
  );

  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 gap-1">
          {button('up', '👍', '좋은 기사예요')}
          {button('down', '👎', '아쉬운 기사예요')}
        </div>
      </div>
      {failed && <div className="mt-1 text-xs text-red-600">저장하지 못했어요. 다시 눌러 주세요.</div>}
      {vote === 'down' && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1">
            {FEEDBACK_REASONS.map(r => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => chooseReason(r)}
                className={`rounded-full border px-2 py-1 text-xs ${reason === r ? 'border-spark-purple bg-spark-purple text-white' : 'border-spark-border bg-white text-spark-ink-soft'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            onBlur={saveComment}
            maxLength={300}
            placeholder="한마디 남기기 (선택)"
            className="mt-1.5 w-full rounded-lg border border-spark-border px-2 py-1.5 text-sm"
          />
        </div>
      )}
    </>
  );
}
