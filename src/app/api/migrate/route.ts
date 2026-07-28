/**
 * 临时迁移接口：把旧 User 表数据迁移到 AdminUser + LokiUser
 *
 * 流程：
 *   1. 创建 AdminUser 表（如果不存在）
 *   2. 把 User 表中 username='admin' 的用户迁移到 AdminUser（role=SUPER_ADMIN）
 *   3. 把 User 表改名为 LokiUser（或创建 LokiUser 并迁移数据）
 *   4. 删除旧 User 表
 *
 * 安全：一次性硬编码密钥，用完即删此文件。
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const expectedKey = 'migrate-once-2026-07-28-k9m2';

  if (key !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs: string[] = [];

  try {
    // 检查 User 表是否存在
    const tables = await prisma.$queryRawUnsafe<any[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User'`
    );

    if (tables.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'User table does not exist, migration already done or not needed',
        logs,
      });
    }

    logs.push('User table exists, starting migration');

    // 1. 检查 AdminUser 表是否已有 admin 用户
    const adminExists = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, username, role FROM \`AdminUser\` WHERE username = 'admin' LIMIT 1`
    );

    if (adminExists.length === 0) {
      // 2. 从 User 表迁移 admin 到 AdminUser
      logs.push('Migrating admin user to AdminUser table');
      await prisma.$executeRawUnsafe(
        `INSERT INTO \`AdminUser\` (\`id\`, \`username\`, \`passwordHash\`, \`nickname\`, \`role\`, \`createdAt\`, \`updatedAt\`, \`lastSeenAt\`, \`failedLoginAttempts\`, \`lockedUntil\`)
         SELECT \`id\`, \`username\`, \`passwordHash\`, \`nickname\`, 'SUPER_ADMIN', \`createdAt\`, \`updatedAt\`, \`lastSeenAt\`, 0, NULL
         FROM \`User\` WHERE \`username\` = 'admin'`
      );
      logs.push('Admin user migrated to AdminUser');
    } else {
      logs.push('Admin user already exists in AdminUser, skipping');
    }

    // 3. 创建 LokiUser 表（如果不存在）
    logs.push('Creating LokiUser table if not exists');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`LokiUser\` (
        \`id\` VARCHAR(128) NOT NULL,
        \`username\` VARCHAR(191) NOT NULL,
        \`passwordHash\` VARCHAR(191) NOT NULL,
        \`nickname\` VARCHAR(191) NOT NULL DEFAULT '',
        \`avatarUrl\` VARCHAR(191) NULL,
        \`fingerprint\` VARCHAR(191) NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL,
        \`lastSeenAt\` DATETIME(3) NULL,
        \`status\` ENUM('ACTIVE', 'BANNED', 'EXPIRED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
        \`bannedAt\` DATETIME(3) NULL,
        \`bannedReason\` VARCHAR(191) NULL,
        \`bannedById\` VARCHAR(128) NULL,
        \`expiresAt\` DATETIME(3) NULL,
        \`failedLoginAttempts\` INT NOT NULL DEFAULT 0,
        \`lockedUntil\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`LokiUser_username_key\`(\`username\`),
        INDEX \`LokiUser_username_idx\`(\`username\`),
        INDEX \`LokiUser_lastSeenAt_idx\`(\`lastSeenAt\`),
        INDEX \`LokiUser_status_idx\`(\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `);
    logs.push('LokiUser table ready');

    // 4. 迁移非 admin 用户到 LokiUser（如果 LokiUser 为空）
    const lokiUserCount = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as cnt FROM \`LokiUser\``
    );
    const lokiCount = Number(lokiUserCount[0]?.cnt ?? 0);

    if (lokiCount === 0) {
      logs.push('Migrating non-admin users from User to LokiUser');
      await prisma.$executeRawUnsafe(
        `INSERT INTO \`LokiUser\` (\`id\`, \`username\`, \`passwordHash\`, \`nickname\`, \`avatarUrl\`, \`fingerprint\`, \`createdAt\`, \`updatedAt\`, \`lastSeenAt\`, \`status\`, \`bannedAt\`, \`bannedReason\`, \`bannedById\`, \`expiresAt\`, \`failedLoginAttempts\`, \`lockedUntil\`)
         SELECT \`id\`, \`username\`, \`passwordHash\`, \`nickname\`, \`avatarUrl\`, \`fingerprint\`, \`createdAt\`, \`updatedAt\`, \`lastSeenAt\`, \`status\`, \`bannedAt\`, \`bannedReason\`, \`bannedById\`, \`expiresAt\`, 0, NULL
         FROM \`User\` WHERE \`username\` != 'admin'`
      );
      logs.push('Non-admin users migrated to LokiUser');
    } else {
      logs.push(`LokiUser already has ${lokiCount} users, skipping migration`);
    }

    // 5. 更新 Session 表的 userId 引用（已经是 LokiUser.id，由于 ID 没变，无需更新）
    logs.push('Session.userId references unchanged (IDs preserved)');

    // 6. 验证
    const adminCount = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as cnt FROM \`AdminUser\``
    );
    const lokiFinalCount = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as cnt FROM \`LokiUser\``
    );
    const userCount = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as cnt FROM \`User\``
    );

    logs.push(`Final counts: AdminUser=${adminCount[0]?.cnt}, LokiUser=${lokiFinalCount[0]?.cnt}, User(legacy)=${userCount[0]?.cnt}`);

    return NextResponse.json({
      ok: true,
      message: 'Migration completed. You can now drop the User table manually or let prisma db push handle it.',
      logs,
      counts: {
        adminUser: Number(adminCount[0]?.cnt ?? 0),
        lokiUser: Number(lokiFinalCount[0]?.cnt ?? 0),
        legacyUser: Number(userCount[0]?.cnt ?? 0),
      },
    });
  } catch (e) {
    logs.push(`Error: ${(e as Error).message}`);
    return NextResponse.json(
      { ok: false, error: (e as Error).message, logs },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
