import { UserRole as LocalUserRole } from '../enums';

// Type converter for Prisma UserRole to Local UserRole
export function convertPrismaUserRole(prismaRole: any): LocalUserRole {
  switch (prismaRole) {
    case 'SUPERADMIN':
      return LocalUserRole.SUPERADMIN;
    case 'ADMIN':
      return LocalUserRole.ADMIN;
    case 'SUBADMIN':
      return LocalUserRole.SUBADMIN;
    case 'MANAGER':
      return LocalUserRole.MANAGER;
    default:
      throw new Error(`Unknown UserRole: ${prismaRole}`);
  }
}

// Type converter for Prisma user object to UserResponseDto
export function convertPrismaUserToResponse(prismaUser: any): any {
  const clientQuota = prismaUser.clientQuota ?? 0;
  const usedClientQuota = prismaUser.usedClientQuota ?? 0;

  return {
    ...prismaUser,
    role: convertPrismaUserRole(prismaUser.role),
    clientQuota,
    usedClientQuota,
    availableClientQuota: clientQuota - usedClientQuota,
  };
}
