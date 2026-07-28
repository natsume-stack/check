/**
 * GET /api/admin/stats — 仪表盘数据（LokiBox 使用情况）
 *
 * 返回：
 *   - LokiBox 注册用户数 / 在线玩家数
 *   - 今日新增 / 今日 LokiBox 启动次数
 *   - 功能配置数 / 强制启用数 / 远程禁用数
 *   - 玩家 IP 国家分布 Top 10
 *   - 24h presence 心跳趋势（按小时聚合）
 *   - 活跃 Box3 地图 Top 10
 *   - 最近一次心跳时间
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, onlineThresholdMs } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(req: NextRequest) {
  const claims = await requireUser(req);
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
    disabledPrograms,
    countryAgg,
    mapAgg,
    recentHeartbeats,
    lastHeartbeat,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastSeenAt: { gt: onlineCutoff } } }),
    prisma.user.count({ where: { createdAt: { gt: todayStart } } }),
    prisma.loginRecord.count({
      where: { createdAt: { gt: todayStart }, success: true },
    }),
    prisma.programConfig.count(),
    prisma.programConfig.count({ where: { enforced: true } }),
    prisma.programConfig.count({ where: { disabled: true } }),
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
    prisma.heartbeat.findMany({
      where: { createdAt: { gt: dayAgo } },
      select: { createdAt: true },
    }),
    prisma.heartbeat.findFirst({
      where: { createdAt: { gt: dayAgo } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

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
    disabledPrograms,
    countryDistribution: countryAgg.map(c => ({
      country: c.country ?? 'Unknown',
      count: c._count._all,
    })),
    mapActivity: mapAgg.map(m => ({
      mapId: m.mapId,
      count: m._count._all,
    })),
    hourlyHeartbeats,
    lastHeartbeatAt: lastHeartbeat?.createdAt.toISOString() ?? null,
  });
}

export const dynamic = 'force-dynamic';
