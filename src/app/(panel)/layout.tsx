import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import BottomIsland from '@/components/BottomIsland';
import { getAdminClaims } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const req = { headers: h } as any;
  const claims = await getAdminClaims(req);
  if (!claims) redirect('/login');

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="sticky top-0 z-30 glass border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--brand)] text-[var(--bg)] flex items-center justify-center font-bold">
              ✓
            </div>
            <div>
              <div className="font-bold tracking-tight">check</div>
              <div className="text-xs text-[var(--text-muted)]">
                LokiBox 验证控制台 · {claims.username}
                {claims.role === 'SUPER_ADMIN' && ' · 超管'}
                {claims.role === 'AGENT' && ' · 代理'}
                {claims.role === 'USER' && ' · 用户'}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 pb-32">{children}</main>

      <BottomIsland role={claims.role} />
    </div>
  );
}
