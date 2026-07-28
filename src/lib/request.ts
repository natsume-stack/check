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

const ALLOWED_ORIGINS = [
  'https://view.dao3.fun',
  'https://dao3.fun',
  'https://play.dao3.fun',
  'https://www.dao3.fun',
  'https://check.cdk.lat',
];

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-TimeStamp, X-Nonce, X-IV, X-Session-Id',
      // 关键：暴露 X-Iv 给 JavaScript，否则跨域时 resp.headers.get('X-Iv') 返回 null
      'Access-Control-Expose-Headers': 'X-Iv, X-Session-Id',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }
  return {};
}

/** 用与请求相同的 sessionKey 加密响应体 */
export async function encryptedJsonResponse(
  payload: unknown,
  req: NextRequest
): Promise<NextResponse> {
  const sessionId = req.headers.get('X-Session-Id') ?? undefined;
  const cors = corsHeaders(req);

  // 优先用 sessionKey 加密响应
  // 注意：不能依赖 X-IV 头判断是否有 session，因为 GET 请求无请求体时不会发送 X-IV
  if (sessionId) {
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
          ...cors,
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
      ...cors,
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
