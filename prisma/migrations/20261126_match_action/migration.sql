-- 포폴 매칭 진행 기록(2026-11-26 소윤): 투자팀이 "포폴사 × 하우스/펀드" 짝마다 진행 단계를 남긴다.
-- 짝 하나에 행 하나(최신 상태). 파트너 공개 대상 아님 — RLS 켜고 anon GRANT 없음.
CREATE TABLE IF NOT EXISTS "MatchAction" (
  "id"         TEXT PRIMARY KEY,
  "targetId"   TEXT NOT NULL,          -- MonitoringTarget.id (포폴사)
  "kind"       TEXT NOT NULL,          -- HOUSE / FUND
  "counterKey" TEXT NOT NULL,          -- HOUSE: investorKey(이름), FUND: Fund.id
  "counterName" TEXT NOT NULL,
  "status"     TEXT NOT NULL,          -- INTERESTED / CONTACTED / MEETING / PASSED
  "note"       TEXT,
  "updatedBy"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MatchAction_target_kind_counter_key" ON "MatchAction"("targetId", "kind", "counterKey");
CREATE INDEX IF NOT EXISTS "MatchAction_status_idx" ON "MatchAction"("status");
ALTER TABLE "MatchAction" ENABLE ROW LEVEL SECURITY;
