# Putting Applyance live

This guide puts Applyance on [Render](https://render.com), which runs everything Applyance needs (the web app, the API, the browser worker, Postgres and Redis) from one file in this repository, `render.yaml`. It takes about an hour the first time. Nothing here costs money until you create the Render services in step 5.

You need accounts with five services. All of them have a free tier or free trial except Render itself.

| Service | What it's for | Rough cost |
| --- | --- | --- |
| [Render](https://render.com) | Runs the app, API, worker, database and Redis | About $50–60 a month with the plans in `render.yaml` |
| [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) (or AWS S3) | Stores resumes, cover letters and screenshots | Free up to 10 GB |
| [Resend](https://resend.com) | Sends password reset, email confirmation and alert emails | Free up to 3,000 emails a month |
| [Stripe](https://stripe.com) | Takes payments for the Pro plan | 2.9% + 30¢ per payment, no monthly fee |
| A domain name (Cloudflare, Namecheap, Google Domains…) | Your address, like `app.applyance.com` | About $10–15 a year |

The AI features are optional; they need an [Anthropic](https://console.anthropic.com) or OpenAI API key.

---

## 1. Make the encryption key

On your computer, in a terminal:

```bash
openssl rand -base64 32
```

Copy the output into a password manager and label it **Applyance DATA_ENCRYPTION_KEY**. It encrypts sensitive answers and saved sign-ins. If it's lost, that data can't be read; if it leaks, change it only with a plan to re-encrypt.

## 2. File storage (Cloudflare R2)

1. In the Cloudflare dashboard, open **R2** and choose **Create bucket**. Name it `applyance-documents`. Leave public access **off**.
2. On the R2 overview page choose **Manage R2 API Tokens → Create API token**. Permission: **Object Read & Write**, limited to the `applyance-documents` bucket.
3. Write down:
   - `S3_ENDPOINT`: the "S3 API" address shown on the bucket page, like `https://<account-id>.r2.cloudflarestorage.com`
   - `S3_BUCKET`: `applyance-documents`
   - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`: from the token page (the secret is shown once)

## 3. Email (Resend)

1. Sign up at Resend and choose **Domains → Add domain**. Enter your domain (for example `applyance.com`) and add the DNS records it shows at your domain provider. Wait until it says **Verified**.
2. Choose **API Keys → Create API key** with **Sending access**. Write it down as `RESEND_API_KEY`.
3. Decide the sender, for example `Applyance <hello@applyance.com>`. That's `EMAIL_FROM`.

## 4. Payments (Stripe)

Start in **test mode** (the "Test mode" switch at the top of the Stripe dashboard). Nothing is charged in test mode; use card `4242 4242 4242 4242` with any future date and CVC.

1. **Product catalog → Add product.** Name: `Applyance Pro`. Add two recurring prices: **$29 monthly** and **$290 yearly**. (These match `packages/shared/src/plans.ts`. If you change a price, change it in both places.)
2. Open each price and copy its id (starts with `price_`). These are `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_PRO_YEARLY`.
3. **Developers → API keys.** Copy the **Secret key** (starts with `sk_test_`). That's `STRIPE_SECRET_KEY`.
4. **Settings → Billing → Customer portal.** Turn on: update payment methods, view invoices, cancel subscriptions (at the end of the period), and switch plans between the two Pro prices. Save.
5. The webhook comes in step 7, once the app has an address.

## 5. Create the services on Render

1. Sign up at Render with your GitHub account and allow it to read the `Job-Application-API` repository.
2. Choose **New → Blueprint**, pick the repository, and Render reads `render.yaml`.
3. Render lists what it will create: `applyance-web`, `applyance-api`, `applyance-worker`, `applyance-db` and `applyance-redis`, and asks for every value it can't fill in itself. Paste in:

| Name | Value |
| --- | --- |
| `DATA_ENCRYPTION_KEY` | From step 1 |
| `APP_URL` | For now, `https://applyance-web.onrender.com` (you'll change it to your domain in step 6) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | From step 2 |
| `RESEND_API_KEY`, `EMAIL_FROM` | From step 3 |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` | From step 4 |
| `STRIPE_WEBHOOK_SECRET` | Leave empty for now (step 7) |
| `ANTHROPIC_API_KEY` | Optional |

4. Choose **Apply**. The first build takes 10–15 minutes. Render runs the database migrations before the web app starts.
5. Open `https://applyance-web.onrender.com`. You should see the Applyance home page. Create your own account.

## 6. Your domain

1. In Render, open **applyance-web → Settings → Custom Domains → Add**, enter `app.yourdomain.com`, and add the CNAME record it shows at your domain provider. Render issues the HTTPS certificate by itself.
2. In Render, open **Environment Groups → applyance-shared** and change `APP_URL` to `https://app.yourdomain.com`. Save; the services restart.

## 7. Stripe webhook

1. In Stripe, **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://app.yourdomain.com/api/stripe/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Save, then **Reveal** the signing secret (starts with `whsec_`). Put it in `STRIPE_WEBHOOK_SECRET` in the `applyance-shared` group on Render.
5. Test it: sign in to Applyance, open **Plan & billing**, choose **Upgrade to Pro**, pay with `4242 4242 4242 4242`. Back on Plan & billing, the plan should say **Pro** within a few seconds. Then try **Manage billing → Cancel**.

## 8. Make yourself the admin

In Render, open **applyance-web → Shell** and run (with your own email):

```bash
pnpm admin:grant you@example.com
```

## 9. Going live with real payments

When everything works in test mode:

1. In Stripe, switch off test mode and repeat step 4 (products, prices, secret key, customer portal) and step 7 (webhook) in live mode. Live keys start with `sk_live_`.
2. Replace the four Stripe values on Render with the live ones.
3. Have the Terms of Service and Privacy Policy reviewed, and fill in your business details in `apps/web/src/config/company.ts`.

---

## Changing plans and prices

Plan names, prices shown on the site, monthly limits and feature lists are all in `packages/shared/src/plans.ts`. What customers are actually charged is the Stripe price. When you change a price, create a new price in Stripe, update the `STRIPE_PRICE_PRO_*` value on Render, and change the number in `plans.ts`.

Without Stripe keys (local development, or a private install just for you) billing is off and every account gets the Pro plan's limits.

## Running the containers anywhere else

The three images build from the repository root and run on any host that runs Docker containers:

```bash
docker build -f docker/web.Dockerfile -t applyance-web .
docker build -f docker/api.Dockerfile -t applyance-api .
docker build -f docker/worker.Dockerfile -t applyance-worker .
```

Give each the environment variables in `render.yaml` (plus `DATABASE_URL` and `REDIS_URL`), run `pnpm db:deploy` in the web image before starting a new version, and point your domain at the web container's port 3000. Redis must use `maxmemory-policy noeviction`.
