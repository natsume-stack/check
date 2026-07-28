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
  // 仅超级管理员可访问代码包下发管理
  if (claims.role !== 'SUPER_ADMIN') redirect('/');

  const packages = await prisma.codePackage.findMany({
    orderBy: [{ featureId: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      featureId: true,
      version: true,
      codeHash: true,
      hmacSignature: true,
      sizeBytes: true,
      isActive: true,
      builtAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // 查询全局下发开关状态
  const distConfig = await prisma.systemConfig.findUnique({
    where: { key: 'pack_distribution_disabled' },
    select: { value: true },
  }).catch(() => null);

  // 序列化 Date
  const serialized = packages.map(p => ({
    ...p,
    builtAt: p.builtAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <ProgramsClient
      initialPackages={serialized}
      initialDistributionDisabled={distConfig?.value === 'true'}
    />
  );
}
