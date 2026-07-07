# AWS Research 04: Cognito Session App 認証フロー解説

このドキュメントは、`archive/cognito-session-app/勉強会資料.pdf` と本プロジェクトの実装をもとに、04 の構成が何をしているのかを学習用に詳しく説明するものです。実行手順は [`README.md`](README.md) にまとめ、ここでは Cognito、token、Cookie、API Gateway 認可、Lambda、DynamoDB までの挙動を中心に扱います。

## 課題の意図

勉強会資料の Mission は次の内容です。

- 60 分で自動ログアウトする Web サービスを作る。
- Cognito を利用する。
- DynamoDB にダミーデータを入れる。
- `web (react or nextjs) -> API Gateway -> Lambda -> DynamoDB` の経路にする。
- 認証していないと DynamoDB のデータを取りに行けない。
- session は Cookie に保存する。
- 2 段階認証を入れる。今回はメールのワンタイムパスワード。

資料内の Q1 から Q4 は、単に画面を作ることではなく、次の理解を確認する意図だと読めます。

- Cognito が返す token の種類と役割。
- `accessToken` を `Authorization: Bearer ...` として API に送る理由。
- `accessToken` が盗まれたときの被害をどう小さくするか。
- ブラウザには token をどのような形で保存するか。
- Cookie から session を取り出し、復号し、API に token を付与する流れ。

この実装はその意図に合わせて、Next.js 側で Cognito 認証と暗号化 Cookie session を扱い、AWS 側で API Gateway JWT authorizer、Lambda、DynamoDB を構成しています。

## 全体構成

```text
Browser
  |
  | email / password / email OTP
  v
Next.js app on localhost
  |
  | Cognito SignUp / ConfirmSignUp / InitiateAuth / RespondToAuthChallenge
  v
Cognito User Pool
  |
  | accessToken / idToken
  v
Next.js API route
  |
  | encrypted HTTP-only Cookie: cognito_session_app
  v
Browser
  |
  | GET /api/items with Cookie
  v
Next.js API route
  |
  | Cookie を復号
  | Authorization: Bearer <accessToken>
  v
API Gateway HTTP API
  |
  | JWT authorizer が accessToken を検証
  v
Lambda
  |
  | Scan
  v
DynamoDB
```

Web 画面はローカルの Next.js で動かします。AWS 側には Cognito、API Gateway、Lambda、DynamoDB、IAM role を作ります。つまり、今回の実装は「ローカル Web + AWS バックエンド」です。

本番や外部公開を考える場合は、Next.js API route を維持できる Amplify Hosting などに載せる構成が自然です。ただし、この課題の主眼は Web ホスティングではなく、認証、session、token、API 保護の理解です。

## 主要コンポーネント

| Component | 実装場所 | 役割 |
| --- | --- | --- |
| Next.js page | `app/src/app/page.tsx` | サインアップ、メール確認、サインイン、OTP 入力、DynamoDB 取得の UI。 |
| Auth API routes | `app/src/app/api/auth/*/route.ts` | Cognito API を呼び出し、認証フローを進める。 |
| Session library | `app/src/lib/session.ts` | Cognito token を暗号化 Cookie に保存し、復号する。 |
| Cookie helper | `app/src/lib/cookie.ts` | Cookie の読み取りと `Set-Cookie` 文字列生成。 |
| Items API route | `app/src/app/api/items/route.ts` | Cookie から session を復号し、API Gateway に access token を付けてリクエストする。 |
| Terraform | `infra/terraform/main.tf` | Cognito、API Gateway、Lambda、DynamoDB などの AWS リソースを作る。 |
| Lambda | `infra/terraform/lambda/items_api.py` | DynamoDB の dummy item を読み、API Gateway に JSON を返す。 |

## 用語解説

### Cognito 周辺の名前の違い

Cognito まわりでは似た名前が多く出ますが、指しているものの階層が違います。ざっくり言うと、Cognito はサービス名、User Pool はその中に作るユーザー管理基盤、User Pool Client はアプリ用の接続設定、Cognito API はそれらを操作する入口、Cognito token はログイン成功後に発行される認証結果です。

| 名前 | 何を指すか | この実装での使い方 |
| --- | --- | --- |
| Cognito | AWS の認証サービス全体の名前。 | ユーザー登録、ログイン、メール確認、メール OTP、token 発行に使う。 |
| Cognito User Pool | ユーザーを保存し、認証ルールを持つ場所。 | メールアドレスを username としてユーザーを管理し、MFA を必須にする。 |
| Cognito User Pool Client | アプリが User Pool を使うためのクライアント設定。 | Next.js API route が `COGNITO_CLIENT_ID` を使って User Pool に認証リクエストを送る。 |
| Cognito API | Cognito に対してサインアップ、ログイン、OTP 応答などを実行する API。 | `SignUp`、`ConfirmSignUp`、`InitiateAuth`、`RespondToAuthChallenge` を Next.js API route から呼ぶ。 |
| Cognito token | Cognito の認証が成功した後に返る JWT などの token。 | `accessToken` を API Gateway 認可に使い、`idToken` はユーザー情報用、`refreshToken` は access token(5 分)が切れたときの再発行に使う。 |
| API Gateway Cognito JWT authorizer | API Gateway 側で Cognito token を検証する設定。 | `/items` に来た `Authorization: Bearer <accessToken>` を検証し、正しければ Lambda に通す。 |

このプロジェクトのログイン処理では、Next.js が Cognito API を呼びます。Cognito API は User Pool と User Pool Client の設定に従って認証を行い、成功すると Cognito token を返します。その後、Next.js は `accessToken` を暗号化 Cookie session に保存し、DynamoDB 取得時だけ API Gateway に送ります。

```text
Next.js API route
  -> Cognito API を呼ぶ
  -> Cognito User Pool がユーザーとMFAを確認する
  -> Cognito User Pool Client の設定に従って token を発行する
  -> Next.js が token を Cookie session に保存する
  -> DynamoDB取得時に accessToken を API Gateway に送る
```

### AWS 提供の機能と自分で実装する機能

上の用語のうち、AWS がサービスとして提供しているものと、自分でコードを書いて使えるようにするものは分けて考えます。

| 名前 | AWS 提供か、自分で実装するか | 理由 |
| --- | --- | --- |
| Cognito | AWS 提供 | AWS のマネージド認証サービスそのもの。自分で Cognito を実装するわけではない。 |
| Cognito User Pool | AWS 提供 | Terraform や AWS Console で作る AWS リソース。ユーザー保存、パスワード管理、MFA、token 発行は AWS 側が行う。 |
| Cognito User Pool Client | AWS 提供 | User Pool に紐づく AWS 側の設定。token の有効期限や認証フローを設定する。 |
| Cognito API | AWS 提供 | `SignUp`、`InitiateAuth` などは AWS SDK から呼べる Cognito の API。API 本体は AWS 側にある。 |
| Cognito token | AWS 提供 | ログイン成功時に Cognito が発行する。自分で署名して作るものではない。 |
| API Gateway Cognito JWT authorizer | AWS 提供 | API Gateway の機能。Cognito の公開鍵を使った JWT 検証を AWS 側で行う。 |

一方で、次の部分は自分で実装しています。AWS が自動で作ってくれるわけではありません。

| 自分で実装する部分 | 実装場所 | 役割 |
| --- | --- | --- |
| Cognito API を呼ぶ処理 | `app/src/app/api/auth/*/route.ts` | サインアップ、確認、サインイン、OTP 応答を AWS SDK で呼ぶ。 |
| Cognito client を作る処理 | `app/src/lib/cognito.ts` | `AWS_REGION` と `COGNITO_CLIENT_ID` を使って Cognito API を呼べるようにする。 |
| token をアプリ用 session に変換する処理 | `app/src/lib/session.ts` | Cognito token から `expiresAt` などを持つ session を作る。 |
| token を暗号化 Cookie に保存する処理 | `app/src/lib/session.ts` | AWS が発行した token を、ブラウザに安全に持たせるため AES-256-GCM で暗号化する。 |
| Cookie を復号して API Gateway に送る処理 | `app/src/app/api/items/route.ts` | Cookie から `accessToken` を取り出し、`Authorization: Bearer ...` として API Gateway に送る。 |
| Lambda の処理 | `infra/terraform/lambda/items_api.py` | API Gateway から呼ばれ、DynamoDB の dummy item を読む。 |

つまり、認証基盤そのものは AWS に任せています。ただし、「画面からどのタイミングで Cognito API を呼ぶか」「返ってきた token をどう保存するか」「API Gateway にどう渡すか」はアプリ側で実装する必要があります。

### Cognito User Pool

Cognito User Pool は、ユーザー登録、ログイン、メール確認、MFA、token 発行を担当する AWS の認証基盤です。この実装ではメールアドレスを username として使います。

Terraform では次を設定しています。

- `username_attributes = ["email"]`: メールアドレスでユーザーを識別する。
- `auto_verified_attributes = ["email"]`: メールアドレス確認を使う。
- `mfa_configuration = "ON"`: MFA を必須にする。
- `email_mfa_configuration`: メール OTP の件名と本文を設定する。
- `user_pool_tier = "ESSENTIALS"`: email MFA を使うための tier。

### User Pool Client

User Pool Client は、アプリケーションが Cognito User Pool を使うためのクライアント設定です。Web アプリは `COGNITO_CLIENT_ID` を使って Cognito API を呼びます。

この実装では `generate_secret = false` にしています。ブラウザやフロントエンド寄りのアプリでは client secret を安全に保持しにくいためです。ただし、今回 Cognito API を呼ぶのは Next.js API route、つまりサーバー側です。

### MFA と OTP

MFA は multi-factor authentication、つまり多要素認証です。パスワードだけでなく、もう一つの要素を要求します。今回はメールに届く OTP を使います。

OTP は one-time password の略で、一度だけ使う短いコードです。サインイン時に Cognito がメールでコードを送り、ユーザーが入力したコードを `RespondToAuthChallenge` に渡すことで認証が完了します。

### SES identity

SES は Simple Email Service です。Cognito がメール OTP や確認コードを送るために、送信元メールアドレスを SES の verified identity として登録しています。

SES identity は「このメールアドレスを AWS から送信元として使ってよい」という確認済みの送信元です。これが未確認だと Cognito からメールを送れません。

### JWT

JWT は JSON Web Token の略です。Cognito の `accessToken` や `idToken` は JWT です。JWT は大きく 3 つの部分に分かれます。

```text
header.payload.signature
```

- `header`: 署名アルゴリズムなど。
- `payload`: `sub`、`exp`、`token_use` などの claim。
- `signature`: 改ざんされていないことを検証する署名。

API Gateway JWT authorizer は Cognito の公開鍵を使って signature を検証し、`iss` や `aud` や `exp` などを確認します。

### accessToken

`accessToken` は API を呼ぶための token です。この実装では API Gateway に次の形式で送ります。

```http
Authorization: Bearer <accessToken>
```

API Gateway は JWT authorizer でこの token を検証します。正しい token で、有効期限内で、対象の Cognito User Pool Client 向けに発行されたものなら Lambda にリクエストを通します。

資料の Q2 は、これを curl や Postman で直接試す意図です。

### idToken

`idToken` はユーザーの本人情報を表す token です。メールアドレスなどのユーザー情報を画面表示に使えます。

この実装では session に保存できますが、API Gateway の認可には使いません。API の認可には `accessToken` を使います。

### refreshToken

`refreshToken` は、新しい access token / id token を再発行するための token です。一般的なアプリでは refresh token によってログイン状態を延長します。

この実装では、access token の有効期限を 5 分と短くし、refresh token の有効期限を 60 分にしています。access token が切れると、Next.js の `/api/items` が refresh token を使って `REFRESH_TOKEN_AUTH` で新しい access token を発行し直します。

こうすることで、次の 2 つを両立させています。

- access token が盗まれても、有効なのは最大 5 分だけ。
- ユーザーの session は refresh token の寿命である 60 分まで維持され、60 分で自動ログアウトする。

refresh token 自体は(rotation を有効にしていないため)更新されず、初回ログインから 60 分で失効します。そのため 60 分を過ぎると refresh もできなくなり、そこで session が終わります。

### Cookie session

Cookie はブラウザがサーバーごとに保存する小さなデータです。この実装では `cognito_session_app` という Cookie に、暗号化した session を入れます。

Cookie の中身には次が含まれます。

- `accessToken`
- `idToken`
- `refreshToken`
- `email`
- `username`
- `expiresAt`（session 全体の期限。refresh token に合わせて 60 分）
- `tokenExpiresAt`（access token の期限。5 分）

ただし、そのまま JSON を入れるのではなく、AES-256-GCM で暗号化して保存します。refresh token も同じ暗号化 Cookie の中に含めるため、HTTP-only Cookie の外に漏れません。

### HTTP-only Cookie

HTTP-only Cookie は、JavaScript の `document.cookie` から読めない Cookie です。XSS でページ上の JavaScript が実行されたとしても、Cookie の値を直接盗みにくくなります。

この実装では Cookie に次の属性を付けます。

```text
HttpOnly
SameSite=Lax
Path=/
Max-Age=3600
```

ローカル開発では HTTP なので `Secure` は付けません。本番 HTTPS では `SESSION_COOKIE_SECURE=true` にして `Secure` を付けます。

### AES-256-GCM

AES-256-GCM は暗号化方式の一つです。暗号化と改ざん検知を同時にできます。GCM は認証付き暗号なので、Cookie の中身が改ざんされると復号に失敗します。

この実装では `SESSION_SECRET` を SHA-256 で 32 byte key にし、session JSON を暗号化します。

Cookie の値は次の形式です。

```text
v1.<iv>.<tag>.<ciphertext>
```

- `iv`: 暗号化ごとに生成するランダム値。
- `tag`: 改ざん検知に使う認証タグ。
- `ciphertext`: 暗号化された session JSON。

## 認証の流れ

### 1. サインアップ

画面でメールアドレスとパスワードを入力し、「サインアップ」を押します。

```text
Browser
  -> POST /api/auth/signup
  -> Next.js API route
  -> Cognito SignUp
```

実装:

- `app/src/app/page.tsx`
- `app/src/app/api/auth/signup/route.ts`

Next.js API route は `SignUpCommand` を呼びます。

```text
Username = email
Password = password
UserAttributes.email = email
```

Cognito はユーザーを作成し、メール確認コードを送ります。この時点のユーザーは `UNCONFIRMED` です。

### 2. メール確認

ユーザーがメールに届いた確認コードを入力し、「メール確認」を押します。

```text
Browser
  -> POST /api/auth/confirm
  -> Next.js API route
  -> Cognito ConfirmSignUp
```

実装:

- `app/src/app/api/auth/confirm/route.ts`

確認に成功すると、Cognito のユーザー状態は `CONFIRMED` になります。すでに `CONFIRMED` のユーザーに対して確認コードを送った場合は、「すでに確認済み」として扱うようにしています。

### 3. サインイン

メールアドレスとパスワードを入力して「サインイン」を押します。

```text
Browser
  -> POST /api/auth/signin
  -> Next.js API route
  -> Cognito InitiateAuth
```

実装:

- `app/src/app/api/auth/signin/route.ts`

Next.js は Cognito に `USER_PASSWORD_AUTH` を送ります。

```text
AuthFlow = USER_PASSWORD_AUTH
USERNAME = email
PASSWORD = password
```

MFA が有効なので、Cognito はすぐに token を返さず、`EMAIL_OTP` challenge を返します。画面は「メール OTP コード」を入力する状態になります。

### 4. メール OTP

ユーザーがメールに届いた OTP を入力し、「OTP送信」を押します。

```text
Browser
  -> POST /api/auth/respond
  -> Next.js API route
  -> Cognito RespondToAuthChallenge
```

実装:

- `app/src/app/api/auth/respond/route.ts`

Next.js は Cognito に次を送ります。

```text
ChallengeName = EMAIL_OTP
USERNAME = email
EMAIL_OTP_CODE = 入力されたコード
Session = signin 時に Cognito が返した一時 session
```

OTP が正しければ Cognito は `AuthenticationResult` を返します。ここに `accessToken`、`idToken`、`expiresIn` などが入っています。

### 5. Cookie session 作成

Cognito 認証が完了すると、Next.js は Cognito token からアプリ用 session を作ります。

```text
AuthenticationResult
  -> AppSession
  -> AES-256-GCM で暗号化
  -> Set-Cookie: cognito_session_app=...
```

実装:

- `app/src/lib/cognito.ts`
- `app/src/lib/session.ts`
- `app/src/lib/cookie.ts`

`createAppSession` は session 全体の期限(`expiresAt`)を refresh token の寿命に合わせます。

```text
expiresAt      = now + SESSION_MAX_AGE_SECONDS(60 分)
tokenExpiresAt = access token の期限(約 5 分)
```

`expiresAt` は session がいつ終わるか、`tokenExpiresAt` は access token をいつ refresh すべきかを表します。`SESSION_MAX_AGE_SECONDS`(3600 秒)は Cognito の refresh token 有効期限 60 分に合わせています。

Cookie は `HttpOnly` なので、ブラウザの JavaScript から直接読めません。ただし、同じ origin への HTTP request にはブラウザが自動で Cookie を付けます。

## DynamoDB データ取得の流れ

### 1. 画面から `/api/items` を呼ぶ

ログイン後に「DynamoDB取得」を押すと、ブラウザは Next.js の API route にリクエストします。

```text
Browser
  -> GET /api/items
```

このときブラウザは `cognito_session_app` Cookie を自動的に送ります。

### 2. Next.js が Cookie を復号する

実装:

- `app/src/app/api/items/route.ts`
- `app/src/lib/session.ts`

Next.js は request header の Cookie から `cognito_session_app` を取り出し、`unsealSession` で復号します。

復号に失敗する場合:

- Cookie が無い。
- Cookie が改ざんされている。
- `SESSION_SECRET` が違う。
- `expiresAt` を過ぎている。

この場合、Next.js は `401` を返し、Cookie を削除します。

### 3. access token が切れていれば refresh する

Cookie を復号したあと、Next.js は access token の期限(`tokenExpiresAt`)を確認します。すでに切れている、または切れる直前(30 秒前)であれば、session 内の refresh token を使って Cognito に `REFRESH_TOKEN_AUTH` を送り、新しい access token / id token を受け取ります。

```text
Next.js API route (/api/items)
  -> tokenExpiresAt を確認
  -> 期限が近い場合: Cognito InitiateAuth (REFRESH_TOKEN_AUTH)
  -> 新しい accessToken / idToken を受け取る
  -> session を更新して暗号化 Cookie を再発行 (Set-Cookie)
```

このとき session 全体の期限(`expiresAt`)は据え置くため、refresh を繰り返しても session の寿命は初回ログインから 60 分のまま延びません。refresh token が失効している(60 分経過など)場合は refresh に失敗し、`401` を返して Cookie を削除します。

実装:

- `app/src/app/api/items/route.ts`
- `app/src/lib/cognito.ts` の `refreshTokens`
- `app/src/lib/session.ts` の `refreshAppSession`

### 4. Next.js が API Gateway に accessToken を送る

Cookie の復号(および必要なら refresh)に成功した場合、Next.js は session 内の `accessToken` を API Gateway に送ります。

```http
GET /items
Authorization: Bearer <accessToken>
```

ここが資料 Q4 の「Cookie から取り出して、復号して、API に付与して送る」の部分です。

### 5. API Gateway JWT authorizer が token を検証する

Terraform では API Gateway HTTP API に JWT authorizer を設定しています。

```hcl
jwt_configuration {
  audience = [aws_cognito_user_pool_client.web.id]
  issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}
```

API Gateway は次を確認します。

- token の署名が Cognito の公開鍵で検証できる。
- `iss` が対象 User Pool の issuer と一致する。
- `aud` または client id が対象 User Pool Client と一致する。
- `exp` が切れていない。

検証に失敗すると Lambda には届かず、API Gateway が `401 Unauthorized` を返します。

### 6. Lambda が DynamoDB を読む

JWT authorizer を通過した場合だけ Lambda が呼ばれます。

実装:

- `infra/terraform/lambda/items_api.py`

Lambda は DynamoDB table を `scan` し、dummy item を返します。同時に、API Gateway authorizer が渡した JWT claim から `sub`、`username`、`email`、`token_use` を返します。

これにより、どの Cognito ユーザーとして API を呼べたのかが確認できます。

## 5 分 access token と 60 分ログアウトの設計

この実装では「access token は短命(5 分)、session は 60 分」を、access token と refresh token の期限差で実現しています。

### Cognito token の期限

Terraform の User Pool Client で token 期限を設定しています。

```hcl
access_token_validity  = 5
id_token_validity      = 5
refresh_token_validity = 60
```

`token_validity_units` は minutes です。access token / id token は 5 分、refresh token は 60 分です。5 分と 60 分は、それぞれ Cognito が許可する access token / refresh token の最小値でもあります。

### access token の refresh

access token は 5 分で切れますが、Next.js の `/api/items` が session 内の refresh token を使って自動更新します。そのため、ユーザーは 5 分ごとに再ログインする必要はなく、DynamoDB 取得を続けられます。

一方で、API Gateway に送る access token は常に 5 分以内に発行されたものになるため、盗まれた access token は最大 5 分で失効します。

### Cookie session の期限

Next.js 側では `.env.local` の `SESSION_MAX_AGE_SECONDS=3600` を使います。これは refresh token の有効期限 60 分に合わせた値で、session 全体の期限(`expiresAt`)になります。Cookie の `Max-Age` も session の残り時間に合わせます。

さらに `unsealSession` は復号後に `expiresAt` を確認します。Cookie が残っていても、期限を過ぎた session は無効です。

```text
Date.now() >= session.expiresAt -> unauthenticated
```

### なぜ 60 分でログアウトになるか

refresh token 自体は(rotation を有効にしていないため)更新されず、初回ログインから 60 分で失効します。60 分を過ぎると、access token を refresh しようとしても Cognito が拒否するため、`/api/items` は `401` を返して Cookie を削除します。アプリ側の `expiresAt` も 60 分なので、どちらの層でも 60 分で session が終わります。

この判断により、60 分後には再ログインが必要になります。

## accessToken が盗まれた場合の被害を小さくする対策

資料 Q2 は「accessToken が盗聴されても最小限に抑える対策」を考えさせるものです。この実装で取っている対策は次です。

### 1. accessToken の有効期限を短くする

`accessToken` は 5 分で失効します。盗まれても、5 分経てば API Gateway が `401` を返します。session を 60 分維持するのは refresh token であり、盗まれた access token を延命するわけではありません。

資料の例でも、期限切れ token を curl で送ると `401 Unauthorized` になります。access token を画面に表示してすぐ curl で送れば `200`、5 分待ってから送れば `401` になり、被害が 5 分に限定されることを確認できます。

### 2. token を JavaScript から直接読めない Cookie に入れる

Cookie は `HttpOnly` です。そのため、通常の JavaScript から `cognito_session_app` の値を読めません。

```js
document.cookie.includes("cognito_session_app")
```

これが `false` になることを確認します。

### 3. Cookie の中身を暗号化する

Cookie に access token を平文では保存していません。AES-256-GCM で暗号化しています。Cookie を見ても access token はそのまま読めません。

### 4. API Gateway 側でも token を検証する

Next.js が API Gateway に token を送っても、API Gateway が Cognito JWT authorizer で検証します。無効な token、期限切れ token、別の User Pool / Client 向け token は拒否されます。

### 5. HTTPS 前提にする

ローカル開発は `http://localhost:3000` ですが、ネットワーク公開する場合は HTTPS が前提です。本番では `SESSION_COOKIE_SECURE=true` にして、Cookie に `Secure` を付けます。これにより Cookie は HTTPS 通信でのみ送信されます。

## 資料の質問への対応

### Q1: token の種類と設計理由

この実装で意識している token は 3 つです。

| Token | 使い道 | この実装での扱い |
| --- | --- | --- |
| `accessToken` | API Gateway に送って API 認可に使う。 | 有効期限 5 分。Cookie session 内に暗号化保存し、API Gateway への `Authorization` header に付ける。 |
| `idToken` | ユーザー情報の確認に使う。 | 有効期限 5 分。Cookie session 内に保存可能。API 認可には使わない。 |
| `refreshToken` | token 更新に使う。 | 有効期限 60 分。暗号化 Cookie に保存し、access token が切れたら `/api/items` で access token を再発行する。 |

access token を 5 分に短くしつつ 60 分の session を維持するには、refresh token による自動更新と、Cookie session の期限設計の両方が必要です。access token の期限だけを 60 分にすると、盗まれた token が 60 分使えてしまいます。

### Q2: accessToken を取り出して API を直接叩く

通常は token を画面に出しません。学習用に `.env.local` で `ENABLE_TOKEN_DEBUG=true` にしたときだけ、`/api/debug/access-token` で access token を表示できます。

その token を使って次のように API Gateway を直接叩けます。

```bash
TOKEN='画面に表示されたaccess token'
API_URL=$(terraform -chdir=../infra/terraform output -raw api_endpoint)
curl -i "${API_URL}/items" -H "Authorization: Bearer ${TOKEN}"
```

有効な token なら `200`、期限切れや不正な token なら `401` です。

### Q3: ブラウザはどんな形で保存しているか

ブラウザには `cognito_session_app` という Cookie として保存しています。ただし、中身は平文ではなく暗号化済みです。さらに `HttpOnly` なので JavaScript から直接読めません。

保存形式:

```text
Set-Cookie: cognito_session_app=v1.<iv>.<tag>.<ciphertext>; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax
```

### Q4: データ取得までの流れ

流れは次です。

```text
Browser
  -> Cookie 付きで Next.js /api/items を呼ぶ
  -> Next.js が Cookie を取得
  -> AES-256-GCM で Cookie を復号
  -> session から accessToken を取り出す
  -> API Gateway /items に Authorization: Bearer <accessToken> を付けて送る
  -> API Gateway JWT authorizer が token を検証
  -> Lambda が DynamoDB を読む
  -> 画面に item を表示
```

## 未認証時と期限切れ時の挙動

### Cookie が無い場合

`GET /api/items` は Cookie を復号できないため `401` を返します。画面では `Not authenticated.` のようなエラーになります。

### Cookie が改ざんされた場合

AES-GCM の認証タグ検証に失敗し、復号できません。そのため未認証扱いで `401` になります。

### Cookie の期限が切れた場合

Cookie の `Max-Age` が切れるとブラウザは Cookie を送らなくなります。また、Cookie が残っていても session 内の `expiresAt` を過ぎていれば `unsealSession` が失敗します。

### accessToken の期限が切れた場合

Next.js から API Gateway に token を送っても、API Gateway JWT authorizer が `exp` を見て拒否します。この場合も `401` です。Next.js は API Gateway から `401` が返った場合、Cookie を削除します。

## なぜ API Gateway に Cognito authorizer を置くのか

Next.js 側で Cookie を復号しているので、Next.js だけで認可できそうに見えます。しかし API Gateway 側にも authorizer を置くことで、次の利点があります。

- API Gateway を直接 curl で叩かれても token なしなら拒否できる。
- Next.js にバグがあっても、API Gateway 側で Cognito token を検証できる。
- Lambda は認証済み request だけを前提に実装できる。
- API の保護境界が AWS 側にもできる。

資料の `curl -i ".../items" -H "Authorization: Bearer ..."` は、まさに API Gateway が token を検証していることを確認するための操作です。

## この実装の前提と限界

### ローカル実行前提

現在の Web は `http://localhost:3000` で動きます。API Gateway の CORS も `http://localhost:3000` を許可しています。

ネットワークに公開する場合は、少なくとも次が必要です。

- Next.js を Amplify Hosting などに載せる。
- `SESSION_COOKIE_SECURE=true` にする。
- API Gateway の CORS に公開 URL を追加する。
- `.env.local` 相当の環境変数を hosting 側に設定する。

### XSS を完全に防ぐものではない

HTTP-only Cookie は JavaScript から token を直接盗むことを難しくします。ただし、XSS があるとユーザーのブラウザから正規の request を送られる可能性はあります。HTTP-only は重要ですが、それだけで XSS 対策が完了するわけではありません。

### CSRF への考慮

Cookie はブラウザが自動送信するため、CSRF を考える必要があります。この実装では `SameSite=Lax` にしています。今回の `/api/items` は読み取り GET なので影響は限定的ですが、更新系 API を作る場合は CSRF token や Origin 検証も検討します。

### refresh の設計

access token を 5 分に短くしたため、refresh token による自動更新を入れています。refresh token 自体は更新しない(rotation 無効)ので、初回ログインから 60 分で必ず失効し、ユーザー体験としては 60 分後に再ログインが必要です。これは課題の「60 分で自動ログアウト」を保ちつつ、access token の被害範囲を 5 分に抑える設計です。

refresh token rotation を有効にすれば、refresh のたびに refresh token も更新されて session を 60 分以上延長できますが、今回は 60 分ログアウトを維持するためあえて有効にしていません。

## どこを読むと理解しやすいか

最初に読む順番は次がおすすめです。

1. `infra/terraform/main.tf`
   - Cognito、API Gateway、Lambda、DynamoDB の全体像を見る。
2. `app/src/app/api/auth/signin/route.ts`
   - パスワード認証後に `EMAIL_OTP` challenge が返る流れを見る。
3. `app/src/app/api/auth/respond/route.ts`
   - OTP を Cognito に送って token を受け取る流れを見る。
4. `app/src/lib/session.ts`
   - token を暗号化 Cookie に入れる仕組みを見る。
5. `app/src/app/api/items/route.ts`
   - Cookie から access token を取り出して API Gateway に送る流れを見る。
6. `infra/terraform/lambda/items_api.py`
   - 認証後に Lambda が DynamoDB を読む処理を見る。

## まとめ

この実装の中心は、Cognito が発行する `accessToken` を API 認可に使い、その token をブラウザには暗号化 HTTP-only Cookie として保持することです。ブラウザは token を直接扱わず、Next.js API route が Cookie を復号して API Gateway に `Authorization: Bearer <accessToken>` を付けて送ります。

API Gateway は Cognito JWT authorizer で token を検証し、正しい token だけを Lambda に通します。Lambda は DynamoDB の dummy data を返します。access token の期限を 5 分と短くして被害範囲を抑えつつ、refresh token(60 分)で自動更新することで、60 分で自動ログアウトする挙動を作っています。
