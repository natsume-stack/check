'use client';

interface Stats {
  totalUsers: number;
  onlineUsers: number;
  todayNewUsers: number;
  todayLogins: number;
  totalPrograms: number;
  enforcedPrograms: number;
  countryDistribution: { country: string; count: number }[];
  hourlyHeartbeats: number[];
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-6 border transition ${
        accent
          ? 'bg-[var(--brand)] text-[var(--bg)] border-transparent'
          : 'bg-[var(--surface)] border-[var(--border)]'
      }`}
    >
      <div
        className={`text-xs uppercase tracking-wider font-semibold ${
          accent ? 'opacity-70' : 'text-[var(--text-muted)]'
        }`}
      >
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums">
        {value}
      </div>
      {sub && (
        <div className={`mt-1 text-xs ${accent ? 'opacity-70' : 'text-[var(--text-muted)]'}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function DashboardClient({ stats }: { stats: Stats }) {
  const maxHeartbeats = Math.max(1, ...stats.hourlyHeartbeats);
  const maxCountry = Math.max(1, ...stats.countryDistribution.map(c => c.count));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">系统运行状态概览</p>
      </div>

      {/* 数据卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="总用户数"
          value={stats.totalUsers}
          sub={`+${stats.todayNewUsers} 今日新增`}
        />
        <StatCard
          label="在线用户"
          value={stats.onlineUsers}
          sub="最近 60 秒内有心跳"
          accent
        />
        <StatCard
          label="今日登录"
          value={stats.todayLogins}
          sub="成功登录次数"
        />
        <StatCard
          label="程序配置"
          value={stats.totalPrograms}
          sub={`${stats.enforcedPrograms} 个强制启用`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 24h 心跳趋势 */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold tracking-tight">24 小时心跳趋势</h2>
              <p className="text-xs text-[var(--text-muted)]">每小时心跳次数</p>
            </div>
          </div>
          <div className="flex items-end gap-1 h-32">
            {stats.hourlyHeartbeats.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-md bg-[var(--brand)] opacity-80 hover:opacity-100 transition"
                style={{
                  height: `${(v / maxHeartbeats) * 100}%`,
                  minHeight: v > 0 ? '4px' : '2px',
                  opacity: v > 0 ? 0.8 : 0.15,
                }}
                title={`${23 - i}h ago: ${v}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-[var(--text-muted)] mt-2">
            <span>24h ago</span>
            <span>now</span>
          </div>
        </div>

        {/* 国家分布 */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
          <div className="mb-4">
            <h2 className="font-bold tracking-tight">IP 国家分布 Top 10</h2>
            <p className="text-xs text-[var(--text-muted)]">最近 24 小时登录</p>
          </div>
          {stats.countryDistribution.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)] py-8 text-center">
              暂无数据
            </div>
          ) : (
            <div className="space-y-2">
              {stats.countryDistribution.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="text-sm font-mono w-32 truncate">
                    {c.country}
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--brand)] rounded-full"
                      style={{ width: `${(c.count / maxCountry) * 100}%` }}
                    />
                  </div>
                  <div className="text-sm font-mono tabular-nums w-12 text-right">
                    {c.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
