/**
 * POST /api/auth/register — 管理后台注册（AdminUser 表）
 *
 * 仅 SUPER_ADMIN 可创建新后台账户（通过 cookie 鉴权）。
 * 默认不开放公开注册。
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/crypto';
import { requireSuperAdmin } from '@/lib/auth';
import { getClientIp } from '@/lib/request';
import { checkRateLimit, rateLimitResponse } from '@/lib/security';

interface Body {
  username: string;
  password: string;
  role?: 'USER' | 'AGENT' | 'SUPER_ADMIN';
  nickname?: string;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function POST(req: NextRequest) {
  // 仅超管可创建后台账户
  const claims = await requireSuperAdmin(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 限流（即使超管也限制创建频率，防误操作刷库）
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'admin-register', windowMs: 60_000, max: 5 });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = (await req.json()) as Body;
  const username = body.username?.trim();
  const password = body.password ?? '';
  const role = body.role ?? 'USER';

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing username or password' }, { status: 400 });
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ error: 'Username must be 3-20 chars (letters, numbers, _, -)' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: 'Password must be 8-72 chars' }, { status: 400 });
  }
  if (!['USER', 'AGENT', 'SUPER_ADMIN'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const exists = await prisma.adminUser.findUnique({ where: { username } });
  if (exists) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const newAdmin = await prisma.adminUser.create({
    data: {
      username,
      passwordHash,
      nickname: body.nickname ?? username,
      role,
    },
  });

  // 审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'CREATE_ADMIN',
      target: newAdmin.id,
      meta: { username, role },
    },
  });

  return NextResponse.json({
    ok: true,
    user: { id: newAdmin.id, username: newAdmin.username, role: newAdmin.role },
  });
}

export const dynamic = 'force-dynamic';
