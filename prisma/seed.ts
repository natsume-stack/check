import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'cyccodemao1234';

  const existing = await prisma.user.findUnique({
    where: { username: adminUsername },
  });

  if (existing) {
    console.log(`[seed] admin user "${adminUsername}" already exists, skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.user.create({
    data: {
      username: adminUsername,
      passwordHash,
      role: 'SUPER_ADMIN',
      nickname: 'Administrator',
    },
  });

  console.log(`[seed] admin user "${adminUsername}" created`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
