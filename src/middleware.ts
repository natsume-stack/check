import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = ['/', '/login', '/register'];
const PUBLIC_PREFIXES = ['/api/auth/login', '/api/auth/register', '/api/auth/me'];

// LokiBox 加密 API 路径前缀（运行在 Box3 游戏页 origin，需要 CORS）
// 注意：用 startsWith 匹配，所以前缀不带尾斜杠也能命中 /friends 和 /friends/xxx
const LOKIBOX_API_PREFIXES = [
  '/session',
  '/auth',
  '/user',
  '/presence',
  '/friends',
  '/users/search',
];

// 允许的 LokiBox 客户端 origin（Box3 游戏平台）
const ALLOWED_ORIGINS = [
  'https://view.dao3.fun',
  'https://dao3.fun',
  'https://play.dao3.fun',
  'https://www.dao3.fun',
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

  try {
    await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    return NextResponse.next();
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
