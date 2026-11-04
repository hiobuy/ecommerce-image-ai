const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /\bhio_(?:live|test)_[A-Za-z0-9]+/g,
];

export function scrubSecrets<T>(value: T, secrets: string[] = []): T {
  const literals = secrets.filter((secret) => secret.length >= 8);
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") {
      let output = input;
      for (const secret of literals) output = output.split(secret).join("[redacted]");
      for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[redacted]");
      return output;
    }
    if (Array.isArray(input)) return input.map((item) => walk(item));
    if (input && typeof input === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(input)) {
        if (key.toLowerCase() === "authorization") continue;
        output[key] = walk(nested);
      }
      return output;
    }
    return input;
  };
  return walk(value) as T;
}

export function cleanMessage(message: string): string {
  const single = message.replace(/\s+/g, " ").trim().slice(0, 500);
  if (/node_modules|\/src\/|\bat\s+\S+\s+\(/.test(single)) {
    return "The request failed. Contact support with the request ID.";
  }
  return single || "The HIOBuy API returned an error.";
}

const DETAIL_KEYS = [
  "job_id",
  "accepted",
  "retryable",
  "retry_after_seconds",
  "retry_after_ms",
  "bucket",
  "limit",
  "scope",
  "feature",
] as const;

export function pickDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const source = details as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of DETAIL_KEYS) {
    if (!(key in source)) continue;
    const value = source[key];
    if (key === "job_id" && (typeof value !== "string" || value.length < 1 || value.length > 200)) continue;
    if ((key === "accepted" || key === "retryable") && typeof value !== "boolean") continue;
    if ((key === "retry_after_seconds" || key === "retry_after_ms" || key === "limit") && typeof value !== "number") continue;
    if ((key === "bucket" || key === "scope" || key === "feature") && (typeof value !== "string" || value.length > 80)) continue;
    picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

export function readRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}
