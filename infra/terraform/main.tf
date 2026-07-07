locals {
  name                 = var.project_name
  lambda_function_name = "${local.name}-items-api"
  tags = {
    Project = var.project_name
    Task    = "cognito-session-app"
  }

  seed_items = {
    item-001 = {
      title       = "Cognito authenticated item"
      description = "This row is returned only when API Gateway receives a valid Cognito access token."
      status      = "ready"
    }
    item-002 = {
      title       = "Encrypted cookie session"
      description = "The web app stores Cognito tokens in an encrypted HTTP-only cookie."
      status      = "ready"
    }
    item-003 = {
      title       = "Five minute access token"
      description = "The access token expires in 5 minutes and is refreshed with the 60 minute refresh token, so a stolen access token is usable for at most 5 minutes."
      status      = "ready"
    }
  }
}

resource "aws_cognito_user_pool" "main" {
  name                     = "${local.name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "ON"
  user_pool_tier           = "ESSENTIALS"

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = var.ses_source_arn
    from_email_address    = var.ses_from_email
  }

  email_mfa_configuration {
    subject = "Your sign-in code"
    message = "Your sign-in code is {####}."
  }

  password_policy {
    minimum_length                   = var.password_minimum_length
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }

  username_configuration {
    case_sensitive = false
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your verification code"
    email_message        = "Your verification code is {####}."
  }

  tags = local.tags
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  access_token_validity                = 5
  id_token_validity                    = 5
  refresh_token_validity               = 60
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  explicit_auth_flows                  = ["ALLOW_USER_PASSWORD_AUTH"]
  supported_identity_providers         = ["COGNITO"]
  allowed_oauth_flows_user_pool_client = false

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "minutes"
  }
}

resource "aws_dynamodb_table" "items" {
  name         = "${local.name}-items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = false
  }

  tags = local.tags
}

resource "aws_dynamodb_table_item" "seed" {
  for_each = local.seed_items

  table_name = aws_dynamodb_table.items.name
  hash_key   = aws_dynamodb_table.items.hash_key

  item = jsonencode({
    id = {
      S = each.key
    }
    title = {
      S = each.value.title
    }
    description = {
      S = each.value.description
    }
    status = {
      S = each.value.status
    }
  })
}

resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "${local.name}-lambda-dynamodb"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:Scan"
      ]
      Resource = aws_dynamodb_table.items.arn
    }]
  })
}

data "archive_file" "items_api" {
  type        = "zip"
  source_file = "${path.module}/lambda/items_api.py"
  output_path = "${path.module}/lambda/items_api.zip"
}

resource "aws_cloudwatch_log_group" "items_api" {
  name              = "/aws/lambda/${local.lambda_function_name}"
  retention_in_days = 14

  tags = local.tags
}

resource "aws_lambda_function" "items_api" {
  function_name    = local.lambda_function_name
  role             = aws_iam_role.lambda.arn
  handler          = "items_api.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.items_api.output_path
  source_code_hash = data.archive_file.items_api.output_base64sha256
  timeout          = 10

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.items.name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.items_api,
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_dynamodb
  ]

  tags = local.tags
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["authorization", "content-type"]
    allow_methods = ["GET", "OPTIONS"]
    allow_origins = var.api_cors_allowed_origins
    max_age       = 300
  }

  tags = local.tags
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.name}-cognito"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "items_api" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.items_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_items" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /items"
  target             = "integrations/${aws_apigatewayv2_integration.items_api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  tags = local.tags
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.items_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
