/**
 * 请求工具 — 提取真实 IP、解析加密请求、统一响应格式
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  decryptPayload,
  encryptPayload,
  getBootstrapKey,
  importSessionKey,
  verifyTimestamp,
} from './crypto';
import { prisma } from './prisma';

// ─── 真实 IP 提取（穿过 Vercel 代理）──────────────

export function getClientIp(req: NextRequest): string {
  const headers = req.headers;
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = headers.get('x-real-ip');
  if (real) return real;
  return '127.0.0.1';
}

// ─── 加密请求解析 ──────────────────────────────────

export interface ParsedEncryptedRequest<T> {
  data: T | null;
  sessionId?: string;
  authToken?: string;
  timestamp: number;
  nonce: string;
  iv?: string;
  rawBody: string;
  replayValid: boolean;
}

/** 解析 LokiBox 兼容的加密请求 */
export async function parseEncryptedRequest<T = unknown>(
  req: NextRequest
): Promise<ParsedEncryptedRequest<T>> {
  const timestamp = Number(req.headers.get('X-TimeStamp') ?? '0');
  const nonce = req.headers.get('X-Nonce') ?? '';
  const iv = req.headers.get('X-IV') ?? undefined;
  const sessionId = req.headers.get('X-Session-Id') ?? undefined;
  const authHeader = req.headers.get('Authorization') ?? '';
  const authToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  const replayValid = !!timestamp && verifyTimestamp(timestamp);
  const rawBody = await req.text();

  let data: T | null = null;
  if (iv && rawBody && replayValid) {
    let key = await getBootstrapKey();

    if (sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (session && session.expiresAt > new Date() && !session.revokedAt) {
        key = await importSessionKey(session.sessionKey);
      }
    }

    try {
      data = await decryptPayload<T>({ iv, data: rawBody }, key);
    } catch {
      data = null;
    }
  }

  return {
    data,
    sessionId,
    authToken,
    timestamp,
    nonce,
    iv,
    rawBody,
    replayValid,
  };
}

// ─── 加密响应 ──────────────────────────────────────

/** 用与请求相同的 sessionKey 加密响应体 */
export async function encryptedJsonResponse(
  payload: unknown,
  req: NextRequest
): Promise<NextResponse> {
  const sessionId = req.headers.get('X-Session-Id') ?? undefined;
  const iv = req.headers.get('X-IV') ?? undefined;

  // 优先用 sessionKey 加密响应
  if (sessionId && iv) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (session && session.expiresAt > new Date() && !session.revokedAt) {
      const key = await importSessionKey(session.sessionKey);
      const encrypted = await encryptPayload(payload, key);
      return new NextResponse(encrypted.data, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'X-Iv': encrypted.iv,
        },
      });
    }
  }

  // 否则用 BootstrapKey 加密
  const bsKey = await getBootstrapKey();
  const encrypted = await encryptPayload(payload, bsKey);
  return new NextResponse(encrypted.data, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'X-Iv': encrypted.iv,
    },
  });
}

// ─── 普通响应（管理后台用）────────────────────────

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
