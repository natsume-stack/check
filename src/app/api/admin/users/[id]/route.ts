/**
 * GET    /api/admin/users/[id] — 用户详情（含历史登录、地图位置）
 * PATCH  /api/admin/users/[id] — 更新用户（role / nickname）
 * DELETE /api/admin/users/[id] — 删除用户
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAdmin(req);
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

  return jsonResponse({ user });
}

interface PatchBody {
  role?: 'ADMIN' | 'USER';
  nickname?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as PatchBody;
  const data: Record<string, unknown> = {};
  if (body.role) data.role = body.role;
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
      meta: data as object,
    },
  });

  return jsonResponse({ user });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  // 不允许删除自己
  if (params.id === claims.sub) {
    return jsonResponse({ error: 'Cannot delete self' }, 400);
  }

  await prisma.user.delete({ where: { id: params.id } });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'user.delete',
      target: params.id,
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
