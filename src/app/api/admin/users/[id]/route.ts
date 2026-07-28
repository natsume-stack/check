/**
 * GET    /api/admin/users/[id] — 用户详情（含历史登录、地图位置）
 * PATCH  /api/admin/users/[id] — 更新用户（role / nickname）
 * DELETE /api/admin/users/[id] — 删除用户
 *
 * 权限：
 *   - AGENT 可查看/操作普通用户，不能查看/操作 AGENT 或 SUPER_ADMIN
 *   - SUPER_ADMIN 全量可操作
 *   - role 字段仅 SUPER_ADMIN 可修改
 *   - 不能删除/封禁自己
 *   - 不能降级最后一个 SUPER_ADMIN
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAgent, canManageUser, canChangeRole } from '@/lib/auth';
import type { Role } from '@/lib/crypto';
import { jsonResponse } from '@/lib/request';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      username: true,
      nickname: true,
      role: true,
      avatarUrl: true,
      fingerprint: true,
      createdAt: true,
      updatedAt: true,
      lastSeenAt: true,
      loginRecords: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          ip: true,
          country: true,
          region: true,
          city: true,
          latitude: true,
          longitude: true,
          accuracyKm: true,
          asn: true,
          org: true,
          timezone: true,
          fingerprint: true,
          userAgent: true,
          success: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) return jsonResponse({ error: 'Not found' }, 404);

  // AGENT 不能查看 AGENT 或 SUPER_ADMIN 详情
  const guard = canManageUser(claims, user.role, { allowSelf: true });
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  return jsonResponse({ user });
}

interface PatchBody {
  role?: Role;
  nickname?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as PatchBody;

  // 先查 target 当前状态（用于越权校验和 role 变更校验）
  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  // 越权防护：AGENT 不能操作 AGENT 或 SUPER_ADMIN
  const guard = canManageUser(claims, target.role, { allowSelf: true });
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  const data: Record<string, unknown> = {};

  // role 变更单独走严格校验
  if (body.role !== undefined) {
    const roleGuard = canChangeRole(
      claims,
      params.id,
      target.role,
      body.role
    );
    if (!roleGuard.ok) {
      return jsonResponse({ error: roleGuard.reason }, 403);
    }

    // 防止降级最后一个 SUPER_ADMIN
    if (
      target.role === 'SUPER_ADMIN' &&
      body.role !== 'SUPER_ADMIN'
    ) {
      const superAdminCount = await prisma.user.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      if (superAdminCount <= 1) {
        return jsonResponse(
          { error: 'Cannot demote the last super admin' },
          400
        );
      }
    }

    data.role = body.role;
  }

  if (body.nickname !== undefined) data.nickname = body.nickname;

  const user = await prisma.user.update({
    where: { id: params.id },
    data,
    select: { id: true, username: true, role: true, nickname: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.patch',
      target: params.id,
      meta: { ...data, targetUsername: target.username },
    },
  });

  return jsonResponse({ user });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  // 不允许删除自己
  if (params.id === claims.sub) {
    return jsonResponse({ error: 'Cannot delete self' }, 400);
  }

  // 先查 target 当前 role，做越权校验
  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { role: true, username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageUser(claims, target.role);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  // 不允许删除最后一个 SUPER_ADMIN
  if (target.role === 'SUPER_ADMIN') {
    const superAdminCount = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    if (superAdminCount <= 1) {
      return jsonResponse(
        { error: 'Cannot delete the last super admin' },
        400
      );
    }
  }

  await prisma.user.delete({ where: { id: params.id } });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.delete',
      target: params.id,
      meta: { targetUsername: target.username, targetRole: target.role },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
