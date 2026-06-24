import { NextResponse } from "next/server";
import { ResendConfirmationCodeCommand } from "@aws-sdk/client-cognito-identity-provider";
import { authError, cognitoClientId, getCognitoClient } from "@/lib/cognito";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { email } = (await request.json()) as { email?: string };
    if (!email) {
      return NextResponse.json({ ok: false, message: "email is required." }, { status: 400 });
    }

    await getCognitoClient().send(
      new ResendConfirmationCodeCommand({
        ClientId: cognitoClientId(),
        Username: email
      })
    );

    return NextResponse.json({
      ok: true,
      message: "Verification code resent by email."
    });
  } catch (error) {
    return NextResponse.json({ ok: false, ...authError(error) }, { status: 400 });
  }
}
