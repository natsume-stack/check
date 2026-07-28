/**
 * DELETE /api/admin/code-packages/[id] — 删除代码包
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const pkg = await prisma.codePackage.findUnique({
    where: { id: params.id },
    select: { featureId: true, version: true },
  });

  if (!pkg) return jsonResponse({ error: 'Not found' }, 404);

  await prisma.codePackage.delete({ where: { id: params.id } });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'code.delete',
      target: pkg.featureId,
      meta: { version: pkg.version },
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
