import { getAdminClaims } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import UsersClient from './UsersClient';

export default async function UsersPage() {
  const h = await headers();
  const req = { headers: h } as any;
  const claims = await getAdminClaims(req);
  if (!claims) redirect('/login');

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      nickname: true,
      role: true,
      avatarUrl: true,
      fingerprint: true,
      createdAt: true,
      lastSeenAt: true,
      loginRecords: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          ip: true,
          country: true,
          region: true,
          city: true,
          latitude: true,
          longitude: true,
          accuracyKm: true,
          asn: true,
          org: true,
          timezone: true,
          userAgent: true,
          createdAt: true,
        },
      },
    },
  });

  const serialized = users.map(u => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    lastLogin: u.loginRecords[0]
      ? {
          ...u.loginRecords[0],
          createdAt: u.loginRecords[0].createdAt.toISOString(),
        }
      : null,
    loginRecords: undefined,
  }));

  return <UsersClient initialUsers={serialized} />;
}
