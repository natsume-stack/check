'use client';

interface Stats {
  totalUsers: number;
  onlineUsers: number;
  todayNewUsers: number;
  todayLogins: number;
  totalPrograms: number;
  enforcedPrograms: number;
  disabledPrograms: number;
  countryDistribution: { country: string; count: number }[];
  mapActivity: { mapId: string; count: number }[];
  hourlyHeartbeats: number[];
  lastHeartbeatAt: string | null;
  recentLogins: {
    ip: string;
    country: string | null;
    region: string | null;
    city: string | null;
    createdAt: string;
    username: string;
    nickname: string;
  }[];
  activeCodePackage: {
    featureId: string;
    version: string;
    codeHash: string;
    sizeBytes: number;
    builtAt: string;
  } | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '从未';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
  const maxMap = Math.max(1, ...stats.mapActivity.map(m => m.count));
  const totalHeartbeats24h = stats.hourlyHeartbeats.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          LokiBox 运行状态概览 · 最近心跳 {timeAgo(stats.lastHeartbeatAt)}
        </p>
      </div>

      {/* 顶部数据卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="LokiBox 注册用户"
          value={stats.totalUsers}
          sub={`+${stats.todayNewUsers} 今日新增`}
        />
        <StatCard
          label="在线玩家"
          value={stats.onlineUsers}
          sub="最近 60 秒内有心跳"
          accent
        />
        <StatCard
          label="今日启动次数"
          value={stats.todayLogins}
          sub="成功登录 LokiBox"
        />
        <StatCard
          label="24h 心跳总数"
          value={totalHeartbeats24h}
          sub="游戏内 presence 上报"
        />
      </div>

      {/* 次级卡片：功能配置 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="功能配置数"
          value={stats.totalPrograms}
          sub="ProgramConfig 条目"
        />
        <StatCard
          label="强制启用"
          value={stats.enforcedPrograms}
          sub="客户端必须开启"
        />
        <StatCard
          label="远程禁用"
          value={stats.disabledPrograms}
          sub="客户端无法开启"
        />
      </div>

      {/* 当前代码包版本 */}
      {stats.activeCodePackage && (
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-bold tracking-tight">当前代码包版本</h2>
              <p className="text-xs text-[var(--text-muted)]">
                客户端下发的激活版本
              </p>
            </div>
            <span className="text-xs px-2 py-1 rounded-md bg-green-500/10 text-green-600 font-semibold">
              Active
            </span>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Feature</dt>
              <dd className="font-mono truncate">
                {stats.activeCodePackage.featureId}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">版本号</dt>
              <dd className="font-mono truncate">
                {stats.activeCodePackage.version}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">大小</dt>
              <dd className="font-mono tabular-nums">
                {formatBytes(stats.activeCodePackage.sizeBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">构建时间</dt>
              <dd>
                {new Date(stats.activeCodePackage.builtAt).toLocaleString(
                  'zh-CN'
                )}
              </dd>
            </div>
          </dl>
          <div className="mt-3">
            <div className="text-xs text-[var(--text-muted)] mb-1">
              代码哈希 (SHA-256)
            </div>
            <div className="font-mono text-xs break-all bg-[var(--surface-2)] rounded-xl p-3">
              {stats.activeCodePackage.codeHash}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 24h 心跳趋势 */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold tracking-tight">24 小时游戏活跃度</h2>
              <p className="text-xs text-[var(--text-muted)]">每小时 presence 心跳次数</p>
            </div>
          </div>
          <div className="flex items-end gap-1 h-32">
            {stats.hourlyHeartbeats.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-md bg-[var(--brand)] hover:opacity-100 transition"
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

        {/* 玩家地理分布 */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
          <div className="mb-4">
            <h2 className="font-bold tracking-tight">玩家地理分布 Top 10</h2>
            <p className="text-xs text-[var(--text-muted)]">最近 24 小时登录的 IP 国家</p>
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

        {/* 活跃地图 Top 10 */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6 lg:col-span-2">
          <div className="mb-4">
            <h2 className="font-bold tracking-tight">活跃地图 Top 10</h2>
            <p className="text-xs text-[var(--text-muted)]">最近 24 小时 Box3 地图心跳上报次数</p>
          </div>
          {stats.mapActivity.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)] py-8 text-center">
              暂无心跳数据
            </div>
          ) : (
            <div className="space-y-2">
              {stats.mapActivity.map((m, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="text-xs text-[var(--text-muted)] w-6 text-right tabular-nums">
                    #{i + 1}
                  </div>
                  <div className="text-sm font-mono flex-1 truncate" title={m.mapId}>
                    {m.mapId}
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--brand)] rounded-full"
                      style={{ width: `${(m.count / maxMap) * 100}%` }}
                    />
                  </div>
                  <div className="text-sm font-mono tabular-nums w-12 text-right">
                    {m.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 最近登录记录 */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
        <div className="mb-4">
          <h2 className="font-bold tracking-tight">最近登录记录</h2>
          <p className="text-xs text-[var(--text-muted)]">
            LokiUser 登录的 IP 与地理位置
          </p>
        </div>
        {stats.recentLogins.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] py-8 text-center">
            暂无登录记录
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {stats.recentLogins.map((l, i) => (
              <div
                key={i}
                className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">
                    {l.nickname || l.username}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] truncate">
                    {l.city ? `${l.city}, ` : ''}
                    {l.region ? `${l.region}, ` : ''}
                    {l.country ?? 'Unknown'}
                  </div>
                </div>
                <div className="font-mono text-xs tabular-nums text-right flex-shrink-0">
                  {l.ip}
                </div>
                <div className="text-xs text-[var(--text-muted)] w-32 text-right flex-shrink-0">
                  {timeAgo(l.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
