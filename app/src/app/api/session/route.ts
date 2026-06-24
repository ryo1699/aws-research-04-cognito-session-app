import { NextResponse } from "next/server";
import { getCookie } from "@/lib/cookie";
import { SESSION_COOKIE_NAME, toPublicSession, unsealSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rawCookie = getCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const session = unsealSession(rawCookie);
  return NextResponse.json(toPublicSession(session), {
    headers: {
      "cache-control": "no-store"
    }
  });
}
