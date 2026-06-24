"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type PublicSession = {
  authenticated: boolean;
  email?: string;
  username?: string;
  expiresAt?: number;
  tokenExpiresAt?: number;
  secondsRemaining?: number;
};

type Item = {
  id: string;
  title: string;
  description: string;
  status: string;
};

type Message = {
  kind: "info" | "error";
  text: string;
};

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [challengeSession, setChallengeSession] = useState("");
  const [challengeName, setChallengeName] = useState("");
  const [session, setSession] = useState<PublicSession>({ authenticated: false });
  const [items, setItems] = useState<Item[]>([]);
  const [caller, setCaller] = useState<Record<string, string | undefined> | undefined>();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<Message>({ kind: "info", text: "未ログインです。" });
  const [loading, setLoading] = useState(false);

  const sessionExpiresAt = useMemo(() => formatDateTime(session.expiresAt), [session.expiresAt]);
  const tokenExpiresAt = useMemo(() => formatDateTime(session.tokenExpiresAt), [session.tokenExpiresAt]);

  useEffect(() => {
    void refreshSession();
  }, []);

  async function refreshSession() {
    const data = await requestJson<PublicSession>("/api/session");
    setSession(data);
    if (data.authenticated) {
      setMessage({ kind: "info", text: "ログイン済みです。DynamoDB のデータを取得できます。" });
    }
  }

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const data = await requestJson<{ message?: string }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setMessage({ kind: "info", text: data.message ?? "確認コードを送信しました。" });
    });
  }

  async function confirmSignUp() {
    await run(async () => {
      const data = await requestJson<{ message?: string }>("/api/auth/confirm", {
        method: "POST",
        body: JSON.stringify({ email, code: confirmCode })
      });
      setMessage({ kind: "info", text: data.message ?? "メール確認が完了しました。" });
    });
  }

  async function resendConfirmCode() {
    await run(async () => {
      const data = await requestJson<{ message?: string }>("/api/auth/resend", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setMessage({ kind: "info", text: data.message ?? "確認コードを再送しました。" });
    });
  }

  async function signIn() {
    await run(async () => {
      const data = await requestJson<{
        nextStep?: string;
        message?: string;
        session?: string;
        challengeName?: string;
      }>("/api/auth/signin", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      if (data.nextStep === "emailOtp" && data.session && data.challengeName) {
        setChallengeSession(data.session);
        setChallengeName(data.challengeName);
        setMessage({ kind: "info", text: data.message ?? "メールOTPを入力してください。" });
        return;
      }

      await refreshSession();
      setMessage({ kind: "info", text: "ログインしました。" });
    });
  }

  async function respondToOtp() {
    await run(async () => {
      await requestJson("/api/auth/respond", {
        method: "POST",
        body: JSON.stringify({
          email,
          code: otpCode,
          session: challengeSession,
          challengeName
        })
      });
      setOtpCode("");
      setChallengeSession("");
      setChallengeName("");
      await refreshSession();
      setMessage({ kind: "info", text: "メールOTP認証が完了しました。" });
    });
  }

  async function fetchItems() {
    await run(async () => {
      const data = await requestJson<{
        items: Item[];
        caller?: Record<string, string | undefined>;
      }>("/api/items");
      setItems(data.items);
      setCaller(data.caller);
      setMessage({ kind: "info", text: `${data.items.length}件のデータを取得しました。` });
    });
  }

  async function showToken() {
    await run(async () => {
      const data = await requestJson<{ accessToken: string }>("/api/debug/access-token");
      setToken(data.accessToken);
      setMessage({ kind: "info", text: "開発確認用 access token を取得しました。" });
    });
  }

  async function logout() {
    await run(async () => {
      await requestJson("/api/auth/logout", { method: "POST" });
      setItems([]);
      setCaller(undefined);
      setToken("");
      await refreshSession();
      setMessage({ kind: "info", text: "ログアウトしました。" });
    });
  }

  async function run(action: () => Promise<void>) {
    setLoading(true);
    try {
      await action();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "エラーが発生しました。" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <div className="workspace">
        <section className="panel">
          <div className="header">
            <p className="eyebrow">AWS Research 04</p>
            <h1>Cognito Session App</h1>
            <p className="muted">Cognito メールOTP MFA と 60分 Cookie セッション</p>
          </div>

          <form className="stack" onSubmit={signUp}>
            <label className="field">
              <span>メールアドレス</span>
              <input
                autoComplete="email"
                inputMode="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>パスワード</span>
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="actions">
              <button className="button" disabled={loading} type="submit">
                サインアップ
              </button>
              <button className="button secondary" disabled={loading} type="button" onClick={signIn}>
                サインイン
              </button>
            </div>
          </form>

          <div className="stack" style={{ marginTop: 18 }}>
            <label className="field">
              <span>サインアップ確認コード</span>
              <input value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} />
            </label>
            <button className="button secondary" disabled={loading} type="button" onClick={confirmSignUp}>
              メール確認
            </button>
            <button className="button secondary" disabled={loading} type="button" onClick={resendConfirmCode}>
              確認コード再送
            </button>
          </div>

          <div className="stack" style={{ marginTop: 18 }}>
            <label className="field">
              <span>メールOTPコード</span>
              <input value={otpCode} onChange={(event) => setOtpCode(event.target.value)} />
            </label>
            <button
              className="button secondary"
              disabled={loading || !challengeSession}
              type="button"
              onClick={respondToOtp}
            >
              OTP送信
            </button>
          </div>
        </section>

        <section className="stack">
          <div className="panel stack">
            <h2>セッション</h2>
            <div className="session-grid">
              <div className="metric">
                <span>状態</span>
                {session.authenticated ? "認証済み" : "未認証"}
              </div>
              <div className="metric">
                <span>残り秒数</span>
                {session.secondsRemaining ?? "-"}
              </div>
              <div className="metric">
                <span>Cookie期限</span>
                {sessionExpiresAt}
              </div>
              <div className="metric">
                <span>Access token期限</span>
                {tokenExpiresAt}
              </div>
            </div>
            <div className={`status ${message.kind === "error" ? "error" : ""}`}>{message.text}</div>
            <div className="actions">
              <button className="button" disabled={loading || !session.authenticated} type="button" onClick={fetchItems}>
                DynamoDB取得
              </button>
              <button className="button secondary" disabled={loading || !session.authenticated} type="button" onClick={showToken}>
                access token表示
              </button>
              <button className="button secondary" disabled={loading || !session.authenticated} type="button" onClick={logout}>
                ログアウト
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>DynamoDB items</h2>
            {caller ? (
              <p className="muted">
                caller: {caller.email ?? caller.username ?? caller.sub ?? "-"} / token_use: {caller.token_use ?? "-"}
              </p>
            ) : null}
            <div className="items">
              {items.length === 0 ? (
                <p className="muted">まだ取得していません。</p>
              ) : (
                items.map((item) => (
                  <article className="item" key={item.id}>
                    <h3>{item.title}</h3>
                    <p className="muted">{item.description}</p>
                  </article>
                ))
              )}
            </div>
          </div>

          {token ? (
            <div className="panel">
              <h2>Debug access token</h2>
              <div className="token-box">{token}</div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");

  const response = await fetch(url, {
    ...init,
    headers
  });
  const data = (await response.json()) as T & { message?: string; code?: string };

  if (!response.ok) {
    throw new Error(data.message ?? data.code ?? `HTTP ${response.status}`);
  }

  return data;
}

function formatDateTime(value: number | undefined): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}
