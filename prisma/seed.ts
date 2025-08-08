import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Create superadmin user
  const hashedPassword = await bcrypt.hash('Credi.p.2025', 10);
  
  const superadmin = await prisma.user.upsert({
    where: { email: 'carlosjoelsalda@gmail.com' },
    update: {},
    create: {
      email: 'carlosjoelsalda@gmail.com',
      password: hashedPassword,
      fullName: 'Super Administrator',
      role: UserRole.SUPERADMIN,
    },
  });

  console.log('Superadmin created:', superadmin.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 