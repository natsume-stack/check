/**
 * Next.js instrumentation hook — 启动时自动 seed admin 账号
 *
 * 同时处理旧 ADMIN 角色到新 SUPER_ADMIN 角色的迁移（idempotent）。
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = (await import('bcryptjs')).default;

    const prisma = new PrismaClient();
    try {
      // ── 1. 迁移旧 ADMIN 用户为 SUPER_ADMIN（兼容性）──
      // 用 raw SQL，因为 Prisma 客户端可能不再识别 'ADMIN' 字面量
      try {
        const result = await prisma.$executeRawUnsafe(
          "UPDATE `User` SET `role` = 'SUPER_ADMIN' WHERE `role` = 'ADMIN'"
        );
        if (result > 0) {
          console.log(
            `[instrumentation] migrated ${result} legacy ADMIN user(s) to SUPER_ADMIN`
          );
        }
      } catch (e) {
        // 如果 schema 中已无 ADMIN 枚举值，或表为空，此查询可能失败 — 安全跳过
        console.warn('[instrumentation] legacy ADMIN migration skipped:', (e as Error).message);
      }

      // ── 2. Seed admin 账号 ──
      const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'admin';
      const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'cyccodemao1234';

      const existing = await prisma.user.findUnique({
        where: { username: adminUsername },
      });

      if (!existing) {
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await prisma.user.create({
          data: {
            username: adminUsername,
            passwordHash,
            role: 'SUPER_ADMIN',
            nickname: 'Administrator',
          },
        });
        console.log(`[instrumentation] admin user "${adminUsername}" seeded (SUPER_ADMIN)`);
      } else if (existing.role !== 'SUPER_ADMIN') {
        // 已存在但不是 SUPER_ADMIN，升级（防止迁移逻辑漏掉）
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: 'SUPER_ADMIN' },
        });
        console.log(
          `[instrumentation] admin user "${adminUsername}" upgraded to SUPER_ADMIN (was ${existing.role})`
        );
      }
    } catch (e) {
      console.error('[instrumentation] seed failed:', e);
    } finally {
      await prisma.$disconnect();
    }
  }
}
