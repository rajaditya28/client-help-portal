/* Seeds one consultant and three clients. Idempotent: safe to run on every boot. */
const { PrismaClient } = require('@prisma/client');
const { scryptSync, randomBytes } = require('node:crypto');

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'password123';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const consultant = await prisma.user.upsert({
    where: { email: 'consultant@demo.test' },
    update: {},
    create: {
      email: 'consultant@demo.test',
      name: 'Priya Sharma',
      role: 'CONSULTANT',
      passwordHash: hashPassword(DEMO_PASSWORD),
    },
  });

  const clients = [
    { email: 'asha@demo.test', name: 'Asha Verma' },
    { email: 'ben@demo.test', name: 'Ben Carter' },
    { email: 'chen@demo.test', name: 'Chen Li' },
  ];

  for (const c of clients) {
    await prisma.user.upsert({
      where: { email: c.email },
      update: { consultantId: consultant.id },
      create: {
        ...c,
        role: 'CLIENT',
        consultantId: consultant.id,
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    });
  }

  console.log(`Seeded 1 consultant + ${clients.length} clients (password: ${DEMO_PASSWORD})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
