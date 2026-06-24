import json
import os
from decimal import Decimal

import boto3


dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["TABLE_NAME"])


class JsonEncoder(json.JSONEncoder):
    def default(self, value):
        if isinstance(value, Decimal):
            return int(value) if value % 1 == 0 else float(value)
        return super().default(value)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json",
            "cache-control": "no-store",
        },
        "body": json.dumps(body, cls=JsonEncoder),
    }


def handler(event, context):
    route_key = event.get("routeKey", "")
    if route_key != "GET /items":
        return response(404, {"message": "Not found"})

    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )

    scan_result = table.scan()
    items = sorted(scan_result.get("Items", []), key=lambda item: item["id"])

    return response(
        200,
        {
            "items": items,
            "caller": {
                "sub": claims.get("sub"),
                "username": claims.get("username"),
                "email": claims.get("email"),
                "token_use": claims.get("token_use"),
            },
        },
    )
