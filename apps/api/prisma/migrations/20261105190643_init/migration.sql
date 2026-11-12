-- CreateEnum
CREATE TYPE "IntegrityMode" AS ENUM ('ANONYMOUS_AUDIT', 'E2E_VERIFIABLE');

-- CreateEnum
CREATE TYPE "ElectionState" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'SEALED');

-- CreateEnum
CREATE TYPE "BallotType" AS ENUM ('SINGLE', 'MULTI', 'APPROVAL', 'RANKED', 'REFERENDUM');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'OBSERVER');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'INSTITUTION',
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Voter_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Election" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mode" "IntegrityMode" NOT NULL,
    "state" "ElectionState" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "sealed" JSONB,

    CONSTRAINT "Election_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "BallotType" NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "allowAbstain" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "profile" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibleVoter" (
    "electionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,

    CONSTRAINT "EligibleVoter_pkey" PRIMARY KEY ("electionId","tenantId","voterId")
);

-- CreateTable
CREATE TABLE "Participation" (
    "electionId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("electionId","tenantId","voterId","positionId")
);

-- CreateTable
CREATE TABLE "Ballot" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ballotHash" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,

    CONSTRAINT "Ballot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "electionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("electionId","seq")
);

-- CreateTable
CREATE TABLE "SessionRevocation" (
    "sid" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionRevocation_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "OtpRecord" (
    "voterId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRecord_pkey" PRIMARY KEY ("voterId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE INDEX "Voter_tenantId_idx" ON "Voter"("tenantId");

-- CreateIndex
CREATE INDEX "Election_tenantId_state_idx" ON "Election"("tenantId", "state");

-- CreateIndex
CREATE INDEX "Position_electionId_idx" ON "Position"("electionId");

-- CreateIndex
CREATE INDEX "Candidate_positionId_idx" ON "Candidate"("positionId");

-- CreateIndex
CREATE INDEX "EligibleVoter_tenantId_voterId_idx" ON "EligibleVoter"("tenantId", "voterId");

-- CreateIndex
CREATE INDEX "Participation_electionId_tenantId_voterId_idx" ON "Participation"("electionId", "tenantId", "voterId");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_ballotHash_key" ON "Ballot"("ballotHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_receiptHash_key" ON "Ballot"("receiptHash");

-- CreateIndex
CREATE INDEX "Ballot_electionId_positionId_idx" ON "Ballot"("electionId", "positionId");

-- CreateIndex
CREATE INDEX "AuditLog_electionId_idx" ON "AuditLog"("electionId");

-- CreateIndex
CREATE INDEX "SessionRevocation_expiresAt_idx" ON "SessionRevocation"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpRecord_expiresAt_idx" ON "OtpRecord"("expiresAt");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voter" ADD CONSTRAINT "Voter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Election" ADD CONSTRAINT "Election_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleVoter" ADD CONSTRAINT "EligibleVoter_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleVoter" ADD CONSTRAINT "EligibleVoter_tenantId_voterId_fkey" FOREIGN KEY ("tenantId", "voterId") REFERENCES "Voter"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_tenantId_voterId_fkey" FOREIGN KEY ("tenantId", "voterId") REFERENCES "Voter"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default Tenant row
INSERT INTO "Tenant" ("id", "type", "name", "config")
VALUES ('default', 'INSTITUTION', 'Default Institution', '{}')
ON CONFLICT ("id") DO NOTHING;

-- Immutability triggers enforcing append-only tables
CREATE OR REPLACE FUNCTION prevent_modification()
RETURNS TRIGGER AS $$
DECLARE
  election_state "ElectionState";
BEGIN
  IF TG_OP = 'DELETE' AND (TG_TABLE_NAME = 'Participation' OR TG_TABLE_NAME = 'AuditLog') THEN
    SELECT state INTO election_state FROM "Election" WHERE id = OLD."electionId";
    IF election_state = 'DRAFT' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Table % is append-only: UPDATE and DELETE are prohibited', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER trg_ballot_immutable
BEFORE UPDATE OR DELETE ON "Ballot"
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER trg_participation_immutable
BEFORE UPDATE OR DELETE ON "Participation"
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- State transition trigger: state can only move forward DRAFT -> OPEN -> CLOSED -> SEALED
CREATE OR REPLACE FUNCTION enforce_election_state_forward()
RETURNS TRIGGER AS $$
DECLARE
  old_rank INT;
  new_rank INT;
BEGIN
  IF OLD."state" = NEW."state" THEN
    RETURN NEW;
  END IF;

  old_rank := CASE OLD."state"
    WHEN 'DRAFT' THEN 1
    WHEN 'OPEN' THEN 2
    WHEN 'CLOSED' THEN 3
    WHEN 'SEALED' THEN 4
    ELSE 0
  END;

  new_rank := CASE NEW."state"
    WHEN 'DRAFT' THEN 1
    WHEN 'OPEN' THEN 2
    WHEN 'CLOSED' THEN 3
    WHEN 'SEALED' THEN 4
    ELSE 0
  END;

  IF new_rank <= old_rank THEN
    RAISE EXCEPTION 'Invalid election state transition from % to %: state can only move forward', OLD."state", NEW."state";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_election_state_forward
BEFORE UPDATE OF "state" ON "Election"
FOR EACH ROW EXECUTE FUNCTION enforce_election_state_forward();

-- ============================================================================
-- Production Least-Privilege Database Role Setup:
--
-- In production, the application should connect using a dedicated non-superuser role
-- with INSERT and SELECT only on the immutable cryptographic/audit tables:
--
-- CREATE ROLE evote_app WITH LOGIN PASSWORD 'strong_production_password';
-- GRANT CONNECT ON DATABASE evote TO evote_app;
-- GRANT USAGE ON SCHEMA public TO evote_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO evote_app;
--
-- Explicitly revoke modification privileges on immutable tables:
-- REVOKE UPDATE, DELETE ON TABLE "AuditLog" FROM evote_app;
-- REVOKE UPDATE, DELETE ON TABLE "Ballot" FROM evote_app;
-- REVOKE UPDATE, DELETE ON TABLE "Participation" FROM evote_app;
-- ============================================================================
