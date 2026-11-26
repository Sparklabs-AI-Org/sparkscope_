// 대시보드에 처음 들어올 때(다른 화면에서) 빈 화면 대신 뼈대를 먼저 보여준다(2026-11-26).
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true">
      <div className="h-8 w-64 rounded-lg bg-gray-200" />
      <div className="flex gap-2">{[0, 1, 2, 3, 4].map(i => <div key={i} className="h-10 w-28 rounded-xl bg-gray-200" />)}</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-2xl bg-gray-200" />)}</div>
      <div className="h-64 rounded-2xl bg-gray-200" />
    </div>
  );
}
