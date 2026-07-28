/**
 * POST /api/auth/register — 管理后台注册（AdminUser 表）
 *
 * 采用内推制度：必须提供有效的 ADMIN 类型邀请码才能注册。
 * 每个邀请码只能注册一个账号，注册成功后邀请码即销毁（usedCount 达到 maxUses）。
 * 新注册用户默认角色为 USER，可由 SUPER_ADMIN 后续提升。
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/crypto';
import { getClientIp } from '@/lib/request';
import { checkRateLimit, rateLimitResponse, writeAuditLog } from '@/lib/security';

interface Body {
  username: string;
  password: string;
  invitationCode: string;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function POST(req: NextRequest) {
  // IP 维度限流：防止滥用
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'admin-register', windowMs: 60_000, max: 5 });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = (await req.json().catch(() => ({}))) as Body;
  const username = body.username?.trim();
  const password = body.password ?? '';
  const invitationCode = body.invitationCode?.trim();

  // 邀请码必填
  if (!invitationCode) {
    return NextResponse.json({ error: '邀请码必填' }, { status: 400 });
  }

  // 验证邀请码
  const invite = await prisma.invitationCode.findUnique({
    where: { code: invitationCode },
  });

  if (!invite) {
    return NextResponse.json({ error: '邀请码无效' }, { status: 400 });
  }

  // 必须是 ADMIN 类型
  if (invite.targetType !== 'ADMIN') {
    return NextResponse.json({ error: '邀请码类型错误' }, { status: 400 });
  }

  // 已禁用
  if (invite.disabledAt) {
    return NextResponse.json({ error: '邀请码已被禁用' }, { status: 400 });
  }

  // 已过期
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: '邀请码已过期' }, { status: 400 });
  }

  // 已用完
  if (invite.usedCount >= invite.maxUses) {
    return NextResponse.json({ error: '邀请码已被使用' }, { status: 400 });
  }

  // 参数校验
  if (!username || !password) {
    return NextResponse.json({ error: '用户名和密码必填' }, { status: 400 });
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ error: '用户名必须为 3-20 位字母/数字/_-' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: '密码必须为 8-72 位' }, { status: 400 });
  }

  // 用户名查重
  const exists = await prisma.adminUser.findUnique({ where: { username } });
  if (exists) {
    return NextResponse.json({ error: '用户名已被使用' }, { status: 409 });
  }

  // 创建 AdminUser（默认 USER 角色）
  const passwordHash = await hashPassword(password);
  const newAdmin = await prisma.adminUser.create({
    data: {
      username,
      passwordHash,
      nickname: username,
      role: 'USER',
    },
  });

  // 销毁邀请码（标记已使用，usedCount+1，记录使用者）
  await prisma.invitationCode.update({
    where: { id: invite.id },
    data: {
      usedCount: { increment: 1 },
      usedById: newAdmin.id,
      usedAt: new Date(),
    },
  });

  // 审计日志
  await writeAuditLog({
    actorId: newAdmin.id,
    action: 'ADMIN_REGISTER',
    target: newAdmin.id,
    meta: { username, invitationCode: invite.code, invitationId: invite.id },
    req,
  });

  return NextResponse.json({
    ok: true,
    user: { id: newAdmin.id, username: newAdmin.username, role: newAdmin.role },
  });
}

export const dynamic = 'force-dynamic';
