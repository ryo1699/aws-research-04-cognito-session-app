import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  type AuthenticationResultType
} from "@aws-sdk/client-cognito-identity-provider";
import { requireEnv } from "@/lib/env";
import { createAppSession, makeSessionCookie, sealSession, toPublicSession } from "@/lib/session";

let client: CognitoIdentityProviderClient | undefined;

export function getCognitoClient(): CognitoIdentityProviderClient {
  client ??= new CognitoIdentityProviderClient({ region: requireEnv("AWS_REGION") });
  return client;
}

export function cognitoClientId(): string {
  return requireEnv("COGNITO_CLIENT_ID");
}

export function challengeCodeParameter(challengeName: string): "EMAIL_OTP_CODE" {
  if (challengeName !== "EMAIL_OTP") {
    throw new Error(`Unsupported Cognito challenge: ${challengeName}`);
  }
  return "EMAIL_OTP_CODE";
}

// refresh token を使って access token / id token を再発行する。
// REFRESH_TOKEN_AUTH は MFA challenge を再要求せず、期限内であれば直接トークンを返す。
// refresh token 自体は(rotation 無効時)更新されず、初回ログインから 60 分で失効する。
export async function refreshTokens(refreshToken: string): Promise<AuthenticationResultType> {
  const result = await getCognitoClient().send(
    new InitiateAuthCommand({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: cognitoClientId(),
      AuthParameters: {
        REFRESH_TOKEN: refreshToken
      }
    })
  );

  if (!result.AuthenticationResult?.AccessToken) {
    throw new Error("Cognito did not return a refreshed access token.");
  }

  return result.AuthenticationResult;
}

export function authError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return { message: error.message, code: error.name };
  }
  return { message: "Unexpected error" };
}

export function authenticatedResponse(auth: AuthenticationResultType, email?: string): Response {
  if (!auth.AccessToken) {
    throw new Error("Cognito did not return an access token.");
  }

  const appSession = createAppSession({
    accessToken: auth.AccessToken,
    idToken: auth.IdToken,
    refreshToken: auth.RefreshToken,
    expiresIn: auth.ExpiresIn,
    email
  });
  const sealed = sealSession(appSession);
  const headers = new Headers();
  headers.set("set-cookie", makeSessionCookie(sealed));
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json");
  headers.set("x-session-expires-at", String(appSession.expiresAt));
  headers.set("x-token-expires-at", String(appSession.tokenExpiresAt ?? ""));

  return new Response(
    JSON.stringify({
      ok: true,
      nextStep: "authenticated",
      session: toPublicSession(appSession)
    }),
    {
      status: 200,
      headers
    }
  );
}
