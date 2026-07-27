/**
 * Next.js instrumentation hook — 启动时自动 seed admin 账号
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = (await import('bcryptjs')).default;

    const prisma = new PrismaClient();
    try {
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
            role: 'ADMIN',
            nickname: 'Administrator',
          },
        });
        console.log(`[instrumentation] admin user "${adminUsername}" seeded`);
      }
    } catch (e) {
      console.error('[instrumentation] seed failed:', e);
    } finally {
      await prisma.$disconnect();
    }
  }
}
