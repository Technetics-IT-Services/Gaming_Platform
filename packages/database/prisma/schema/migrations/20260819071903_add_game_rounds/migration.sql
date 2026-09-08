-- CreateEnum
CREATE TYPE "GameRoundStatus" AS ENUM ('CREATED', 'RESERVED', 'RESOLVED', 'SETTLED', 'FAILED', 'PENDING_SETTLEMENT', 'RECOVERED');

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_key" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "bet_type" TEXT NOT NULL,
    "currency_id" UUID NOT NULL,
    "stake" DECIMAL(38,18) NOT NULL,
    "payout" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "status" "GameRoundStatus" NOT NULL DEFAULT 'CREATED',
    "idempotency_key" TEXT NOT NULL,
    "reservation_id" UUID,
    "bet_transaction_id" UUID,
    "result" JSONB,
    "fairness" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_rounds_user_id_created_at_idx" ON "game_rounds"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "game_rounds_status_idx" ON "game_rounds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_user_id_idempotency_key_key" ON "game_rounds"("user_id", "idempotency_key");
