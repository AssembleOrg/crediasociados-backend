-- CreateEnum
CREATE TYPE "public"."CollectionRouteStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "public"."daily_collection_routes" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "routeDate" TIMESTAMP(3) NOT NULL,
    "status" "public"."CollectionRouteStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalCollected" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "totalExpenses" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_collection_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collection_route_items" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "subLoanId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientAddress" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "amountCollected" DECIMAL(40,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_route_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."route_expenses" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "category" "public"."ExpenseCategory" NOT NULL,
    "amount" DECIMAL(40,2) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_collection_routes_managerId_idx" ON "public"."daily_collection_routes"("managerId");

-- CreateIndex
CREATE INDEX "daily_collection_routes_routeDate_idx" ON "public"."daily_collection_routes"("routeDate");

-- CreateIndex
CREATE INDEX "daily_collection_routes_status_idx" ON "public"."daily_collection_routes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_collection_routes_managerId_routeDate_key" ON "public"."daily_collection_routes"("managerId", "routeDate");

-- CreateIndex
CREATE INDEX "collection_route_items_routeId_idx" ON "public"."collection_route_items"("routeId");

-- CreateIndex
CREATE INDEX "collection_route_items_subLoanId_idx" ON "public"."collection_route_items"("subLoanId");

-- CreateIndex
CREATE INDEX "collection_route_items_orderIndex_idx" ON "public"."collection_route_items"("orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "collection_route_items_routeId_subLoanId_key" ON "public"."collection_route_items"("routeId", "subLoanId");

-- CreateIndex
CREATE INDEX "route_expenses_routeId_idx" ON "public"."route_expenses"("routeId");

-- CreateIndex
CREATE INDEX "route_expenses_category_idx" ON "public"."route_expenses"("category");

-- AddForeignKey
ALTER TABLE "public"."daily_collection_routes" ADD CONSTRAINT "daily_collection_routes_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."collection_route_items" ADD CONSTRAINT "collection_route_items_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."daily_collection_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."collection_route_items" ADD CONSTRAINT "collection_route_items_subLoanId_fkey" FOREIGN KEY ("subLoanId") REFERENCES "public"."sub_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."route_expenses" ADD CONSTRAINT "route_expenses_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."daily_collection_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
