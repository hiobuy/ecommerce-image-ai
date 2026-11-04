function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCurl(request: {
  method: "GET" | "POST";
  path: string;
  shop?: boolean;
  idempotencyKey?: string;
  body?: unknown;
}): string {
  const parts = [`curl --request ${request.method} "$HIOBUY_API_BASE_URL${request.path}"`];
  parts.push('--header "Authorization: Bearer YOUR_APP_API_KEY"');
  if (request.shop !== false) parts.push('--header "X-Shop-Domain: $HIOBUY_AI_SHOP"');
  if (request.idempotencyKey) parts.push(`--header "X-Idempotency-Key: ${request.idempotencyKey}"`);
  if (request.body !== undefined) {
    parts.push('--header "Content-Type: application/json"');
    parts.push(`--data ${shellSingleQuote(JSON.stringify(request.body, null, 2))}`);
  }
  return parts.map((part, index) => (index === parts.length - 1 ? part : `${part} \\`)).join("\n  ");
}

export const API_KEY_PLACEHOLDER = "YOUR_APP_API_KEY";
