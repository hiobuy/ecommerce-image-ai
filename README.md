# HIOBuy Commerce AI API Demo

Developer demo for the four public [Commerce AI](https://hiobuy.com/en/api-docs/commerce-ai) operations. The page runs in your browser. The API key stays on a small local Node server that calls `https://api.hiobuy.com`.

This is an example project. It does not sign people in, take payment, or sell credits.

Automated tests use mock responses. They do not prove that a live HIOBuy account accepted a request.

## Features

- Text translation: `POST /v1/ai/text/translate` (`text.translate`)
- Remove Chinese text: `POST /v1/ai/image/jobs` with `remove_chinese_text`
- Translate image text: `POST /v1/ai/image/jobs` with `replace_chinese_text`
- White background: `POST /v1/ai/image/jobs` with `white_background` (price feature `image.background`)
- Balance from `GET /v1/ai/credits`
- Effective prices from `rules[].credits` and `rules[].enabled` on `GET /v1/ai/credits/pricing`
- Pre-run estimate from `POST /v1/ai/credits/estimate`
- Image task polling through `GET /v1/ai/jobs/{job_id}`

`image.lifestyle` and other private operations are not included.

## Requirements

- Node.js 20 or newer
- npm
- A HIOBuy App API key with access to Commerce AI
- The prepaid AI account `shop` for that same key

No database, Redis, Docker, or cloud account is required.

## Getting an API Key

1. Open the [Developer Center](https://developers.hiobuy.com).
2. Create an API key for the App you want this demo to use.
3. Enable AI access for that App. A product subscription does not by itself enable Commerce AI.
4. Prepaid calls need a key with the `product:translate` scope. Test keys are rejected by live AI.

Put the key only in the server environment. Do not paste it into frontend code, tickets, or screenshots.

## AI Account Configuration

`HIOBUY_AI_SHOP` is the billing account identifier, not an App ID, Workspace ID, or a domain you make up.

Discover it with the API key and no `X-Shop-Domain` header:

```bash
curl --fail --silent 'https://api.hiobuy.com/v1/ai/account' \
  --header "Authorization: Bearer $HIOBUY_API_KEY"
```

Copy the returned `shop`. You can also copy the same value from that App's HTTP example in Developer Center. Create the prepaid account under Developer Center → AI Enhancement if the call returns `404 AI_ACCOUNT_NOT_FOUND`.

On startup, and before any shop-scoped call, this demo compares `HIOBUY_AI_SHOP` with `GET /v1/ai/account`. If they differ, it stops. A different shop selects a different account.

## Installation

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
HIOBUY_API_KEY=
HIOBUY_AI_SHOP=
HIOBUY_API_BASE_URL=https://api.hiobuy.com
PORT=8790
```

## Running Locally

```bash
npm run dev
```

Open http://127.0.0.1:5173. The Vite page proxies `/api` to http://127.0.0.1:8790. The API process listens on localhost only.

Production build:

```bash
npm run build
npm start
```

`npm start` serves the built page and the API on port 8790.

Other checks:

```bash
npm run typecheck
npm test
```

## API Examples

Replace the placeholders on your own server. The browser copy button uses the same placeholders.

```bash
curl --request POST "$HIOBUY_API_BASE_URL/v1/ai/text/translate" \
  --header "Authorization: Bearer YOUR_APP_API_KEY" \
  --header "X-Shop-Domain: $HIOBUY_AI_SHOP" \
  --header "X-Idempotency-Key: text-translation-001" \
  --header "Content-Type: application/json" \
  --data '{"texts":["纯棉短袖T恤"],"source_language":"zh","target_language":"en","format_type":"text","scene":"e-commerce-title"}'
```

```bash
curl --request POST "$HIOBUY_API_BASE_URL/v1/ai/image/jobs" \
  --header "Authorization: Bearer YOUR_APP_API_KEY" \
  --header "X-Shop-Domain: $HIOBUY_AI_SHOP" \
  --header "X-Idempotency-Key: remove-image-001" \
  --header "Content-Type: application/json" \
  --data '{"type":"remove_chinese_text","image_url":"https://cdn.example.com/product.jpg"}'
```

`replace_chinese_text` also sends `target_language`. `white_background` does not. Poll `GET /v1/ai/jobs/YOUR_JOB_ID` until `job.status` is `completed`, `failed`, or `refunded`. HTTP 200 and 202 only mean the job record was returned.

Text requests accept 1–50 non-empty strings. The trimmed total must be at most 50,000 UTF-16 units. This page sends the textarea as one string.

Scenes: `e-commerce-title`, `e-commerce-description`, `e-commerce-chat`, `e-commerce-cpv`, `novel`, `game`. `format_type` is `text` or `html`.

## Image URL Requirements

`image_url` must be HTTPS on a host the Gateway allows. The API rejects local files, base64, multipart uploads, and arbitrary public domains. A URL that opens in a browser can still be rejected.

This demo does not upload files and does not add storage. Host the image yourself on an approved CDN, or ask HIOBuy to review the host. The signed-in Developer Center playground upload is not a public API.

Default download limits published with the API are 10 MiB, 25,000,000 pixels, 3 redirects, and 15 seconds. Deployment settings can differ.

## Credits & Pricing

The page shows:

- `credits_balance` from `GET /v1/ai/credits`
- the selected feature's `rules[].credits` when `rules[].enabled` is true
- `credits_required` from the estimate call
- `credits_used` after the operation, then a fresh balance read

`default_credits` is not used as the price. Estimate does not reserve credits and does not guarantee the later charge. The demo does not calculate a balance by subtracting locally, and it does not sell credits.

New developers may receive 100 free AI Credits, subject to current eligibility. That is not a promise that every account has 100 credits. Product API trial units are a different quota.

If the balance is too low, the page shows the API error and links to the Developer Center.

## Troubleshooting

| What you see | What to check |
|---|---|
| Setup needed / `DEMO_NOT_CONFIGURED` | `.env` has both `HIOBUY_API_KEY` and `HIOBUY_AI_SHOP`. Restart `npm run dev`. |
| `DEMO_ACCOUNT_MISMATCH` | `HIOBUY_AI_SHOP` is not the `shop` from `GET /v1/ai/account`. |
| 401 | The API key is missing, revoked, or not a Bearer token. |
| 402 | The account does not have enough credits. Top up in Developer Center if you want to continue. |
| 403 | AI access, `product:translate`, or the feature is not enabled. Test keys cannot call live AI. |
| 400 `IMAGE_HOST_NOT_ALLOWED` or `UNSAFE_IMAGE_URL` | Use an approved HTTPS image host. |
| 409 `AI_REQUEST_IN_PROGRESS` or `AI_RECONCILIATION_REQUIRED` | The demo polls `details.job_id`. Do not start another paid task for the same outcome. |
| 429 | Wait for `Retry-After`. Creation, polling, and metadata have separate limits. |
| 503 | If nothing was accepted, retry the same idempotency key and body. If a job id exists, poll that job. |

Contact [support@hiobuy.com](mailto:support@hiobuy.com) with the request ID. Do not send the API key.

`job.billing_state` values include `reserved`, `executing`, `provider_succeeded`, `completed`, `refunded`, and `reconciliation`. `provider_succeeded` or `reconciliation` can still show `job.status` as `running`. Keep polling that job.

Refreshing status reads the same job. Run again creates a new idempotency key and can charge again.

## Security

- The browser talks only to `/api/*` on the local server.
- `Authorization` is added in `server/`. It is not written to `localStorage`, the page bundle, or the copy-paste cURL.
- The server allows only the Commerce AI operations used by this demo. It is not an open URL proxy.
- Image and job ids are checked before they are placed in a path.
- Error bodies drop unrecognized detail fields and redact bearer tokens and the configured key.
- The dev server binds to `127.0.0.1`.
- Do not commit `.env`.

Before publishing, change the GitHub link in `client/src/config.ts` if the repository URL is different. This project does not create the GitHub repository for you.

## License

MIT. See [LICENSE](LICENSE).
