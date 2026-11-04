import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { AppConfig } from "../server/src/config.ts";
import { createApp } from "../server/src/app.ts";

const SHOP = "app-0123456789abcdef01234567.ai.hiobuy.invalid";
const API_KEY = "hio_live_supersecretvalue";

type Call = { url: string; method: string; headers: Headers; body?: unknown };

function createFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    const call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchImpl };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function appConfig(fetchImpl: typeof fetch, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiKey: API_KEY,
    shop: SHOP,
    baseUrl: "https://api.hiobuy.com",
    port: 0,
    fetchImpl,
    ...overrides,
  };
}

async function listen(config: AppConfig) {
  const server = createApp(config).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function upstream(call: Call, extras?: { translateText?: string }): Response {
  const path = new URL(call.url).pathname;
  if (!call.url.startsWith("https://api.hiobuy.com/")) throw new Error(`Unexpected URL ${call.url}`);
  if (path === "/v1/ai/account") {
    return json(200, {
      request_id: "req_account",
      workspace_id: "aiw_example",
      shop: SHOP,
      account_type: "prepaid",
      status: "active",
      currency: "USD",
      credits_balance: 20,
    });
  }
  if (path === "/v1/ai/credits") {
    return json(200, { request_id: "req_balance", workspace_id: "aiw_example", shop: SHOP, credits_balance: 18 });
  }
  if (path === "/v1/ai/credits/pricing") {
    return json(200, {
      request_id: "req_price",
      rules: [
        { feature: "text.translate", credits: 2, default_credits: 99, enabled: true, source: "default" },
        { feature: "image.remove_chinese_text", credits: 1, default_credits: 5, enabled: true, source: "default" },
        { feature: "image.replace_chinese_text", credits: 1, default_credits: 1, enabled: true, source: "default" },
        { feature: "image.background", credits: 3, default_credits: 1, enabled: true, source: "app_override" },
        { feature: "image.lifestyle", credits: 50, default_credits: 50, enabled: true, source: "default" },
      ],
    });
  }
  if (path === "/v1/ai/credits/estimate") return json(200, { request_id: "req_estimate", feature: (call.body as { feature?: string })?.feature, count: 1, unit_credits: 2, credits_required: 2, credits_balance: 18, can_afford: true, credits_shortfall: 0 });
  if (path === "/v1/ai/text/translate") {
    return json(200, {
      request_id: "req_translate",
      job_id: "job_text",
      workspace_id: "aiw_example",
      shop: SHOP,
      credits_used: 2,
      credits_balance: 16,
      character_count: 2,
      translations: [{ translated_text: extras?.translateText ?? "shirt", detected_language: "zh", characters: 2 }],
    });
  }
  if (path === "/v1/ai/image/jobs") {
    const body = call.body as { type?: string };
    return json(202, { request_id: "req_image", job: { id: "job_image", type: body.type, status: "queued", credits_reserved: 1, credits_used: 0, billing_state: "reserved" } });
  }
  if (path === "/v1/ai/jobs/job_image") {
    return json(200, { request_id: "req_job", job: { id: "job_image", status: "completed", billing_state: "completed", credits_reserved: 1, credits_used: 1, output: { url: "https://cdn.example.com/result.webp" } } });
  }
  if (path === "/v1/ai/assets/job_image.webp") {
    return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } });
  }
  return json(500, { error: { code: "UNEXPECTED", message: path, request_id: "req_unexpected" } });
}

test("session discovers the account without a shop header and hides private prices", async () => {
  const mock = createFetch((call) => upstream(call));
  const server = await listen(appConfig(mock.fetchImpl));
  try {
    const response = await fetch(`${server.base}/api/session`);
    const body = await response.json() as { balance: number; prices: Array<{ feature: string; credits: number }>; account_ok: boolean };
    assert.equal(response.status, 200);
    assert.equal(body.account_ok, true);
    assert.equal(body.balance, 18);
    assert.deepEqual(body.prices.map((price) => price.feature), [
      "text.translate",
      "image.remove_chinese_text",
      "image.replace_chinese_text",
      "image.background",
    ]);
    assert.equal(body.prices.find((price) => price.feature === "image.background")?.credits, 3);
    assert.equal(JSON.stringify(body).includes("default_credits"), false);
    assert.equal(JSON.stringify(body).includes("lifestyle"), false);
    assert.equal(JSON.stringify(body).includes(API_KEY), false);
    const account = mock.calls.find((call) => call.url.endsWith("/v1/ai/account"));
    const pricing = mock.calls.find((call) => call.url.endsWith("/v1/ai/credits/pricing"));
    const credits = mock.calls.find((call) => call.url.endsWith("/v1/ai/credits"));
    assert.equal(account?.headers.get("x-shop-domain"), null);
    assert.equal(pricing?.headers.get("x-shop-domain"), null);
    assert.equal(credits?.headers.get("x-shop-domain"), SHOP);
    assert.equal(account?.headers.get("authorization"), `Bearer ${API_KEY}`);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await server.close();
  }
});

test("a mismatched shop does not call shop-scoped endpoints", async () => {
  const mock = createFetch((call) => upstream(call));
  const server = await listen(appConfig(mock.fetchImpl, { shop: "wrong.example" }));
  try {
    const response = await fetch(`${server.base}/api/session`);
    const body = await response.json() as { account_ok: boolean; error: { code: string } };
    assert.equal(body.account_ok, false);
    assert.equal(body.error.code, "DEMO_ACCOUNT_MISMATCH");
    assert.deepEqual(mock.calls.map((call) => new URL(call.url).pathname), ["/v1/ai/account"]);
    assert.equal(mock.calls[0]?.headers.get("x-shop-domain"), null);
  } finally {
    await server.close();
  }
});

test("missing configuration does not call HIOBuy", async () => {
  const mock = createFetch(() => { throw new Error("network"); });
  const server = await listen(appConfig(mock.fetchImpl, { apiKey: "", shop: "" }));
  try {
    const response = await fetch(`${server.base}/api/session`);
    const body = await response.json() as { configured: boolean; error: { code: string } };
    assert.equal(body.configured, false);
    assert.equal(body.error.code, "DEMO_NOT_CONFIGURED");
    assert.equal(mock.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("translate forwards one body and idempotency key and scrubs the API key", async () => {
  const mock = createFetch((call) => upstream(call, { translateText: `ok ${API_KEY}` }));
  const server = await listen(appConfig(mock.fetchImpl));
  try {
    const payload = {
      texts: [" 衬衫 "],
      source_language: "zh",
      target_language: "en",
      format_type: "text",
      scene: "e-commerce-title",
    };
    const send = () => fetch(`${server.base}/api/translate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "text-intent-1" },
      body: JSON.stringify(payload),
    });
    const first = await send();
    const second = await send();
    const text = await first.text();
    assert.equal(second.status, 200);
    assert.equal(text.includes(API_KEY), false);
    assert.match(text, /\[redacted\]/);
    const posts = mock.calls.filter((call) => call.url.endsWith("/v1/ai/text/translate"));
    assert.equal(posts.length, 2);
    assert.equal(posts[0]?.headers.get("x-idempotency-key"), "text-intent-1");
    assert.equal(posts[1]?.headers.get("x-idempotency-key"), "text-intent-1");
    assert.deepEqual(posts[0]?.body, posts[1]?.body);
    assert.deepEqual(posts[0]?.body, { ...payload, texts: ["衬衫"] });
    assert.equal(posts[0]?.headers.get("x-shop-domain"), SHOP);
  } finally {
    await server.close();
  }
});

test("image jobs send the public types and never fetch the image host", async () => {
  const mock = createFetch((call) => upstream(call));
  const server = await listen(appConfig(mock.fetchImpl));
  try {
    const cases = [
      { type: "remove_chinese_text", target_language: "en", expected: { type: "remove_chinese_text", image_url: "https://cdn.example.com/product.jpg" } },
      { type: "white_background", target_language: "en", expected: { type: "white_background", image_url: "https://cdn.example.com/product.jpg" } },
      { type: "replace_chinese_text", target_language: "en", expected: { type: "replace_chinese_text", image_url: "https://cdn.example.com/product.jpg", target_language: "en" } },
    ];
    for (const [index, item] of cases.entries()) {
      const response = await fetch(`${server.base}/api/image-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": `image-intent-${index}` },
        body: JSON.stringify({ ...item.expected, target_language: item.target_language }),
      });
      assert.equal(response.status, 202);
      const text = await response.text();
      assert.equal(text.includes(API_KEY), false);
    }
    const jobs = mock.calls.filter((call) => call.url.endsWith("/v1/ai/image/jobs"));
    assert.deepEqual(jobs.map((call) => call.body), cases.map((item) => item.expected));
    assert.equal(mock.calls.some((call) => call.url.includes("cdn.example.com")), false);
    const estimate = await fetch(`${server.base}/api/estimate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "image.background", count: 9, texts: ["ignore"] }),
    });
    assert.equal(estimate.status, 200);
    const estimateCall = mock.calls.find((call) => call.url.endsWith("/v1/ai/credits/estimate") && (call.body as { feature?: string }).feature === "image.background");
    assert.deepEqual(estimateCall?.body, { feature: "image.background", count: 1 });
  } finally {
    await server.close();
  }
});

test("text estimate sends the same text fields and no count", async () => {
  const mock = createFetch((call) => upstream(call));
  const server = await listen(appConfig(mock.fetchImpl));
  try {
    const response = await fetch(`${server.base}/api/estimate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        feature: "text.translate",
        texts: [" 白色 "],
        source_language: "zh",
        target_language: "en",
        format_type: "html",
        scene: "e-commerce-cpv",
        count: 99,
      }),
    });
    assert.equal(response.status, 200);
    const call = mock.calls.find((item) => item.url.endsWith("/v1/ai/credits/estimate"));
    assert.deepEqual(call?.body, {
      feature: "text.translate",
      texts: ["白色"],
      source_language: "zh",
      target_language: "en",
      format_type: "html",
      scene: "e-commerce-cpv",
    });
  } finally {
    await server.close();
  }
});

test("invalid image URLs and unknown proxy routes do not leave the demo", async () => {
  const mock = createFetch((call) => upstream(call));
  const server = await listen(appConfig(mock.fetchImpl));
  try {
    const rejected = await fetch(`${server.base}/api/image-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "bad-image" },
      body: JSON.stringify({ type: "remove_chinese_text", image_url: "http://cdn.example.com/a.jpg" }),
    });
    assert.equal(rejected.status, 400);
    const missing = await fetch(`${server.base}/api/proxy?url=https://example.com`);
    const missingBody = await missing.json() as { error: { code: string } };
    assert.equal(missing.status, 404);
    assert.equal(missingBody.error.code, "NOT_FOUND");
    const traversal = await fetch(`${server.base}/api/jobs/a..b`);
    assert.equal(traversal.status, 400);
    assert.equal(mock.calls.length, 0);
    assert.equal(missing.headers.get("access-control-allow-origin"), null);
  } finally {
    await server.close();
  }
});

test("asset download is limited to the fixed asset path", async () => {
  const mock = createFetch((call) => upstream(call));
  const server = await listen(appConfig(mock.fetchImpl));
  try {
    const response = await fetch(`${server.base}/api/assets/job_image`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.match(response.headers.get("content-disposition") || "", /job_image\.webp/);
    const asset = mock.calls.find((call) => call.url.includes("/v1/ai/assets/"));
    assert.equal(asset?.url, "https://api.hiobuy.com/v1/ai/assets/job_image.webp");
    assert.equal(asset?.headers.get("x-shop-domain"), SHOP);
  } finally {
    await server.close();
  }
});

test("upstream errors keep request_id and status", async () => {
  const mock = createFetch((call) => {
    if (new URL(call.url).pathname === "/v1/ai/account") return upstream(call);
    return json(402, { error: { code: "INSUFFICIENT_CREDITS", message: `balance ${API_KEY}`, request_id: "req_pay", details: { upstream_message: "secret stack" } } });
  });
  const server = await listen(appConfig(mock.fetchImpl));
  try {
    const response = await fetch(`${server.base}/api/credits`);
    const body = await response.json() as { error: { code: string; message: string; request_id: string; details?: unknown } };
    assert.equal(response.status, 402);
    assert.equal(body.error.code, "INSUFFICIENT_CREDITS");
    assert.equal(body.error.request_id, "req_pay");
    assert.equal(body.error.message.includes(API_KEY), false);
    assert.equal(JSON.stringify(body).includes("upstream_message"), false);
  } finally {
    await server.close();
  }
});
