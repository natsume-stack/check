/**
 * /api/admin/admin-users/[id] — 单个 AdminUser 管理（仅 SUPER_ADMIN）
 *
 * GET    /api/admin/admin-users/[id]         查看详情
 * PATCH  /api/admin/admin-users/[id]         更新 nickname / 重置密码
 * DELETE /api/admin/admin-users/[id]         删除 AdminUser
 *
 * 安全：
 *   - 仅 SUPER_ADMIN 可访问
 *   - 不能删除自己（防误操作）
 *   - 不能删除最后一个 SUPER_ADMIN（防锁死）
 *   - 所有操作记录审计日志
 *   - 不能通过 PATCH 修改 role（必须走 /role 子路由，单独的审计逻辑）
 */

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/crypto';
import {
  requireSuperAdmin,
  canManageAdminUser,
} from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const user = await prisma.adminUser.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      username: true,
      nickname: true,
      role: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
      failedLoginAttempts: true,
      lockedUntil: true,
      auditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          target: true,
          meta: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) return jsonResponse({ error: 'Not found' }, 404);

  return jsonResponse({ user });
}

interface PatchBody {
  nickname?: string;
  password?: string; // 重置密码（明文，会重新哈希）
  // 注意：role 不允许通过此接口修改，必须走 /role 子路由
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const targetId = params.id;
  const body = (await req.json()) as PatchBody;

  const target = await prisma.adminUser.findUnique({
    where: { id: targetId },
    select: { id: true, username: true, role: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageAdminUser(claims, targetId, target.role);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  const data: Record<string, unknown> = {};
  const meta: Record<string, unknown> = { targetUsername: target.username };

  if (typeof body.nickname === 'string') {
    const nickname = body.nickname.trim().slice(0, 50);
    data.nickname = nickname;
    meta.nickname = nickname;
  }

  if (typeof body.password === 'string') {
    if (body.password.length < 8 || body.password.length > 72) {
      return jsonResponse({ error: 'Password must be 8-72 chars' }, 400);
    }
    data.passwordHash = await hashPassword(body.password);
    meta.passwordReset = true;
  }

  if (Object.keys(data).length === 0) {
    return jsonResponse({ error: 'Nothing to update' }, 400);
  }

  const updated = await prisma.adminUser.update({
    where: { id: targetId },
    data,
    select: { id: true, username: true, nickname: true, role: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'admin.patch',
      target: targetId,
      meta: meta as Prisma.InputJsonValue,
    },
  });

  return jsonResponse({ user: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const targetId = params.id;

  // 防止删除自己
  if (claims.sub === targetId) {
    return jsonResponse({ error: 'Cannot delete yourself' }, 400);
  }

  const target = await prisma.adminUser.findUnique({
    where: { id: targetId },
    select: { id: true, username: true, role: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageAdminUser(claims, targetId, target.role);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  // 防止删除最后一个 SUPER_ADMIN
  if (target.role === 'SUPER_ADMIN') {
    const superAdminCount = await prisma.adminUser.count({
      where: { role: 'SUPER_ADMIN' },
    });
    if (superAdminCount <= 1) {
      return jsonResponse(
        { error: 'Cannot delete the last super admin' },
        400
      );
    }
  }

  await prisma.adminUser.delete({ where: { id: targetId } });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'admin.delete',
      target: targetId,
      meta: { username: target.username, role: target.role },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
