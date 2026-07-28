/**
 * POST /api/admin/users/[id]/unban — 解封用户
 *
 *  - 设置 user.status = ACTIVE，清除 bannedAt / bannedReason / bannedById
 *  - 创建 AuditLog
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAgent, canManageLokiUser } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  // 越权防护：USER 不能解封 LokiUser
  const target = await prisma.lokiUser.findUnique({
    where: { id: params.id },
    select: { username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageLokiUser(claims);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  // 恢复用户状态
  await prisma.lokiUser.update({
    where: { id: params.id },
    data: {
      status: 'ACTIVE',
      bannedAt: null,
      bannedReason: null,
      bannedById: null,
    },
  });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.unban',
      target: params.id,
      meta: { targetUsername: target.username },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
