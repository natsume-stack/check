/**
 * GET /api/admin/stats — 仪表盘数据
 *
 * 返回：
 *   - 总用户数 / 在线数
 *   - 今日新增 / 今日登录次数
 *   - 程序配置数 / 强制启用数
 *   - IP 国家分布 Top 10
 *   - 24h 心跳趋势
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, onlineThresholdMs } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(req: NextRequest) {
  const claims = await requireAdmin(req);
  if (!claims) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const onlineCutoff = new Date(Date.now() - onlineThresholdMs());
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    onlineUsers,
    todayNewUsers,
    todayLogins,
    totalPrograms,
    enforcedPrograms,
    countryAgg,
    heartbeatAgg,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastSeenAt: { gt: onlineCutoff } } }),
    prisma.user.count({ where: { createdAt: { gt: todayStart } } }),
    prisma.loginRecord.count({
      where: { createdAt: { gt: todayStart }, success: true },
    }),
    prisma.programConfig.count(),
    prisma.programConfig.count({ where: { enforced: true } }),
    prisma.loginRecord.groupBy({
      by: ['country'],
      where: { createdAt: { gt: dayAgo }, success: true },
      _count: { _all: true },
      orderBy: { _count: { country: 'desc' } },
      take: 10,
    }),
    prisma.heartbeat.groupBy({
      by: ['mapId'],
      where: { createdAt: { gt: dayAgo } },
      _count: { _all: true },
      orderBy: { _count: { mapId: 'desc' } },
      take: 10,
    }),
  ]);

  // 24h 心跳按小时聚合
  const recentHeartbeats = await prisma.heartbeat.findMany({
    where: { createdAt: { gt: dayAgo } },
    select: { createdAt: true },
  });
  const hourlyHeartbeats = new Array(24).fill(0);
  for (const h of recentHeartbeats) {
    const hourAgo = Math.floor(
      (now.getTime() - h.createdAt.getTime()) / (60 * 60 * 1000)
    );
    if (hourAgo >= 0 && hourAgo < 24) {
      hourlyHeartbeats[23 - hourAgo]++;
    }
  }

  return jsonResponse({
    totalUsers,
    onlineUsers,
    todayNewUsers,
    todayLogins,
    totalPrograms,
    enforcedPrograms,
    countryDistribution: countryAgg.map(c => ({
      country: c.country ?? 'Unknown',
      count: c._count._all,
    })),
    mapActivity: heartbeatAgg.map(m => ({
      mapId: m.mapId,
      count: m._count._all,
    })),
    hourlyHeartbeats,
  });
}

export const dynamic = 'force-dynamic';
