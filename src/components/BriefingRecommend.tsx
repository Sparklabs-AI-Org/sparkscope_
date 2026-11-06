'use client';
// 「이런 기사도 보고 싶어요」 — 임직원이 유용하거나 재미있게 본 기사의 링크를 추천한다(2026-11-05 은빛).
// 모은 링크는 관리자 통계 화면에서 보고 기사 선정 기준을 다듬는 데 쓴다.
import { useState, type FormEvent } from 'react';

interface Props {
  dateKey: string;
  token?: string;
}

const isWebLink = (t: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(t).protocol);
  } catch {
    return false;
  }
};

export default function BriefingRecommend({ dateKey, token }: Props) {
  const [url, setUrl] = useState('');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'badLink' | 'tooMany' | 'failed'>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const link = url.trim();
    if (!isWebLink(link)) return setState('badLink');
    setState('sending');
    const res = await fetch('/api/briefing/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dateKey, url: link, comment, token }),
    }).catch(() => null);
    if (!res?.ok) return setState(res?.status === 429 ? 'tooMany' : 'failed');
    setUrl('');
    setComment('');
    setState('done');
  };

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-spark-border bg-white p-3">
      <h2 className="text-sm font-bold text-spark-ink">이런 기사도 보고 싶어요</h2>
      <p className="mt-0.5 text-xs text-spark-ink-soft">개인적으로 유용했던 기사가 있다면 링크를 공유해주세요.</p>
      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={e => { setUrl(e.target.value); if (state !== 'sending') setState('idle'); }}
        maxLength={2000}
        required
        placeholder="기사 링크 (https://…)"
        aria-label="추천할 기사 링크"
        className="mt-2 w-full rounded-lg border border-spark-border px-2 py-1.5 text-sm"
      />
      <input
        value={comment}
        onChange={e => setComment(e.target.value)}
        maxLength={300}
        placeholder="어떤 점이 좋았나요? (선택)"
        aria-label="추천 이유"
        className="mt-1.5 w-full rounded-lg border border-spark-border px-2 py-1.5 text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="shrink-0 rounded-lg bg-spark-purple px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          추천하기
        </button>
        <span role="status" className="text-xs text-spark-ink-soft">
          {state === 'done' && '추천해 주셔서 고마워요. 기사 선정에 참고할게요.'}
          {state === 'badLink' && <span className="text-red-600">http로 시작하는 기사 링크를 넣어 주세요.</span>}
          {state === 'tooMany' && <span className="text-red-600">오늘은 추천을 충분히 남겨 주셨어요. 내일 다시 부탁드려요.</span>}
          {state === 'failed' && <span className="text-red-600">저장하지 못했어요. 다시 눌러 주세요.</span>}
        </span>
      </div>
    </form>
  );
}
