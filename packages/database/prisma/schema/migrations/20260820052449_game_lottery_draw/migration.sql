-- CreateEnum
CREATE TYPE "LotteryDrawStatus" AS ENUM ('OPEN', 'CLOSED', 'DRAWN', 'SETTLED');

-- AlterTable
ALTER TABLE "game_rounds" ADD COLUMN     "draw_id" UUID;

-- CreateTable
CREATE TABLE "lottery_draws" (
    "id" UUID NOT NULL,
    "draw_number" SERIAL NOT NULL,
    "status" "LotteryDrawStatus" NOT NULL DEFAULT 'OPEN',
    "pool_size" INTEGER NOT NULL,
    "pick" INTEGER NOT NULL,
    "ticket_price" DECIMAL(38,18) NOT NULL,
    "currency_id" UUID NOT NULL,
    "server_seed" TEXT NOT NULL,
    "server_seed_hash" TEXT NOT NULL,
    "client_seed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "winning_numbers" INTEGER[],
    "opens_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draw_at" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_draws_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lottery_draws_draw_number_key" ON "lottery_draws"("draw_number");

-- CreateIndex
CREATE INDEX "lottery_draws_status_draw_at_idx" ON "lottery_draws"("status", "draw_at");

-- CreateIndex
CREATE INDEX "game_rounds_draw_id_idx" ON "game_rounds"("draw_id");
