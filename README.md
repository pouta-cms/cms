# ☀️ pouta

> **Clear skies for web development.** An open-source, SaaS-ready, framework-agnostic **Git-Backed Headless CMS** built explicitly for the **Edge**. Running entirely on Cloudflare serverless edge infrastructure (Pages & Workers) and SQLite at the Edge (Cloudflare D1).

![Pouta CMS Dashboard Banner](https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1200)

Pouta CMS combines the speed, security, and developer experience of GitOps with a familiar, high-fidelity block-editing canvas (powered by BlockNote). The CMS is **completely schema-agnostic and framework-agnostic**—it has zero local knowledge of your content structure. When a creator signs in, Pouta fetches their target repository’s config (`pouta.config.json`) dynamically from Git and draws the visual sidebars, metadata fields, and write paths on the fly! This makes it fully compatible with **any** Markdown-powered website or static site generator, including **Astro, Next.js, Eleventy, Nuxt, Hugo, Jekyll, and Gatsby**.


---

## ⚡ Core Value Propositions

*   **Zero Server Maintenance**: Deploys entirely as serverless edge workers on Cloudflare Pages/Workers. Zero database provisioning, zero server scaling issues, and zero monthly overhead.
*   **Familiar Block Editing Canvas**: Features a premium Notion-like block-editing interface (built on BlockNote/React) outputting clean, highly structured JSON.
*   **Stateless Cookie Cryptography**: Session tokens are encrypted statelessly on the edge using standard `AES-GCM` Web Crypto ciphers. No session lookup overhead.
*   **GitOps Repo-Hosted Schemas**: Every connected website controls its own custom schemas, folder directories, and write paths in code via a root `pouta.config.json` committed to Git.
*   **SaaS-First Multi-Tenancy**: Writers log in via GitHub OAuth, connect installations, and only see connected repository dropdowns. Edge APIs verify collaborator write access in real-time.
*   **Isolated Edge Draft Caches**: Local drafts are cached instantly at the edge inside Cloudflare D1 (SQLite), scoped per repository, preventing unnecessary Git commit noise.

---

## 📁 Repository Directory Structure

```bash
├── db/
│   └── schema.sql             # Universal Isolated D1 SQLite Schema
├── public/
│   ├── logo.svg               # Official Pouta Sun Brand Logo (SVG)
│   └── logo.png               # Official Pouta Sun Brand Logo (PNG)
├── src/
│   ├── components/
│   │   ├── BlockNoteEditor.tsx # React BlockNote Wrapper Component
│   │   └── CMSWorkspace.tsx    # Dynamic 3-Column SaaS CMS Dashboard
│   ├── pages/
│   │   ├── admin/
│   │   │   └── index.astro    # Admin Entrypoint serving React Workspace
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login.ts   # GitHub OAuth Redirection Endpoint
│   │       │   ├── callback.ts# exchanges code for encrypted session cookie
│   │       │   ├── logout.ts  # Clears HTTP-Only secure cookies
│   │       │   └── me.ts      # Validates stateless session credentials
│   │       ├── github/
│   │       │   └── repos.ts   # Retrieves user App installations & repos
│   │       ├── content/
│   │       │   ├── config.ts  # Fetches pouta.config.json dynamically from Git
│   │       │   ├── list.ts    # Queries D1 SQLite isolated repository drafts
│   │       │   ├── save.ts    # Caches dynamic drafts with collaborator guards
│   │       │   └── publish.ts # Dynamic Markdown/YAML Git Publisher API
│   │       └── images/
│   │           └── upload.ts  # Secure multi-tenant Cloudflare R2 image uploader
│   └── utils/
│       ├── crypto.ts          # Stateless AES-GCM Cookie Seal Helpers
│       ├── auth.ts            # Session decrypters & collaborator verifiers
│       └── githubApp.ts       # Edge-native RS256 JWT App Token Builders
├── astro.config.mjs           # Astro Edge Configuration (Static Mode)
├── wrangler.jsonc             # Cloudflare D1 & SaaS Env Bindings
└── package.json               # Package manifests & scripts
```

---

## 🚀 Quick Start Guide

### 1. Register a GitHub App
Pouta CMS operates as a GitHub App to securely lock repository scopes and push commits using short-lived installation tokens.
1. Go to your GitHub profile: `Settings > Developer Settings > GitHub Apps > New GitHub App`.
2. Configure App settings:
   *   **Homepage URL**: `https://your-pouta-domain.com` (Your public marketing landing page)
   *   **Callback URL**: `https://app.your-pouta-domain.com/api/auth/callback` (Points to the active app API engine)
   *   **Setup URL**: `https://app.your-pouta-domain.com` (Redirects users straight to the workspace after installation)

3. Grant dynamic **Repository Permissions**:
   *   **Contents**: `Read & Write` (To read and commit Markdown files)
   *   **Metadata**: `Read-only` (Required to list repository properties)
4. Grant user **Organization Permissions** (Optional):
   *   **Members**: `Read-only` (To check collaborative organization access)
5. Generate credentials:
   *   Generate an **OAuth Client Secret** and copy the Client ID.
   *   Generate a **Private Key (.pem)**. Base64-encode this private key so it can be safely stored as a single environment variable:
       ```bash
       base64 -i your-app-private-key.pem | pbcopy
       ```

### 2. Configure Cloudflare Variables

To ensure high security, sensitive credentials and secrets must **never** be committed to Git inside `wrangler.jsonc`. 

#### A. For Local Development (Git-Ignored)
1. Copy the template secrets file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
2. Open `.dev.vars` and add your actual GitHub credentials, session secret, and R2 public URL prefix:
   ```env
    GITHUB_APP_ID="1002345"
    GITHUB_CLIENT_ID="Iv1.xxxxxxxxx"
    GITHUB_CLIENT_SECRET="xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    GITHUB_APP_PRIVATE_KEY_B64="your_base64_encoded_private_key_pem_here"
    SESSION_SECRET="your-dynamic-secret-passphrase-32-chars-minimum"
    R2_PUBLIC_URL_PREFIX="https://media.yourdomain.com"
    
    # Stripe Billing Setup (Optional)
    PAYWALL_ENABLED="false"
    STRIPE_PAYMENT_LINK="https://buy.stripe.com/your_mock_payment_link"
    STRIPE_WEBHOOK_SECRET="whsec_your_mock_webhook_secret_key"
    ```

#### B. For Production Deployments
Add these keys under your project settings in the **Cloudflare Pages/Workers Dashboard > Settings > Environment Variables** (set them as encrypted Secrets where applicable):
*   `GITHUB_APP_ID`
*   `GITHUB_CLIENT_ID`
*   `GITHUB_CLIENT_SECRET` (Secret)
*   `GITHUB_APP_PRIVATE_KEY_B64` (Secret)
*   `SESSION_SECRET` (Secret)
*   `R2_PUBLIC_URL_PREFIX` (The custom public domain mapped to your R2 bucket)
*   `PAYWALL_ENABLED` (Optional, set to "true" to enable repository paywall locking)
*   `STRIPE_PAYMENT_LINK` (Stripe Payment Link URL, e.g., `https://buy.stripe.com/...`)
*   `STRIPE_WEBHOOK_SECRET` (Secret, Stripe webhook signature key `whsec_...`)
*   **D1 Database Binding**: Bind your database directly in the Cloudflare Dashboard under your Pages Project > **Settings > Functions > D1 Database Bindings**. Bind the variable name `DB` to your production database. This is the recommended approach as it completely removes the need to supply or track the database UUID in `wrangler.jsonc` or CI/CD pipeline files.

#### C. Cloudflare R2 Bucket Setup
Pouta uses **Cloudflare R2** for fast, high-performance image uploads and serving:
1.  **Create your R2 Bucket**:
    Create a new bucket named `pouta-media` locally via Wrangler or via the Cloudflare Dashboard:
    ```bash
    npx wrangler r2 bucket create pouta-media
    ```
2.  **Map a Custom Domain**:
    Map a custom domain (e.g. `media.yourdomain.com`) to your R2 bucket in the Cloudflare Dashboard under **R2 > Buckets > pouta-media > Settings > Public access** to serve your uploaded files. Ensure this matches the `R2_PUBLIC_URL_PREFIX` environment variable.



### 3. Create your Website Config (`pouta.config.json`)
Commit a `pouta.config.json` at the root of your target website repository. Pouta reads this dynamically to draw custom sidebars:
```json
{
  "contentTypes": [
    {
      "type": "posts",
      "label": "Blog Posts",
      "writePath": "src/content/posts/{slug}.md",
      "fields": [
        { "name": "layout", "label": "Layout", "type": "select", "options": ["post", "page"] },
        { "name": "author", "label": "Author", "type": "select", "options": ["moha", "other-author"] },
        { "name": "categories", "label": "Categories", "type": "list" },
        { "name": "featured_image_url", "label": "Featured Image", "type": "image" },
        { "name": "slug", "label": "SEO Slug (Optional)", "type": "slug" },
        { "name": "seo_title", "label": "SEO Title", "type": "text" },
        { "name": "seo_description", "label": "SEO Description", "type": "description" }
      ]
    }
  ]
}
```

### 4. Deploy and Write!
Run local SQLite migrations and boot up the development server:
```bash
# Execute local database schema migrations
npx wrangler d1 execute pouta-d1-db --local --file=db/schema.sql

# Start development server
npm run dev
```

Visit `http://localhost:4321` to sign in with GitHub, connect your repository, and begin drafting!

---

## 🌐 Production SaaS Domain Architecture

For professional production deployments, we highly recommend separating your public-facing marketing resources from your secure CMS workspace using a subdomain mapping layout:

*   **Root Domain (`your-pouta-domain.com`)**: Serves your public marketing landing page, pricing details, and documentation.
*   **Subdomain (`app.your-pouta-domain.com`)**: Hosts the active edge-native Pouta gateway dashboard workspace, API controllers, and database handlers.

This pattern isolates your public landing page assets from your high-speed editing canvas and scopes your secure `pouta_session` cookies strictly to the `app.` workspace.

---

## 🏛️ Architecture & Deep Dive

For an in-depth understanding of the technical layout, cryptographic specifications, session schemas, and content serialization pipelines, please consult our [Architecture Blueprint](ARCHITECTURE.md). It includes:
*   **System Topology & Flow Diagrams**: Full Mermaid visualizations of serverless edge nodes, the D1 SQLite cache, and GitHub App integrations.
*   **Stateless Cookie Cryptography**: Explanations of `AES-GCM` symmetric session encryption and Web Crypto key derivation.
*   **Edge-Native RS256 JWT Generation**: Details of RSA PKCS#8 signature algorithms and dynamic installation access token exchanges.
*   **Multi-Tenant Isolation Gates**: Security specifications checking session validity, real-time collaborator checks, and SQLite scoped queries.
*   **BlockNote JSON-to-Markdown Pipelines**: The complete recursive serialization logic converting visual canvas blocks to frontmatter-enriched GFM files.

---

## 💳 Stripe Paywall & Billing Setup (Optional)

Pouta CMS features an optional, built-in Stripe paywall system that allows you to put metered edge features (Cloudflare R2 image storage and Workers AI assistants) behind a repository-scoped paywall. This paywall is controlled entirely by the `PAYWALL_ENABLED="true"` environment variable.

### 1. Configure the Webhook Events
In your **Stripe Dashboard > Developers > Webhooks** (or via the Stripe CLI), configure your endpoint to forward to `https://<your-cms-domain>/api/webhooks/stripe` listening to exactly these three events:
*   **`checkout.session.completed`** (Triggers when a customer upgrades a repository).
*   **`customer.subscription.updated`** (Triggers on plan renewal, updates, or status changes).
*   **`customer.subscription.deleted`** (Triggers when a subscription is canceled or expires).

### 2. Local Testing (Stripe CLI)
To test billing and checkout flows locally:
1.  **Install & Login** to the Stripe CLI:
    ```bash
    brew install stripe/stripe-cli/stripe
    stripe login
    ```
2.  **Start Forwarding** events to your local dev server (default port `4321`):
    ```bash
    stripe listen --forward-to localhost:4321/api/webhooks/stripe
    ```
3.  **Configure Signature Verification**:
    Copy the local signing secret (`whsec_...`) printed in your terminal and configure it in your `.dev.vars` file:
    ```env
    STRIPE_WEBHOOK_SECRET="whsec_your_local_secret"
    ```
4.  **Trigger a Mock Purchase**:
    Run the checkout simulation command in a separate terminal window:
    ```bash
    stripe trigger checkout.session.completed
    ```

### 3. Production Variables Setup
Add these variables in your **Cloudflare Pages/Workers Dashboard > Settings > Environment Variables**:
*   `PAYWALL_ENABLED`: Set to `"true"` to activate repository-scoped paywall gates.
*   `STRIPE_PAYMENT_LINK`: The URL of your Stripe Payment Link (e.g., `https://buy.stripe.com/...`). Pouta dynamically appends the active `?client_reference_id=owner/repo` to track repository purchases.
*   `STRIPE_PORTAL_LINK`: The URL of your Stripe-hosted Customer Portal login page (e.g., `https://billing.stripe.com/p/login/...`), allowing 1-click self-service invoice and cancellation management.
*   `STRIPE_WEBHOOK_SECRET` (Secret): Your production Stripe webhook signing secret (`whsec_...`) to verify signatures at the edge.

---

## ⚖️ Open Source License
Pouta is open-source software licensed under the [GPLv3 License](LICENSE). Clear skies ahead! ☀️

