/**
 * POST /api/admin/users/[id]/unban — 解封用户
 *
 *  - 设置 user.status = ACTIVE，清除 bannedAt / bannedReason / bannedById
 *  - 创建 AuditLog
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAgent, canManageUser } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  // 越权防护：AGENT 不能解封 AGENT 或 SUPER_ADMIN
  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { role: true, username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageUser(claims, target.role, { allowSelf: true });
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  // 恢复用户状态
  await prisma.user.update({
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
      meta: { targetUsername: target.username, targetRole: target.role },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
