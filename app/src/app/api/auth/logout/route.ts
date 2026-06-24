import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true, authenticated: false });
  response.headers.set("set-cookie", clearSessionCookie());
  response.headers.set("cache-control", "no-store");
  return response;
}
