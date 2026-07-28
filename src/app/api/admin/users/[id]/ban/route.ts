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
import { requireAgent, canManageUser } from '@/lib/auth';
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

  // 不允许封禁自己
  if (params.id === claims.sub) {
    return jsonResponse({ error: 'Cannot ban self' }, 400);
  }

  // 越权防护：AGENT 不能封禁 AGENT 或 SUPER_ADMIN
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
      meta: { reason, targetUsername: target.username, targetRole: target.role },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
