/**
 * DELETE /api/admin/invitations/[id] — 禁用邀请码（软删除，SUPER_ADMIN only）
 *
 * 通过设置 disabledAt = now() 实现软删除，不物理删除记录，
 * 以保留审计轨迹与已使用次数统计。
 *
 * - 邀请码不存在 → 404
 * - 已禁用（disabledAt 非空）→ 幂等返回成功，不重复写审计日志
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';
import { writeAuditLog } from '@/lib/security';

interface RouteContext {
  params: { id: string };
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const id = ctx.params.id;

  const existing = await prisma.invitationCode.findUnique({
    where: { id },
    select: { id: true, code: true, disabledAt: true },
  });

  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  // 幂等：已禁用则直接返回成功，不重复写入审计日志
  if (existing.disabledAt) {
    return jsonResponse({ id: existing.id, disabledAt: existing.disabledAt });
  }

  const now = new Date();
  const updated = await prisma.invitationCode.update({
    where: { id },
    data: { disabledAt: now },
    select: { id: true, code: true, disabledAt: true },
  });

  await writeAuditLog({
    actorId: claims.sub,
    action: 'invitation.disable',
    target: updated.code,
    meta: { id: updated.id },
    req,
  });

  return jsonResponse({
    id: updated.id,
    disabledAt: updated.disabledAt,
  });
}

export const dynamic = 'force-dynamic';
