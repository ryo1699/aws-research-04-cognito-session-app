import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cognito Session App",
  description: "Cognito email OTP MFA and encrypted cookie session sample."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
