/**
 * GET  /api/admin/invitations — 邀请码列表（SUPER_ADMIN only）
 * POST /api/admin/invitations — 创建邀请码（SUPER_ADMIN only）
 *
 * 返回结构（列表项）：
 *   { id, code, targetType, maxUses, usedCount, usedById, usedAt, createdAt, expiresAt, disabledAt, createdBy: { username } }
 *
 * 创建请求体：
 *   { maxUses?: number, expiresInHours?: number, targetType?: 'LOKI' | 'ADMIN' }
 *   - targetType 默认 'LOKI'（LokiBox 客户端），'ADMIN' = 后台内推
 *   - maxUses 默认 1，必须 >= 1
 *   - ADMIN 类型强制 maxUses = 1（一对一内推）
 *   - expiresInHours 不传则永久有效（expiresAt = null）
 *   - 使用 crypto.randomBytes(24).toString('base64url') 生成 ~32 字符邀请码
 */

import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';
import { writeAuditLog } from '@/lib/security';

/** 生成 ~32 字符的邀请码（24 字节 base64url 编码） */
function generateInvitationCode(): string {
  return randomBytes(24).toString('base64url');
}

interface CreateBody {
  maxUses?: number;
  expiresInHours?: number;
  targetType?: string;
}

/** 根据 expiresInHours 计算创建参数（仅 ADMIN 类型） */
function parseCreateParams(body: CreateBody): {
  maxUses: number;
  expiresAt: Date | null;
  targetType: string;
} {
  // 只支持 ADMIN 内推类型，LOKI 客户端邀请码已废弃
  const targetType = 'ADMIN';
  const maxUses = 1; // ADMIN 强制单次使用

  let expiresAt: Date | null = null;
  if (
    body.expiresInHours !== undefined &&
    body.expiresInHours !== null &&
    Number.isFinite(body.expiresInHours) &&
    (body.expiresInHours as number) > 0
  ) {
    expiresAt = new Date(
      Date.now() + Math.floor(body.expiresInHours as number) * 60 * 60 * 1000
    );
  }

  return { maxUses, expiresAt, targetType };
}

export async function GET(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const invitations = await prisma.invitationCode.findMany({
    where: { targetType: 'ADMIN' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      code: true,
      targetType: true,
      maxUses: true,
      usedCount: true,
      usedById: true,
      usedAt: true,
      createdAt: true,
      expiresAt: true,
      disabledAt: true,
      createdBy: { select: { username: true } },
    },
  });

  const result = invitations.map((inv) => ({
    id: inv.id,
    code: inv.code,
    targetType: inv.targetType,
    maxUses: inv.maxUses,
    usedCount: inv.usedCount,
    usedById: inv.usedById,
    usedAt: inv.usedAt,
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    disabledAt: inv.disabledAt,
    createdBy: inv.createdBy?.username ?? null,
  }));

  return jsonResponse(result);
}

export async function POST(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const { maxUses, expiresAt, targetType } = parseCreateParams(body);

  const code = generateInvitationCode();

  const invitation = await prisma.invitationCode.create({
    data: {
      code,
      targetType,
      maxUses,
      expiresAt,
      createdById: claims.sub,
    },
  });

  await writeAuditLog({
    actorId: claims.sub,
    action: 'invitation.create',
    target: code,
    meta: { id: invitation.id, maxUses, expiresAt, targetType },
    req,
  });

  return jsonResponse({
    id: invitation.id,
    code: invitation.code,
    targetType: invitation.targetType,
    maxUses: invitation.maxUses,
    expiresAt: invitation.expiresAt,
  });
}

export const dynamic = 'force-dynamic';
