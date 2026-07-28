/**
 * POST /api/admin/users/[id]/unban — 解封用户
 *
 *  - 设置 user.status = ACTIVE，清除 bannedAt / bannedReason / bannedById
 *  - 创建 AuditLog
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

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
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
