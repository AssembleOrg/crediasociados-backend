-- DropForeignKey
ALTER TABLE "public"."collection_route_items" DROP CONSTRAINT "collection_route_items_subLoanId_fkey";

-- DropIndex
DROP INDEX "public"."collection_route_items_routeId_subLoanId_key";

-- AlterTable
ALTER TABLE "public"."collection_route_items" ALTER COLUMN "subLoanId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."collection_route_items" ADD CONSTRAINT "collection_route_items_subLoanId_fkey" FOREIGN KEY ("subLoanId") REFERENCES "public"."sub_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
