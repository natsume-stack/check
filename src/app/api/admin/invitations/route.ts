/**
 * GET  /api/admin/invitations — 邀请码列表（SUPER_ADMIN only）
 * POST /api/admin/invitations — 创建邀请码（SUPER_ADMIN only）
 *
 * 返回结构（列表项）：
 *   { id, code, maxUses, usedCount, createdAt, expiresAt, disabledAt, createdBy: { username } }
 *
 * 创建请求体：
 *   { maxUses?: number, expiresInHours?: number }
 *   - maxUses 默认 1，必须 >= 1
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
}

/** 根据 maxUses / expiresInHours 计算创建参数 */
function parseCreateParams(body: CreateBody): {
  maxUses: number;
  expiresAt: Date | null;
} {
  const maxUses =
    Number.isFinite(body.maxUses) && (body.maxUses as number) >= 1
      ? Math.floor(body.maxUses as number)
      : 1;

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

  return { maxUses, expiresAt };
}

export async function GET(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const invitations = await prisma.invitationCode.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      code: true,
      maxUses: true,
      usedCount: true,
      createdAt: true,
      expiresAt: true,
      disabledAt: true,
      createdBy: { select: { username: true } },
    },
  });

  const result = invitations.map((inv) => ({
    id: inv.id,
    code: inv.code,
    maxUses: inv.maxUses,
    usedCount: inv.usedCount,
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    disabledAt: inv.disabledAt,
    createdBy: inv.createdBy ? { username: inv.createdBy.username } : null,
  }));

  return jsonResponse(result);
}

export async function POST(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const { maxUses, expiresAt } = parseCreateParams(body);

  const code = generateInvitationCode();

  const invitation = await prisma.invitationCode.create({
    data: {
      code,
      maxUses,
      expiresAt,
      createdById: claims.sub,
    },
  });

  await writeAuditLog({
    actorId: claims.sub,
    action: 'invitation.create',
    target: code,
    meta: { id: invitation.id, maxUses, expiresAt },
    req,
  });

  return jsonResponse({
    id: invitation.id,
    code: invitation.code,
    maxUses: invitation.maxUses,
    expiresAt: invitation.expiresAt,
  });
}

export const dynamic = 'force-dynamic';
