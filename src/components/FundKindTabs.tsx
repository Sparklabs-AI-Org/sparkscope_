'use client';
// 펀드 카드 묶음을 자펀드 / 모펀드 탭으로 나눠 보여 준다(2026-11-27 벤처1본부 회의). 카드 자체는 서버에서 그려서 넘겨받는다.
import { useState } from 'react';

type Tab = { id: 'CHILD' | 'MOTHER'; label: string; hint: string; count: number; body: React.ReactNode };

export function FundKindTabs({ tabs, emptyLabel }: { tabs: Tab[]; emptyLabel: string }) {
  const first = tabs.find(x => x.count > 0)?.id ?? tabs[0].id;
  const [cur, setCur] = useState<Tab['id']>(first);
  const tab = tabs.find(x => x.id === cur) ?? tabs[0];
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5" role="tablist">
        {tabs.map(x => (
          <button key={x.id} type="button" role="tab" aria-selected={cur === x.id} onClick={() => setCur(x.id)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] font-bold transition-colors ${cur === x.id ? 'border-spark-purple bg-spark-purple text-white' : 'border-spark-border bg-white text-spark-ink-soft hover:border-spark-purple/40 hover:text-spark-purple'}`}>
            {x.label} <span className="tabular-nums opacity-80">{x.count}</span>
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11.5px] text-spark-muted">{tab.hint}</p>
      {tab.count > 0 ? tab.body : <p className="rounded-xl border border-dashed border-spark-border bg-white px-3.5 py-6 text-center text-[12.5px] text-spark-muted">{emptyLabel}</p>}
    </div>
  );
}
