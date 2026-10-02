/**
 * Datos de prueba para debugging y testing.
 *
 * Crea ADMIN → 2 SUBADMIN → 3 cobradores con clientes, préstamos, cobros,
 * rutas del día, gastos y caja fuerte. Usa los servicios reales de la app
 * (no inserts a mano) para que wallets, cuotas y rutas queden consistentes,
 * igual que si se hubiera operado desde el front.
 *
 * Todo lo que crea queda marcado para poder borrarlo sin tocar datos reales:
 *   - emails  *@qa.test
 *   - DNIs    QA########  (con letras: no puede coincidir con una persona real)
 *
 * ─── Modos ──────────────────────────────────────────────────────────────────
 *   pnpm dev:fixtures                crea los datos (falla si ya existen)
 *   pnpm dev:fixtures --cleanup      borra SOLO los datos de prueba
 *   pnpm dev:fixtures --reset        [solo base no productiva] vacía TODA la
 *                                    base y crea además un SUPERADMIN de prueba
 *
 * Producción (base "railway"): requiere ALLOW_PRODUCTION_FIXTURES=1. No crea
 * SUPERADMIN (el ADMIN de prueba cuelga del SUPERADMIN real), no registra la
 * baja por pérdida (la lista negra es compartida por todos los subadmins) y
 * --reset está prohibido.
 *
 *   ALLOW_PRODUCTION_FIXTURES=1 pnpm dev:fixtures
 *   ALLOW_PRODUCTION_FIXTURES=1 pnpm dev:fixtures --cleanup
 *
 * Base aparte (local o *_dev en Railway): pasar DATABASE_URL; si es remota,
 * ALLOW_REMOTE_DEV_DB=1. Crear el esquema con `npx prisma db push` (el
 * historial de migraciones no reconstruye una base vacía).
 *
 * ─── Cuentas (contraseña de todas: test1234) ───────────────────────────────
 *   superadmin@qa.test    SUPERADMIN  (solo en bases no productivas)
 *   admin@qa.test         ADMIN
 *   subadmin1@qa.test     SUBADMIN  (tenant 1)
 *     cobrador1@qa.test   MANAGER   comisión 10%
 *     cobrador2@qa.test   MANAGER   comisión 8%
 *   subadmin2@qa.test     SUBADMIN  (tenant 2, para probar aislamiento)
 *     cobrador3@qa.test   MANAGER   comisión 10%
 *
 * Cliente compartido entre tenants: DNI QA00000001 (cobrador1 y cobrador3),
 * cada uno con su propio préstamo.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import { ClientsService } from '../src/clients/clients.service';
import { LoansService } from '../src/loans/loans.service';
import { PaymentsService } from '../src/payments/payments.service';
import { WalletService } from '../src/wallet/wallet.service';
import { SafeService } from '../src/safe/safe.service';
import { CollectionRoutesService } from '../src/collection-routes/collection-routes.service';
import { ClientLossesService } from '../src/client-losses/client-losses.service';
import { UserRole } from '../src/common/enums';
import { DateUtil } from '../src/common/utils';

const PASSWORD = 'test1234';
const EMAIL_DOMAIN = '@qa.test';
const DNI_PREFIX = 'QA';
const PRODUCTION_DATABASES = ['railway'];

const RESET = process.argv.includes('--reset');
const CLEANUP = process.argv.includes('--cleanup');

const email = (local: string) => `${local}${EMAIL_DOMAIN}`;
const dni = (n: number) => `${DNI_PREFIX}${String(n).padStart(8, '0')}`;
/** ISO de hace N días (zona Buenos Aires), útil para primeras cuotas vencidas. */
const daysAgo = (n: number) => DateUtil.now().minus({ days: n }).startOf('day').toISO()!;

/** Devuelve true si la base es producción. Aborta si el entorno no es seguro. */
function checkDatabase(): boolean {
  const url = process.env.DATABASE_URL || '';
  let host = '';
  let dbName = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    // URL inválida
  }
  const fail = (msg: string) => {
    console.error(`\n✋ ${msg}\n`);
    process.exit(1);
  };

  if (!dbName) fail('DATABASE_URL inválida o sin nombre de base.');

  const isProduction = PRODUCTION_DATABASES.includes(dbName);
  if (isProduction) {
    if (process.env.ALLOW_PRODUCTION_FIXTURES !== '1') {
      fail(`La base "${dbName}" es producción. Para cargar o limpiar fixtures ahí pasá ALLOW_PRODUCTION_FIXTURES=1.`);
    }
    if (RESET) fail('--reset está prohibido en producción (vaciaría todos los datos reales).');
    return true;
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  const remoteDevAllowed = process.env.ALLOW_REMOTE_DEV_DB === '1' && dbName.endsWith('_dev');
  if (!isLocal && !remoteDevAllowed) {
    fail(`Base remota "${dbName}" en ${host}: solo se permite si se llama *_dev y con ALLOW_REMOTE_DEV_DB=1.`);
  }
  return false;
}

/**
 * Borra únicamente lo creado por este script: usuarios *@qa.test y clientes
 * QA########. Nunca toca clientes reales aunque un cobrador de prueba los
 * tuviera vinculados (solo se borra el vínculo, que cae con el usuario).
 */
async function cleanup(prisma: PrismaService, log: Logger) {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_DOMAIN } },
    select: { id: true, email: true, role: true },
  });
  const userIds = users.map((u) => u.id);
  const clients = await prisma.client.findMany({
    where: { dni: { startsWith: DNI_PREFIX } },
    select: { id: true },
  });
  const clientIds = clients.map((c) => c.id);

  await prisma.$transaction(async (tx) => {
    // Clientes de prueba: cascada a préstamos, cuotas, pagos, pérdidas y vínculos
    await tx.client.deleteMany({ where: { id: { in: clientIds } } });
    // Préstamos de cobradores de prueba (Loan.managerId no tiene FK)
    await tx.loan.deleteMany({ where: { managerId: { in: userIds } } });
    await tx.blacklistedClient.deleteMany({ where: { dni: { startsWith: DNI_PREFIX } } });
    // Usuarios de abajo hacia arriba (createdBy es opcional, pero así no quedan huérfanos)
    for (const role of ['MANAGER', 'SUBADMIN', 'ADMIN', 'SUPERADMIN'] as const) {
      await tx.user.deleteMany({ where: { id: { in: userIds }, role } });
    }
  }, { timeout: 120000 });

  log.log(`Limpieza: ${users.length} usuarios y ${clients.length} clientes de prueba eliminados`);
}

async function main() {
  const isProduction = checkDatabase();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const log = new Logger('dev-fixtures');

  try {
    const prisma = app.get(PrismaService);

    if (CLEANUP) {
      await cleanup(prisma, log);
      return;
    }

    const users = app.get(UsersService);
    const clients = app.get(ClientsService);
    const loans = app.get(LoansService);
    const payments = app.get(PaymentsService);
    const wallets = app.get(WalletService);
    const safes = app.get(SafeService);
    const routes = app.get(CollectionRoutesService);
    const losses = app.get(ClientLossesService);

    // ── 0. Estado previo ────────────────────────────────────────────────────
    if (RESET) {
      const tables: { tablename: string }[] = await prisma.$queryRaw`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      if (tables.length) {
        await prisma.$executeRawUnsafe(
          `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
        );
      }
      log.warn(`Base vaciada (${tables.length} tablas)`);
    } else {
      const [existingUsers, existingClients] = await Promise.all([
        prisma.user.count({ where: { email: { endsWith: EMAIL_DOMAIN } } }),
        prisma.client.count({ where: { dni: { startsWith: DNI_PREFIX } } }),
      ]);
      if (existingUsers || existingClients) {
        throw new Error(
          `Ya hay datos de prueba (${existingUsers} usuarios, ${existingClients} clientes). Corré --cleanup primero.`,
        );
      }
    }

    // ── 1. Usuarios ─────────────────────────────────────────────────────────
    const asUser = (u: { id: string; role: any }) => ({ id: u.id, role: u.role });

    let superadmin: { id: string; role: any };
    if (isProduction) {
      // El ADMIN de prueba cuelga del SUPERADMIN real; no se crea otro.
      const real = await prisma.user.findFirst({
        where: { role: 'SUPERADMIN', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true },
      });
      if (!real) throw new Error('No hay SUPERADMIN activo del que colgar el ADMIN de prueba');
      superadmin = real;
    } else {
      superadmin = await prisma.user.create({
        data: {
          email: email('superadmin'),
          password: await bcrypt.hash(PASSWORD, 10),
          fullName: 'Super Admin QA',
          role: 'SUPERADMIN',
          clientQuota: 1000,
        },
        select: { id: true, role: true },
      });
    }

    const admin = await users.create(
      { email: email('admin'), password: PASSWORD, fullName: 'Admin QA', role: UserRole.ADMIN, clientQuota: 450 },
      asUser(superadmin),
    );
    const subadmin1 = await users.create(
      { email: email('subadmin1'), password: PASSWORD, fullName: 'Subadmin QA Uno', role: UserRole.SUBADMIN, clientQuota: 200, phone: '541100000001' },
      asUser(admin),
    );
    const subadmin2 = await users.create(
      { email: email('subadmin2'), password: PASSWORD, fullName: 'Subadmin QA Dos', role: UserRole.SUBADMIN, clientQuota: 100, phone: '541100000002' },
      asUser(admin),
    );
    const cobrador1 = await users.create(
      { email: email('cobrador1'), password: PASSWORD, fullName: 'Cobrador QA Uno', role: UserRole.MANAGER, clientQuota: 50, commission: 10 },
      asUser(subadmin1),
    );
    const cobrador2 = await users.create(
      { email: email('cobrador2'), password: PASSWORD, fullName: 'Cobrador QA Dos', role: UserRole.MANAGER, clientQuota: 30, commission: 8 },
      asUser(subadmin1),
    );
    const cobrador3 = await users.create(
      { email: email('cobrador3'), password: PASSWORD, fullName: 'Cobrador QA Tres', role: UserRole.MANAGER, clientQuota: 30, commission: 10 },
      asUser(subadmin2),
    );
    log.log('Usuarios creados');

    // ── 2. Dinero inicial: wallet del subadmin, transferencias y caja fuerte ─
    for (const [sub, mgrs] of [
      [subadmin1, [cobrador1, cobrador2]],
      [subadmin2, [cobrador3]],
    ] as const) {
      await wallets.deposit(sub.id, { amount: 5_000_000, currency: 'ARS', description: 'Capital inicial (QA)' } as any);
      for (const m of mgrs) {
        await wallets.transfer(sub.id, { managerId: m.id, amount: 1_000_000, currency: 'ARS', description: 'Asignación inicial (QA)' } as any);
        await safes.deposit(m.id, 500_000, 'Fondo inicial caja fuerte (QA)');
      }
    }
    log.log('Wallets y cajas fuertes cargadas');

    // ── 3. Clientes (verificados por su subadmin) ───────────────────────────
    type Seed = { name: string; dni: string; phone: string; address: string; job: string };
    const makeClients = (base: number, lastName: string): Seed[] =>
      [
        ['Ana', 'Almacén'],
        ['Bruno', 'Kiosco'],
        ['Carla', 'Peluquería'],
        ['Diego', 'Remis'],
        ['Elena', 'Verdulería'],
      ].map(([first, job], i) => ({
        name: `${first} ${lastName} QA`,
        dni: dni(base + i),
        phone: `54110000${String(base + i).padStart(4, '0').slice(-4)}`,
        address: `Calle Falsa ${100 + i}, Florencio Varela, Buenos Aires`,
        job,
      }));

    const createClients = async (manager: { id: string }, subadminId: string, seeds: Seed[]) => {
      const out: { id: string; fullName: string; dni: string }[] = [];
      for (const s of seeds) {
        const c: any = await clients.create(
          { fullName: s.name, dni: s.dni, phone: s.phone, address: s.address, job: s.job, work: 'Independiente' } as any,
          manager.id,
          UserRole.MANAGER,
        );
        if (!c.verified) await clients.verifyClient(c.id, subadminId);
        out.push({ id: c.id, fullName: s.name, dni: s.dni });
      }
      return out;
    };

    const c1 = await createClients(cobrador1, subadmin1.id, makeClients(1, 'Pérez'));
    const c2 = await createClients(cobrador2, subadmin1.id, makeClients(201, 'Gómez'));
    // cobrador3 comparte el primer cliente (QA00000001) con cobrador1
    const c3 = await createClients(cobrador3, subadmin2.id, [
      makeClients(1, 'Pérez')[0],
      ...makeClients(301, 'López').slice(1),
    ]);
    log.log(`Clientes creados: ${c1.length + c2.length + c3.length} (1 compartido entre tenants)`);

    // ── 4. Préstamos con distintas frecuencias y antigüedad ─────────────────
    type LoanSpec = { amount: number; freq: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'; payments: number; startDaysAgo: number };
    const specs: LoanSpec[] = [
      { amount: 500_000, freq: 'WEEKLY', payments: 12, startDaysAgo: 35 },
      { amount: 200_000, freq: 'DAILY', payments: 20, startDaysAgo: 10 },
      { amount: 300_000, freq: 'BIWEEKLY', payments: 6, startDaysAgo: 28 },
      { amount: 150_000, freq: 'DAILY', payments: 24, startDaysAgo: 0 },
      { amount: 1_000_000, freq: 'MONTHLY', payments: 6, startDaysAgo: 45 },
    ];

    const createLoans = async (manager: { id: string }, cs: { id: string }[]) => {
      const created: any[] = [];
      for (let i = 0; i < cs.length; i++) {
        const s = specs[i % specs.length];
        created.push(
          await loans.createLoan(
            {
              clientId: cs[i].id,
              amount: s.amount,
              baseInterestRate: 0.5,
              penaltyInterestRate: 0,
              currency: 'ARS',
              paymentFrequency: s.freq,
              totalPayments: s.payments,
              firstDueDate: daysAgo(s.startDaysAgo),
              description: `Préstamo QA ${s.freq}`,
            } as any,
            manager.id,
          ),
        );
      }
      return created;
    };

    const l1 = await createLoans(cobrador1, c1);
    const l2 = await createLoans(cobrador2, c2);
    const l3 = await createLoans(cobrador3, c3);
    log.log(`Préstamos creados: ${l1.length + l2.length + l3.length}`);

    // ── 5. Cobros: cuotas vencidas pagas completas, algunas parciales ───────
    const payOverdue = async (manager: { id: string }, loanList: any[], partialEvery: number) => {
      let count = 0;
      const now = new Date();
      for (const loan of loanList) {
        const subLoans = await prisma.subLoan.findMany({
          where: { loanId: loan.id ?? loan.loan?.id, deletedAt: null, dueDate: { lt: now } },
          orderBy: { paymentNumber: 'asc' },
        });
        // Deja la última vencida sin pagar para tener morosidad
        for (const [idx, sl] of subLoans.slice(0, -1).entries()) {
          const partial = partialEvery > 0 && (idx + 1) % partialEvery === 0;
          await payments.registerPayment(manager.id, UserRole.MANAGER as any, {
            subLoanId: sl.id,
            amount: partial ? Math.round(Number(sl.totalAmount) / 2) : Number(sl.totalAmount),
            currency: 'ARS',
            distributeOverflow: false,
            description: partial ? 'Pago parcial (QA)' : 'Pago (QA)',
          } as any);
          count++;
        }
      }
      return count;
    };
    const paid =
      (await payOverdue(cobrador1, l1, 4)) +
      (await payOverdue(cobrador2, l2, 3)) +
      (await payOverdue(cobrador3, l3, 0));
    log.log(`Pagos registrados: ${paid}`);

    // ── 6. Rutas del día + un gasto de ruta ─────────────────────────────────
    // En producción no se dispara createDailyRoutes (crearía/actualizaría las
    // rutas de TODOS los cobradores reales); se usa solo en bases aparte.
    if (!isProduction) {
      await routes.createDailyRoutes();
      const todayRoute = await prisma.dailyCollectionRoute.findFirst({
        where: { managerId: cobrador1.id, status: 'ACTIVE' },
        orderBy: { routeDate: 'desc' },
      });
      if (todayRoute) {
        await routes.createRouteExpense(todayRoute.id, cobrador1.id, UserRole.MANAGER as any, {
          category: 'COMBUSTIBLE',
          amount: 15_000,
          description: 'Nafta (QA)',
        } as any);
      }
      log.log('Rutas del día creadas');
    }

    // ── 7. Pérdida (solo fuera de producción: la lista negra es compartida) ─
    if (!isProduction) {
      const lossClient = c2[4];
      await losses.markAsLoss(lossClient.id, cobrador2.id, 'Cliente inubicable (QA)');
      log.log(`Pérdida registrada: ${lossClient.fullName} (DNI ${lossClient.dni})`);
    }

    // ── Resumen ─────────────────────────────────────────────────────────────
    const [u, cl, lo, pa] = await Promise.all([
      prisma.user.count({ where: { email: { endsWith: EMAIL_DOMAIN } } }),
      prisma.client.count({ where: { dni: { startsWith: DNI_PREFIX } } }),
      prisma.loan.count({ where: { client: { dni: { startsWith: DNI_PREFIX } } } }),
      prisma.payment.count({ where: { subLoan: { loan: { client: { dni: { startsWith: DNI_PREFIX } } } } } }),
    ]);
    console.log(`\n✅ Fixtures listos: ${u} usuarios, ${cl} clientes, ${lo} préstamos, ${pa} pagos`);
    console.log(`   Contraseña de todas las cuentas: ${PASSWORD} (ver cabecera de scripts/dev-fixtures.ts)\n`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('\n❌ dev-fixtures falló:', err?.response?.message || err?.message || err);
  process.exit(1);
});
