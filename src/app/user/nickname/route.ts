import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface NicknamePayload {
  nickname: string;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<NicknamePayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  const nickname = parsed.data?.nickname?.trim();
  if (!nickname || nickname.length > 20) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid nickname'), req);
  }

  await prisma.user.update({
    where: { id: claims.sub },
    data: { nickname },
  });

  return encryptedJsonResponse(ok(null, 'Nickname updated'), req);
}

export const dynamic = 'force-dynamic';
