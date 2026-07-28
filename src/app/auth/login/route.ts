/**
 * POST /auth/login — LokiBox 客户端登录（加密链路，LokiUser 表）
 *
 * 请求体（加密后）：{ username, password, fingerprint }
 * 响应（加密后）：ok({ token, sessionId, sessionKey, features })
 *   - token: JWT (type='loki')，主要认证凭证
 *   - sessionId / sessionKey: 后续加密通信使用的会话标识与 AES-256 密钥
 *   - features: 当前可用的 feature 清单（已过滤 disabled）
 *
 * 安全：
 *   - 暴力破解防护：连续 5 次失败锁 15 分钟
 *   - 账号状态校验：封禁/到期/暂停拒绝登录
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ok,
  fail,
  verifyPassword,
  signJwt,
  generateSessionKey,
} from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { locateIp } from '@/lib/ip-locate';
import {
  checkUserStatus,
  getAvailableFeatures,
  isAccountLocked,
  recordFailedLogin,
  resetLoginAttempts,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/security';

interface LoginPayload {
  username: string;
  password: string;
  fingerprint?: string;
}

// 用户状态 reason → fail code 映射
const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
};

export async function POST(req: NextRequest) {
  // IP 维度限流（防扫描爆破）
  const clientIp = getClientIp(req);
  const rl = await checkRateLimit(clientIp, { key: 'loki-login', windowMs: 60_000, max: 15 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests, please try again later'),
      req
    );
  }

  const parsed = await parseEncryptedRequest<LoginPayload>(req);

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

  // 查 LokiUser 表
  const user = await prisma.lokiUser.findUnique({ where: { username } });

  if (!user) {
    return encryptedJsonResponse(
      fail('INVALID_CREDENTIALS', 'Invalid username or password'),
      req
    );
  }

  // 检查账号锁定
  const lockStatus = await isAccountLocked(user.id, true);
  if (lockStatus.locked) {
    const minutes = Math.ceil((lockStatus.remainingMs ?? 0) / 60_000);
    return encryptedJsonResponse(
      fail('ACCOUNT_LOCKED', `账号已锁定，请 ${minutes} 分钟后再试`),
      req
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user.id, true);

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
        success: false,
        failureReason: 'WRONG_PASSWORD',
      },
    });

    return encryptedJsonResponse(
      fail('INVALID_CREDENTIALS', 'Invalid username or password'),
      req
    );
  }

  // 检查账号状态（封禁 / 到期 / 暂停）
  const statusCheck = await checkUserStatus(user.id);
  if (!statusCheck.ok) {
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
        success: false,
        failureReason: statusCheck.reason,
      },
    });
    return encryptedJsonResponse(
      fail(
        STATUS_FAIL_CODE[statusCheck.reason] ?? 'ACCOUNT_BANNED',
        statusCheck.message
      ),
      req
    );
  }

  // 登录成功，重置失败计数
  await resetLoginAttempts(user.id, true);

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
    data: {
      lastSeenAt: new Date(),
      fingerprint: fingerprint ?? user.fingerprint,
    },
  });

  // 创建 Session
  const sessionKey = generateSessionKey();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      sessionKey,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // 签发 JWT（type='loki'，绑定设备指纹 + session）
  // sid 字段绑定 session，登出/封禁时吊销 session 即可使 JWT 失效
  const token = await signJwt({
    sub: user.id,
    username: user.username,
    type: 'loki',
    fp: fingerprint,
    sid: session.id,
  });

  const features = await getAvailableFeatures();

  return encryptedJsonResponse(
    ok({ token, sessionId: session.id, sessionKey, features }, 'Logged in'),
    req
  );
}

export const dynamic = 'force-dynamic';
