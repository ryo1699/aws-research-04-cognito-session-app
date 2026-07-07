import { NextResponse } from "next/server";
import { getCookie } from "@/lib/cookie";
import { requireEnv } from "@/lib/env";
import { refreshTokens } from "@/lib/cognito";
import {
  clearSessionCookie,
  makeSessionCookie,
  refreshAppSession,
  sealSession,
  SESSION_COOKIE_NAME,
  sessionRemainingSeconds,
  unsealSession,
  type AppSession
} from "@/lib/session";

export const runtime = "nodejs";

// access token の期限がこの秒数以内に迫っていたら、事前に refresh する。
const REFRESH_BUFFER_MS = 30_000;

export async function GET(request: Request) {
  const rawCookie = getCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  let session = unsealSession(rawCookie);

  if (!session) {
    const response = NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
    response.headers.set("set-cookie", clearSessionCookie());
    response.headers.set("cache-control", "no-store");
    return response;
  }

  // access token が(直前を含め)期限切れなら refresh token で更新する。
  // 更新できた場合は新しい access token を Cookie に再封入する。
  let refreshedCookie: string | undefined;
  if (accessTokenExpiring(session)) {
    if (!session.refreshToken) {
      return unauthenticated();
    }

    try {
      const auth = await refreshTokens(session.refreshToken);
      session = refreshAppSession(session, {
        accessToken: auth.AccessToken as string,
        idToken: auth.IdToken,
        expiresIn: auth.ExpiresIn
      });
      // Cookie の Max-Age はセッション全体の残り寿命(最長でも初回ログインから 60 分)に合わせる。
      refreshedCookie = makeSessionCookie(sealSession(session), sessionRemainingSeconds(session));
    } catch {
      // refresh token 失効・失効済みなど。セッションを終了させる。
      return unauthenticated();
    }
  }

  const backendUrl = `${requireEnv("BACKEND_API_URL").replace(/\/+$/g, "")}/items`;
  const backendResponse = await fetch(backendUrl, {
    headers: {
      authorization: `Bearer ${session.accessToken}`
    },
    cache: "no-store"
  });

  const body = await backendResponse.text();
  const response = new Response(body, {
    status: backendResponse.status,
    headers: {
      "content-type": backendResponse.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store"
    }
  });

  if (backendResponse.status === 401) {
    response.headers.set("set-cookie", clearSessionCookie());
  } else if (refreshedCookie) {
    response.headers.set("set-cookie", refreshedCookie);
  }

  return response;
}

function accessTokenExpiring(session: AppSession): boolean {
  return session.tokenExpiresAt !== undefined && Date.now() >= session.tokenExpiresAt - REFRESH_BUFFER_MS;
}

function unauthenticated(): Response {
  const response = NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  response.headers.set("set-cookie", clearSessionCookie());
  response.headers.set("cache-control", "no-store");
  return response;
}
