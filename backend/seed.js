/**
 * Seed script — creates the first admin user.
 * Run: node seed.js
 */
require('dotenv').config({ path: 'C:\\credentials\\.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'piyush@wiom.in';
  const name = process.env.SEED_ADMIN_NAME || 'Piyush';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    return;
  }

  await prisma.user.create({ data: { name, email, role: 'admin' } });
  console.log(`✓ Admin created: ${name} <${email}>`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
