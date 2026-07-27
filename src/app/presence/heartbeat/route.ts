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
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface HeartbeatPayload {
  map_id: string;
  player_id?: number;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<HeartbeatPayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  const mapId = parsed.data?.map_id;
  if (!mapId) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Missing map_id'), req);
  }

  // 更新心跳时间 + 创建 heartbeat 记录
  await prisma.$transaction([
    prisma.user.update({
      where: { id: claims.sub },
      data: { lastSeenAt: new Date() },
    }),
    prisma.heartbeat.create({
      data: {
        userId: claims.sub,
        mapId,
        playerId: parsed.data.player_id ?? null,
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
