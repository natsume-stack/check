/**
 * POST /auth/login — LokiBox 客户端登录（加密链路）
 *
 * 请求体（加密后）：{ username, password, fingerprint }
 * 响应（加密后）：ok({ token: <JWT> })
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ok,
  fail,
  verifyPassword,
  signJwt,
} from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { locateIp } from '@/lib/ip-locate';

interface LoginPayload {
  username: string;
  password: string;
  fingerprint?: string;
}

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
      },
    });
    return encryptedJsonResponse(
      fail('INVALID_CREDENTIALS', 'Invalid username or password'),
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

  const token = await signJwt({
    sub: user.id,
    username: user.username,
    role: user.role,
  });

  return encryptedJsonResponse(ok({ token }, 'Logged in'), req);
}

export const dynamic = 'force-dynamic';
