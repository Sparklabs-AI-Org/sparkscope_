-- 모펀드·자펀드 구분 + 카드별 O/X 피드백 (2026-11-27 벤처1본부 회의: 이희윤 상무·이준행 매니저·은빛).
-- 멱등: 여러 번 돌려도 안전. 내부 화면 전용 — RLS 켜고 anon GRANT 없음.
-- 이 SQL을 돌리기 전에도 화면은 뜬다(코드가 표·열이 없으면 규칙 분류만 쓰고 피드백 버튼을 숨긴다).

-- 사람이 정한 구분. null이면 화면이 규칙(fund-kind.ts)으로 나눈다.
--   MOTHER = 모펀드·출자사업(대표님이 큰 돈의 흐름을 보는 용도)
--   CHILD  = 자펀드(실무가 후속 투자 연결할 GP를 찾는 용도)
ALTER TABLE "Fund" ADD COLUMN IF NOT EXISTS "kind" TEXT;

-- 카드별 O/X. 한 사람이 한 펀드에 한 줄(다시 누르면 덮어쓴다).
CREATE TABLE IF NOT EXISTS "FundFeedback" (
  "id"        TEXT PRIMARY KEY,
  "fundId"    TEXT NOT NULL REFERENCES "Fund"("id") ON DELETE CASCADE,
  "userEmail" TEXT NOT NULL,
  "verdict"   TEXT NOT NULL,          -- O(맞다) / X(생뚱맞다)
  "note"      TEXT,                   -- 왜 그런지(선택)
  "shownKind" TEXT,                   -- 누를 때 카드가 있던 탭(MOTHER/CHILD) — 분류 규칙을 고칠 때 본다
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FundFeedback_fundId_userEmail_key" ON "FundFeedback"("fundId","userEmail");
CREATE INDEX IF NOT EXISTS "FundFeedback_verdict_idx" ON "FundFeedback"("verdict");
ALTER TABLE "FundFeedback" ENABLE ROW LEVEL SECURITY;
