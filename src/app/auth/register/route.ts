/**
 * POST /auth/register — LokiBox 客户端注册
 *
 * 请求体（加密后）：
 *   { username, password, auth?, fingerprint }
 *
 * 响应（加密后）：
 *   ok({ token: <JWT> })  — JWT 同时作为 LokiBox 的 Bearer token
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ok,
  fail,
  hashPassword,
  signJwt,
  type ApiResponse,
} from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { locateIp } from '@/lib/ip-locate';

interface RegisterPayload {
  username: string;
  password: string;
  auth?: string;       // Box3 平台 Authorization，可选
  fingerprint?: string;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<RegisterPayload>(req);

  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid or expired timestamp'),
      req
    );
  }

  const payload = parsed.data;
  if (!payload) {
    return encryptedJsonResponse(
      fail('INVALID_ENCRYPTION', 'Failed to decrypt payload'),
      req
    );
  }

  const { username, password, fingerprint } = payload;

  // 校验
  if (!username || !password) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Missing username or password'),
      req
    );
  }
  if (!USERNAME_RE.test(username)) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid username format'),
      req
    );
  }
  if (password.length < 8 || password.length > 72) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Password must be 8-72 chars'),
      req
    );
  }

  // 重复用户
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    return encryptedJsonResponse(
      fail('ALREADY_EXISTS', 'Username already taken'),
      req
    );
  }

  // 创建用户
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      nickname: username,
      fingerprint: fingerprint ?? null,
    },
  });

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
      fingerprint: fingerprint ?? null,
      userAgent: req.headers.get('user-agent') ?? '',
      success: true,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  // 签发 JWT
  const token = await signJwt({
    sub: user.id,
    username: user.username,
    role: user.role,
  });

  return encryptedJsonResponse(ok({ token }, 'Registered'), req);
}

export const dynamic = 'force-dynamic';
