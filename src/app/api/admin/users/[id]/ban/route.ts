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
import { requireAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

interface BanBody {
  reason?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as BanBody;
  const reason = body.reason?.trim() || '账号已被封禁';

  // 不允许封禁自己
  if (params.id === claims.sub) {
    return jsonResponse({ error: 'Cannot ban self' }, 400);
  }

  // 更新用户状态
  await prisma.user.update({
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
      meta: { reason },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
