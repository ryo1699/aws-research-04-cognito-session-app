import { NextResponse } from "next/server";
import { getCookie } from "@/lib/cookie";
import { requireEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME, unsealSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (process.env.ENABLE_TOKEN_DEBUG !== "true") {
    return NextResponse.json({ ok: false, message: "Token debug API is disabled." }, { status: 404 });
  }

  const rawCookie = getCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const session = unsealSession(rawCookie);
  if (!session) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: true,
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      tokenExpiresAt: session.tokenExpiresAt,
      apiUrl: `${requireEnv("BACKEND_API_URL").replace(/\/+$/g, "")}/items`
    },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
