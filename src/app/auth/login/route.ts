/**
 * POST /auth/login — LokiBox 客户端登录（加密链路）
 *
 * 请求体（加密后）：{ username, password, fingerprint }
 * 响应（加密后）：ok({ token, sessionId, sessionKey, features })
 *   - token: JWT，主要认证凭证
 *   - sessionId / sessionKey: 后续加密通信使用的会话标识与 AES-256 密钥
 *   - features: 当前可用的 feature 清单（已过滤 disabled）
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
import { checkUserStatus, getAvailableFeatures } from '@/lib/auth';

interface LoginPayload {
  username: string;
  password: string;
  fingerprint?: string;
}

// 用户状态 reason → fail code 映射
const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

export async function POST(req: NextRequest) {
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

  const user = await prisma.user.findUnique({ where: { username } });

  if (!user) {
    return encryptedJsonResponse(
      fail('INVALID_CREDENTIALS', 'Invalid username or password'),
      req
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
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

  // ── 新增：检查账号状态（封禁 / 到期 / 暂停）──────────
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
    data: {
      lastSeenAt: new Date(),
      fingerprint: fingerprint ?? user.fingerprint,
    },
  });

  // ── 新增：创建 Session（关联 userId）──────────────────
  const sessionKey = generateSessionKey();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      sessionKey,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 天，与 JWT 一致
    },
  });

  const token = await signJwt({
    sub: user.id,
    username: user.username,
    role: user.role,
  });

  // 获取可用 features（已过滤 disabled 的由调用方处理）
  const features = await getAvailableFeatures();

  return encryptedJsonResponse(
    ok({ token, sessionId: session.id, sessionKey, features }, 'Logged in'),
    req
  );
}

export const dynamic = 'force-dynamic';
