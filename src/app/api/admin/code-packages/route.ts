/**
 * GET /api/admin/code-packages — 列出所有代码包
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

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

  return jsonResponse({ packages });
}

export const dynamic = 'force-dynamic';
