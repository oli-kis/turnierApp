-- AlterTable
ALTER TABLE "Goal" ADD COLUMN "clientId" TEXT;

-- CreateIndex
-- Nullable + UNIQUE: SQLite and Postgres both allow multiple NULLs, so goals
-- scored online (no outbox key) are unaffected by the constraint.
CREATE UNIQUE INDEX "Goal_clientId_key" ON "Goal"("clientId");
