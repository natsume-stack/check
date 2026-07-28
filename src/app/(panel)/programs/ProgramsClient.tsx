'use client';

import { useState, useRef } from 'react';

interface Pkg {
  id: string;
  featureId: string;
  version: string;
  codeHash: string;
  hmacSignature: string;
  sizeBytes: number;
  isActive: boolean;
  builtAt: string;
  createdAt: string;
  updatedAt: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function shortHash(hash: string, head = 12, tail = 8) {
  if (!hash) return '—';
  if (hash.length <= head + tail) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

function makeVersion() {
  return new Date().toISOString();
}

export default function ProgramsClient({
  initialPackages,
}: {
  initialPackages: Pkg[];
}) {
  const [packages, setPackages] = useState<Pkg[]>(initialPackages);
  const [featureId, setFeatureId] = useState('lokibox-pack');
  const [version, setVersion] = useState(makeVersion);
  const [code, setCode] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activePackages = packages.filter(p => p.isActive);

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* ignore */
    }
  }

  async function refreshList() {
    setRefreshing(true);
    try {
      const resp = await fetch('/api/admin/code-packages', { cache: 'no-store' });
      const data = await resp.json();
      if (resp.ok && Array.isArray(data.packages)) {
        setPackages(data.packages);
      }
    } catch {
      /* ignore refresh errors */
    } finally {
      setRefreshing(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setCode(text);
  }

  function uploadViaXhr(body: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = ev => {
        if (ev.lengthComputable) {
          setProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        let data: any = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data?.error || `上传失败 (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('网络错误'));
      xhr.open('POST', '/api/admin/code-packages/upload');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('X-Requested-With', 'check-admin');
      xhr.send(body);
    });
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!featureId.trim()) {
      setError('请填写 Feature ID');
      return;
    }
    if (!version.trim()) {
      setError('请填写版本号');
      return;
    }
    if (!code) {
      setError(mode === 'file' ? '请选择代码文件' : '请粘贴代码内容');
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const data = await uploadViaXhr(
        JSON.stringify({
          featureId: featureId.trim(),
          version: version.trim(),
          code,
        })
      );
      setSuccess(
        `上传成功 · v${data.version} · ${formatSize(data.sizeBytes)} · ${shortHash(data.codeHash)}`
      );
      setCode('');
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setVersion(makeVersion());
      await refreshList();
    } catch (err: any) {
      setError(err.message || '上传失败');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function handleDelete(p: Pkg) {
    if (!confirm(`确认删除 ${p.featureId} @ ${p.version}？此操作不可恢复。`)) return;
    setError('');
    try {
      const resp = await fetch(`/api/admin/code-packages/${p.id}`, {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || '删除失败');
      }
      setPackages(prev => prev.filter(x => x.id !== p.id));
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  }

  function resetForm() {
    setCode('');
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setVersion(makeVersion());
    setError('');
    setSuccess('');
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">代码包下发管理</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            上传 / 管理 LokiBox 客户端代码包，支持版本回滚与完整性校验
          </p>
        </div>
        <button
          onClick={refreshList}
          disabled={refreshing}
          className="h-10 px-4 rounded-xl glass font-semibold text-sm hover:opacity-80 transition disabled:opacity-50"
        >
          {refreshing ? '刷新中…' : '↻ 刷新'}
        </button>
      </div>

      {/* Messages */}
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

      {/* Active versions */}
      <section>
        <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          当前激活版本
        </h2>
        {activePackages.length === 0 ? (
          <div className="rounded-2xl glass p-8 text-center text-sm text-[var(--text-muted)]">
            尚无激活的代码包，请上传第一个版本
          </div>
        ) : (
          <div className="grid gap-4">
            {activePackages.map(p => (
              <div key={p.id} className="rounded-2xl glass p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-500 rounded-bl-xl">
                  Active
                </div>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-[var(--surface-2)]">
                    {p.featureId}
                  </span>
                  <span className="font-mono text-lg font-bold break-all">
                    {p.version}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                      大小
                    </div>
                    <div className="font-mono">{formatSize(p.sizeBytes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                      上传时间
                    </div>
                    <div className="font-mono text-xs">
                      {new Date(p.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                      SHA-256 Hash
                    </div>
                    <button
                      onClick={() => copyText(p.codeHash, `hash-${p.id}`)}
                      className="font-mono text-xs break-all text-left hover:text-[var(--brand)] transition"
                      title={p.codeHash}
                    >
                      {p.codeHash}{' '}
                      <span className="text-[var(--text-muted)]">
                        {copied === `hash-${p.id}` ? '✓ 已复制' : '⧉'}
                      </span>
                    </button>
                  </div>
                  <div className="col-span-2 md:col-span-4">
                    <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                      HMAC 签名
                    </div>
                    <button
                      onClick={() => copyText(p.hmacSignature, `hmac-${p.id}`)}
                      className="font-mono text-xs break-all text-left hover:text-[var(--brand)] transition"
                      title={p.hmacSignature}
                    >
                      {p.hmacSignature}{' '}
                      <span className="text-[var(--text-muted)]">
                        {copied === `hmac-${p.id}` ? '✓ 已复制' : '⧉'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Upload */}
      <section>
        <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          上传新版本
        </h2>
        <form
          onSubmit={handleUpload}
          className="rounded-2xl glass p-6 space-y-4"
        >
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`h-9 px-4 rounded-lg text-sm font-semibold transition ${
                mode === 'file'
                  ? 'bg-[var(--brand)] text-[var(--bg)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
              }`}
            >
              选择文件
            </button>
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={`h-9 px-4 rounded-lg text-sm font-semibold transition ${
                mode === 'paste'
                  ? 'bg-[var(--brand)] text-[var(--bg)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
              }`}
            >
              粘贴代码
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                Feature ID
              </label>
              <input
                type="text"
                value={featureId}
                onChange={e => setFeatureId(e.target.value)}
                placeholder="lokibox-pack"
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--brand)] transition"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                版本号
              </label>
              <input
                type="text"
                value={version}
                onChange={e => setVersion(e.target.value)}
                className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] font-mono text-sm focus:outline-none focus:border-[var(--brand)] transition"
              />
            </div>
          </div>

          {mode === 'file' ? (
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                代码文件
              </label>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".js,.mjs,.ts,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 px-5 rounded-xl bg-[var(--surface-2)] font-semibold text-sm hover:opacity-80 transition"
                >
                  选择文件…
                </button>
                <span className="text-sm text-[var(--text-muted)] font-mono truncate">
                  {fileName || '未选择文件'}
                </span>
                {code && (
                  <span className="text-xs text-[var(--text-muted)] ml-auto">
                    {formatSize(new Blob([code]).size)} · {code.length} 字符
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                代码内容
              </label>
              <textarea
                value={code}
                onChange={e => setCode(e.target.value)}
                rows={8}
                placeholder="// 粘贴代码内容…"
                className="w-full p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] font-mono text-sm focus:outline-none focus:border-[var(--brand)] transition"
              />
              {code && (
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {formatSize(new Blob([code]).size)} · {code.length} 字符
                </div>
              )}
            </div>
          )}

          {uploading && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div
                  className="h-full bg-[var(--brand)] transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-xs text-[var(--text-muted)] font-mono">
                上传中 {progress}%
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={uploading}
              className="h-11 px-6 rounded-xl bg-[var(--brand)] text-[var(--bg)] font-bold disabled:opacity-50 hover:opacity-90 transition"
            >
              {uploading ? '上传中…' : '↑ 上传代码包'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={uploading}
              className="h-11 px-6 rounded-xl bg-[var(--surface-2)] font-semibold hover:opacity-80 transition disabled:opacity-50"
            >
              重置
            </button>
          </div>
        </form>
      </section>

      {/* History */}
      <section>
        <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          历史版本 ({packages.length})
        </h2>
        {packages.length === 0 ? (
          <div className="rounded-2xl glass p-8 text-center text-sm text-[var(--text-muted)]">
            暂无代码包
          </div>
        ) : (
          <div className="rounded-2xl glass overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Feature</th>
                    <th className="text-left px-4 py-3">版本</th>
                    <th className="text-left px-4 py-3">大小</th>
                    <th className="text-left px-4 py-3">Hash</th>
                    <th className="text-left px-4 py-3">上传时间</th>
                    <th className="text-left px-4 py-3">状态</th>
                    <th className="text-right px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map(p => (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface)]/40 transition"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-[var(--surface-2)]">
                          {p.featureId}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs break-all">
                        {p.version}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {formatSize(p.sizeBytes)}
                      </td>
                      <td
                        className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]"
                        title={p.codeHash}
                      >
                        {shortHash(p.codeHash)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">
                        {new Date(p.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-4 py-3">
                        {p.isActive ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-500">
                            Active
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[var(--surface-2)] text-[var(--text-muted)]">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(p)}
                          className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-red-500/10 text-red-500 hover:bg-red-500/20 transition"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
