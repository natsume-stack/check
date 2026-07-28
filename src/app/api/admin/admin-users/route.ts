/**
 * /api/admin/admin-users — 管理后台账户管理（AdminUser 表）
 *
 * GET  /api/admin/admin-users       列出所有 AdminUser（仅 SUPER_ADMIN）
 * POST /api/admin/admin-users       创建新 AdminUser（仅 SUPER_ADMIN）
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/crypto';
import { requireSuperAdmin, canManageAdminUser } from '@/lib/auth';
import type { Role } from '@/lib/crypto';

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function GET(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await prisma.adminUser.findMany({
    select: {
      id: true,
      username: true,
      nickname: true,
      role: true,
      lastSeenAt: true,
      createdAt: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ users });
}

interface CreateBody {
  username: string;
  password: string;
  role?: Role;
  nickname?: string;
}

export async function POST(req: NextRequest) {
  const claims = await requireSuperAdmin(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as CreateBody;
  const username = body.username?.trim();
  const password = body.password ?? '';
  const role: Role = body.role ?? 'USER';

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing username or password' }, { status: 400 });
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
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
