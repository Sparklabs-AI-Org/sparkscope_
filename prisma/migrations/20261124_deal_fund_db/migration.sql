-- 투자 딜·펀드 결성 DB (2026-11-24 소윤 요청). 국내만, 투자 전문 매체 수집 추가 전제, 경영진은 대표자 이름만.
-- 멱등: 여러 번 돌려도 안전. 내부 분석용이라 파트너 공개 뷰 없음. 모든 테이블 RLS 켬(정책 없음 = anon 차단).

-- 투자사·출자자(GP·LP·딜 투자사 공용 목록)
CREATE TABLE IF NOT EXISTS "Investor" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "aliases"   TEXT[] NOT NULL DEFAULT '{}',
  "kind"      TEXT,            -- VC / CVC / AC / PE / POLICY / BANK / ANGEL / CORP / OTHER
  "website"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Investor_name_key" ON "Investor"("name");

-- 투자받은 회사
CREATE TABLE IF NOT EXISTS "Company" (
  "id"                 TEXT PRIMARY KEY,
  "name"               TEXT NOT NULL,
  "aliases"            TEXT[] NOT NULL DEFAULT '{}',
  "ceoName"            TEXT,     -- 대표자 이름만(경영진 목록은 보류)
  "foundedYear"        INTEGER,
  "description"        TEXT,     -- 한 줄 소개(제품·사업)
  "sector"             TEXT,
  "monitoringTargetId" TEXT REFERENCES "MonitoringTarget"("id") ON DELETE SET NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Company_name_key" ON "Company"("name");
CREATE INDEX IF NOT EXISTS "Company_monitoringTargetId_idx" ON "Company"("monitoringTargetId");

-- 펀드(출자공고 → GP선정 → 결성완료를 한 줄에서 단계만 올린다)
CREATE TABLE IF NOT EXISTS "Fund" (
  "id"            TEXT PRIMARY KEY,
  "programName"   TEXT,          -- 사업명(예: 글로벌 스케일업 협력펀드)
  "fundName"      TEXT,          -- 정식 펀드명(기사에 드묾)
  "stage"         TEXT NOT NULL DEFAULT 'CLOSED',  -- ANNOUNCED / GP_SELECTED / CLOSED
  "targetSizeKrw" BIGINT,
  "closedSizeKrw" BIGINT,
  "sizeText"      TEXT,          -- 원문 표기("7000억 원")
  "sectors"       TEXT[] NOT NULL DEFAULT '{}',
  "announcedAt"   TIMESTAMP(3),
  "closedAt"      TIMESTAMP(3),
  "parentFundId"  TEXT REFERENCES "Fund"("id") ON DELETE SET NULL,  -- 출자사업 → 자펀드
  "reviewStatus"  TEXT NOT NULL DEFAULT 'AUTO',    -- AUTO / VERIFIED / REJECTED
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Fund_stage_idx" ON "Fund"("stage");
CREATE INDEX IF NOT EXISTS "Fund_announcedAt_idx" ON "Fund"("announcedAt");

CREATE TABLE IF NOT EXISTS "FundGP" (
  "id"         TEXT PRIMARY KEY,
  "fundId"     TEXT NOT NULL REFERENCES "Fund"("id") ON DELETE CASCADE,
  "investorId" TEXT NOT NULL REFERENCES "Investor"("id") ON DELETE CASCADE,
  "role"       TEXT,             -- SOLE / CO_GP
  "amountKrw"  BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS "FundGP_fundId_investorId_key" ON "FundGP"("fundId","investorId");

CREATE TABLE IF NOT EXISTS "FundLP" (
  "id"         TEXT PRIMARY KEY,
  "fundId"     TEXT NOT NULL REFERENCES "Fund"("id") ON DELETE CASCADE,
  "investorId" TEXT NOT NULL REFERENCES "Investor"("id") ON DELETE CASCADE,
  "amountKrw"  BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS "FundLP_fundId_investorId_key" ON "FundLP"("fundId","investorId");

-- 투자 딜
CREATE TABLE IF NOT EXISTS "Deal" (
  "id"                    TEXT PRIMARY KEY,
  "companyId"             TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "round"                 TEXT,  -- SEED / PRE_A / A / B / C / D+ / BRIDGE / STRATEGIC / MA / IPO / OTHER
  "amountKrw"             BIGINT, -- 비공개면 null
  "amountText"            TEXT,
  "announcedAt"           TIMESTAMP(3) NOT NULL,
  "reportedCumulativeKrw" BIGINT, -- 기사에 "누적 ○○억"이 있을 때만(대조용; 누적은 Deal 합으로 계산)
  "reviewStatus"          TEXT NOT NULL DEFAULT 'AUTO',
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Deal_companyId_announcedAt_idx" ON "Deal"("companyId","announcedAt");
CREATE INDEX IF NOT EXISTS "Deal_announcedAt_idx" ON "Deal"("announcedAt");

CREATE TABLE IF NOT EXISTS "DealInvestor" (
  "id"         TEXT PRIMARY KEY,
  "dealId"     TEXT NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
  "investorId" TEXT NOT NULL REFERENCES "Investor"("id") ON DELETE CASCADE,
  "role"       TEXT,             -- LEAD / FOLLOW / NEW / EXISTING
  "fundId"     TEXT REFERENCES "Fund"("id") ON DELETE SET NULL,  -- 어떤 펀드로(Fund 표에 있을 때)
  "fundName"   TEXT             -- 기사에 적힌 펀드명 그대로(드묾. 예: 한국밸류 국민성장 일반사모투자신탁 2호)
);
CREATE UNIQUE INDEX IF NOT EXISTS "DealInvestor_dealId_investorId_key" ON "DealInvestor"("dealId","investorId");
CREATE INDEX IF NOT EXISTS "DealInvestor_investorId_idx" ON "DealInvestor"("investorId");

-- 근거 기사(한 딜·펀드에 여러 기사 → 중복 보도 합치기)
CREATE TABLE IF NOT EXISTS "DealSource" (
  "id"        TEXT PRIMARY KEY,
  "dealId"    TEXT NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
  "articleId" TEXT NOT NULL REFERENCES "Article"("id") ON DELETE CASCADE,
  "evidence"  TEXT,              -- 근거 문장
  "extracted" JSONB,             -- 이 기사에서 뽑은 값 그대로
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DealSource_dealId_articleId_key" ON "DealSource"("dealId","articleId");
CREATE INDEX IF NOT EXISTS "DealSource_articleId_idx" ON "DealSource"("articleId");

CREATE TABLE IF NOT EXISTS "FundSource" (
  "id"        TEXT PRIMARY KEY,
  "fundId"    TEXT NOT NULL REFERENCES "Fund"("id") ON DELETE CASCADE,
  "articleId" TEXT NOT NULL REFERENCES "Article"("id") ON DELETE CASCADE,
  "evidence"  TEXT,
  "extracted" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FundSource_fundId_articleId_key" ON "FundSource"("fundId","articleId");
CREATE INDEX IF NOT EXISTS "FundSource_articleId_idx" ON "FundSource"("articleId");

-- 추출기 처리 표시(deal-extract.ts) — 한 번 본 기사는 다시 LLM에 넘기지 않는다
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "dealCheckedAt" TIMESTAMP(3);
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "dealVerdict" TEXT;  -- DEAL / FUND / NONE / OVERSEAS / UNVERIFIED / ERROR

ALTER TABLE "Investor"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Fund"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FundGP"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FundLP"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealInvestor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealSource"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FundSource"   ENABLE ROW LEVEL SECURITY;
