import { NextResponse } from "next/server";
import { SignUpCommand } from "@aws-sdk/client-cognito-identity-provider";
import { authError, cognitoClientId, getCognitoClient } from "@/lib/cognito";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { email, password } = (await request.json()) as { email?: string; password?: string };
    if (!email || !password) {
      return NextResponse.json({ ok: false, message: "email and password are required." }, { status: 400 });
    }

    await getCognitoClient().send(
      new SignUpCommand({
        ClientId: cognitoClientId(),
        Username: email,
        Password: password,
        UserAttributes: [{ Name: "email", Value: email }]
      })
    );

    return NextResponse.json({
      ok: true,
      nextStep: "confirmSignUp",
      message: "Verification code sent by email."
    });
  } catch (error) {
    return NextResponse.json({ ok: false, ...authError(error) }, { status: 400 });
  }
}
