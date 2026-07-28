/**
 * POST /loader/heartbeat — 心跳上报（每 60s 调用一次）
 *
 * 请求体（加密后）：{ map_id, player_id?, code_hash }
 * 响应（加密后）：ok({ status: 'OK' })
 *
 * 状态不 ok 时：
 *   - 吊销当前 session
 *   - 返回 fail('ACCOUNT_BANNED' | 'ACCOUNT_EXPIRED' | 'ACCOUNT_SUSPENDED')
 *   - 客户端收到后应立即退出
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
  code_hash: string;
}

// 用户状态 reason → fail code 映射
const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'loader-hb', windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest<HeartbeatPayload>(req);

  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid or expired timestamp'),
      req
    );
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(
      fail('UNAUTHORIZED', 'Not authenticated'),
      req
    );
  }

  // 设备指纹验证
  const fpValid = await validateFingerprint(claims.sub, claims.fp);
  if (!fpValid) {
    return encryptedJsonResponse(
      fail('DEVICE_MISMATCH', 'Device fingerprint mismatch, please re-login'),
      req
    );
  }

  const payload = parsed.data;
  if (!payload?.map_id) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Missing map_id'),
      req
    );
  }

  // 強制要求 code_hash — 不報告 code_hash 的客戶端視為篡改
  if (!payload.code_hash) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Missing code_hash'),
      req
    );
  }

  // 检查账号状态
  const statusCheck = await checkUserStatus(claims.sub);
  if (!statusCheck.ok) {
    // 吊销当前 session
    if (parsed.sessionId) {
      await prisma.session.update({
        where: { id: parsed.sessionId },
        data: {
          revokedAt: new Date(),
          revokedReason: statusCheck.reason,
        },
      }).catch(() => {
        // session 可能已被吊销或不存在，忽略错误
      });
    }

    return encryptedJsonResponse(
      fail(
        STATUS_FAIL_CODE[statusCheck.reason] ?? 'ACCOUNT_BANNED',
        statusCheck.message
      ),
      req
    );
  }

  // 完整性校驗：客戶端上報的 code_hash 必須與服務端 Session 中記錄的一致
  // 防止客戶端篡改代碼包後繼續心跳
  if (parsed.sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: parsed.sessionId },
      select: { codeHash: true, revokedAt: true },
    }).catch(() => null);

    // 如果 session 有 codeHash 但客戶端報告的不一致，說明篡改
    if (session?.codeHash && session.codeHash !== payload.code_hash) {
      // codeHash 不匹配，说明客户端篡改了代码包
      await prisma.session.update({
        where: { id: parsed.sessionId },
        data: {
          revokedAt: new Date(),
          revokedReason: 'INTEGRITY_FAIL',
        },
      }).catch(() => {});

      await prisma.auditLog.create({
        data: {
          actorId: null, // LokiUser 不是 AdminUser，actorId 留空
          action: 'INTEGRITY_FAIL',
          target: parsed.sessionId,
          meta: {
            lokiUserId: claims.sub,
            lokiUsername: claims.username,
            expected: session.codeHash,
            reported: payload.code_hash,
          },
        },
      }).catch(() => {});

      return encryptedJsonResponse(
        fail('INTEGRITY_FAIL', 'Code hash mismatch, session revoked'),
        req
      );
    }
  }

  // 状态 ok：更新心跳时间 + 创建 heartbeat 记录
  await prisma.$transaction([
    prisma.lokiUser.update({
      where: { id: claims.sub },
      data: { lastSeenAt: new Date() },
    }),
    prisma.heartbeat.create({
      data: {
        userId: claims.sub,
        mapId: payload.map_id,
        playerId: payload.player_id ?? null,
        codeHash: payload.code_hash ?? null,
      },
    }),
  ]);

  return encryptedJsonResponse(
    ok({ status: 'OK' }),
    req
  );
}

export const dynamic = 'force-dynamic';
