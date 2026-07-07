# AWS Research 04: 勉強会 Q1〜Q4 回答と実演手順

このドキュメントは、勉強会資料（`archive/cognito-session-app/勉強会資料.pdf`）の Q1〜Q4 に対する回答と、手を動かす必要がある部分（accessToken を直接叩く、Cookie を確認する）の具体的手順をまとめたものです。

- 認証フローの詳細な仕組みは [`AUTH_FLOW_README.md`](AUTH_FLOW_README.md) を参照。
- 環境構築（Terraform / Next.js 起動）の手順は [`README.md`](README.md) を参照。
- Next.js サーバーの仕組みと token のやり取り（ログイン時 / `/api/items` 呼び出し時）を図解したページ: https://claude.ai/code/artifact/39913611-870a-48fa-8927-142443609ac9

## 前提

手を動かす系（Q2 の curl / Postman、Q3・Q4 の確認）は、次が済んでいることが前提です。

- `terraform apply` 済み（Cognito / API Gateway / Lambda / DynamoDB が存在する）。
- `npm run dev` 起動済みで `http://localhost:3000` が開ける。
- 画面でサインアップ → メール確認 → サインイン → メール OTP まで完了できる。

まだの場合は [`README.md`](README.md) の「Terraform」→「Next.js アプリ」を先に実行します。

---

## Q1: token の種類とその設計理由

**問いの意図**（ヒント「accessToken だけじゃない」「60 分を設計するにはここを考える」）: 3 種類の token の役割と、access token を短命にしつつ 60 分自動ログアウトを成立させるための期限設計を説明する。**手を動かす必要はなく、説明できれば OK。**

Cognito がログイン成功時に返す token は 3 つです（[`respond/route.ts`](app/src/app/api/auth/respond/route.ts) の `AuthenticationResult`）。

| token | 役割 | この実装での扱い | 期限 |
| --- | --- | --- | --- |
| `accessToken` | API の認可。API Gateway に `Authorization: Bearer` で送る | 暗号化 Cookie に保存し、`/api/items` 経由で API Gateway に付与 | 5 分 |
| `idToken` | ユーザーの本人情報（email 等）。画面表示用 | Cookie に保存可。**API 認可には使わない** | 5 分 |
| `refreshToken` | accessToken / idToken を再発行してログインを延長する | 暗号化 Cookie に保存し、access token が切れたら `/api/items` で更新 | 60 分 |

### 設計理由（答えの核心）

ねらいは「access token が盗まれても被害を最小化しつつ、session は 60 分維持する」ことです。この 2 つを両立させるため、access token と refresh token で期限差をつけています。

- [`main.tf`](infra/terraform/main.tf) の User Pool Client:
  - `access_token_validity = 5`（分）→ 盗まれた access token は最大 5 分で失効。
  - `id_token_validity = 5`
  - `refresh_token_validity = 60` → session 全体の寿命。
- **access token が切れたら refresh token で自動更新**（[`items/route.ts`](app/src/app/api/items/route.ts) → [`cognito.ts`](app/src/lib/cognito.ts) の `refreshTokens`）。5 分ごとの再ログインは不要。
- **refresh token rotation は無効**なので refresh token 自体は更新されず、初回ログインから 60 分で失効 → そこで自動ログアウト。
- **Cookie session 側にも期限**（`SESSION_MAX_AGE_SECONDS=3600`）。[`session.ts`](app/src/lib/session.ts) の `createAppSession` で `expiresAt = now + 60 分`（refresh token に合わせる）とし、`tokenExpiresAt`（access token, 5 分）とは別管理。refresh を繰り返しても `expiresAt` は延ばさないので 60 分で必ず切れる。

まとめると「access token は 5 分に短くして被害範囲を絞り、refresh token（60 分）で延命しつつ、その refresh token と Cookie session の期限で 60 分ログアウトを成立させる」のが Q1 の設計理由です。

---

## Q2: accessToken を取り出して curl / Postman で直接叩く ＋ 盗聴対策

Q2 は 2 部構成です。① 実際に token を取り出して API を直接叩く、② 盗聴されても被害を最小化する対策を答える。

### 事前準備: デバッグ用 token 表示を有効化

通常は token を画面に出しません。学習時だけ有効にします。[`app`](app) の `.env.local` を編集します。

```env
ENABLE_TOKEN_DEBUG=true
```

環境変数は再起動で反映されます。`npm run dev` のターミナルで `Ctrl + C` → 再度 `npm run dev`。

その後 `http://localhost:3000` でサインイン → メール OTP まで完了しておきます。

デバッグ API（[`/api/debug/access-token`](app/src/app/api/debug/access-token/route.ts)）は `accessToken` に加えて、叩くべき完全な URL（`apiUrl`）も返します。

### ①-A: curl で叩く

`projects/aws-research-04-cognito-session-app/app` ディレクトリで、`npm run dev` とは別のターミナルを開いて実行します。

**token 有効パターン（200 になる）:**

```bash
TOKEN='画面の「access token表示」でコピーしたaccess token'
API_URL=$(terraform -chdir=../infra/terraform output -raw api_endpoint)
curl -i "${API_URL}/items" -H "Authorization: Bearer ${TOKEN}"
```

- 有効な token → `HTTP/2 200` ＋ `{"items":[...],"caller":{...}}`。
- access token の期限 5 分を過ぎた後や改ざん token → `HTTP/2 401` ＋ `error="invalid_token" ... the token has expired`（資料の例と同じ）。表示直後は `200`、5 分待つと `401` になり、盗まれても最大 5 分しか使えないことを確認できる。

**token 無しパターン（401 になる ＝ 認可が効いている証拠）:**

```bash
curl -i "${API_URL}/items"
```

→ `401 Unauthorized`。API Gateway の Cognito JWT authorizer が、token が無いと Lambda に通さないことを確認できます。

### ①-B: Postman で叩く

**Step 1. accessToken と apiUrl を取得**

- 方法 A（簡単）: 画面の「access token表示」ボタンを押し、表示された `accessToken` をコピー。
- 方法 B（Postman だけで完結）: `GET http://localhost:3000/api/debug/access-token` を叩き、レスポンス JSON の `accessToken` と `apiUrl` をコピー。ただしこの API はログイン Cookie 前提なので、後述の「Cookie の渡し方」でブラウザと同じ Cookie を渡す必要があります。

**Step 2. API Gateway へのリクエストを作る**

1. 新規リクエスト → メソッド `GET`。
2. URL: Step 1 の `apiUrl`（例 `https://xxxx.execute-api.ap-northeast-1.amazonaws.com/items`）。
   - 控えていない場合は `{api_endpoint}/items`。`api_endpoint` は `terraform -chdir=infra/terraform output -raw api_endpoint` で確認。
3. **Authorization** タブを開く。
4. **Auth Type** で `Bearer Token` を選ぶ。
5. **Token** 欄に Step 1 の `accessToken`（`eyJ...`）を貼る。
   - `Bearer ` の文字は付けない。Postman が自動で `Authorization: Bearer <token>` を組み立てる（curl の `-H "Authorization: Bearer ..."` と等価）。
6. **Send**。

**Step 3. 結果を確認**

- 有効な token → `200 OK` ＋ ボディ `{"items":[...],"caller":{...}}`。
- レスポンス Headers に `content-type: application/json`。

**Step 4. 401 パターンも試す（対策の体感）**

- Auth を空にして Send → `401`（token 無し）。
- token の末尾を 1 文字変えて Send → `401`（署名検証 NG ＝ 改ざん検知）。
- 5 分経過後 / 期限切れ token で Send → `401` ＋ `www-authenticate: Bearer ... error="invalid_token" ... the token has expired`。

**補足: Postman への Cookie の渡し方（方法 B のみ）**

Chrome で `http://localhost:3000` にログイン済みなら、DevTools → Application → Cookies から `cognito_session_app` の値をコピーし、Postman の該当リクエストの **Headers** に `Cookie: cognito_session_app=<値>` を手動追加します。通常は方法 A で十分です。

### 後片付け

確認できたら必ず戻します。

```env
ENABLE_TOKEN_DEBUG=false
```

その後 `npm run dev` を再起動します。

### ② 盗聴対策: 何がどう効いているのか

資料 Q2 は「もし accessToken が**盗聴されても最小限に抑える**対策は？」という問いです。主眼は「傍受を 100% 防ぐ」ではなく、**傍受された場合の被害を小さくする**ことです。対策を性質ごとに 3 グループに分けると正確に説明できます。

#### グループ A: 「盗聴そのもの」を防ぐ対策

| 対策 | 効き方 |
| --- | --- |
| HTTPS 化（本番は `SESSION_COOKIE_SECURE=true` で `Secure` 付与） | 通信路を暗号化するので、途中経路でパケットを覗いても token が平文で読めない。**盗聴に対する唯一の直接的な防御**。`Secure` は Cookie を HTTPS 通信でしか送らせない |

> 注意: このリポジトリはローカル開発なので `http://localhost:3000` ＝ HTTP で動いており `SESSION_COOKIE_SECURE=false`。つまり「盗聴を防ぐ対策」は現状まだ有効化されていない（本番 HTTPS 前提の設計）。ここは正直に説明する。

#### グループ B: 「盗聴されても被害を最小化」する対策（Q2 の本命）

盗聴を完全には防げない前提で、傍受された token の価値を下げる。資料の「200 → 時間が経つと 401」がこの効果を示す。

| 対策 | 効き方 |
| --- | --- |
| accessToken の有効期限が短い（5 分） | 盗まれた token も最大 5 分で失効。攻撃者が使える時間窓を大きく狭める。資料で curl の 2 回目が `the token has expired` で 401 になるのがこれ |
| refreshToken は暗号化 HTTP-only Cookie の中だけに置く | 延命に使う refreshToken を平文で外に出さない。攻撃者が API に送る access token を傍受しても、そこに refreshToken は含まれない |
| refresh token rotation を無効にして 60 分で失効 | refreshToken を得られても更新経路の寿命は 60 分で尽き、それ以上は延命できない |
| API Gateway 側で exp 等を再検証 | 盗んだ期限切れ token をアプリを迂回して直接投げても、authorizer が `exp` を見て 401 |

#### グループ C: 「盗聴とは別のリスク（窃取）」への対策（混同注意）

厳密にはネットワーク盗聴ではなく、別ルートでの窃取（XSS・Cookie 漏洩）への対策。Q2 の「盗聴」の直接の答えではないので区別する。

| 対策 | 本来防ぐもの |
| --- | --- |
| HttpOnly Cookie | XSS で JS が `document.cookie` から token を抜くのを防ぐ |
| Cookie 中身の AES-256-GCM 暗号化 | Cookie の値自体が漏れた場合に token が平文で読まれるのを防ぐ。GCM の認証タグで改ざん検知も |

#### まとめ（Q2 で答えるべき優先順）

1. 本命（被害最小化）: accessToken を短命（5 分）にし、延命用の refreshToken は暗号化 Cookie の中だけに保持、API Gateway で exp を再検証。盗聴されても「使える時間が 5 分だけ」に封じ込める。
2. 前提（傍受を防ぐ）: 本番は HTTPS ＋ `Secure`。ただしローカルは未適用。
3. 別リスクの対策: HttpOnly ＋ Cookie 暗号化（盗聴ではなく XSS / 漏洩対策と位置づける）。

---

## Q3: ブラウザはどんな形で保存している？（ヒント: 暗号化）

**答え:** ブラウザには `cognito_session_app` という Cookie として保存。中身は平文 JSON ではなく **AES-256-GCM で暗号化**した文字列。形式は [`session.ts`](app/src/lib/session.ts) の `sealSession`:

```text
v1.<iv>.<tag>.<ciphertext>
```

- `iv`: 暗号化ごとのランダム値。
- `tag`: 改ざん検知の認証タグ（GCM）。Cookie を 1 文字でもいじると復号失敗。
- `ciphertext`: 暗号化した session JSON（この中に accessToken 等）。

Cookie 属性は `HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`（[`cookie.ts`](app/src/lib/cookie.ts)、ローカル HTTP なので `Secure` 無し）。「暗号化」かつ「JS から読めない」の二重。

### 確認手順

1. `http://localhost:3000` でログイン ＆「DynamoDB取得」まで完了。
2. 右クリック →「検証」→ DevTools 上部 **Application** タブ。
3. 左メニュー **Storage > Cookies > http://localhost:3000**。
4. `cognito_session_app` があり、値が `v1.....` の暗号文になっていることを確認。
5. `HttpOnly` にチェックあり、`SameSite` が `Lax` を確認。
6. **Console** タブで次を実行:

```js
document.cookie.includes("cognito_session_app")
```

→ `false` が返れば「HttpOnly なので JS から読めない」ことの確認完了。

---

## Q4: データを取得するまでの流れ

**ヒントの穴埋め:** 「Cookie から**暗号化 session**を取り出して、**AES-256-GCM（＋ SESSION_SECRET）**で**復号**して、API に**accessToken を Authorization: Bearer として**付与して送る」。

```text
1. ブラウザ「DynamoDB取得」→ GET /api/items
   （ブラウザが cognito_session_app Cookie を自動添付）
        ↓  app/src/app/api/items/route.ts
2. Next.js が Cookie を取り出す（getCookie）
3. unsealSession で復号（AES-256-GCM, SESSION_SECRET を SHA-256 した鍵）
   - 失敗（無い / 改ざん / 鍵違い / expiresAt 超過）→ 401 + Cookie 削除
        ↓
4. session.accessToken を取り出し、API Gateway へ
   GET /items  Authorization: Bearer <accessToken>
        ↓  API Gateway HTTP API
5. JWT authorizer が検証（署名 / iss / aud(client id) / exp）
   - NG → Lambda に届かず 401（items/route 側はこの 401 で Cookie 削除）
        ↓
6. Lambda(items_api.py) が DynamoDB を Scan
        ↓
7. items + caller(JWT claim 由来の sub/username/email/token_use) を返却
        ↓
8. 画面にダミーデータ 3 件と caller 情報を表示
```

ポイントは **ブラウザは生の token を直接触らない**こと。復号と token 付与はすべてサーバー側の Next.js API route（[`items/route.ts`](app/src/app/api/items/route.ts)）で行われます。

### 確認手順

DevTools **Network** タブを開いた状態で「DynamoDB取得」を押す。

- `/api/items`（Next.js）へのリクエスト … Request Headers に `cognito_session_app` Cookie が載り、レスポンスに items が返る。
- ログイン中は 200、Cookie 削除後は 401（[`README.md`](README.md) の「Cookie削除後に401」手順で確認可）。

---

## まとめ（どれが手を動かす問いか）

| 問い | 種類 | やること |
| --- | --- | --- |
| Q1 | 説明のみ | 3 種 token ＋ access 5 分 / refresh 60 分の期限差 ＋ Cookie 期限で 60 分ログアウトを説明 |
| Q2 | 要ハンズオン | `ENABLE_TOKEN_DEBUG=true` → 再起動 → token 取得 → curl / Postman で 200 / 401 を実演 ＋ 盗聴対策を 3 分類で説明 |
| Q3 | 説明 ＋ 軽い確認 | 暗号化 Cookie `v1.iv.tag.ct`。DevTools で `document.cookie` が `false` を確認 |
| Q4 | 説明 ＋ 軽い確認 | 「取り出す → 復号 → Bearer 付与」の流れ。Network タブで確認 |
