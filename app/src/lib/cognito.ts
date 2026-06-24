import {
  CognitoIdentityProviderClient,
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

export function challengeCodeParameter(challengeName: string): "EMAIL_OTP_CODE" | "EMAIL_MFA_CODE" {
  return challengeName === "EMAIL_MFA" ? "EMAIL_MFA_CODE" : "EMAIL_OTP_CODE";
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
  });
}
