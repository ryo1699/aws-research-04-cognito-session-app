import { NextResponse } from "next/server";
import { InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import {
  authError,
  authenticatedResponse,
  cognitoClientId,
  getCognitoClient
} from "@/lib/cognito";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { email, password } = (await request.json()) as { email?: string; password?: string };
    if (!email || !password) {
      return NextResponse.json({ ok: false, message: "email and password are required." }, { status: 400 });
    }

    const result = await getCognitoClient().send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: cognitoClientId(),
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password
        }
      })
    );

    if (result.ChallengeName) {
      if (result.ChallengeName !== "EMAIL_OTP" && result.ChallengeName !== "EMAIL_MFA") {
        return NextResponse.json(
          {
            ok: false,
            nextStep: "unsupportedChallenge",
            challengeName: result.ChallengeName,
            message: `Unsupported Cognito challenge: ${result.ChallengeName}`
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        ok: true,
        nextStep: "emailOtp",
        challengeName: result.ChallengeName,
        session: result.Session,
        message: "One-time code sent by email."
      });
    }

    if (!result.AuthenticationResult) {
      return NextResponse.json({ ok: false, message: "Cognito did not return tokens." }, { status: 502 });
    }

    return authenticatedResponse(result.AuthenticationResult, email);
  } catch (error) {
    return NextResponse.json({ ok: false, ...authError(error) }, { status: 400 });
  }
}
