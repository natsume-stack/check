/**
 * POST /api/admin/invitations/batch — 批量创建邀请码（SUPER_ADMIN only）
 *
 * 请求体：
 *   { count: number, maxUses?: number, expiresInHours?: number }
 *   - count 必须 >= 1，上限 100（防止误操作产生过多记录）
 *   - maxUses 默认 1，必须 >= 1
 *   - expiresInHours 不传则永久有效（expiresAt = null）
 *
 * 返回：
 *   { codes: [{ id, code, maxUses, expiresAt }] }
 *
 * 使用 prisma.$transaction 保证批量写入的原子性，
 * 每个邀请码独立生成（crypto.randomBytes(24).toString('base64url')），
 * 失败则整体回滚。
 */

import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';
import { writeAuditLog } from '@/lib/security';

/** 单批最大创建数量 */
const MAX_BATCH_COUNT = 100;

/** 生成 ~32 字符的邀请码（24 字节 base64url 编码） */
function generateInvitationCode(): string {
  return randomBytes(24).toString('base64url');
}

interface BatchBody {
  count?: number;
  maxUses?: number;
  expiresInHours?: number;
}

export async function POST(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as BatchBody;

  const count =
    Number.isFinite(body.count) && (body.count as number) >= 1
      ? Math.min(MAX_BATCH_COUNT, Math.floor(body.count as number))
      : 0;
  if (count < 1) {
    return jsonResponse(
      { error: 'Invalid count (must be a positive integer)' },
      400
    );
  }

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

  // 事务内批量创建，保证原子性
  const created = await prisma.$transaction(
    Array.from({ length: count }, () =>
      prisma.invitationCode.create({
        data: {
          code: generateInvitationCode(),
          maxUses,
          expiresAt,
          createdById: claims.sub,
        },
        select: { id: true, code: true, maxUses: true, expiresAt: true },
      })
    )
  );

  // 审计日志：记录批量创建事件（target 取首个 code 作为代表，meta 记录全部 code）
  await writeAuditLog({
    actorId: claims.sub,
    action: 'invitation.create',
    target: created[0]?.code ?? null,
    meta: {
      batch: true,
      count: created.length,
      maxUses,
      expiresAt,
      codes: created.map((c) => c.code),
    },
    req,
  });

  return jsonResponse({ codes: created });
}

export const dynamic = 'force-dynamic';
