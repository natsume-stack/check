'use client';

import { useState } from 'react';

interface InvitationCode {
  id: string;
  code: string;
  targetType: string;
  maxUses: number;
  usedCount: number;
  usedById: string | null;
  usedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  disabledAt: string | null;
  createdBy: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function shortCode(code: string) {
  if (code.length <= 16) return code;
  return `${code.slice(0, 8)}…${code.slice(-6)}`;
}

export default function InvitationsClient({
  initialCodes,
}: {
  initialCodes: InvitationCode[];
}) {
  const [codes, setCodes] = useState<InvitationCode[]>(initialCodes);
  const [expiresInHours, setExpiresInHours] = useState(0);
  const [batchCount, setBatchCount] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState('');

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {}
  }

  async function refreshList() {
    try {
      const resp = await fetch('/api/admin/invitations', { cache: 'no-store' });
      const data = await resp.json();
      if (resp.ok && Array.isArray(data)) {
        setCodes(data);
      }
    } catch {}
  }

  async function handleCreate(batch = false) {
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const baseBody: any = {
        targetType: 'ADMIN',
        expiresInHours: expiresInHours || undefined,
      };

      const body = batch
        ? { ...baseBody, count: batchCount }
        : baseBody;

      const resp = await fetch('/api/admin/invitations' + (batch ? '/batch' : ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || '创建失败');
        return;
      }

      if (batch && data.codes) {
        const newCodes = data.codes.map((c: any) => ({
          ...c,
          targetType: 'ADMIN',
          usedCount: 0,
          usedById: null,
          usedAt: null,
          createdAt: new Date().toISOString(),
          expiresAt: c.expiresAt ?? null,
          disabledAt: null,
          createdBy: null,
        }));
        setCodes([...newCodes, ...codes]);
        setSuccess(`成功创建 ${data.codes.length} 个内推链接`);
      } else if (data.code) {
        const newCode = {
          ...data,
          targetType: 'ADMIN',
          usedCount: 0,
          usedById: null,
          usedAt: null,
          createdAt: new Date().toISOString(),
          expiresAt: data.expiresAt ?? null,
          disabledAt: null,
          createdBy: null,
        };
        setCodes([newCode, ...codes]);

        const link = `${window.location.origin}/register?code=${data.code}`;
        setSuccess(`内推链接已创建：${link}`);
      }
    } catch (e) {
      setError('网络错误');
    } finally {
      setCreating(false);
    }
  }

  async function handleDisable(id: string) {
    if (!confirm('确定禁用？')) return;
    try {
      const resp = await fetch(`/api/admin/invitations/${id}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (resp.ok) {
        setCodes(codes.map(c => c.id === id ? { ...c, disabledAt: new Date().toISOString() } : c));
      }
    } catch {}
  }

  const activeCodes = codes.filter(c => !c.disabledAt);
  const disabledCodes = codes.filter(c => c.disabledAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">内推链接管理</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            管理后台内推链接，每个链接仅可注册一个账号
          </p>
        </div>
        <button onClick={refreshList} className="h-11 px-4 rounded-2xl text-sm font-semibold bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-2)] transition">
          刷新
        </button>
      </div>

      {/* 创建区域 */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
        <h2 className="font-bold tracking-tight mb-1">
          创建内推链接
        </h2>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          内推链接仅可注册一个 check 后台账号，注册后自动销毁
        </p>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">有效期(小时, 0=永久)</label>
            <input
              type="number"
              min={0}
              value={expiresInHours}
              onChange={e => setExpiresInHours(Math.max(0, parseInt(e.target.value) || 0))}
              className="h-10 w-36 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm focus:outline-none focus:border-[var(--brand)]"
            />
          </div>
          <button
            onClick={() => handleCreate(false)}
            disabled={creating}
            className="h-10 px-5 rounded-xl bg-[var(--brand)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
          >
            {creating ? '创建中…' : '创建内推链接'}
          </button>
          <div className="flex items-end gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={batchCount}
              onChange={e => setBatchCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
              className="h-10 w-20 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm focus:outline-none focus:border-[var(--brand)]"
            />
            <button
              onClick={() => handleCreate(true)}
              disabled={creating}
              className="h-10 px-5 rounded-xl bg-[var(--surface-2)] text-sm font-semibold hover:opacity-80 disabled:opacity-50 transition"
            >
              批量创建
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {success && (
          <p className="mt-3 text-sm text-green-600 break-all">{success}</p>
        )}
      </div>

      {/* 活跃列表 */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
        <h2 className="font-bold tracking-tight mb-4">
          活跃内推链接{' '}
          <span className="text-[var(--text-muted)] font-normal">({activeCodes.length})</span>
        </h2>
        {activeCodes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">
            暂无内推链接
          </p>
        ) : (
          <div className="space-y-2">
            {activeCodes.map(c => {
              const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/register?code=${c.code}`;
              const isUsed = c.usedCount >= c.maxUses;
              return (
                <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors group ${isUsed ? 'opacity-60' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <code className="block text-xs font-mono select-all truncate text-[var(--text)]">
                      {link}
                    </code>
                    {isUsed && c.usedAt && (
                      <span className="text-xs text-[var(--text-muted)] mt-0.5 block">
                        已注册 · {formatDate(c.usedAt)}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {c.expiresAt ? `过期 ${formatDate(c.expiresAt)}` : '永久'}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {formatDate(c.createdAt)}
                  </span>
                  <button
                    onClick={() => copyText(link, c.id)}
                    className="px-2 py-1 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors"
                  >
                    {copied === c.id ? '✓ 已复制' : '复制'}
                  </button>
                  {!isUsed && (
                    <button
                      onClick={() => handleDisable(c.id)}
                      className="px-2 py-1 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      禁用
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 已禁用列表 */}
      {disabledCodes.length > 0 && (
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
          <h2 className="font-bold tracking-tight mb-4">
            已禁用 <span className="text-[var(--text-muted)] font-normal">({disabledCodes.length})</span>
          </h2>
          <div className="space-y-2">
            {disabledCodes.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] opacity-60">
                <code className="flex-1 text-sm font-mono text-[var(--text-muted)] select-all">{shortCode(c.code)}</code>
                <span className="text-xs text-[var(--text-muted)]">
                  禁用于 {formatDate(c.disabledAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
