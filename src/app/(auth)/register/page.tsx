'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('两次密码不一致');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'check-admin' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Register failed');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass rounded-[28px] p-10 shadow-2xl">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[var(--brand)] text-[var(--bg)] mb-4">
          <span className="text-2xl font-bold">+</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">注册账号</h1>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          创建你的 check 账号
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            用户名
          </label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="3-20 位字母/数字/_-"
            autoFocus
            required
            className="w-full h-12 px-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/10 transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            密码
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="至少 8 位"
            required
            className="w-full h-12 px-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/10 transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            确认密码
          </label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="再输入一次"
            required
            className="w-full h-12 px-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/10 transition"
          />
        </div>

        {error && (
          <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 rounded-2xl bg-[var(--brand)] text-[var(--bg)] font-bold disabled:opacity-50 hover:opacity-90 transition"
        >
          {loading ? '注册中…' : '创建账号'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
        已有账号？{' '}
        <Link href="/login" className="font-semibold text-[var(--text)] underline underline-offset-4">
          登录
        </Link>
      </p>
    </div>
  );
}
