/** POST /friends/delete — 删除好友 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface DeletePayload {
  target_username: string;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<DeletePayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  const targetUsername = parsed.data?.target_username?.trim();
  if (!targetUsername) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'target_username required'), req);
  }

  await prisma.$transaction([
    prisma.friend.deleteMany({
      where: {
        userId: claims.sub,
        other: { username: targetUsername },
      },
    }),
    prisma.friend.deleteMany({
      where: {
        otherId: claims.sub,
        user: { username: targetUsername },
      },
    }),
  ]);

  return encryptedJsonResponse(ok({ username: targetUsername }, 'Removed'), req);
}

export const dynamic = 'force-dynamic';
