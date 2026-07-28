import { getAdminClaims } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import DashboardClient from './DashboardClient';

// 强制动态渲染，避免 build 时预渲染连接数据库
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function fetchStats() {
  // 内部直接调用 prisma 拿数据，绕过 fetch
  const { prisma } = await import('@/lib/prisma');
  const { onlineThresholdMs } = await import('@/lib/auth');

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
    recentLogins,
    activeCodePackage,
  ] = await Promise.all([
    prisma.lokiUser.count(),
    prisma.lokiUser.count({ where: { lastSeenAt: { gt: onlineCutoff } } }),
    prisma.lokiUser.count({ where: { createdAt: { gt: todayStart } } }),
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
    // 最近登录记录（IP + 位置）
    prisma.loginRecord.findMany({
      where: { success: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        ip: true,
        country: true,
        region: true,
        city: true,
        createdAt: true,
        user: { select: { username: true, nickname: true } },
      },
    }),
    // 当前激活的代码包版本
    prisma.codePackage.findFirst({
      where: { isActive: true },
      orderBy: { builtAt: 'desc' },
      select: {
        featureId: true,
        version: true,
        codeHash: true,
        sizeBytes: true,
        builtAt: true,
      },
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

  return {
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
    recentLogins: recentLogins.map(l => ({
      ip: l.ip,
      country: l.country,
      region: l.region,
      city: l.city,
      createdAt: l.createdAt.toISOString(),
      username: l.user.username,
      nickname: l.user.nickname,
    })),
    activeCodePackage: activeCodePackage
      ? {
          featureId: activeCodePackage.featureId,
          version: activeCodePackage.version,
          codeHash: activeCodePackage.codeHash,
          sizeBytes: activeCodePackage.sizeBytes,
          builtAt: activeCodePackage.builtAt.toISOString(),
        }
      : null,
  };
}

export default async function DashboardPage() {
  const h = await headers();
  const req = { headers: h } as any;
  const claims = await getAdminClaims(req);
  if (!claims) redirect('/login');

  const stats = await fetchStats();

  return <DashboardClient stats={stats} />;
}
