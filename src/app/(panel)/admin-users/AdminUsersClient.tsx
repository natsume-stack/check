'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Role = 'SUPER_ADMIN' | 'AGENT' | 'USER';

interface AdminUser {
  id: string;
  username: string;
  nickname: string;
  role: Role;
  lastSeenAt: string | null;
  createdAt: string;
  failedLoginAttempts: number;
  lockedUntil: string | null;
}

interface AuditLog {
  id: string;
  action: string;
  target: string | null;
  meta: unknown;
  createdAt: string;
}

interface AdminUserDetail extends AdminUser {
  updatedAt: string;
  auditLogs: AuditLog[];
}

const ROLE_OPTIONS: { value: Role; label: string; desc: string }[] = [
  { value: 'USER', label: '普通用户', desc: '仅仪表盘' },
  { value: 'AGENT', label: '代理', desc: '仪表盘 + LokiBox 用户管理' },
  { value: 'SUPER_ADMIN', label: '超级管理员', desc: '全量开放' },
];

const ROLE_BADGE: Record<Role, { label: string; cls: string }> = {
  SUPER_ADMIN: { label: '超管', cls: 'bg-purple-500/10 text-purple-600' },
  AGENT: { label: '代理', cls: 'bg-blue-500/10 text-blue-600' },
  USER: { label: '用户', cls: 'bg-gray-500/10 text-gray-600' },
};

function timeAgo(iso: string | null): string {
  if (!iso) return '从未';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export default function AdminUsersClient({
  initialUsers,
}: {
  initialUsers: AdminUser[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 创建表单
  const [showCreate, setShowCreate] = useState(false);
  const [createUser, setCreateUser] = useState('');
  const [createPass, setCreatePass] = useState('');
  const [createRole, setCreateRole] = useState<Role>('USER');
  const [createNick, setCreateNick] = useState('');

  // 角色修改
  const [showRoleChange, setShowRoleChange] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<Role>('USER');

  const q = query.trim().toLowerCase();
  const filtered = users.filter(u => {
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      u.nickname.toLowerCase().includes(q)
    );
  });

  async function loadDetail(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/admin-users/${id}`, {
        headers: { 'X-Requested-With': 'check-admin' },
      });
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setDetail(data.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function selectUser(u: AdminUser) {
    setSelected(u);
    setError('');
    setSuccess('');
    void loadDetail(u.id);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!createUser.trim() || !createPass) {
      setError('用户名和密码不能为空');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/admin-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'check-admin',
        },
        body: JSON.stringify({
          username: createUser.trim(),
          password: createPass,
          role: createRole,
          nickname: createNick.trim() || createUser.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');
      setSuccess(`✓ 已创建 ${data.user.username} (${ROLE_OPTIONS.find(r => r.value === data.user.role)?.label})`);
      setShowCreate(false);
      setCreateUser('');
      setCreatePass('');
      setCreateRole('USER');
      setCreateNick('');
      // 刷新列表
      const refresh = await fetch('/api/admin/admin-users', {
        headers: { 'X-Requested-With': 'check-admin' },
      });
      if (refresh.ok) {
        const refreshData = await refresh.json();
        setUsers(refreshData.users);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(userId: string, role: Role) {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/admin-users/${userId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'check-admin',
        },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '修改失败');
      setSuccess(`✓ 角色已更新`);
      setShowRoleChange(null);
      // 刷新列表
      const refresh = await fetch('/api/admin/admin-users', {
        headers: { 'X-Requested-With': 'check-admin' },
      });
      if (refresh.ok) {
        const refreshData = await refresh.json();
        setUsers(refreshData.users);
      }
      if (selected?.id === userId) {
        setSelected(prev => prev ? { ...prev, role } : null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(userId: string, username: string) {
    if (!window.confirm(`确认删除后台账户 @${username}？此操作不可恢复。`)) return;
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/admin-users/${userId}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'check-admin' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      setSuccess(`✓ 已删除 @${username}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
      if (selected?.id === userId) {
        setSelected(null);
        setDetail(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Check 后台账户管理</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            管理 check 验证系统的后台账户 · 角色分配 · 审计日志
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索用户名…"
            className="h-11 px-4 rounded-2xl text-sm bg-[var(--surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] w-full sm:w-56"
          />
          <button
            onClick={() => { setShowCreate(!showCreate); setError(''); setSuccess(''); }}
            className="h-11 px-5 rounded-2xl text-sm font-bold bg-[var(--brand)] text-[var(--bg)] hover:opacity-90 transition flex-shrink-0"
          >
            {showCreate ? '取消' : '+ 创建账户'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          {success}
        </div>
      )}

      {/* 创建表单 */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-2xl glass p-6 space-y-4"
        >
          <h3 className="font-bold text-sm">创建新后台账户</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                用户名
              </label>
              <input
                value={createUser}
                onChange={e => setCreateUser(e.target.value)}
                placeholder="3-20 位字母/数字/下划线"
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] transition"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                密码
              </label>
              <input
                type="password"
                value={createPass}
                onChange={e => setCreatePass(e.target.value)}
                placeholder="8-72 位"
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] transition"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                昵称（可选）
              </label>
              <input
                value={createNick}
                onChange={e => setCreateNick(e.target.value)}
                placeholder="默认同用户名"
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] transition"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                角色
              </label>
              <select
                value={createRole}
                onChange={e => setCreateRole(e.target.value as Role)}
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] transition"
              >
                {ROLE_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>
                    {r.label} — {r.desc}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="h-11 px-6 rounded-xl bg-[var(--brand)] text-[var(--bg)] font-bold disabled:opacity-50 hover:opacity-90 transition"
          >
            {busy ? '创建中…' : '创建账户'}
          </button>
        </form>
      )}

      {/* 用户列表 + 详情 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 列表 */}
        <div className="lg:col-span-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-12 text-center text-[var(--text-muted)]">
              暂无后台账户
            </div>
          ) : (
            filtered.map(u => {
              const isSelected = selected?.id === u.id;
              const roleMeta = ROLE_BADGE[u.role];
              const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
              return (
                <button
                  key={u.id}
                  onClick={() => selectUser(u)}
                  className={`w-full text-left rounded-2xl p-4 border transition flex items-center gap-4 ${
                    isSelected
                      ? 'bg-[var(--brand)] text-[var(--bg)] border-transparent'
                      : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]'
                  }`}
                >
                  {/* 头像 */}
                  <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] flex items-center justify-center font-bold flex-shrink-0">
                    {u.username[0]?.toUpperCase()}
                  </div>
                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold truncate">
                        {u.nickname || u.username}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ${isSelected ? 'bg-black/10' : roleMeta.cls}`}>
                        {roleMeta.label}
                      </span>
                      {locked && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold bg-red-500/10 text-red-600">
                          锁定
                        </span>
                      )}
                    </div>
                    <div className="text-xs opacity-70 truncate">
                      @{u.username}
                    </div>
                  </div>
                  <div className="text-xs opacity-70 text-right flex-shrink-0">
                    {timeAgo(u.lastSeenAt)}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* 详情面板 */}
        <div className="lg:col-span-2 space-y-4">
          {selected && detail ? (
            <div className="space-y-4">
              {/* 用户信息卡 */}
              <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center font-bold text-lg">
                    {selected.username[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">
                      {selected.nickname || selected.username}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      @{selected.username}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-md font-semibold ${ROLE_BADGE[selected.role].cls}`}>
                    {ROLE_BADGE[selected.role].label}
                  </span>
                </div>

                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">用户 ID</dt>
                    <dd className="font-mono text-xs">{selected.id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">当前角色</dt>
                    <dd>
                      <span className={`text-xs px-2 py-0.5 rounded-md font-semibold ${ROLE_BADGE[selected.role].cls}`}>
                        {ROLE_BADGE[selected.role].label}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">创建时间</dt>
                    <dd>{new Date(selected.createdAt).toLocaleString('zh-CN')}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">最近活跃</dt>
                    <dd>{timeAgo(selected.lastSeenAt)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">登录失败</dt>
                    <dd>
                      <span className={selected.failedLoginAttempts >= 3 ? 'text-red-600 font-semibold' : ''}>
                        {selected.failedLoginAttempts} 次
                      </span>
                    </dd>
                  </div>
                  {selected.lockedUntil && new Date(selected.lockedUntil).getTime() > Date.now() && (
                    <div className="flex justify-between">
                      <dt className="text-[var(--text-muted)]">锁定至</dt>
                      <dd className="text-red-600">{new Date(selected.lockedUntil).toLocaleString('zh-CN')}</dd>
                    </div>
                  )}
                </dl>

                {/* 操作 */}
                <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-3">
                  <div className="text-xs text-[var(--text-muted)]">管理操作</div>
                  <div className="flex flex-wrap gap-2">
                    {/* 角色修改 */}
                    {showRoleChange === selected.id ? (
                      <div className="flex items-center gap-2 w-full">
                        <select
                          value={newRole}
                          onChange={e => setNewRole(e.target.value as Role)}
                          className="flex-1 h-9 px-3 rounded-xl text-xs bg-[var(--bg)] border border-[var(--border)]"
                        >
                          {ROLE_OPTIONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <button
                          disabled={busy}
                          onClick={() => handleRoleChange(selected.id, newRole)}
                          className="h-9 px-4 rounded-xl text-xs font-bold bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50"
                        >
                          确认
                        </button>
                        <button
                          onClick={() => setShowRoleChange(null)}
                          className="h-9 px-3 rounded-xl text-xs bg-[var(--surface-2)]"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setShowRoleChange(selected.id);
                          setNewRole(selected.role);
                        }}
                        className="px-3 h-9 rounded-xl text-xs font-semibold bg-[var(--surface-2)] hover:opacity-80 transition"
                      >
                        修改角色
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(selected.id, selected.username)}
                      disabled={busy}
                      className="px-3 h-9 rounded-xl text-xs font-semibold bg-red-500/10 text-red-600 hover:bg-red-500/20 transition disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>

              {/* 审计日志 */}
              <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
                <h3 className="font-bold text-sm mb-3">审计日志（最近 20 条）</h3>
                {detail.auditLogs.length === 0 ? (
                  <div className="text-sm text-[var(--text-muted)]">暂无记录</div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {detail.auditLogs.map(log => (
                      <div key={log.id} className="text-xs border-b border-[var(--border)] pb-2 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)]">
                            {log.action}
                          </span>
                          <span className="text-[var(--text-muted)]">
                            {new Date(log.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        {log.target && (
                          <div className="text-[var(--text-muted)] mt-0.5">
                            Target: <span className="font-mono">{log.target}</span>
                          </div>
                        )}
                        {(() => {
                          try {
                            const metaStr = JSON.stringify(log.meta);
                            if (metaStr && metaStr !== '{}') {
                              return (
                                <div className="text-[var(--text-muted)] mt-0.5 break-all">
                                  {metaStr.slice(0, 200)}
                                </div>
                              );
                            }
                          } catch {}
                          return null;
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
              <p className="text-sm">点击左侧账户查看详情</p>
              <p className="text-xs mt-2">可查看审计日志、修改角色、删除账户</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}