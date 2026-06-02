-- AlterTable: registrar el monto condonado al terminar un préstamo (quita)
ALTER TABLE "loans" ADD COLUMN "forgivenAmount" DECIMAL(40,2) NOT NULL DEFAULT 0;
