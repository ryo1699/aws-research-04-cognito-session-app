import { NextResponse } from "next/server";
import { RespondToAuthChallengeCommand } from "@aws-sdk/client-cognito-identity-provider";
import {
  authError,
  authenticatedResponse,
  challengeCodeParameter,
  cognitoClientId,
  getCognitoClient
} from "@/lib/cognito";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { email, code, session, challengeName } = (await request.json()) as {
      email?: string;
      code?: string;
      session?: string;
      challengeName?: string;
    };

    if (!email || !code || !session || !challengeName) {
      return NextResponse.json(
        { ok: false, message: "email, code, session, and challengeName are required." },
        { status: 400 }
      );
    }

    const codeParameter = challengeCodeParameter(challengeName);
    const result = await getCognitoClient().send(
      new RespondToAuthChallengeCommand({
        ClientId: cognitoClientId(),
        ChallengeName: challengeName as "EMAIL_OTP" | "EMAIL_MFA",
        Session: session,
        ChallengeResponses: {
          USERNAME: email,
          [codeParameter]: code
        }
      })
    );

    if (!result.AuthenticationResult) {
      return NextResponse.json({ ok: false, message: "Cognito did not return tokens." }, { status: 502 });
    }

    return authenticatedResponse(result.AuthenticationResult, email);
  } catch (error) {
    return NextResponse.json({ ok: false, ...authError(error) }, { status: 400 });
  }
}
