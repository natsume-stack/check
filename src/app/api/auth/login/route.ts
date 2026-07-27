/**
 * POST /api/auth/login — 管理后台登录（明文 JSON，非加密链路）
 *
 * Body: { username, password }
 * 返回：设置 HttpOnly Cookie，返回 { ok: true, user: { username, role } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/crypto';
import { locateIp } from '@/lib/ip-locate';
import { SESSION_COOKIE_NAME, setSessionCookie } from '@/lib/auth';
import { getClientIp } from '@/lib/request';

interface Body {
  username: string;
  password: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const username = body.username?.trim();
  const password = body.password ?? '';

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // 记录登录
  const ip = getClientIp(req);
  const geo = await locateIp(ip);
  await prisma.loginRecord.create({
    data: {
      userId: user.id,
      ip,
      country: geo?.country,
      region: geo?.region,
      city: geo?.city,
      latitude: geo?.latitude,
      longitude: geo?.longitude,
      accuracyKm: geo?.accuracyKm,
      asn: geo?.asn,
      org: geo?.org,
      timezone: geo?.timezone,
      userAgent: req.headers.get('user-agent') ?? '',
      success: true,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  const token = await setSessionCookie({
    sub: user.id,
    username: user.username,
    role: user.role,
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
    maxAge: 7 * 24 * 60 * 60, // 7 天
  });
  return res;
}

export const dynamic = 'force-dynamic';
