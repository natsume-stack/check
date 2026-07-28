/**
 * POST /api/admin/users/[id]/expiry — 设置账号到期时间
 *
 * 请求体：{ expiresAt: string (ISO) | null }
 *  - null 表示永久有效
 *  - 创建 AuditLog
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

interface ExpiryBody {
  expiresAt?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as ExpiryBody;
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  if (expiresAt && isNaN(expiresAt.getTime())) {
    return jsonResponse({ error: 'Invalid expiresAt format' }, 400);
  }

  await prisma.user.update({
    where: { id: params.id },
    data: { expiresAt },
  });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.set_expiry',
      target: params.id,
      meta: { expiresAt: expiresAt?.toISOString() ?? null },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
