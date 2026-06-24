output "aws_region" {
  value = var.aws_region
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "items_table_name" {
  value = aws_dynamodb_table.items.name
}

output "ses_from_email" {
  value = var.ses_from_email
}
