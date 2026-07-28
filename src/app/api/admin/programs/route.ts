/**
 * GET  /api/admin/programs       — 列出所有程序配置
 * POST /api/admin/programs       — 创建/更新程序配置
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const programs = await prisma.programConfig.findMany({
    orderBy: [{ programId: 'asc' }, { featureId: 'asc' }],
  });

  return jsonResponse({ programs });
}

interface CreateBody {
  programId?: string;
  featureId?: string;
  config?: unknown;
  enforced?: boolean;
  disabled?: boolean;
}

export async function POST(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as CreateBody;
  const programId = body.programId?.trim() || 'lokibox';
  const featureId = body.featureId?.trim();
  if (!featureId) return jsonResponse({ error: 'Missing featureId' }, 400);

  const result = await prisma.programConfig.upsert({
    where: { programId_featureId: { programId, featureId } },
    create: {
      programId,
      featureId,
      config: (body.config ?? {}) as object,
      enforced: body.enforced ?? false,
      disabled: body.disabled ?? false,
    },
    update: {
      config: (body.config ?? {}) as object,
      enforced: body.enforced ?? false,
      disabled: body.disabled ?? false,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'program.update',
      target: `${programId}/${featureId}`,
      meta: { enforced: result.enforced, disabled: result.disabled },
    },
  });

  return jsonResponse({ program: result });
}

export const dynamic = 'force-dynamic';
