import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = ['/', '/login', '/register'];
const PUBLIC_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/me',
  '/api/health', // 保活探针，公开访问
  '/admin/pack', // Bearer token 鉴权，不走 cookie
];

// LokiBox 加密 API 路径前缀（运行在 Box3 游戏页 origin，需要 CORS）
const LOKIBOX_API_PREFIXES = [
  '/session',
  '/auth',
  '/user',
  '/presence',
  '/friends',
  '/loader',
  '/pack',
  '/users/search',
];

// 允许的 LokiBox 客户端 origin（Box3 游戏平台）
const ALLOWED_ORIGINS = [
  'https://view.dao3.fun',
  'https://dao3.fun',
  'https://play.dao3.fun',
  'https://www.dao3.fun',
  'https://check.cdk.lat',
];

// ─── 基于角色的路径访问控制 ───────────────────────────
//
// USER        → 仅 /（仪表盘）+ /api/admin/stats
// AGENT       → + /users, /api/admin/users/*
// SUPER_ADMIN → + /programs, /api/admin/programs/*, /api/admin/code-packages/*
//
// 注意：middleware 仅做粗粒度拦截，API 内部仍需用 requireAgent/requireSuperAdmin
// 做深度防御（防中间件绕过）。

const USER_ALLOWED_PREFIXES = ['/', '/api/admin/stats'];

const AGENT_ONLY_PREFIXES = [
  '/users',
  '/api/admin/users',
];

const SUPER_ADMIN_ONLY_PREFIXES = [
  '/programs',
  '/api/admin/programs',
  '/api/admin/code-packages',
];

function getAllowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return null;
}

function getJwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) return new Uint8Array();
  return new TextEncoder().encode(s);
}

function hasAccess(role: string | undefined, pathname: string): boolean {
  if (role === 'SUPER_ADMIN') return true;

  if (role === 'AGENT') {
    if (SUPER_ADMIN_ONLY_PREFIXES.some(p => pathname.startsWith(p))) return false;
    return true;
  }

  if (role === 'USER') {
    // 仅允许 USER_ALLOWED_PREFIXES
    if (AGENT_ONLY_PREFIXES.some(p => pathname.startsWith(p))) return false;
    if (SUPER_ADMIN_ONLY_PREFIXES.some(p => pathname.startsWith(p))) return false;
    // 其他路径（如 /）允许
    return true;
  }

  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLokiBoxApi = LOKIBOX_API_PREFIXES.some(p => pathname.startsWith(p));

  // LokiBox 加密 API：只处理 OPTIONS preflight（CORS 实际头由路由处理器注入）
  // 不对正常请求返回 NextResponse.next()，避免覆盖路由响应头（如 X-Iv）
  if (isLokiBoxApi) {
    if (req.method === 'OPTIONS') {
      const origin = getAllowedOrigin(req);
      if (origin) {
        return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-TimeStamp, X-Nonce, X-IV, X-Session-Id',
          'Access-Control-Expose-Headers': 'X-Iv, X-Session-Id',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
      }
      return new NextResponse(null, { status: 204 });
    }
    // 正常请求直接放行，CORS 响应头由 encryptedJsonResponse 注入
    return NextResponse.next();
  }

  // 公开路径放行
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // 静态资源放行
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  // 检查管理后台 Cookie
  const token = req.cookies.get('check_session')?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  let role: string | undefined;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    role = payload.role as string | undefined;
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 按角色限制路径访问（防越权直访 URL）
  if (!hasAccess(role, pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
