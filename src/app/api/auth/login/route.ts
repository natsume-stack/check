/**
 * POST /api/auth/login — 管理后台登录（AdminUser 表）
 *
 * 明文 JSON（HTTPS 保护），设 HttpOnly Cookie。
 * 安全：
 *   - IP 维度限流：60s 内最多 10 次尝试
 *   - 账号维度锁定：连续 5 次失败锁 15 分钟
 *   - 失败响应统一 'Invalid credentials'（防用户名枚举）
 *   - 登录成功重置计数
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/crypto';
import { SESSION_COOKIE_NAME, setSessionCookie, isAccountLocked, recordFailedLogin, resetLoginAttempts } from '@/lib/auth';
import { getClientIp } from '@/lib/request';
import { checkRateLimit, rateLimitResponse } from '@/lib/security';

interface Body {
  username: string;
  password: string;
}

export async function POST(req: NextRequest) {
  // IP 维度限流（防扫描爆破）
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'admin-login', windowMs: 60_000, max: 10 });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = (await req.json()) as Body;
  const username = body.username?.trim();
  const password = body.password ?? '';

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  const user = await prisma.adminUser.findUnique({ where: { username } });
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // 检查锁定
  const lockStatus = await isAccountLocked(user.id, false);
  if (lockStatus.locked) {
    const minutes = Math.ceil((lockStatus.remainingMs ?? 0) / 60_000);
    return NextResponse.json(
      { error: `账号已锁定，请 ${minutes} 分钟后再试` },
      { status: 429 }
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user.id, false);
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // 登录成功，重置失败计数
  await resetLoginAttempts(user.id, false);
  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  const token = await setSessionCookie({
    sub: user.id,
    username: user.username,
    role: user.role,
    type: 'admin',
  });

  const res = NextResponse.json({
    ok: true,
    user: { username: user.username, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

export const dynamic = 'force-dynamic';
