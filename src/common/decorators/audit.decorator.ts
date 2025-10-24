import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '../services/audit.service';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  action: AuditAction;
  entity: string;
  description?: string;
}

export const Audit = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_KEY, metadata);

