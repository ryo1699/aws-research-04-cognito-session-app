import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { optionalNumberEnv, requireEnv } from "@/lib/env";
import { serializeCookie } from "@/lib/cookie";

export const SESSION_COOKIE_NAME = "cognito_session_app";

const aad = Buffer.from("aws-research-04-cognito-session-app:v1");

export type AppSession = {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  email?: string;
  username?: string;
  expiresAt: number;
  tokenExpiresAt?: number;
};

export type PublicSession = {
  authenticated: boolean;
  email?: string;
  username?: string;
  expiresAt?: number;
  tokenExpiresAt?: number;
  secondsRemaining?: number;
};

export function sessionMaxAgeSeconds(): number {
  return optionalNumberEnv("SESSION_MAX_AGE_SECONDS", 3600);
}

export function makeSessionCookie(value: string, maxAgeSeconds?: number): string {
  return serializeCookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "Lax",
    path: "/",
    maxAge: maxAgeSeconds ?? sessionMaxAgeSeconds()
  });
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "Lax",
    path: "/",
    maxAge: 0
  });
}

export function sealSession(session: AppSession): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", b64url(iv), b64url(tag), b64url(ciphertext)].join(".");
}

export function unsealSession(value: string | undefined): AppSession | undefined {
  if (!value) {
    return undefined;
  }

  const [version, ivPart, tagPart, ciphertextPart] = value.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) {
    return undefined;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), fromB64url(ivPart));
    decipher.setAAD(aad);
    decipher.setAuthTag(fromB64url(tagPart));
    const plaintext = Buffer.concat([
      decipher.update(fromB64url(ciphertextPart)),
      decipher.final()
    ]);
    const session = JSON.parse(plaintext.toString("utf8")) as AppSession;

    if (!session.accessToken || !session.expiresAt || Date.now() >= session.expiresAt) {
      return undefined;
    }

    return session;
  } catch {
    return undefined;
  }
}

export function toPublicSession(session: AppSession | undefined): PublicSession {
  if (!session) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    email: session.email,
    username: session.username,
    expiresAt: session.expiresAt,
    tokenExpiresAt: session.tokenExpiresAt,
    secondsRemaining: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))
  };
}

export function createAppSession(params: {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  email?: string;
  username?: string;
}): AppSession {
  const now = Date.now();
  const tokenExpiresAt =
    params.expiresIn && params.expiresIn > 0 ? now + params.expiresIn * 1000 : jwtExpiresAt(params.accessToken);
  // セッション全体の寿命は refresh token の有効期限(SESSION_MAX_AGE_SECONDS = 60分)に紐づける。
  // access token の期限(tokenExpiresAt, 約5分)はこれとは別に管理し、期限が来たら refresh で更新する。
  const expiresAt = now + sessionMaxAgeSeconds() * 1000;

  return {
    accessToken: params.accessToken,
    idToken: params.idToken,
    refreshToken: params.refreshToken,
    email: params.email ?? jwtClaim(params.idToken, "email") ?? jwtClaim(params.accessToken, "email"),
    username: params.username ?? jwtClaim(params.accessToken, "username"),
    expiresAt,
    tokenExpiresAt
  };
}

// refresh token で access token / id token を更新した結果を、既存セッションに反映する。
// セッション全体の寿命(expiresAt)と refresh token は据え置き、access token 側だけを差し替える。
export function refreshAppSession(
  previous: AppSession,
  params: { accessToken: string; idToken?: string; expiresIn?: number }
): AppSession {
  const now = Date.now();
  const tokenExpiresAt =
    params.expiresIn && params.expiresIn > 0 ? now + params.expiresIn * 1000 : jwtExpiresAt(params.accessToken);

  return {
    ...previous,
    accessToken: params.accessToken,
    idToken: params.idToken ?? previous.idToken,
    tokenExpiresAt
  };
}

// セッションの残り寿命(秒)。refresh 時に Cookie の Max-Age をセッション期限に合わせるために使う。
export function sessionRemainingSeconds(session: AppSession): number {
  return Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(requireEnv("SESSION_SECRET"), "utf8").digest();
}

function secureCookie(): boolean {
  return process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
}

function b64url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

function jwtClaim(token: string | undefined, claim: string): string | undefined {
  const payload = jwtPayload(token);
  const value = payload?.[claim];
  return typeof value === "string" ? value : undefined;
}

function jwtExpiresAt(token: string | undefined): number | undefined {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
}

function jwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) {
    return undefined;
  }

  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    return JSON.parse(fromB64url(payload).toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
