/**
 * GET    /api/admin/users/[id] — 用户详情（含历史登录、地图位置）
 * PATCH  /api/admin/users/[id] — 更新用户（nickname）
 * DELETE /api/admin/users/[id] — 删除用户
 *
 * 权限：
 *   - AGENT / SUPER_ADMIN 可管理 LokiUser
 *   - LokiUser 没有 role 字段，PATCH role 一律拒绝
 *   - admin 不在 LokiUser 表里，无需 self 检查
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAgent, canManageLokiUser } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const user = await prisma.lokiUser.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      username: true,
      nickname: true,
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

  const guard = canManageLokiUser(claims);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  return jsonResponse({ user });
}

interface PatchBody {
  role?: unknown;
  nickname?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as PatchBody;

  // LokiUser 没有 role 字段，一律拒绝
  if (body.role !== undefined) {
    return jsonResponse({ error: 'LokiUser 没有 role 字段' }, 400);
  }

  // 先查 target 当前状态（用于越权校验）
  const target = await prisma.lokiUser.findUnique({
    where: { id: params.id },
    select: { id: true, username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageLokiUser(claims);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  const data: Record<string, unknown> = {};
  if (body.nickname !== undefined) data.nickname = body.nickname;

  const user = await prisma.lokiUser.update({
    where: { id: params.id },
    data,
    select: { id: true, username: true, nickname: true },
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

  // admin 不在 LokiUser 表里，无需 self 检查
  const target = await prisma.lokiUser.findUnique({
    where: { id: params.id },
    select: { username: true },
  });
  if (!target) return jsonResponse({ error: 'Not found' }, 404);

  const guard = canManageLokiUser(claims);
  if (!guard.ok) {
    return jsonResponse({ error: guard.reason }, 403);
  }

  await prisma.lokiUser.delete({ where: { id: params.id } });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.delete',
      target: params.id,
      meta: { targetUsername: target.username },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
