/**
 * POST /api/admin/users/[id]/suspend — 暂停用户
 *
 * 请求体：{ reason }
 *  - 设置 user.status = SUSPENDED
 *  - 吊销该用户所有活跃 session
 *  - 创建 AuditLog
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

interface SuspendBody {
  reason?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as SuspendBody;
  const reason = body.reason?.trim() || '账号已被暂停';

  // 不允许暂停自己
  if (params.id === claims.sub) {
    return jsonResponse({ error: 'Cannot suspend self' }, 400);
  }

  // 更新用户状态
  await prisma.user.update({
    where: { id: params.id },
    data: {
      status: 'SUSPENDED',
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
      revokedReason: 'SUSPENDED',
    },
  });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.suspend',
      target: params.id,
      meta: { reason },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
