-- Tipo genérico de notificación para avisos manuales (correcciones de datos, comunicados).
-- Solo usa title + message; el frontend lo muestra sin bloque de detalle específico.
ALTER TYPE "public"."NotificationType" ADD VALUE 'SYSTEM_NOTICE';
