/**
 * 数据库种子脚本 — 初始化超级管理员（AdminUser 表）
 *
 * 用法：pnpm prisma db seed 或 npx tsx prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'cyccodemao1234';

  const existing = await prisma.adminUser.findUnique({
    where: { username: adminUsername },
  });

  if (existing) {
    // 已存在但不是超管，升级
    if (existing.role !== 'SUPER_ADMIN') {
      await prisma.adminUser.update({
        where: { id: existing.id },
        data: { role: 'SUPER_ADMIN' },
      });
      console.log(`[seed] admin "${adminUsername}" upgraded to SUPER_ADMIN`);
    } else {
      console.log(`[seed] admin "${adminUsername}" already SUPER_ADMIN, skipping`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.adminUser.create({
    data: {
      username: adminUsername,
      passwordHash,
      role: 'SUPER_ADMIN',
      nickname: 'Administrator',
    },
  });

  console.log(`[seed] admin "${adminUsername}" created (SUPER_ADMIN)`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
