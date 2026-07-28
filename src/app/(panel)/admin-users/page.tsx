import { getAdminClaims } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import AdminUsersClient from './AdminUsersClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminUsersPage() {
  const h = await headers();
  const req = { headers: h } as any;
  const claims = await getAdminClaims(req);
  if (!claims) redirect('/login');
  if (claims.role !== 'SUPER_ADMIN') redirect('/');

  const users = await prisma.adminUser.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      username: true,
      nickname: true,
      role: true,
      lastSeenAt: true,
      createdAt: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  const serialized = users.map(u => ({
    ...u,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
  }));

  return <AdminUsersClient initialUsers={serialized} />;
}