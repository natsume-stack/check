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
import { requireAgent, canManageUser } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

interface SuspendBody {
  reason?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as SuspendBody;
  const reason = body.reason?.trim() || '账号已被暂停';

  // 不允许暂停自己
  if (params.id === claims.sub) {
    return jsonResponse({ error: 'Cannot suspend self' }, 400);
  }

  // 越权防护：AGENT 不能暂停 AGENT 或 SUPER_ADMIN
  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { role: true, username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageUser(claims, target.role);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
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
      meta: { reason, targetUsername: target.username, targetRole: target.role },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
