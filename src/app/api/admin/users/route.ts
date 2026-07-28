/**
 * GET /api/admin/users — 用户列表（含在线状态、最近登录、最近位置）
 *
 * Query:
 *   ?q=keyword  — 搜索用户名/昵称
 *   ?online=1   — 只看在线
 *   ?page=1     — 分页
 *   ?limit=20   — 每页数量（max 100）
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAgent, onlineThresholdMs } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(req: NextRequest) {
  const claims = await requireAgent(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const onlineOnly = url.searchParams.get('online') === '1';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20')));
  const onlineCutoff = new Date(Date.now() - onlineThresholdMs());

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { username: { contains: q } },
      { nickname: { contains: q } },
    ];
  }
  if (onlineOnly) {
    where.lastSeenAt = { gt: onlineCutoff };
  }

  // AGENT 只能看到普通用户，不能看到其他 AGENT 或 SUPER_ADMIN（防止信息泄露）
  if (claims.role === 'AGENT') {
    where.role = 'USER';
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        username: true,
        nickname: true,
        role: true,
        avatarUrl: true,
        fingerprint: true,
        createdAt: true,
        lastSeenAt: true,
        loginRecords: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
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
            userAgent: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const result = users.map(u => {
    const lastLogin = u.loginRecords[0];
    const online = u.lastSeenAt
      ? Date.now() - u.lastSeenAt.getTime() < onlineThresholdMs()
      : false;
    return {
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      role: u.role,
      avatarUrl: u.avatarUrl,
      fingerprint: u.fingerprint,
      online,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      lastLogin,
    };
  });

  return jsonResponse({
    total,
    page,
    limit,
    users: result,
  });
}

export const dynamic = 'force-dynamic';
