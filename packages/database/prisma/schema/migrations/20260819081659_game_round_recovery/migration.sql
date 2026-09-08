-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GameRoundStatus" ADD VALUE 'RECOVERING';
ALTER TYPE "GameRoundStatus" ADD VALUE 'RECOVERY_FAILED';

-- AlterTable
ALTER TABLE "game_rounds" ADD COLUMN     "last_recovery_at" TIMESTAMP(3),
ADD COLUMN     "next_recovery_at" TIMESTAMP(3),
ADD COLUMN     "recovery_attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "game_rounds_status_next_recovery_at_idx" ON "game_rounds"("status", "next_recovery_at");
