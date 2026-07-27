import { getAdminClaims } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import DashboardClient from './DashboardClient';

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
