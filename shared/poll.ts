import { isTerminalJobStatus, type AiJob } from "./contract.ts";
import { abortError, nextPollDelayMs } from "./retry.ts";

export type JobFetchResult =
  | { ok: true; job: AiJob; requestId: string | null }
  | {
      ok: false;
      status: number;
      retryAfterMs?: number;
      error: { code: string; message: string; request_id: string | null; details?: Record<string, unknown> };
    };

export type PollOutcome =
  | { kind: "terminal"; job: AiJob; requestId: string | null; polls: number }
  | { kind: "timeout"; jobId: string; polls: number }
  | {
      kind: "error";
      status: number;
      polls: number;
      error: { code: string; message: string; request_id: string | null };
    };

export async function pollJob(options: {
  jobId: string;
  fetchJob: (jobId: string) => Promise<JobFetchResult>;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  maxMs?: number;
  signal?: AbortSignal;
  jitter?: () => number;
}): Promise<PollOutcome> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.maxMs ?? 11 * 60 * 1000);
  let polls = 0;
  let attempt = 0;
  while (true) {
    if (options.signal?.aborted) throw abortError();
    if (now() > deadline) return { kind: "timeout", jobId: options.jobId, polls };
    const result = await options.fetchJob(options.jobId);
    polls += 1;
    if (!result.ok) {
      if (result.status === 429) {
        await options.sleep((result.retryAfterMs ?? 10_000) + (options.jitter?.() ?? 0));
        continue;
      }
      return { kind: "error", status: result.status, polls, error: result.error };
    }
    if (isTerminalJobStatus(result.job.status)) {
      return { kind: "terminal", job: result.job, requestId: result.requestId, polls };
    }
    await options.sleep(nextPollDelayMs(attempt) + (options.jitter?.() ?? 0));
    attempt += 1;
  }
}
