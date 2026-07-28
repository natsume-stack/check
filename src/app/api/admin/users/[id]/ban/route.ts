/**
 * POST /api/admin/users/[id]/ban — 封禁用户
 *
 * 请求体：{ reason }
 *  - 设置 user.status = BANNED，记录 bannedAt / bannedReason / bannedById
 *  - 吊销该用户所有活跃 session
 *  - 创建 AuditLog
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAgent, canManageLokiUser } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

interface BanBody {
  reason?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as BanBody;
  const reason = body.reason?.trim() || '账号已被封禁';

  // admin 不在 LokiUser 表里，无需 self 检查
  // 越权防护：USER 不能操作 LokiUser
  const target = await prisma.lokiUser.findUnique({
    where: { id: params.id },
    select: { username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageLokiUser(claims);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  // 更新用户状态
  await prisma.lokiUser.update({
    where: { id: params.id },
    data: {
      status: 'BANNED',
      bannedAt: new Date(),
      bannedReason: reason,
      bannedById: claims.sub,
    },
  });

  // 吊销该用户所有活跃 session
  await prisma.session.updateMany({
    where: {
      userId: params.id,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: 'BANNED',
    },
  });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.ban',
      target: params.id,
      meta: { reason, targetUsername: target.username },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
