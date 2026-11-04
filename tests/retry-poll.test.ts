import assert from "node:assert/strict";
import { test } from "node:test";
import type { AiJob } from "../shared/contract.ts";
import { pollJob } from "../shared/poll.ts";
import { postWithRetry } from "../shared/retry.ts";
import type { DemoResult } from "../shared/errors.ts";

test("network and rate-limit retries reuse the same send closure", async () => {
  const keys: string[] = [];
  let attempt = 0;
  const result = await postWithRetry({
    sleep: async () => {},
    send: async () => {
      keys.push("same-key");
      attempt += 1;
      if (attempt < 3) {
        return { ok: false, status: 429, retry_after_ms: 10, error: { code: "AI_RATE_LIMIT_EXCEEDED", message: "slow", request_id: "req_rate" } };
      }
      return { ok: true, status: 200, request_id: "req_ok", data: { translations: [] } };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(keys, ["same-key", "same-key", "same-key"]);
});

test("an in-progress conflict is not submitted again", async () => {
  let sends = 0;
  const result = await postWithRetry<unknown>({
    sleep: async () => {},
    send: async () => {
      sends += 1;
      return {
        ok: false,
        status: 409,
        request_id: "req_conflict",
        error: {
          code: "AI_REQUEST_IN_PROGRESS",
          message: "Already running",
          request_id: "req_conflict",
          details: { job_id: "job_existing" },
        },
      };
    },
  });
  assert.equal(sends, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.details?.job_id, "job_existing");
});

test("validation errors are not retried", async () => {
  let sends = 0;
  await postWithRetry({
    sleep: async () => {},
    send: async () => {
      sends += 1;
      return { ok: false, status: 400, request_id: "req_bad", error: { code: "UNSAFE_IMAGE_URL", message: "Rejected", request_id: "req_bad" } };
    },
  });
  assert.equal(sends, 1);
});

test("polling stays on one job through provider_succeeded and stops on a terminal status", async () => {
  const seen: string[] = [];
  const script: Array<"running" | "provider_succeeded" | "completed" | "failed" | "refunded"> = ["running", "provider_succeeded", "completed"];
  const outcome = await pollJob({
    jobId: "job_1",
    now: () => 0,
    maxMs: 60_000,
    sleep: async () => {},
    fetchJob: async (jobId) => {
      seen.push(jobId);
      const step = script[seen.length - 1] ?? "completed";
      const job: AiJob = {
        id: jobId,
        status: step === "provider_succeeded" ? "running" : step,
        billing_state: step === "provider_succeeded" ? "provider_succeeded" : step,
        credits_reserved: 1,
        credits_used: step === "completed" ? 1 : 0,
        output: step === "completed" ? { url: "https://cdn.example.com/result.webp" } : null,
      };
      return { ok: true, job, requestId: "req_job" };
    },
  });
  assert.deepEqual(seen, ["job_1", "job_1", "job_1"]);
  assert.equal(outcome.kind, "terminal");
  if (outcome.kind === "terminal") assert.equal(outcome.job.output?.url, "https://cdn.example.com/result.webp");
});

test("failed and refunded jobs stop polling", async () => {
  for (const status of ["failed", "refunded"] as const) {
    let polls = 0;
    const outcome = await pollJob({
      jobId: "job_stop",
      now: () => 0,
      maxMs: 60_000,
      sleep: async () => {},
      fetchJob: async () => {
        polls += 1;
        return { ok: true, requestId: "req_job", job: { id: "job_stop", status, credits_used: 0, error: { code: "AI_JOB_TIMEOUT", message: "Stopped", retryable: false } } };
      },
    });
    assert.equal(polls, 1);
    assert.equal(outcome.kind, "terminal");
  }
});

test("429 polling waits and does not create another job id", async () => {
  const waits: number[] = [];
  let calls = 0;
  const outcome = await pollJob({
    jobId: "job_rate",
    now: () => 0,
    maxMs: 60_000,
    sleep: async (ms) => { waits.push(ms); },
    fetchJob: async (jobId) => {
      calls += 1;
      assert.equal(jobId, "job_rate");
      if (calls === 1) {
        return { ok: false, status: 429, retryAfterMs: 10_000, error: { code: "AI_RATE_LIMIT_EXCEEDED", message: "slow", request_id: "req_rate" } };
      }
      return { ok: true, requestId: "req_job", job: { id: jobId, status: "completed", output: { url: "https://cdn.example.com/out.webp" } } };
    },
  });
  assert.deepEqual(waits, [10_000]);
  assert.equal(outcome.kind, "terminal");
});

test("polling times out without switching job ids", async () => {
  let clock = 0;
  const seen: string[] = [];
  const outcome = await pollJob({
    jobId: "job_wait",
    now: () => clock,
    maxMs: 3_000,
    sleep: async (ms) => { clock += ms; },
    fetchJob: async (jobId) => {
      seen.push(jobId);
      return { ok: true, requestId: null, job: { id: jobId, status: "running", billing_state: "reconciliation" } };
    },
  });
  assert.equal(outcome.kind, "timeout");
  assert.ok(seen.length > 1);
  assert.equal(new Set(seen).size, 1);
});

test("upstream network failures retry and then stop", async () => {
  let sends = 0;
  const result: DemoResult<unknown> = await postWithRetry({
    sleep: async () => {},
    send: async () => {
      sends += 1;
      return { ok: false, status: 503, request_id: null, error: { code: "DEMO_UPSTREAM_NETWORK", message: "timeout", request_id: null } };
    },
  });
  assert.equal(sends, 3);
  assert.equal(result.ok, false);
});
