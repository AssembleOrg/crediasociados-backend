/*
  Warnings:

  - A unique constraint covering the columns `[prefix,year,sequence]` on the table `loans` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `prefix` to the `loans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sequence` to the `loans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `year` to the `loans` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."loans" ADD COLUMN     "prefix" TEXT NOT NULL,
ADD COLUMN     "sequence" INTEGER NOT NULL,
ADD COLUMN     "year" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "public"."loan_sequences" (
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "loan_sequences_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "loans_prefix_year_sequence_key" ON "public"."loans"("prefix", "year", "sequence");
