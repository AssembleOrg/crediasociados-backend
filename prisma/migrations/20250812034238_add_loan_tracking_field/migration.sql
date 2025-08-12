/*
  Warnings:

  - A unique constraint covering the columns `[loanTrack]` on the table `loans` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `loanTrack` to the `loans` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."loans" ADD COLUMN     "loanTrack" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "loans_loanTrack_key" ON "public"."loans"("loanTrack");
