/**
 * Next.js instrumentation hook — 启动时自动 seed admin 账号（AdminUser 表）
 *
 * 仅在 Node.js runtime 执行，避免在 edge runtime 报错。
 * Vercel Serverless 冷启动时触发，幂等。
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = (await import('bcryptjs')).default;

    const prisma = new PrismaClient();
    try {
      const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'admin';
      const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'cyccodemao1234';

      const existing = await prisma.adminUser.findUnique({
        where: { username: adminUsername },
      });

      if (!existing) {
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await prisma.adminUser.create({
          data: {
            username: adminUsername,
            passwordHash,
            role: 'SUPER_ADMIN',
            nickname: 'Administrator',
          },
        });
        console.log(`[instrumentation] admin "${adminUsername}" seeded (SUPER_ADMIN)`);
      } else if (existing.role !== 'SUPER_ADMIN') {
        await prisma.adminUser.update({
          where: { id: existing.id },
          data: { role: 'SUPER_ADMIN' },
        });
        console.log(`[instrumentation] admin "${adminUsername}" upgraded to SUPER_ADMIN`);
      }
    } catch (e) {
      console.error('[instrumentation] seed failed:', e);
    } finally {
      await prisma.$disconnect();
    }
  }
}
