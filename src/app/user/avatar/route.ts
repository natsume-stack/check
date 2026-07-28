import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface AvatarPayload {
  avatar_url: string;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<AvatarPayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  const url = parsed.data?.avatar_url;
  if (!url || url.length > 500) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid avatar url'), req);
  }

  await prisma.lokiUser.update({
    where: { id: claims.sub },
    data: { avatarUrl: url },
  });

  return encryptedJsonResponse(ok(null, 'Avatar updated'), req);
}

export const dynamic = 'force-dynamic';
