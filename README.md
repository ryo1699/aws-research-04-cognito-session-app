# AWS Research 04: Cognito Session App

Cognito で認証し、メールのワンタイムパスワードで 2 段階認証を行い、認証済みユーザーだけが API Gateway 経由で DynamoDB のダミーデータを取得できるサンプルです。

セッションは Next.js の API route で暗号化し、HTTP-only Cookie に保存します。Cookie と Cognito access token / ID token / refresh token は 60 分にそろえ、アプリ側では refresh token を使わないため、60 分で自動ログアウトする設計です。

認証フロー、token、Cookie、API Gateway JWT authorizer の挙動を詳しく学ぶ場合は [`AUTH_FLOW_README.md`](AUTH_FLOW_README.md) を参照します。

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

Cognito の email MFA は SES の検証済み identity を使う前提です。これは「Cognito がこのメールアドレスからメールを送ってよい」と SES 側で承認しておく作業です。

### SES identityを作る方法A: AWS CLI

この方法は Mac のターミナルで実行します。`no-reply@example.com` は、自分が受信できるメールアドレスに置き換えます。

```bash
aws sesv2 create-email-identity \
  --region ap-northeast-1 \
  --email-identity no-reply@example.com
```

実行後、そのメールアドレスに AWS から検証メールが届きます。メール本文内の検証リンクをブラウザで開いて承認します。

承認できたかをターミナルで確認します。

```bash
aws sesv2 get-email-identity \
  --region ap-northeast-1 \
  --email-identity no-reply@example.com \
  --query VerifiedForSendingStatus
```

`VerifiedForSendingStatus` が `true` になってから Terraform を実行します。

### SES identityを作る方法B: AWSコンソール

CLI を使わない場合は AWS コンソールで操作します。

1. AWS コンソールを開く。
2. 右上のリージョンを `ap-northeast-1`、つまり東京リージョンにする。
3. 検索欄で `SES` または `Simple Email Service` を開く。
4. 左メニューの `Configuration > Verified identities` を開く。
5. `Create identity` を押す。
6. Identity type は `Email address` を選ぶ。
7. `Email address` に送信元にしたいメールアドレスを入力する。
8. `Create identity` を押す。
9. 入力したメールアドレスに届く AWS の検証メールを開き、検証リンクを押す。
10. SES の `Verified identities` 画面で status が `Verified` になったことを確認する。

この後、Terraform の `terraform.tfvars` に SES identity の値を書きます。AWS アカウント ID はターミナルで確認できます。

```bash
aws sts get-caller-identity --query Account --output text
```

例:

```hcl
ses_from_email = "no-reply@example.com"
ses_source_arn = "arn:aws:ses:ap-northeast-1:123456789012:identity/no-reply@example.com"
```

`123456789012` は自分の AWS アカウント ID に置き換えます。

### 2回目以降のSES操作

SES identity は一度 `Verified` になっていれば、毎回作り直す必要はありません。次の条件を満たしていれば、この SES identity 作成手順はスキップできます。

- 同じ AWS アカウントを使う。
- 同じリージョン `ap-northeast-1` を使う。
- 同じ送信元メールアドレスを使う。
- SES の verified identity を削除していない。

確認だけしたい場合は、ターミナルで次を実行します。

```bash
aws sesv2 get-email-identity \
  --region ap-northeast-1 \
  --email-identity no-reply@example.com \
  --query VerifiedForSendingStatus
```

`true` が返れば SES identity は再利用できます。`NotFoundException` が出る場合は、そのメールアドレスの identity が存在しないため、もう一度作成とメール承認が必要です。

## Terraform

ここからは Mac のターミナルで実行します。最初にリポジトリルート、つまり `aws-research` ディレクトリにいる前提です。

```bash
cd projects/aws-research-04-cognito-session-app/infra/terraform
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
```

上の `cp` は example ファイルを実際に使う設定ファイルとしてコピーする操作です。その後、VS Code などのエディタで次の2ファイルを開いて編集します。

- `backend.hcl`: Terraform state を置く S3 bucket 名を自分の環境に合わせる。
- `terraform.tfvars`: `ses_from_email` / `ses_source_arn` を上で検証した SES identity に合わせる。

編集できたら、ターミナルで Terraform を実行します。

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

### 2回目以降のTerraform操作

一度 `terraform apply` が成功して AWS リソースが残っている場合、毎回 `terraform apply` し直す必要はありません。次のリソースが残っていれば、そのまま再利用できます。

- Cognito User Pool
- API Gateway
- Lambda
- DynamoDB
- IAM Role など

リソースが残っているか確認するには、`projects/aws-research-04-cognito-session-app/infra/terraform` ディレクトリで次を実行します。

```bash
terraform state list
terraform output -raw cognito_user_pool_client_id
terraform output -raw api_endpoint
```

`terraform output` が値を返す場合は、Next.js アプリの `.env.local` にその値を設定して起動できます。

`terraform destroy` を実行した後は、Cognito / API Gateway / Lambda / DynamoDB などが削除されます。その場合は、もう一度 `terraform apply` が必要です。ただし、SES identity は Terraform 管理外なので、手動で削除していなければ再作成は不要です。

Terraform のコードや `terraform.tfvars` を変更した場合は、既存リソースが残っていても次を実行して差分を確認します。

```bash
terraform plan
terraform apply
```

## Next.js アプリ

ここからはローカル PC で Web アプリを起動する手順です。新しいターミナルを開くか、リポジトリルートに戻ってから実行します。

```bash
cd projects/aws-research-04-cognito-session-app/app
cp .env.local.example .env.local
```

`.env.local` は Next.js アプリの環境変数ファイルです。次のコマンドは、`projects/aws-research-04-cognito-session-app/app` ディレクトリで実行します。Terraform output から必要な値を読み取って `.env.local` に書き込みます。

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

### 2回目以降のNext.js操作

`app/node_modules` が残っていれば、毎回 `npm install` する必要はありません。通常は次だけで起動できます。

```bash
cd projects/aws-research-04-cognito-session-app/app
npm run dev
```

`.env.local` も一度作れば毎回作り直す必要はありません。ただし、次の場合は `.env.local` を作り直すか、値を更新します。

- `terraform destroy` 後に `terraform apply` し直して、Cognito client ID や API endpoint が変わった。
- 別の AWS アカウントやリージョンで作り直した。
- `SESSION_MAX_AGE_SECONDS` などのローカル設定を変更したい。

## 動作確認

1. メールアドレスとパスワードを入力して「サインアップ」を押す。
2. メールに届いた確認コードを入力して「メール確認」を押す。
   - メールが届かない場合は迷惑メールを確認し、それでも無ければ「確認コード再送」を押す。
3. 「サインイン」を押し、メールに届いた OTP を入力して「OTP送信」を押す。
4. 「DynamoDB取得」を押し、3 件のダミーデータと caller 情報が表示されることを確認する。
5. ブラウザ DevTools で `cognito_session_app` Cookie が存在し、JavaScript から直接読めない HTTP-only Cookie になっていることを確認する。
6. 60 分後、または Cookie 削除後に `DynamoDB取得` が 401 になり、再ログインが必要になることを確認する。

### Cookie確認手順

Chrome の場合は次の手順で確認します。

1. `http://localhost:3000` を開き、ログインと `DynamoDB取得` まで完了する。
2. 画面上で右クリックし、`検証` を押す。
3. DevTools 上部の `Application` タブを開く。
4. 左メニューの `Storage > Cookies` を開く。
5. `http://localhost:3000` をクリックする。
6. Cookie 一覧に `cognito_session_app` があることを確認する。
7. `cognito_session_app` の `HttpOnly` にチェックがあることを確認する。
8. `SameSite` が `Lax` であることを確認する。
9. ローカル開発は `http://localhost:3000` なので、`Secure` は空欄または false でよい。

JavaScript から直接読めないことは、DevTools の `Console` タブで確認します。

```js
document.cookie.includes("cognito_session_app")
```

`false` が返れば、`cognito_session_app` は JavaScript から直接読めていません。`document.cookie` を実行したときに他の Cookie が表示されても、`cognito_session_app=...` が含まれていなければ OK です。

### Cookie削除後に401になることを確認する手順

この確認は `http://localhost:3000` の画面でログイン済みになり、`DynamoDB取得` が成功した後に実施します。

1. Chrome DevTools を開く。
2. `Application` タブを開く。
3. 左メニューの `Storage > Cookies > http://localhost:3000` を開く。
4. Cookie 一覧から `cognito_session_app` を選ぶ。
5. Delete キー、または Cookie 一覧上部の削除アイコンで `cognito_session_app` を削除する。
6. 画面に戻り、`DynamoDB取得` を押す。
7. 画面に `Not authenticated.` または 401 系のエラーが表示されることを確認する。
8. DevTools の `Network` タブで `/api/items` を見ると、Status が `401` になっていることも確認できる。

この確認で見ているのは、Next.js 側の `/api/items` が Cookie なしのリクエストを拒否することです。Cookie が無い場合、Next.js は API Gateway に access token を送れないため、DynamoDB のデータを取得できません。

### 時間経過で401になることを短時間で確認する手順

本来の設定では `SESSION_MAX_AGE_SECONDS=3600` なので、60 分待つとセッションが期限切れになります。動作確認で 60 分待つのが面倒な場合は、ローカル確認時だけ期限を短くします。

1. `npm run dev` を実行しているターミナルで `Ctrl + C` を押し、Next.js を停止する。
2. `projects/aws-research-04-cognito-session-app/app/.env.local` を開く。
3. 次の値を一時的に短くする。

```env
SESSION_MAX_AGE_SECONDS=60
```

4. Next.js を再起動する。

```bash
npm run dev
```

5. `http://localhost:3000` を開き、サインインして `DynamoDB取得` が成功することを確認する。
6. 60 秒以上待つ。
7. もう一度 `DynamoDB取得` を押す。
8. `Not authenticated.` または 401 系のエラーが表示されることを確認する。

確認後は `.env.local` を元に戻します。

```env
SESSION_MAX_AGE_SECONDS=3600
```

値を戻したら、再度 `Ctrl + C` で停止して `npm run dev` を起動し直します。

新規ユーザーの初回サインインでは、Cognito がサインアップ確認メールを初回の追加要素として扱い、OTP challenge を返さずに token を発行する場合があります。その場合は一度ログアウトし、同じユーザーで再サインインしてメール OTP を確認します。

API が認証なしでは拒否することも確認します。

このコマンドは `projects/aws-research-04-cognito-session-app/app` ディレクトリで実行します。`npm run dev` を実行しているターミナルはそのままにして、別のターミナルを開いて実行してください。

```bash
API_URL=$(terraform -chdir=../infra/terraform output -raw api_endpoint)
curl -i "${API_URL}/items"
```

`401` が返れば、API Gateway の Cognito JWT authorizer が効いています。

資料の Q2 用に access token で直接 API を叩く場合だけ、`.env.local` の `ENABLE_TOKEN_DEBUG=true` にして Next.js を再起動します。ログイン後、画面の「access token表示」ボタンで token を表示し、ターミナルに貼って確認します。

このコマンドも `projects/aws-research-04-cognito-session-app/app` ディレクトリで実行します。

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
