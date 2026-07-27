'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

interface User {
  id: string;
  username: string;
  nickname: string;
  role: string;
  avatarUrl: string | null;
  fingerprint: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastLogin: {
    ip: string;
    country: string | null;
    region: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    accuracyKm: number | null;
    asn: string | null;
    org: string | null;
    timezone: string | null;
    userAgent: string | null;
    createdAt: string;
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

function isOnline(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 60_000;
}

export default function UsersClient({ initialUsers }: { initialUsers: User[] }) {
  const [users] = useState<User[]>(initialUsers);
  const [selected, setSelected] = useState<User | null>(null);
  const [filter, setFilter] = useState<'all' | 'online'>('all');

  const filtered = filter === 'online' ? users.filter(u => isOnline(u.lastSeenAt)) : users;

  const mapLocations = selected && selected.lastLogin?.latitude
    ? [{
        lat: selected.lastLogin.latitude,
        lon: selected.lastLogin.longitude!,
        accuracyKm: selected.lastLogin.accuracyKm ?? undefined,
        label: `${selected.nickname || selected.username}`,
        sub: selected.lastLogin.city
          ? `${selected.lastLogin.city}, ${selected.lastLogin.country}`
          : selected.lastLogin.country ?? '',
      }]
    : users
        .filter(u => u.lastLogin?.latitude && u.lastLogin?.longitude)
        .map(u => ({
          lat: u.lastLogin!.latitude!,
          lon: u.lastLogin!.longitude!,
          accuracyKm: u.lastLogin!.accuracyKm ?? undefined,
          label: u.nickname || u.username,
          sub: u.lastLogin!.city
            ? `${u.lastLogin!.city}, ${u.lastLogin!.country}`
            : u.lastLogin!.country ?? '',
        }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">用户管理</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            在线状态 / 登录 IP / 设备指纹 / 地理位置
          </p>
        </div>
        <div className="flex gap-2">
          {(['all', 'online'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-11 px-4 rounded-2xl text-sm font-semibold transition ${
                filter === f
                  ? 'bg-[var(--brand)] text-[var(--bg)]'
                  : 'bg-[var(--surface)] border border-[var(--border)]'
              }`}
            >
              {f === 'all' ? '全部' : '仅在线'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 用户列表 */}
        <div className="lg:col-span-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-12 text-center text-[var(--text-muted)]">
              暂无用户
            </div>
          ) : (
            filtered.map(u => {
              const online = isOnline(u.lastSeenAt);
              const isSelected = selected?.id === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setSelected(u)}
                  className={`w-full text-left rounded-2xl p-4 border transition flex items-center gap-4 ${
                    isSelected
                      ? 'bg-[var(--brand)] text-[var(--bg)] border-transparent'
                      : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]'
                  }`}
                >
                  {/* 头像 / 在线点 */}
                  <div className="relative flex-shrink-0">
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatarUrl}
                        alt={u.username}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] flex items-center justify-center font-bold">
                        {u.username[0]?.toUpperCase()}
                      </div>
                    )}
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--surface)] ${
                        online ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold truncate">
                        {u.nickname || u.username}
                      </span>
                      {u.role === 'ADMIN' && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] font-semibold">
                          ADMIN
                        </span>
                      )}
                    </div>
                    <div className="text-xs opacity-70 truncate">
                      @{u.username} · {u.lastLogin?.city ?? 'Unknown'}
                      {u.lastLogin?.country ? `, ${u.lastLogin.country}` : ''}
                    </div>
                  </div>

                  {/* 时间 */}
                  <div className="text-xs opacity-70 text-right flex-shrink-0">
                    <div>{online ? '在线' : timeAgo(u.lastSeenAt)}</div>
                    <div className="font-mono opacity-60">
                      {u.lastLogin?.ip ?? '—'}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* 详情面板 */}
        <div className="lg:col-span-2 space-y-4">
          {selected ? (
            <div className="space-y-4">
              {/* 用户信息卡 */}
              <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
                <div className="flex items-center gap-3 mb-4">
                  {selected.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.avatarUrl}
                      alt={selected.username}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center font-bold text-lg">
                      {selected.username[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">
                      {selected.nickname || selected.username}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      @{selected.username}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-md font-semibold ${
                      isOnline(selected.lastSeenAt)
                        ? 'bg-green-500/10 text-green-600'
                        : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                    }`}
                  >
                    {isOnline(selected.lastSeenAt) ? '在线' : '离线'}
                  </span>
                </div>

                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">用户 ID</dt>
                    <dd className="font-mono text-xs">{selected.id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">角色</dt>
                    <dd className="font-semibold">{selected.role}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">注册时间</dt>
                    <dd>{new Date(selected.createdAt).toLocaleString('zh-CN')}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">最近活跃</dt>
                    <dd>{timeAgo(selected.lastSeenAt)}</dd>
                  </div>
                </dl>
              </div>

              {/* 设备指纹 */}
              <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
                <h3 className="font-bold mb-3 text-sm">设备指纹</h3>
                {selected.fingerprint ? (
                  <div className="font-mono text-xs break-all bg-[var(--surface-2)] rounded-xl p-3">
                    {selected.fingerprint}
                  </div>
                ) : (
                  <div className="text-sm text-[var(--text-muted)]">未记录</div>
                )}
                {selected.lastLogin?.userAgent && (
                  <div className="mt-3">
                    <div className="text-xs text-[var(--text-muted)] mb-1">
                      User-Agent
                    </div>
                    <div className="font-mono text-xs break-all bg-[var(--surface-2)] rounded-xl p-3 max-h-24 overflow-y-auto">
                      {selected.lastLogin.userAgent}
                    </div>
                  </div>
                )}
              </div>

              {/* 登录信息 */}
              {selected.lastLogin && (
                <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5 space-y-3">
                  <h3 className="font-bold text-sm">最近登录</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-[var(--text-muted)]">IP 地址</dt>
                      <dd className="font-mono">{selected.lastLogin.ip}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[var(--text-muted)]">位置</dt>
                      <dd>
                        {selected.lastLogin.city ? `${selected.lastLogin.city}, ` : ''}
                        {selected.lastLogin.region ? `${selected.lastLogin.region}, ` : ''}
                        {selected.lastLogin.country ?? 'Unknown'}
                      </dd>
                    </div>
                    {selected.lastLogin.timezone && (
                      <div className="flex justify-between">
                        <dt className="text-[var(--text-muted)]">时区</dt>
                        <dd className="font-mono text-xs">{selected.lastLogin.timezone}</dd>
                      </div>
                    )}
                    {selected.lastLogin.org && (
                      <div className="flex justify-between">
                        <dt className="text-[var(--text-muted)]">运营商</dt>
                        <dd className="text-xs">{selected.lastLogin.org}</dd>
                      </div>
                    )}
                    {selected.lastLogin.asn && (
                      <div className="flex justify-between">
                        <dt className="text-[var(--text-muted)]">ASN</dt>
                        <dd className="font-mono text-xs">{selected.lastLogin.asn}</dd>
                      </div>
                    )}
                    {selected.lastLogin.accuracyKm && (
                      <div className="flex justify-between">
                        <dt className="text-[var(--text-muted)]">定位精度</dt>
                        <dd>±{selected.lastLogin.accuracyKm.toFixed(1)} km</dd>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <dt className="text-[var(--text-muted)]">登录时间</dt>
                      <dd>{new Date(selected.lastLogin.createdAt).toLocaleString('zh-CN')}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* 地图 */}
              {selected.lastLogin?.latitude && selected.lastLogin?.longitude && (
                <MapView locations={mapLocations} height={280} />
              )}
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
                <h3 className="font-bold mb-2">用户地理分布</h3>
                <p className="text-xs text-[var(--text-muted)] mb-4">
                  点击左侧用户查看详情，或查看全局分布
                </p>
              </div>
              <MapView locations={mapLocations} height={420} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
