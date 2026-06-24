# AWS Research 04: Cognito Session App

Cognito で認証し、メールのワンタイムパスワードで 2 段階認証を行い、認証済みユーザーだけが API Gateway 経由で DynamoDB のダミーデータを取得できるサンプルです。

セッションは Next.js の API route で暗号化し、HTTP-only Cookie に保存します。Cookie と Cognito access token / ID token / refresh token は 60 分にそろえ、アプリ側では refresh token を使わないため、60 分で自動ログアウトする設計です。

## フォルダ構成

```text
aws-research-04-cognito-session-app/
  .github/workflows/
    cognito-session-app-check.yml
  app/
    src/app/
    src/lib/
    package.json
  infra/terraform/
    main.tf
    variables.tf
    outputs.tf
    lambda/items_api.py
```

## 構成

```text
Browser
  |
  | email/password, email OTP
  v
Next.js API routes
  |
  | Cognito InitiateAuth / RespondToAuthChallenge
  | encrypted HTTP-only cookie
  v
Browser session cookie
  |
  | /api/items
  v
Next.js API route
  |
  | Authorization: Bearer <accessToken>
  v
API Gateway HTTP API JWT authorizer
  |
  v
Lambda
  |
  v
DynamoDB
```

## 事前準備

- Terraform 1.6 以上
- Node.js 20 以上
- AWS credentials
- SES の検証済み送信元メールアドレス

Cognito の email MFA は SES の検証済み identity を使う前提です。未作成なら先に作成し、届いた検証メールを承認します。

```bash
aws sesv2 create-email-identity \
  --region ap-northeast-1 \
  --email-identity no-reply@example.com

aws sesv2 get-email-identity \
  --region ap-northeast-1 \
  --email-identity no-reply@example.com \
  --query VerifiedForSendingStatus
```

`VerifiedForSendingStatus` が `true` になってから Terraform を実行します。

## Terraform

```bash
cd projects/aws-research-04-cognito-session-app/infra/terraform
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
```

`backend.hcl` の S3 bucket と、`terraform.tfvars` の `ses_from_email` / `ses_source_arn` を自分の値に変更します。

```bash
terraform init -backend-config=backend.hcl
terraform fmt -recursive
terraform plan
terraform apply
```

apply 後に値を確認します。

```bash
terraform output -raw aws_region
terraform output -raw cognito_user_pool_id
terraform output -raw cognito_user_pool_client_id
terraform output -raw api_endpoint
terraform output -raw items_table_name
```

## Next.js アプリ

```bash
cd projects/aws-research-04-cognito-session-app/app
cp .env.local.example .env.local
```

`.env.local` を Terraform output で埋めます。

```bash
{
  echo "AWS_REGION=ap-northeast-1"
  echo "COGNITO_CLIENT_ID=$(terraform -chdir=../infra/terraform output -raw cognito_user_pool_client_id)"
  echo "BACKEND_API_URL=$(terraform -chdir=../infra/terraform output -raw api_endpoint)"
  echo "SESSION_SECRET=$(openssl rand -base64 32)"
  echo "SESSION_MAX_AGE_SECONDS=3600"
  echo "SESSION_COOKIE_SECURE=false"
  echo "ENABLE_TOKEN_DEBUG=false"
} > .env.local
```

起動します。

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

## 動作確認

1. メールアドレスとパスワードを入力して「サインアップ」を押す。
2. メールに届いた確認コードを入力して「メール確認」を押す。
3. 「サインイン」を押し、メールに届いた OTP を入力して「OTP送信」を押す。
4. 「DynamoDB取得」を押し、3 件のダミーデータと caller 情報が表示されることを確認する。
5. ブラウザ DevTools で `cognito_session_app` Cookie が存在し、JavaScript から直接読めない HTTP-only Cookie になっていることを確認する。
6. 60 分後、または Cookie 削除後に `DynamoDB取得` が 401 になり、再ログインが必要になることを確認する。

新規ユーザーの初回サインインでは、Cognito がサインアップ確認メールを初回の追加要素として扱い、OTP challenge を返さずに token を発行する場合があります。その場合は一度ログアウトし、同じユーザーで再サインインしてメール OTP を確認します。

API が認証なしでは拒否することも確認します。

```bash
API_URL=$(terraform -chdir=../infra/terraform output -raw api_endpoint)
curl -i "${API_URL}/items"
```

`401` が返れば、API Gateway の Cognito JWT authorizer が効いています。

資料の Q2 用に access token で直接 API を叩く場合だけ、`.env.local` の `ENABLE_TOKEN_DEBUG=true` にして Next.js を再起動します。ログイン後、画面の「access token表示」ボタンで token を表示し、ターミナルに貼って確認します。

```bash
TOKEN='画面に表示されたaccess token'
API_URL=$(terraform -chdir=../infra/terraform output -raw api_endpoint)
curl -i "${API_URL}/items" -H "Authorization: Bearer ${TOKEN}"
```

token が有効なら `200`、60 分経過後なら `401` になります。

## 完了と言える条件

- Cognito でメール確認とメール OTP MFA が動く。
- Next.js がログイン後に暗号化 HTTP-only Cookie を発行する。
- 未認証の `GET /items` は `401` になる。
- ログイン後の画面から DynamoDB のダミーデータを取得できる。
- access token を直接 `Authorization: Bearer` に付けると API Gateway 経由で同じデータを取得できる。
- 60 分経過後に Cookie / token が使えなくなり、再ログインが必要になる。

## token 設計メモ

- `accessToken`: API Gateway JWT authorizer に送る。盗まれても最大 60 分で失効する。
- `idToken`: 画面表示用のユーザー情報確認に使える。今回の API 認可には使わない。
- `refreshToken`: Cognito client 側の有効期限も 60 分にする。アプリでは refresh 処理を実装せず、セッション延長を避ける。
- Cookie: AES-256-GCM で暗号化し、HTTP-only / SameSite=Lax で保存する。ローカル開発では HTTP のため `SESSION_COOKIE_SECURE=false`、本番 HTTPS では `true` にする。

## 片付け

```bash
cd projects/aws-research-04-cognito-session-app/infra/terraform
terraform destroy
```
