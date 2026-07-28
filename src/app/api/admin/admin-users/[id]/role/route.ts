/**
 * /api/admin/admin-users/[id]/role — 修改 AdminUser 角色（仅 SUPER_ADMIN）
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin, canManageAdminUser } from '@/lib/auth';
import type { Role } from '@/lib/crypto';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const targetId = params.id;
  const body = (await req.json()) as { role: Role };
  const newRole = body.role;

  if (!newRole || !['USER', 'AGENT', 'SUPER_ADMIN'].includes(newRole)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const target = await prisma.adminUser.findUnique({
    where: { id: targetId },
    select: { role: true, username: true },
  });
  if (!target) {
    return NextResponse.json({ error: 'Admin user not found' }, { status: 404 });
  }

  // 权限校验
  const check = canManageAdminUser(claims, targetId, target.role, newRole);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  // 防止降级最后一个 SUPER_ADMIN
  if (target.role === 'SUPER_ADMIN' && newRole !== 'SUPER_ADMIN') {
    const superAdminCount = await prisma.adminUser.count({
      where: { role: 'SUPER_ADMIN' },
    });
    if (superAdminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the last super admin' },
        { status: 400 }
      );
    }
  }

  await prisma.adminUser.update({
    where: { id: targetId },
    data: { role: newRole },
  });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'CHANGE_ROLE',
      target: targetId,
      meta: { from: target.role, to: newRole, username: target.username },
    },
  });

  return NextResponse.json({ ok: true, role: newRole });
}

export const dynamic = 'force-dynamic';
