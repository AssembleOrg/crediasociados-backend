/**
 * Auditoría nocturna de saldos (cron de Railway).
 *
 * Revisa las tres cadenas de movimientos (billetera de cobros, caja fuerte y
 * wallet) y avisa por WhatsApp si:
 *  - un movimiento reciente arranca de un saldo distinto al que dejó el
 *    anterior (dos operaciones que se pisaron, como el 16/10/2026), o
 *  - el saldo guardado no coincide con el último movimiento.
 * Si está todo bien no manda nada.
 *
 * Env: DATABASE_URL, BOT_SEND_URL (…/send del bot de WhatsApp),
 * BOT_CONTROL_SECRET, ALERT_PHONE, AUDIT_DAYS (default 2).
 */
const { PrismaClient } = require('@prisma/client');

const DAYS = Number(process.env.AUDIT_DAYS || 2);

const CHAINS = [
  { name: 'Billetera de cobros', tx: 'collector_wallet_transactions', key: 'walletId', holder: 'collector_wallets' },
  { name: 'Caja fuerte', tx: 'safe_transactions', key: 'safeId', holder: 'safes' },
  { name: 'Wallet', tx: 'wallet_transactions', key: 'walletId', holder: 'wallets' },
];

const ars = (n) => '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const ba = (d) => new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'medium' });

async function audit(prisma, c) {
  // Saltos: balanceBefore distinto del balanceAfter del movimiento anterior.
  const breaks = await prisma.$queryRawUnsafe(`
    WITH t AS (
      SELECT t."${c.key}" AS k, t."createdAt", t.type, t.amount, t.description,
             t."balanceBefore", t."balanceAfter",
             LAG(t."balanceAfter") OVER (PARTITION BY t."${c.key}" ORDER BY t."createdAt", t.id) AS prev
      FROM ${c.tx} t
    )
    SELECT u.email, u."fullName", t.*
    FROM t
    JOIN ${c.holder} h ON h.id = t.k
    JOIN users u ON u.id = h."userId"
    WHERE t."createdAt" >= now() - make_interval(days => $1::int)
      AND t.prev IS NOT NULL AND t."balanceBefore" IS NOT NULL
      AND abs(t."balanceBefore" - t.prev) > 0.01
    ORDER BY t."createdAt"`, DAYS);

  // Saldo guardado distinto del último movimiento.
  const mismatches = await prisma.$queryRawUnsafe(`
    WITH last AS (
      SELECT DISTINCT ON ("${c.key}") "${c.key}" AS k, "balanceAfter", "createdAt"
      FROM ${c.tx}
      ORDER BY "${c.key}", "createdAt" DESC, id DESC
    )
    SELECT u.email, u."fullName", h.balance, l."balanceAfter", l."createdAt"
    FROM ${c.holder} h
    JOIN last l ON l.k = h.id
    JOIN users u ON u.id = h."userId"
    WHERE l."balanceAfter" IS NOT NULL AND abs(h.balance - l."balanceAfter") > 0.01`);

  const lines = [];
  for (const b of breaks) {
    lines.push(
      `• ${c.name} de ${b.fullName} (${b.email}), ${ba(b.createdAt)}: ${b.type} ${ars(b.amount)} arrancó de ${ars(b.balanceBefore)} ` +
        `pero el anterior dejó ${ars(b.prev)} (dif ${ars(Number(b.balanceBefore) - Number(b.prev))}). "${String(b.description).slice(0, 60)}"`,
    );
  }
  for (const m of mismatches) {
    lines.push(
      `• ${c.name} de ${m.fullName} (${m.email}): saldo ${ars(m.balance)} pero el último movimiento (${ba(m.createdAt)}) dejó ` +
        `${ars(m.balanceAfter)} (dif ${ars(Number(m.balance) - Number(m.balanceAfter))})`,
    );
  }
  return lines;
}

async function notify(text) {
  const { BOT_SEND_URL, BOT_CONTROL_SECRET, ALERT_PHONE } = process.env;
  if (!BOT_SEND_URL || !BOT_CONTROL_SECRET || !ALERT_PHONE) {
    console.error('Falta BOT_SEND_URL/BOT_CONTROL_SECRET/ALERT_PHONE; no se puede avisar');
    return;
  }
  const body = JSON.stringify({ phone: ALERT_PHONE, text });
  // El bot puede estar reconectando: reintentar unas veces.
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(BOT_SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': BOT_CONTROL_SECRET },
        body,
      });
      if (res.ok) return;
      console.error('Aviso falló', res.status, await res.text());
    } catch (e) {
      console.error('Aviso falló', e.message);
    }
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const lines = [];
    for (const c of CHAINS) lines.push(...(await audit(prisma, c)));
    if (lines.length === 0) {
      console.log(`Auditoría de saldos OK (últimos ${DAYS} días)`);
      return;
    }
    const text = `⚠️ Crediasociados: auditoría de saldos encontró ${lines.length} problema(s)\n\n${lines.slice(0, 15).join('\n')}` +
      (lines.length > 15 ? `\n… y ${lines.length - 15} más` : '');
    console.log(text);
    await notify(text);
  } catch (e) {
    console.error(e);
    await notify(`⚠️ Crediasociados: la auditoría nocturna de saldos falló: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
