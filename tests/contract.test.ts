import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionForFailure,
  buildEstimateBody,
  buildImageJobBody,
  buildTranslateBody,
  existingJobId,
  normalizeBaseUrl,
  recoveryJobId,
  selectPublicPrices,
} from "../shared/contract.ts";
import { buildCurl } from "../shared/curl.ts";
import { loadEnvFile } from "../server/src/env.ts";
import { readConfig } from "../server/src/config.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("translate body trims texts and keeps the public fields", () => {
  const body = buildTranslateBody({
    texts: [" 纯棉短袖 "],
    source_language: "auto",
    target_language: "en",
    format_type: "text",
    scene: "e-commerce-title",
  });
  assert.deepEqual(body, {
    texts: ["纯棉短袖"],
    source_language: "auto",
    target_language: "en",
    format_type: "text",
    scene: "e-commerce-title",
  });
});

test("translate rejects empty, extra, and oversized text", () => {
  assert.throws(() => buildTranslateBody({
    texts: [" "],
    source_language: "zh",
    target_language: "en",
    format_type: "text",
    scene: "e-commerce-title",
  }));
  assert.throws(() => buildTranslateBody({
    texts: ["ok"],
    source_language: "zh",
    target_language: "en",
    format_type: "markdown",
    scene: "e-commerce-title",
  }));
  assert.throws(() => buildTranslateBody({
    texts: ["ok"],
    source_language: "zh",
    target_language: "en",
    format_type: "text",
    scene: "general",
  }));
  assert.throws(() => buildTranslateBody({
    texts: ["a".repeat(50_001)],
    source_language: "zh",
    target_language: "en",
    format_type: "html",
    scene: "novel",
  }));
});

test("image jobs use only the three public types", () => {
  const image = "https://cdn.example.com/product.jpg";
  assert.deepEqual(buildImageJobBody({ type: "remove_chinese_text", image_url: image, target_language: "en" }), {
    type: "remove_chinese_text",
    image_url: image,
  });
  assert.deepEqual(buildImageJobBody({ type: "white_background", image_url: image, target_language: "fr" }), {
    type: "white_background",
    image_url: image,
  });
  assert.deepEqual(buildImageJobBody({ type: "replace_chinese_text", image_url: image, target_language: "en" }), {
    type: "replace_chinese_text",
    image_url: image,
    target_language: "en",
  });
  assert.throws(() => buildImageJobBody({ type: "enhance", image_url: image }));
  assert.throws(() => buildImageJobBody({ type: "replace_chinese_text", image_url: image }));
  assert.throws(() => buildImageJobBody({ type: "remove_chinese_text", image_url: "http://cdn.example.com/a.jpg" }));
});

test("estimate uses feature keys and does not send count for text", () => {
  const text = buildEstimateBody({
    feature: "text.translate",
    texts: [" hello "],
    source_language: "auto",
    target_language: "en",
    format_type: "text",
    scene: "e-commerce-description",
  });
  assert.equal(text.feature, "text.translate");
  assert.equal("count" in text, false);
  assert.deepEqual(text.texts, ["hello"]);
  assert.deepEqual(buildEstimateBody({ feature: "image.background" }), {
    feature: "image.background",
    count: 1,
  });
  assert.throws(() => buildEstimateBody({ feature: "image.lifestyle" }));
});

test("prices use credits and enabled, never default_credits", () => {
  const prices = selectPublicPrices([
    { feature: "text.translate", credits: 2, default_credits: 99, enabled: true },
    { feature: "image.remove_chinese_text", credits: 1, default_credits: 5, enabled: true },
    { feature: "image.replace_chinese_text", credits: 4, default_credits: 1, enabled: false },
    { feature: "image.background", credits: 3, default_credits: 1, enabled: true },
    { feature: "image.lifestyle", credits: 50, default_credits: 50, enabled: true },
  ]);
  assert.deepEqual(prices, [
    { feature: "text.translate", credits: 2, enabled: true, missing: false },
    { feature: "image.remove_chinese_text", credits: 1, enabled: true, missing: false },
    { feature: "image.replace_chinese_text", credits: 4, enabled: false, missing: false },
    { feature: "image.background", credits: 3, enabled: true, missing: false },
  ]);
  assert.equal(JSON.stringify(prices).includes("default_credits"), false);
  assert.equal(JSON.stringify(prices).includes("lifestyle"), false);
});

test("recovery polls only the in-progress and reconciliation codes", () => {
  const job = { details: { job_id: "job_123" } };
  assert.equal(recoveryJobId({ code: "AI_REQUEST_IN_PROGRESS", ...job }), "job_123");
  assert.equal(recoveryJobId({ code: "AI_RECONCILIATION_REQUIRED", ...job }), "job_123");
  assert.equal(recoveryJobId({ code: "IDEMPOTENCY_CONFLICT", ...job }), null);
  assert.equal(existingJobId(job), "job_123");
  assert.equal(actionForFailure({ ok: false, status: 409, error: { code: "AI_REQUEST_IN_PROGRESS", ...job } }), "poll");
  assert.equal(actionForFailure({ ok: false, status: 409, error: { code: "IDEMPOTENCY_CONFLICT", ...job } }), "stop");
  assert.equal(actionForFailure({ ok: false, status: 503, error: { code: "AI_MAINTENANCE", details: { accepted: false } } }), "retry");
  assert.equal(actionForFailure({ ok: false, status: 503, error: { code: "AI_MAINTENANCE", ...job } }), "poll");
  assert.equal(actionForFailure({ ok: false, status: 503, error: { code: "AI_MAINTENANCE" } }), "stop");
  assert.equal(actionForFailure({ ok: false, status: 429, error: { code: "AI_RATE_LIMIT_EXCEEDED" } }), "retry");
  assert.equal(actionForFailure({ ok: false, status: 0, networkError: true }), "retry");
});

test("curl examples keep the API key placeholder", () => {
  const curl = buildCurl({
    method: "POST",
    path: "/v1/ai/text/translate",
    idempotencyKey: "text-translation-001",
    body: { texts: ["hello"], target_language: "en" },
  });
  assert.match(curl, /YOUR_APP_API_KEY/);
  assert.match(curl, /\$HIOBUY_AI_SHOP/);
  assert.doesNotMatch(curl, /hio_(live|test)_/);
});

test("base URL must be https and cannot carry credentials", () => {
  assert.equal(normalizeBaseUrl("https://api.hiobuy.com/ignored"), "https://api.hiobuy.com");
  assert.throws(() => normalizeBaseUrl("http://api.hiobuy.com"));
  assert.throws(() => normalizeBaseUrl("https://user:pass@api.hiobuy.com"));
  assert.throws(() => readConfig({ HIOBUY_API_BASE_URL: "http://169.254.169.254" } as NodeJS.ProcessEnv));
});

test("env file does not override existing values", () => {
  const env: NodeJS.ProcessEnv = { UNTOUCHED: "preset" };
  loadEnvFile(path.join(here, "fixtures/sample.env"), env);
  assert.equal(env.HIOBUY_API_KEY, "example-key");
  assert.equal(env.HIOBUY_AI_SHOP, "shop.example");
  assert.equal(env.UNTOUCHED, "preset");
  assert.equal(readFileSync(path.join(here, "fixtures/sample.env"), "utf8").includes("hio_live_"), false);
});
