variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "ap-northeast-1"
}

variable "project_name" {
  type        = string
  description = "Name prefix for AWS resources."
  default     = "aws-research-04-cognito-session-app"
}

variable "ses_from_email" {
  type        = string
  description = "Verified SES email address used by Cognito for verification and email OTP MFA."
}

variable "ses_source_arn" {
  type        = string
  description = "ARN of the verified SES identity used by Cognito. Example: arn:aws:ses:ap-northeast-1:123456789012:identity/no-reply@example.com"
}

variable "api_cors_allowed_origins" {
  type        = list(string)
  description = "Origins allowed by the HTTP API CORS configuration."
  default     = ["http://localhost:3000"]
}

variable "password_minimum_length" {
  type        = number
  description = "Minimum Cognito password length."
  default     = 12
}
