-- Blacklist: soporte CUIT, baja lógica y trazabilidad (cliente/pérdida de origen)

-- DNI pasa a opcional (se puede vetar solo por CUIT)
ALTER TABLE "public"."blacklisted_clients" ALTER COLUMN "dni" DROP NOT NULL;

-- Nuevas columnas
ALTER TABLE "public"."blacklisted_clients" ADD COLUMN "cuit" TEXT;
ALTER TABLE "public"."blacklisted_clients" ADD COLUMN "clientId" TEXT;
ALTER TABLE "public"."blacklisted_clients" ADD COLUMN "clientLossId" TEXT;
ALTER TABLE "public"."blacklisted_clients" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Índices
CREATE INDEX "blacklisted_clients_cuit_idx" ON "public"."blacklisted_clients"("cuit");
CREATE INDEX "blacklisted_clients_deletedAt_idx" ON "public"."blacklisted_clients"("deletedAt");
