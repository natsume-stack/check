'use client';

import { useState } from 'react';

interface Program {
  id: string;
  programId: string;
  featureId: string;
  config: unknown;
  enforced: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function ProgramsClient({
  initialPrograms,
}: {
  initialPrograms: Program[];
}) {
  const [programs, setPrograms] = useState<Program[]>(initialPrograms);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const [programId, setProgramId] = useState('lokibox');
  const [featureId, setFeatureId] = useState('');
  const [config, setConfig] = useState('{}');
  const [enforced, setEnforced] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setEditing(null);
    setProgramId('lokibox');
    setFeatureId('');
    setConfig('{}');
    setEnforced(false);
    setDisabled(false);
    setError('');
  }

  function startEdit(p: Program) {
    setEditing(p);
    setProgramId(p.programId);
    setFeatureId(p.featureId);
    setConfig(JSON.stringify(p.config, null, 2));
    setEnforced(p.enforced);
    setDisabled(p.disabled);
    setShowForm(true);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(config);
    } catch {
      setError('Config JSON 解析失败');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/admin/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          programId,
          featureId,
          config: parsedConfig,
          enforced,
          disabled,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Save failed');
        return;
      }

      // 更新列表
      const newProgram = data.program as Program;
      const newProgramSerialized: Program = {
        ...newProgram,
        createdAt: new Date(newProgram.createdAt).toISOString(),
        updatedAt: new Date(newProgram.updatedAt).toISOString(),
      };
      setPrograms(prev => {
        const idx = prev.findIndex(
          p => p.programId === newProgram.programId && p.featureId === newProgram.featureId
        );
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = newProgramSerialized;
          return copy;
        }
        return [newProgramSerialized, ...prev];
      });

      setShowForm(false);
      resetForm();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确认删除此配置？')) return;
    const resp = await fetch(`/api/admin/programs/${id}`, { method: 'DELETE' });
    if (resp.ok) {
      setPrograms(prev => prev.filter(p => p.id !== id));
    }
  }

  async function toggleField(p: Program, field: 'enforced' | 'disabled') {
    const newValue = !p[field];
    const resp = await fetch(`/api/admin/programs/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: newValue }),
    });
    if (resp.ok) {
      setPrograms(prev =>
        prev.map(x => (x.id === p.id ? { ...x, [field]: newValue } : x))
      );
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">LokiBox 程序管理</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            远程配置 LokiBox 各 feature 参数 / 强制启用 / 远程禁用
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="h-11 px-5 rounded-2xl bg-[var(--brand)] text-[var(--bg)] font-bold hover:opacity-90 transition"
        >
          + 新建配置
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6 space-y-4"
        >
          <h2 className="font-bold text-lg">{editing ? '编辑配置' : '新建配置'}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                程序 ID
              </label>
              <input
                type="text"
                value={programId}
                onChange={e => setProgramId(e.target.value)}
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                Feature ID
              </label>
              <input
                type="text"
                value={featureId}
                onChange={e => setFeatureId(e.target.value)}
                placeholder="kill-aura 或 *"
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
              配置 JSON
            </label>
            <textarea
              value={config}
              onChange={e => setConfig(e.target.value)}
              rows={8}
              className="w-full p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] font-mono text-sm focus:outline-none focus:border-[var(--brand)] transition"
            />
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enforced}
                onChange={e => setEnforced(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-semibold">强制启用</span>
              <span className="text-xs text-[var(--text-muted)]">（客户端无法关闭）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={disabled}
                onChange={e => setDisabled(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-semibold">禁用</span>
              <span className="text-xs text-[var(--text-muted)]">（客户端无法开启）</span>
            </label>
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="h-11 px-6 rounded-2xl bg-[var(--brand)] text-[var(--bg)] font-bold disabled:opacity-50 hover:opacity-90 transition"
            >
              {loading ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="h-11 px-6 rounded-2xl bg-[var(--surface-2)] font-semibold hover:opacity-80 transition"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {/* 配置列表 */}
      {programs.length === 0 ? (
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-12 text-center">
          <div className="text-[var(--text-muted)]">暂无程序配置</div>
          <div className="text-xs text-[var(--text-muted)] mt-2">
            点击「新建配置」开始
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map(p => (
            <div
              key={p.id}
              className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-[var(--surface-2)]">
                    {p.programId}
                  </span>
                  <span className="font-mono text-sm font-semibold">/{p.featureId}</span>
                  {p.enforced && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-600 font-semibold">
                      强制
                    </span>
                  )}
                  {p.disabled && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-red-500/10 text-red-600 font-semibold">
                      禁用
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)] font-mono">
                  {JSON.stringify(p.config).slice(0, 200)}
                  {JSON.stringify(p.config).length > 200 ? '…' : ''}
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-2">
                  更新于 {new Date(p.updatedAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleField(p, 'enforced')}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    p.enforced
                      ? 'bg-orange-500/20 text-orange-600'
                      : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                  }`}
                >
                  强制
                </button>
                <button
                  onClick={() => toggleField(p, 'disabled')}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    p.disabled
                      ? 'bg-red-500/20 text-red-600'
                      : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                  }`}
                >
                  禁用
                </button>
                <button
                  onClick={() => startEdit(p)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-[var(--surface-2)] text-[var(--text)] hover:opacity-80 transition"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-red-500/10 text-red-600 hover:bg-red-500/20 transition"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
