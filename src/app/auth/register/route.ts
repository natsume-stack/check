/**
 * POST /auth/register — LokiBox 客户端注册（LokiUser 表）
 *
 * 请求体（加密后）：
 *   { username, password, auth?, fingerprint }
 *
 * 响应（加密后）：
 *   ok({ token: <JWT> })  — JWT (type='loki') 作为 Bearer token
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ok,
  fail,
  hashPassword,
  signJwt,
  generateSessionKey,
} from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { locateIp } from '@/lib/ip-locate';
import { checkRateLimit } from '@/lib/security';

interface RegisterPayload {
  username: string;
  password: string;
  auth?: string;       // Box3 平台 Authorization，可选
  fingerprint?: string;
  invitationCode?: string; // 邀请码（必填）
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function POST(req: NextRequest) {
  // IP 维度限流（LokiBox 客户端注册）：1 小时内最多 5 次
  const clientIp = getClientIp(req);
  const rl = await checkRateLimit(clientIp, { key: 'loki-register', windowMs: 3_600_000, max: 5 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many registrations from this IP'),
      req
    );
  }

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

  const { username, password, fingerprint, invitationCode } = payload;

  // 校验
  if (!username || !password) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Missing username or password'),
      req
    );
  }

  // 邀请码校验（必填）
  if (!invitationCode) {
    return encryptedJsonResponse(
      fail('INVITATION_REQUIRED', '邀请码必填'),
      req
    );
  }

  // 验证邀请码
  const invite = await prisma.invitationCode.findUnique({
    where: { code: invitationCode },
  });

  if (!invite) {
    return encryptedJsonResponse(
      fail('INVALID_INVITATION', '邀请码无效'),
      req
    );
  }

  // 检查邀请码状态
  if (invite.disabledAt) {
    return encryptedJsonResponse(
      fail('INVALID_INVITATION', '邀请码已被禁用'),
      req
    );
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return encryptedJsonResponse(
      fail('INVALID_INVITATION', '邀请码已过期'),
      req
    );
  }

  if (invite.usedCount >= invite.maxUses) {
    return encryptedJsonResponse(
      fail('INVALID_INVITATION', '邀请码使用次数已达上限'),
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

  // 重复用户（查 LokiUser 表）
  const exists = await prisma.lokiUser.findUnique({ where: { username } });
  if (exists) {
    return encryptedJsonResponse(
      fail('ALREADY_EXISTS', 'Username already taken'),
      req
    );
  }

  // 创建 LokiUser
  const passwordHash = await hashPassword(password);
  const user = await prisma.lokiUser.create({
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

  await prisma.lokiUser.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  // 增加邀请码使用次数
  await prisma.invitationCode.update({
    where: { id: invite.id },
    data: { usedCount: { increment: 1 } },
  });

  // 创建 Session 并绑定 JWT
  const sessionKey = generateSessionKey();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      sessionKey,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // 签发 JWT（type='loki'，绑定设备指纹 + session）
  const token = await signJwt({
    sub: user.id,
    username: user.username,
    type: 'loki',
    fp: fingerprint,
    sid: session.id,
  });

  return encryptedJsonResponse(ok({ token, sessionId: session.id, sessionKey }, 'Registered'), req);
}

export const dynamic = 'force-dynamic';
