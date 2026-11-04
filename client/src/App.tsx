import { useState } from "react";
import { isTerminalJobStatus, type AiJob, type PriceView } from "../../shared/contract.ts";
import { DOCS_URL, GITHUB_URL, OPENAPI_URL, PORTAL_URL, SUPPORT_EMAIL } from "./config.ts";
import { FEATURES, FORMAT_OPTIONS, SCENE_OPTIONS, SOURCE_LANGUAGES, TARGET_LANGUAGES } from "./features.ts";
import { formatCredits } from "./format.ts";
import { useDemo, type DemoOutput } from "./useDemo.ts";

export function App() {
  const demo = useDemo();
  const status = statusLabel(demo.run.phase, demo.output, demo.run.phase === "polling");

  return (
    <>
      <header>
        <strong><span>HIO</span>Buy <small>AI Developer Demo</small></strong>
        <nav>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">API Documentation</a>
        </nav>
      </header>
      <main className="wrap">
        <div className="intro">
          <div>
            <div className="kicker">Build with HIOBuy AI</div>
            <h1>AI Playground</h1>
            <p>Call the four public Commerce AI operations through a local server, then inspect the request, task status, and result.</p>
          </div>
          <aside className="gift">
            <b>Trial credits</b>
            <p>New developers may receive 100 free AI Credits, subject to current eligibility.</p>
          </aside>
        </div>
        <div className="layout">
          <aside className="card sidebar">
            {FEATURES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === demo.feature ? "nav active" : "nav"}
                aria-pressed={item.id === demo.feature}
                onClick={() => demo.setFeature(item.id)}
              >
                <span className="mark">{item.mark}</span>
                {item.nav}
              </button>
            ))}
          </aside>
          <section>
            <div className="card">
              <div className="head">
                <div>
                  <h2>{demo.selected.title}</h2>
                  <p>{demo.selected.description}</p>
                  <p className="endpoint">{demo.selected.endpoint}</p>
                </div>
                <span className={demo.session?.account_ok ? "badge" : "badge warn"}>
                  {demo.sessionLoading ? "Loading account" : demo.session?.account_ok ? creditsPhrase(demo.session.balance) : "Setup needed"}
                </span>
              </div>
              {demo.session && !demo.session.account_ok ? <ConfigBanner message={demo.session.error?.message} requestId={demo.session.error?.request_id} /> : null}
              {!demo.session && !demo.sessionLoading ? <ConfigBanner message="The local API server is not running. Start it with npm run dev." requestId={null} /> : null}
              <div className="columns">
                <section className="section">
                  {demo.feature === "translate" ? (
                    <>
                      <label htmlFor="source">Source text</label>
                      <textarea id="source" className="field" value={demo.text} onChange={(event) => demo.setText(event.target.value)} />
                      <p className="small">{demo.textUnits.toLocaleString("en-US")} / 50,000 UTF-16 units. This demo sends one trimmed string in texts.</p>
                      <div className="row">
                        <div>
                          <label htmlFor="from">Source language</label>
                          <select id="from" className="field" value={demo.sourceLanguage} onChange={(event) => demo.setSourceLanguage(event.target.value)}>
                            {SOURCE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="to">Target language</label>
                          <select id="to" className="field" value={demo.targetLanguage} onChange={(event) => demo.setTargetLanguage(event.target.value)}>
                            {TARGET_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="row">
                        <div>
                          <label htmlFor="scene">Scene</label>
                          <select id="scene" className="field" value={demo.scene} onChange={(event) => demo.setScene(event.target.value as typeof demo.scene)}>
                            {SCENE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="format">Format</label>
                          <select id="format" className="field" value={demo.formatType} onChange={(event) => demo.setFormatType(event.target.value as typeof demo.formatType)}>
                            {FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <label htmlFor="image-url">Image URL</label>
                      <input
                        id="image-url"
                        className="field"
                        type="url"
                        inputMode="url"
                        placeholder="https://cdn.example.com/product.jpg"
                        spellCheck={false}
                        value={demo.imageUrl}
                        onChange={(event) => demo.setImageUrl(event.target.value)}
                      />
                      <ImagePreview url={demo.imageUrl} />
                      <p className="hint">Use an HTTPS image on a Gateway-approved host. This demo does not upload files.</p>
                      {demo.feature === "replace" ? (
                        <div className="row">
                          <div>
                            <label htmlFor="image-lang">Target language</label>
                            <select id="image-lang" className="field" value={demo.imageLanguage} onChange={(event) => demo.setImageLanguage(event.target.value)}>
                              {TARGET_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                            </select>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                  <PriceLine price={demo.price} feature={demo.selected.feature} />
                  <EstimateLine
                    estimating={demo.estimating}
                    estimate={demo.estimateResult}
                    error={demo.estimateError}
                  />
                  <button className="btn" type="button" disabled={!demo.canRun} onClick={() => void demo.execute()}>
                    {demo.running ? "Working" : "Run"}
                  </button>
                  {demo.inputError && !demo.running && hasDraft(demo.feature, demo.text, demo.imageUrl) ? <p className="hint warn">{demo.inputError}</p> : null}
                </section>
                <section className="section">
                  <div className="stage-head">
                    <span>Result</span>
                    <span className={`pill ${pillTone(demo.run.phase)}`}>{status}</span>
                  </div>
                  <Result
                    output={demo.output}
                    run={demo.run}
                    balance={demo.session?.balance ?? null}
                    idle={demo.feature === "translate"
                      ? "The translation and the credits used appear here."
                      : "The result stays here while the job queues and finishes."}
                  />
                  {demo.activeJobId && (demo.run.phase === "timeout" || demo.run.phase === "error") ? (
                    <button className="textbtn" type="button" onClick={() => void demo.refreshStatus()}>
                      Check this job
                    </button>
                  ) : null}
                </section>
              </div>
            </div>
            <div className="card codecard">
              <div className="codehead">
                <div>
                  <h3>API Request Example</h3>
                  <p className="small">{demo.requestLabel}. The key stays on the server.</p>
                </div>
                <CopyButton text={demo.curl} label="Copy cURL" />
              </div>
              <pre data-testid="curl">{demo.curl}</pre>
              <div className="codehead response-head">
                <div>
                  <h3>{demo.responseLabel}</h3>
                  <p className="small">
                    {demo.responseLabel === "Illustrative response shape"
                      ? "Illustrative numbers are not a price quote. Use rules[].credits and the estimate response."
                      : "Returned by the API for this run. The key is not included."}
                  </p>
                </div>
                <CopyButton text={JSON.stringify(demo.responseBody, null, 2)} label="Copy JSON" />
              </div>
              <pre>{JSON.stringify(demo.responseBody, null, 2)}</pre>
              <div className="foot">
                Keep your API key on the server. No payment, login, or recharge flow is included.
                {" "}
                <a href={DOCS_URL} target="_blank" rel="noreferrer">Commerce AI docs</a>
                {" · "}
                <a href={OPENAPI_URL} target="_blank" rel="noreferrer">openapi.json</a>
                {" · "}
                <a href={PORTAL_URL} target="_blank" rel="noreferrer">Developer Center</a>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function ConfigBanner({ message, requestId }: { message?: string | null; requestId?: string | null }) {
  return (
    <div className="banner">
      <p>{message || "Add HIOBUY_API_KEY and HIOBUY_AI_SHOP to the server environment."}</p>
      {requestId ? <p className="small">Request ID: {requestId}</p> : null}
      <p className="small">Copy the shop from GET /v1/ai/account or this App&apos;s HTTP example. Do not invent a domain.</p>
    </div>
  );
}

function PriceLine({ price, feature }: { price: PriceView | undefined; feature: string }) {
  let text = "No effective price returned for this feature.";
  if (price && !price.missing && price.credits != null) {
    const unit = feature === "text.translate" ? "per 1,000 UTF-16 units" : "per image";
    text = price.enabled
      ? `${creditsPhrase(price.credits)} ${unit}`
      : "This feature is disabled for the current app.";
  }
  return <p className="price">{text}</p>;
}

function EstimateLine({
  estimating,
  estimate,
  error,
}: {
  estimating: boolean;
  estimate: { credits_required?: number; can_afford?: boolean; credits_shortfall?: number; request_id?: string } | null;
  error: { message: string; request_id: string | null } | null;
}) {
  if (estimating && !estimate) return <p className="small">Estimating credits…</p>;
  if (error) {
    return <p className="small">Estimate unavailable: {error.message}{error.request_id ? ` Request ID: ${error.request_id}` : ""}</p>;
  }
  if (!estimate || typeof estimate.credits_required !== "number") return null;
  return (
    <p className="small">
      Estimate {creditsPhrase(estimate.credits_required)}. This does not reserve credits.
      {estimate.can_afford === false ? ` Short by ${creditsPhrase(estimate.credits_shortfall)}.` : ""}
      {estimate.can_afford === false ? <> <a href={PORTAL_URL} target="_blank" rel="noreferrer">Open Developer Center</a></> : null}
    </p>
  );
}

function Result({
  output,
  run,
  balance,
  idle,
}: {
  output: DemoOutput | null;
  run: { phase: string; headline?: string; message?: string; requestId?: string | null; code?: string };
  balance: number | null;
  idle: string;
}) {
  if (run.phase === "submitting") {
    return <Progress testId="output" title="Sending" message="One request is on its way. A new run is a new charge." step="submit" />;
  }
  if (run.phase === "error" || run.phase === "timeout") {
    return (
      <div data-testid="output">
        <div className="stage issue">
          <h3>{run.headline}</h3>
          <p>{run.message}</p>
          {run.requestId ? <p className="ids">Request {run.requestId}</p> : null}
          {run.headline === "Not enough AI credits" ? (
            <p><a href={PORTAL_URL} target="_blank" rel="noreferrer">Open Developer Center</a></p>
          ) : null}
          <p className="hint">Include the request ID when you write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        </div>
        {output?.kind === "image" && resultSrc(output.job) ? <ImageResult output={output} balance={balance} /> : null}
      </div>
    );
  }
  if (output?.kind === "text") {
    return (
      <div data-testid="output">
        <div className="output text">{output.translated}</div>
        <p className="receipt">
          {output.detected ? `Detected ${output.detected} · ` : ""}
          {output.characterCount == null ? "" : `${output.characterCount.toLocaleString("en-US")} UTF-16 units · `}
          Used {creditsPhrase(output.creditsUsed)} · Balance {creditsPhrase(balance)}
        </p>
        {output.requestId ? <p className="ids">Request {output.requestId}</p> : null}
        <div className="actions">
          <CopyButton text={output.translated} label="Copy translation" />
        </div>
      </div>
    );
  }
  if (output?.kind === "image") {
    return (
      <div data-testid="output">
        <ImageResult output={output} balance={balance} />
      </div>
    );
  }
  if (run.phase === "polling") {
    return <Progress testId="output" title="Working" message="This page keeps checking the same job." step="process" />;
  }
  return (
    <div className="stage" data-testid="output">
      <h3>Ready when you are</h3>
      <p>{idle}</p>
    </div>
  );
}

function ImageResult({ output, balance }: { output: Extract<DemoOutput, { kind: "image" }>; balance: number | null }) {
  const src = resultSrc(output.job);
  const pending = !isTerminalJobStatus(output.job.status);
  if (pending) {
    const progress = progressCopy(output.job);
    return (
      <Progress
        testId="job-progress"
        title={progress.title}
        message={progress.message}
        step={progress.step}
        jobId={output.job.id}
        requestId={output.requestId}
      />
    );
  }
  return (
    <>
      {src ? (
        <figure className="hero">
          <img src={src} alt="Processed product" />
        </figure>
      ) : (
        <div className="stage">
          <h3>Finished without an image</h3>
          <p>The job ended, and the response did not include a result image.</p>
        </div>
      )}
      <p className="receipt">
        {output.job.status === "completed" ? `Used ${creditsPhrase(output.job.credits_used)}` : prettyStatus(output.job.status)}
        {" · "}
        Balance {creditsPhrase(balance)}
      </p>
      <p className="ids">Job {output.job.id}{output.requestId ? ` · Request ${output.requestId}` : ""}</p>
      {src ? (
        <div className="actions">
          <button className="btn secondary" type="button" onClick={() => void downloadResult(output.job, src)}>Download</button>
        </div>
      ) : null}
    </>
  );
}

function Progress({
  title,
  message,
  step,
  jobId,
  requestId,
  testId,
}: {
  title: string;
  message: string;
  step: "submit" | "queue" | "process" | "finish";
  jobId?: string;
  requestId?: string | null;
  testId: string;
}) {
  const steps = [
    ["submit", "Sent"],
    ["queue", "Queued"],
    ["process", "Processing"],
    ["finish", "Result"],
  ] as const;
  const active = steps.findIndex(([id]) => id === step);
  return (
    <div className="stage" data-testid={testId}>
      <ol className="steps" aria-label="Job progress">
        {steps.map(([id, label], index) => (
          <li key={id} className={index < active ? "done" : index === active ? "current" : undefined}>{label}</li>
        ))}
      </ol>
      <h3>{title}</h3>
      <p>{message}</p>
      {jobId || requestId ? <p className="ids">{jobId ? `Job ${jobId}` : ""}{jobId && requestId ? " · " : ""}{requestId ? `Request ${requestId}` : ""}</p> : null}
    </div>
  );
}

function ImagePreview({ url }: { url: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const https = url.startsWith("https://");
  if (!https) return null;
  if (failedUrl === url) {
    return <p className="hint">The browser could not preview this host. The API still downloads the image.</p>;
  }
  return (
    <div className="preview">
      <img src={url} alt="Source preview" onError={() => setFailedUrl(url)} />
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => setCopied(false));
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function resultSrc(job: AiJob): string | null {
  const url = job.output?.url;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.pathname.includes("/v1/ai/assets/")) return `/api/assets/${encodeURIComponent(job.id)}`;
    return url;
  } catch {
    return null;
  }
}

async function downloadResult(job: AiJob, src: string) {
  if (src.startsWith("/api/")) {
    const response = await fetch(src);
    if (!response.ok) return;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${job.id}.webp`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = src;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.click();
}

function hasDraft(feature: string, text: string, imageUrl: string): boolean {
  return feature === "translate" ? text.trim().length > 0 : imageUrl.trim().length > 0;
}

function statusLabel(phase: string, output: DemoOutput | null, polling: boolean): string {
  if (phase === "submitting") return "Sending";
  if (polling && output?.kind === "image") {
    const step = progressCopy(output.job).step;
    if (step === "queue") return "Queued";
    if (step === "finish") return "Finishing";
    return "Processing";
  }
  if (polling) return "Working";
  if (phase === "done") return "Done";
  if (phase === "timeout") return "Stopped";
  if (phase === "error") return "Needs attention";
  return "Ready";
}

function pillTone(phase: string): string {
  if (phase === "done") return "ok";
  if (phase === "error" || phase === "timeout") return "bad";
  if (phase === "submitting" || phase === "polling") return "live";
  return "";
}

function creditsPhrase(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${formatCredits(value)} ${value === 1 ? "credit" : "credits"}`;
}

function prettyStatus(status: string | undefined): string {
  if (status === "failed") return "Failed";
  if (status === "refunded") return "Refunded";
  if (status === "completed") return "Done";
  return status || "Finished";
}

function progressCopy(job: AiJob): { title: string; message: string; step: "queue" | "process" | "finish" } {
  const reserved = typeof job.credits_reserved === "number" ? `${creditsPhrase(job.credits_reserved)} reserved. ` : "";
  if (job.billing_state === "reconciliation") {
    return { step: "finish", title: "Confirming the charge", message: "The image step finished. This page keeps checking the same job." };
  }
  if (job.billing_state === "provider_succeeded") {
    return { step: "finish", title: "Preparing the image", message: "The provider finished. The result appears here when the job completes." };
  }
  if (job.status === "running") {
    return { step: "process", title: "Processing the image", message: `${reserved}This page checks the same job until it finishes.` };
  }
  return { step: "queue", title: "Queued", message: `${reserved}Nothing else is charged while it waits.` };
}
