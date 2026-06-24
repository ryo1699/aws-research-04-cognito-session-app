import { NextResponse } from "next/server";
import { ConfirmSignUpCommand } from "@aws-sdk/client-cognito-identity-provider";
import { authError, cognitoClientId, getCognitoClient } from "@/lib/cognito";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { email, code } = (await request.json()) as { email?: string; code?: string };
    if (!email || !code) {
      return NextResponse.json({ ok: false, message: "email and code are required." }, { status: 400 });
    }

    await getCognitoClient().send(
      new ConfirmSignUpCommand({
        ClientId: cognitoClientId(),
        Username: email,
        ConfirmationCode: code
      })
    );

    return NextResponse.json({
      ok: true,
      nextStep: "signIn",
      message: "Email confirmed. Sign in with the same email and password."
    });
  } catch (error) {
    return NextResponse.json({ ok: false, ...authError(error) }, { status: 400 });
  }
}
