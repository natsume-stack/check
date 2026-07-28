/**
 * POST /presence/heartbeat — 心跳上报
 *   { map_id, player_id? }
 * GET /presence/map/[id] — 获取同地图在线玩家
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { checkRateLimit } from '@/lib/security';
import { getLokiBoxUser, checkUserStatus, validateFingerprint } from '@/lib/auth';

interface HeartbeatPayload {
  map_id: string;
  player_id?: number;
}

// 用戶狀態 reason → fail code 映射
const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'presence-hb', windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest<HeartbeatPayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  // 设备指纹验证
  const fpValid = await validateFingerprint(claims.sub, claims.fp);
  if (!fpValid) {
    return encryptedJsonResponse(
      fail('DEVICE_MISMATCH', 'Device fingerprint mismatch, please re-login'),
      req
    );
  }

  // 檢查賬號狀態 — 封禁/到期/暫停的用戶不能發送心跳
  const statusCheck = await checkUserStatus(claims.sub);
  if (!statusCheck.ok) {
    // 吊銷當前 session
    if (parsed.sessionId) {
      await prisma.session.update({
        where: { id: parsed.sessionId },
        data: {
          revokedAt: new Date(),
          revokedReason: statusCheck.reason,
        },
      }).catch(() => {});
    }

    return encryptedJsonResponse(
      fail(
        STATUS_FAIL_CODE[statusCheck.reason] ?? 'ACCOUNT_BANNED',
        statusCheck.message
      ),
      req
    );
  }

  const mapId = parsed.data?.map_id;
  if (!mapId) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Missing map_id'), req);
  }

  // 更新心跳时间 + 创建 heartbeat 记录
  await prisma.$transaction([
    prisma.lokiUser.update({
      where: { id: claims.sub },
      data: { lastSeenAt: new Date() },
    }),
    prisma.heartbeat.create({
      data: {
        userId: claims.sub,
        mapId,
        playerId: parsed.data?.player_id ?? null,
      },
    }),
  ]);

  // 清理过期心跳（>5min）
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const recent = await prisma.heartbeat.findMany({
    where: { mapId, createdAt: { gt: cutoff } },
    distinct: ['userId'],
    include: {
      user: {
        select: { username: true, nickname: true },
      },
    },
  });

  return encryptedJsonResponse(
    ok({
      players: recent
        .filter(h => h.userId !== claims.sub)
        .map(h => ({
          username: h.user.username,
          nickname: h.user.nickname,
          player_id: h.playerId,
        })),
    }),
    req
  );
}

export const dynamic = 'force-dynamic';
