import { NextResponse } from "next/server";
import { getCookie } from "@/lib/cookie";
import { requireEnv } from "@/lib/env";
import { clearSessionCookie, SESSION_COOKIE_NAME, unsealSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rawCookie = getCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const session = unsealSession(rawCookie);

  if (!session) {
    const response = NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
    response.headers.set("set-cookie", clearSessionCookie());
    response.headers.set("cache-control", "no-store");
    return response;
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
  }

  return response;
}
