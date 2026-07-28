/**
 * GET  /api/admin/pack-distribution — 获取全局程序下发开关状态
 * PATCH /api/admin/pack-distribution — 切换全局程序下发开关
 *
 * 鉴权：SUPER_ADMIN（Cookie JWT）
 * 安全：CSRF 校验 + 审计日志
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { checkCsrf, csrfErrorResponse, writeAuditLog } from '@/lib/security';

const CONFIG_KEY = 'pack_distribution_disabled';

export async function GET(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await prisma.systemConfig.findUnique({
    where: { key: CONFIG_KEY },
    select: { value: true, updatedAt: true },
  }).catch(() => null);

  return NextResponse.json({
    disabled: config?.value === 'true',
    updatedAt: config?.updatedAt?.toISOString() ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!checkCsrf(req)) {
    return csrfErrorResponse();
  }

  const body = await req.json().catch(() => ({}));
  const disabled = Boolean(body.disabled);

  // Upsert 配置记录
  const config = await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value: String(disabled) },
    create: { key: CONFIG_KEY, value: String(disabled) },
  });

  // 审计日志
  await writeAuditLog({
    actorId: claims.sub,
    action: 'config.update',
    target: CONFIG_KEY,
    meta: { disabled },
  });

  return NextResponse.json({
    disabled,
    updatedAt: config.updatedAt.toISOString(),
  });
}

export const dynamic = 'force-dynamic';
