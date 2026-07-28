'use client';

import { useState } from 'react';

interface InvitationCode {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
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
  const [maxUses, setMaxUses] = useState(1);
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
      if (resp.ok && Array.isArray(data.codes)) {
        setCodes(data.codes);
      }
    } catch {}
  }

  async function handleCreate(batch = false) {
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const body = batch
        ? { count: batchCount, maxUses, expiresInHours: expiresInHours || undefined }
        : { maxUses, expiresInHours: expiresInHours || undefined };

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
        const newCodes = data.codes.map((c: any) => ({ ...c, createdAt: new Date().toISOString(), expiresAt: c.expiresAt ?? null, disabledAt: null, usedCount: 0, createdBy: null }));
        setCodes([...newCodes, ...codes]);
        setSuccess(`成功创建 ${data.codes.length} 个邀请码`);
      } else if (data.code) {
        setCodes([{ ...data, createdAt: new Date().toISOString(), expiresAt: data.expiresAt ?? null, disabledAt: null, usedCount: 0, createdBy: null }, ...codes]);
        setSuccess(`邀请码已创建: ${data.code}`);
      }
    } catch (e) {
      setError('网络错误');
    } finally {
      setCreating(false);
    }
  }

  async function handleDisable(id: string) {
    if (!confirm('确定禁用此邀请码？')) return;
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
          <h1 className="text-3xl font-bold tracking-tight">邀请码管理</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            管理 LokiBox 客户端注册邀请码，控制新用户注册入口
          </p>
        </div>
        <button onClick={refreshList} className="h-11 px-4 rounded-2xl text-sm font-semibold bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-2)] transition">
          刷新
        </button>
      </div>

      {/* 创建区域 */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
        <h2 className="font-bold tracking-tight mb-4">创建邀请码</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">最大使用次数</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxUses}
              onChange={e => setMaxUses(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-10 w-28 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm focus:outline-none focus:border-[var(--brand)]"
            />
          </div>
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
            {creating ? '创建中…' : '创建单个'}
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
        {success && <p className="mt-3 text-sm text-green-600">{success}</p>}
      </div>

      {/* 活跃邀请码 */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
        <h2 className="font-bold tracking-tight mb-4">
          活跃邀请码 <span className="text-[var(--text-muted)] font-normal">({activeCodes.length})</span>
        </h2>
        {activeCodes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">暂无活跃邀请码</p>
        ) : (
          <div className="space-y-2">
            {activeCodes.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors group">
                <code className="flex-1 text-sm font-mono select-all">{c.code}</code>
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap tabular-nums">
                  {c.usedCount}/{c.maxUses} 次
                </span>
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                  {c.expiresAt ? `过期 ${formatDate(c.expiresAt)}` : '永久'}
                </span>
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                  {formatDate(c.createdAt)}
                </span>
                <button
                  onClick={() => copyText(c.code, c.id)}
                  className="px-2 py-1 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  {copied === c.id ? '✓ 已复制' : '复制'}
                </button>
                <button
                  onClick={() => handleDisable(c.id)}
                  className="px-2 py-1 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  禁用
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 已禁用邀请码 */}
      {disabledCodes.length > 0 && (
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6">
          <h2 className="font-bold tracking-tight mb-4">
            已禁用邀请码 <span className="text-[var(--text-muted)] font-normal">({disabledCodes.length})</span>
          </h2>
          <div className="space-y-2">
            {disabledCodes.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] opacity-60">
                <code className="flex-1 text-sm font-mono text-[var(--text-muted)] select-all">{shortCode(c.code)}</code>
                <span className="text-xs text-[var(--text-muted)] tabular-nums">
                  {c.usedCount}/{c.maxUses} 次
                </span>
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