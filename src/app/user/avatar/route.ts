import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { getLokiBoxUser, validateFingerprint, checkUserStatus } from '@/lib/auth';
import { checkRateLimit } from '@/lib/security';

const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

interface AvatarPayload {
  avatar_url: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'user-avatar', windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest<AvatarPayload>(req);
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

  // 账号状态检查
  const statusCheck = await checkUserStatus(claims.sub);
  if (!statusCheck.ok) {
    return encryptedJsonResponse(
      fail(STATUS_FAIL_CODE[statusCheck.reason] ?? 'ACCOUNT_BANNED', statusCheck.message),
      req
    );
  }

  const url = parsed.data?.avatar_url;
  if (!url || url.length > 500) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid avatar url'), req);
  }

  // 协议白名单 + 域名白名单 — 只允许 https + 已知图片域名
  // 防止 javascript:/data: XSS，以及恶意域名的 SSRF/钓鱼
  const ALLOWED_AVATAR_DOMAINS = new Set([
    'static.dao3.fun',      // 官方图片托管
    'i.imgur.com',          // 常用图床
    'cdn.discordapp.com',   // Discord CDN
  ]);
  
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'https:') {
      return encryptedJsonResponse(
        fail('VALIDATION_ERROR', 'Avatar URL must use HTTPS protocol'),
        req
      );
    }
    // 域名白名单检查
    const hostname = urlObj.hostname.toLowerCase();
    if (!ALLOWED_AVATAR_DOMAINS.has(hostname)) {
      return encryptedJsonResponse(
        fail('VALIDATION_ERROR', 'Avatar URL domain not allowed. Use static.dao3.fun'),
        req
      );
    }
    // 阻止 SVG（可含 <script>）
    if (urlObj.pathname.toLowerCase().endsWith('.svg')) {
      return encryptedJsonResponse(
        fail('VALIDATION_ERROR', 'SVG avatars are not allowed'),
        req
      );
    }
    // 阻止 URL 中的潜在 XSS 向量
    if (/[<>"'`]/.test(urlObj.pathname)) {
      return encryptedJsonResponse(
        fail('VALIDATION_ERROR', 'Invalid characters in avatar URL'),
        req
      );
    }
  } catch {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid avatar URL format'),
      req
    );
  }

  await prisma.lokiUser.update({
    where: { id: claims.sub },
    data: { avatarUrl: url },
  });

  return encryptedJsonResponse(ok(null, 'Avatar updated'), req);
}

export const dynamic = 'force-dynamic';
