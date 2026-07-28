/**
 * GET    /api/admin/programs/[id] — 取单个配置（id 是 cuid）
 * PATCH  /api/admin/programs/[id] — 更新字段
 * DELETE /api/admin/programs/[id] — 删除
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const program = await prisma.programConfig.findUnique({
    where: { id: params.id },
  });
  if (!program) return jsonResponse({ error: 'Not found' }, 404);

  return jsonResponse({ program });
}

interface PatchBody {
  config?: unknown;
  enforced?: boolean;
  disabled?: boolean;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as PatchBody;
  const data: Record<string, unknown> = {};
  if (body.config !== undefined) data.config = body.config;
  if (body.enforced !== undefined) data.enforced = body.enforced;
  if (body.disabled !== undefined) data.disabled = body.disabled;

  const program = await prisma.programConfig.update({
    where: { id: params.id },
    data,
  });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'program.patch',
      target: `${program.programId}/${program.featureId}`,
      meta: data as object,
    },
  });

  return jsonResponse({ program });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  await prisma.programConfig.delete({ where: { id: params.id } });

  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'program.delete',
      target: params.id,
    },
  });

  return jsonResponse({ ok: true });
}

export const dynamic = 'force-dynamic';
