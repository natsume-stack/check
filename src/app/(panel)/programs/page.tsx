import { getAdminClaims } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import ProgramsClient from './ProgramsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProgramsPage() {
  const h = await headers();
  const req = { headers: h } as any;
  const claims = await getAdminClaims(req);
  if (!claims) redirect('/login');

  const programs = await prisma.programConfig.findMany({
    orderBy: [{ programId: 'asc' }, { featureId: 'asc' }],
  });

  // 序列化 Date/BigInt
  const serialized = programs.map(p => ({
    ...p,
    config: p.config as unknown,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return <ProgramsClient initialPrograms={serialized} />;
}
