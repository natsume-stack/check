import { getAdminClaims } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import InvitationsClient from './InvitationsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InvitationsPage() {
  const h = await headers();
  const req = { headers: h } as any;
  const claims = await getAdminClaims(req);
  if (!claims) redirect('/login');
  if (claims.role !== 'SUPER_ADMIN') redirect('/');

  const codes = await prisma.invitationCode.findMany({
    orderBy: [{ targetType: 'asc' }, { createdAt: 'desc' }],
    include: {
      createdBy: {
        select: { username: true },
      },
    },
  });

  const serialized = codes.map(c => ({
    id: c.id,
    code: c.code,
    targetType: c.targetType,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    usedById: c.usedById,
    usedAt: c.usedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    disabledAt: c.disabledAt?.toISOString() ?? null,
    createdBy: c.createdBy?.username ?? null,
  }));

  return <InvitationsClient initialCodes={serialized} />;
}
