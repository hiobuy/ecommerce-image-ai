import { assertAllowedUpstreamPath } from "../../shared/contract.ts";
import { DemoError, type DemoFailure, type DemoResult } from "../../shared/errors.ts";
import { cleanMessage, pickDetails, readRequestId, scrubSecrets } from "../../shared/scrub.ts";
import type { AppConfig } from "./config.ts";

export function normalizeUpstreamError(status: number, body: unknown, secrets: string[]): DemoFailure {
  const scrubbed = scrubSecrets(body, secrets);
  const envelope = scrubbed && typeof scrubbed === "object" ? (scrubbed as { error?: unknown }).error : undefined;
  const error = envelope && typeof envelope === "object" ? (envelope as Record<string, unknown>) : undefined;
  const requestId = readRequestId(error?.request_id);
  const details = pickDetails(error?.details);
  const code = typeof error?.code === "string" && error.code.length > 0 && error.code.length <= 80 ? error.code : "UPSTREAM_ERROR";
  const category = typeof error?.category === "string" && error.category.length <= 80 ? error.category : undefined;
  return {
    ok: false,
    status,
    request_id: requestId,
    error: {
      code,
      message: cleanMessage(typeof error?.message === "string" ? error.message : "The HIOBuy API rejected the request."),
      request_id: requestId,
      ...(category ? { category } : {}),
      ...(details ? { details } : {}),
    },
  };
}

export function retryAfterMs(header: string | null, details?: Record<string, unknown>): number | undefined {
  const headerSeconds = header == null ? Number.NaN : Number(header);
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return Math.max(1, headerSeconds) * 1000;
  const seconds = details?.retry_after_seconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) return Math.max(1, seconds) * 1000;
  const milliseconds = details?.retry_after_ms;
  if (typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  return undefined;
}

export type HiobuyClient = ReturnType<typeof createHiobuyClient>;

export function createHiobuyClient(config: AppConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  let pending: Promise<void> | null = null;

  async function request(options: {
    path: string;
    method: "GET" | "POST";
    shop: boolean;
    idempotencyKey?: string;
    body?: unknown;
    binary?: boolean;
    scrub?: boolean;
  }): Promise<DemoResult<unknown> & { bytes?: Uint8Array; contentType?: string }> {
    const path = assertAllowedUpstreamPath(options.path);
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    headers.set("Accept", options.binary ? "image/webp,application/json" : "application/json");
    if (options.shop) headers.set("X-Shop-Domain", config.shop);
    if (options.idempotencyKey) headers.set("X-Idempotency-Key", options.idempotencyKey);
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, config.baseUrl), {
        method: options.method,
        headers,
        body,
        signal: AbortSignal.timeout(options.binary ? 60_000 : 45_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new DemoError(
        503,
        "DEMO_UPSTREAM_NETWORK",
        timedOut
          ? "The HIOBuy API did not respond in time. Retry the same intent with the same idempotency key."
          : "The demo server could not reach the HIOBuy API.",
      );
    }

    if (options.binary && response.ok) {
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 20 * 1024 * 1024) {
        throw new DemoError(413, "DEMO_ASSET_TOO_LARGE", "The result image is larger than this demo will download.");
      }
      if (contentType.includes("json") || contentType.includes("text") || bytes[0] === 0x7b) {
        const parsed = parseJson(new TextDecoder().decode(bytes));
        const failure = normalizeUpstreamError(response.status, parsed, [config.apiKey]);
        return failure;
      }
      return { ok: true, status: response.status, request_id: null, data: null, bytes, contentType };
    }

    const parsed = parseJson(await response.text());
    const details = parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
      ? pickDetails((parsed as { error?: { details?: unknown } }).error?.details)
      : undefined;
    const retry = retryAfterMs(response.headers.get("retry-after"), details);
    if (!response.ok) {
      const failure = normalizeUpstreamError(response.status, parsed, [config.apiKey]);
      if (retry) failure.retry_after_ms = retry;
      return failure;
    }
    const data = options.scrub === false ? parsed : scrubSecrets(parsed, [config.apiKey]);
    const requestId = readRequestId(data && typeof data === "object" ? (data as { request_id?: unknown }).request_id : null);
    return { ok: true, status: response.status, request_id: requestId, data };
  }

  async function ensureAccount(): Promise<void> {
    if (!config.apiKey || !config.shop) {
      throw new DemoError(503, "DEMO_NOT_CONFIGURED", "Set HIOBUY_API_KEY and HIOBUY_AI_SHOP in the server environment.");
    }
    if (!pending) {
      pending = verifyAccount().catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    await pending;
  }

  async function verifyAccount(): Promise<void> {
    const result = await request({ path: "/v1/ai/account", method: "GET", shop: false, scrub: false });
    if (!result.ok) {
      throw new DemoError(result.status || 502, result.error.code, result.error.message, result.request_id, result.error.details);
    }
    const shop = result.data && typeof result.data === "object" ? (result.data as { shop?: unknown }).shop : undefined;
    if (typeof shop !== "string" || !shop.trim()) {
      throw new DemoError(502, "DEMO_BAD_RESPONSE", "GET /v1/ai/account did not return a shop.");
    }
    if (shop !== config.shop) {
      throw new DemoError(
        500,
        "DEMO_ACCOUNT_MISMATCH",
        `HIOBUY_AI_SHOP does not match the prepaid account for this API key. The account shop is "${shop}". Copy that value from GET /v1/ai/account or the Developer Center HTTP example. Shop-scoped calls were not sent.`,
      );
    }
  }

  return {
    ensureAccount,
    getCredits() {
      return withAccount(() => request({ path: "/v1/ai/credits", method: "GET", shop: true }));
    },
    getPricing() {
      return withAccount(() => request({ path: "/v1/ai/credits/pricing", method: "GET", shop: false }));
    },
    estimate(body: unknown) {
      return withAccount(() => request({ path: "/v1/ai/credits/estimate", method: "POST", shop: true, body }));
    },
    translate(body: unknown, idempotencyKey: string) {
      return withAccount(() => request({
        path: "/v1/ai/text/translate",
        method: "POST",
        shop: true,
        idempotencyKey,
        body,
      }));
    },
    createImageJob(body: unknown, idempotencyKey: string) {
      return withAccount(() => request({
        path: "/v1/ai/image/jobs",
        method: "POST",
        shop: true,
        idempotencyKey,
        body,
      }));
    },
    getJob(jobId: string) {
      return withAccount(() => request({ path: `/v1/ai/jobs/${jobId}`, method: "GET", shop: true }));
    },
    getAsset(jobId: string) {
      return withAccount(() => request({ path: `/v1/ai/assets/${jobId}.webp`, method: "GET", shop: true, binary: true }));
    },
  };

  async function withAccount<T>(work: () => Promise<T>): Promise<T> {
    await ensureAccount();
    return work();
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
