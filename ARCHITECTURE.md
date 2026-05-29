# ☀️ Pouta CMS Architecture Blueprint

This document details the architectural layout, cryptographic specifications, multi-tenant security layers, and data-flow pipelines of **Pouta**, a SaaS-ready, framework-agnostic Git-backed headless CMS engineered for the Edge.

---

## 1. System Topology Overview

Pouta is built on a **serverless edge-native architecture** using Cloudflare Pages, Cloudflare Workers, and SQLite at the Edge (Cloudflare D1). It features a static-first frontend with SSR-enabled admin API routes (`prerender = false`) executing globally on Cloudflare’s Edge network.

The following architecture diagram displays the relationship between the client browser, Cloudflare's Edge node, the localized SQLite cache, the GitHub App REST API, and the user's remote Git repository.

```mermaid
graph TD
    subgraph Client ["Client Browser"]
        UI["CMS UI (Astro + React Dashboard)"]
        Editor["BlockNote Workspace Canvas"]
    end

    subgraph Edge ["Cloudflare Edge Node (Pages & Workers)"]
        SessionCrypto["Web Crypto AES-GCM Session Handler"]
        JWTSigner["Edge-Native RS256 JWT Signer"]
        API["Edge Serverless API Endpoints"]
        D1DB[("Cloudflare D1 SQLite Cache")]
        R2Bucket[("Cloudflare R2 Object Storage")]
    end

    subgraph GitHub ["GitHub Infrastructure"]
        GHApp["GitHub App Gateway"]
        TargetRepo["Target Git Repository (pouta.config.json)"]
    end

    UI -->|1. Sign In / Callback| API
    API <-->|2. Stateless Sealed Cookie| SessionCrypto
    
    UI -->|3. Fetch Schema & Cache| API
    API -->|4. Read Drafts| D1DB
    API <-->|5. Auth JWT / Install Token| JWTSigner
    
    JWTSigner <-->|6. Token Exchange / API Requests| GHApp
    GHApp <-->|7. Load Config & Write MD File| TargetRepo
    
    Editor -->|8. Autosave cache| D1DB
    UI -->|9. Trigger Publish| API
    API -->|10. Push markdown commit| GHApp
    
    Editor -->|11. Upload file| API
    API -->|12. PUT binary data| R2Bucket
    Client -->|13. Direct public render| R2Bucket
```

---

## 2. Stateless Edge Session Cryptography

To eliminate edge database lookup overhead and ensure zero cold-start delay, Pouta uses **stateless secure session seals** placed directly into an HTTP-only, secure cookie (`pouta_session`).

```mermaid
flowchart LR
    Token["Raw GitHub Access Token"] --> Hash["SHA-256 Key Derivation"]
    Secret["Passphrase (SESSION_SECRET)"] --> Hash
    Hash --> AES["AES-GCM Cipher"]
    IV["12-Byte Cryptographic IV"] --> AES
    AES --> Encrypted["Ciphertext"]
    Encrypted --> Output["Base64 Encoded (IV : Ciphertext)"]
```

### A. Key Derivation & Cryptographic import
Using the Web Crypto API, a high-entropy symmetric `AES-GCM` key is dynamically derived from the environment variable `SESSION_SECRET`:

1. The passphrase is encoded into UTF-8 bytes using `TextEncoder`.
2. A cryptographically secure 256-bit hash is computed using `crypto.subtle.digest('SHA-256', ...)`.
3. The SHA-256 output is imported via `crypto.subtle.importKey` as an `AES-GCM` key.

### B. Encryption Protocol (Sealing)
During the OAuth callback exchange:
* An ephemeral **12-byte Initialization Vector (IV)** is generated using `crypto.getRandomValues(new Uint8Array(12))`.
* The raw user token string is encrypted via `crypto.subtle.encrypt` using standard `AES-GCM` parameters.
* The IV and Ciphertext are converted into standard Base64 strings and serialized into a single string formatted as: `ivBase64:ciphertextBase64`.
* The sealed session is sent to the client browser in an `HTTP-Only`, `Secure`, `SameSite=Lax` cookie.

### C. Decryption Protocol (Unsealing)
Upon incoming API requests:
* The `pouta_session` cookie is parsed and split on the `:` delimiter.
* The IV and ciphertext Base64 strings are decoded back into binary `Uint8Array` formats.
* The derived key is fed back into `crypto.subtle.decrypt` alongside the original IV.
* The decrypted token bytes are decoded into UTF-8 text using `TextDecoder` to authorize the request in real time.

---

## 3. Edge-Native RS256 JWT & Installation Tokens

Pouta performs GFM file writing via **GitHub App Installation Access Tokens** instead of permanent OAuth keys. The App private key is Base64 encoded inside Cloudflare environment variables to prevent PEM parsing errors on the edge.

```mermaid
sequenceDiagram
    participant Pouta as "Pouta Edge API"
    participant Subtle as "Web Crypto (SubtleCrypto)"
    participant GH as "GitHub API Gateway"

    Note over Pouta, Subtle: 1. Import PKCS#8 RSA Key
    Pouta->>Subtle: base64UrlDecode(GITHUB_APP_PRIVATE_KEY_B64)
    Subtle-->>Pouta: CryptoKey (RSASSA-PKCS1-v1_5 / SHA-256)
    
    Note over Pouta, Subtle: 2. Generate RS256 JWT
    Pouta->>Subtle: Sign Header.Payload String
    Subtle-->>Pouta: Binary Signature
    
    Note over Pouta, GH: 3. Token Exchange
    Pouta->>GH: POST /app/installations/{id}/access_tokens (Auth: Bearer JWT)
    GH-->>Pouta: 1-Hour Installation Access Token (scoped)
```

### A. PKCS#8 RSA Key Import
The base64 encoded private key (`GITHUB_APP_PRIVATE_KEY_B64`) is parsed, stripped of standard PKCS#8 PEM boundary tags (`-----BEGIN PRIVATE KEY-----`), decoded to a binary `ArrayBuffer`, and imported via:
```typescript
crypto.subtle.importKey(
  'pkcs8',
  binaryKey,
  {
    name: 'RSASSA-PKCS1-v1_5',
    hash: { name: 'SHA-256' },
  },
  false,
  ['sign']
);
```

### B. RS256 JWT Issuance
To authenticates requests to GitHub as the App itself:
* A standard JWT header is assembled: `{"alg": "RS256", "typ": "JWT"}`.
* The JWT payload is constructed with standard claims:
  * `iss`: The configured `GITHUB_APP_ID`.
  * `iat`: Set to 60 seconds prior to present time (to prevent client clock-skew failures).
  * `exp`: Set to 9 minutes in the future (within GitHub's 10-minute maximum limit).
* The header and payload are URL-Safe Base64 encoded and joined: `headerB64Url.payloadB64Url`.
* A digital signature is generated over the message using the imported private key, which is encoded as a URL-safe Base64 string and appended: `header.payload.signature`.

### C. Repository Installation Access Token Exchange
The generated JWT is sent in the header of an HTTP POST request to GitHub's installation endpoint:
`https://api.github.com/app/installations/{installation_id}/access_tokens`.
GitHub returns a temporary, scoped Installation Access Token valid for **1 hour**, giving Pouta exact write permissions only on the chosen target repository.

---

## 4. Multi-Tenant Isolation & Tenancy Guards

To ensure multi-tenant security, Pouta enforces real-time tenancy gates at the edge. A user cannot view, save, or publish a draft for any repository without passing through three gates:

```
[Incoming Request]
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ GATE 1: Stateless Session Cryptography                  │
│ Decrypts the session cookie using the edge secret key.  │
└────────────────────────┬────────────────────────────────┘
                         │ Success
                         ▼
┌─────────────────────────────────────────────────────────┐
│ GATE 2: Real-time Collaborator Access Check             │
│ Calls `GET /repos/{owner}/{name}` with the user's token │
│ and checks if `permissions.push === true`.              │
└────────────────────────┬────────────────────────────────┘
                         │ Success
                         ▼
┌─────────────────────────────────────────────────────────┐
│ GATE 3: SQLite Query Scoping                            │
│ Scopes SQLite queries strictly by owner and repository:  │
│ WHERE repo_owner = ? AND repo_name = ?                  │
└─────────────────────────────────────────────────────────┘
```

1. **Stateless Session Cryptography**: The incoming cookie must successfully decrypt using the edge node's secret key, confirming the request comes from an authenticated user.
2. **Real-time Collaborator Access Check**: The decrypted personal GitHub token is sent to the GitHub API to check repository privileges. If `permissions.push === true` is not returned, the request is instantly rejected with a `403 Forbidden` error.
3. **SQLite Query Scoping**: If the user passes the first two gates, all D1 database operations are strictly scoped to the repository owner and repository name:
   ```sql
   SELECT * FROM documents WHERE repo_owner = ? AND repo_name = ?
   ```

---

## 5. Dynamic GitOps Configuration Schema

Pouta is **entirely schema-agnostic**. It stores no local schemas or content definitions. Every website controls its own content structure directly within its codebase via a `pouta.config.json` file placed in the repository root.

```json
{
  "contentTypes": [
    {
      "type": "blog",
      "label": "Blog Posts",
      "writePath": "src/content/blog/{slug}.md",
      "fields": [
        { "name": "featured_image", "label": "Cover Image", "type": "image" },
        { "name": "description", "label": "Meta Description", "type": "textarea" },
        { "name": "pinned", "label": "Pinned Post", "type": "boolean" }
      ]
    }
  ]
}
```

When a writer signs in and selects a repository workspace:
1. Pouta calls the `/api/content/config` edge endpoint.
2. The endpoint dynamically fetches the target repo's `pouta.config.json` file from Git using the repository's installation access token.
3. The configuration is parsed and returned to the React visual dashboard.
4. The frontend loops over the JSON `fields` array and dynamically renders the matching form elements (textboxes, textareas, number fields, toggle switches, or image uploaders) along with their defined sidebar configurations.

---

## 6. The BlockNote to Markdown Content Pipeline

Content is authored inside a Notion-like workspace canvas using BlockNote (built on React & ProseMirror), which outputs rich JSON structures representing structured blocks. When publishing, these blocks are serialized into GitHub Flavored Markdown (GFM) with dynamic frontmatter.

### A. Rich JSON Block to GFM Translation Rules
The edge parser reads the block array recursively using these translation rules:

| Block Type | JSON Payload Example | Output Markdown |
| :--- | :--- | :--- |
| **heading** | `{"type": "heading", "props":{"level":2}, "content":[{"type":"text","text":"My Title"}]}` | `## My Title\n\n` |
| **paragraph** | `{"type": "paragraph", "content":[{"type":"text","text":"Hello world"}]}` | `Hello world\n\n` |
| **bulletListItem** | `{"type": "bulletListItem", "content":[{"type":"text","text":"Item"}]}` | `- Item\n` |
| **numberedListItem**| `{"type": "numberedListItem", "content":[{"type":"text","text":"First"}]}` | `1. First\n` |
| **checkListItem** | `{"type": "checkListItem", "props":{"checked":true}, "content":[{"type":"text","text":"Task"}]}` | `- [x] Task\n` |
| **blockQuote** | `{"type": "blockQuote", "content":[{"type":"text","text":"Quoted text"}]}` | `> Quoted text\n\n` |
| **codeBlock** | `{"type": "codeBlock", "props":{"language":"ts"}, "content":[{"type":"text","text":"const x = 1;"}]}` | `\`\`\`ts\nconst x = 1;\n\`\`\`\n\n` |
| **image** | `{"type": "image", "props":{"url":"https://...","caption":"Alt Text"}}` | `![Alt Text](https://...)\n\n` |

*Nested blocks (e.g., nested lists) are processed recursively by indenting each child line with two spaces.*

### B. Frontmatter Assembling
Pouta dynamically maps the document metadata into a YAML Frontmatter block. It combines core system attributes, user-defined config fields, and automatically generated timestamps:

```yaml
---
id: "8c7d8a9f-4b2a-4c8d-b3e1-3e4b7c8d9e0f"
type: "blog"
slug: "my-first-post"
title: "My First Post"
featured_image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa"
description: "A comprehensive guide on serverless architectures."
pinned: "true"
status: "published"
created_at: "2026-05-26T18:00:00.000Z"
published_at: "2026-05-26T18:15:00.000Z"
updated_at: "2026-05-26T18:15:00.000Z"
---

## My Title

Hello world
```

### C. Git Content API PUT Strategy
During the publish commit operation:
1. Pouta checks if the file already exists in the repository by performing a `GET` request to GitHub's contents API for the target `writePath`.
2. If the file exists, it retrieves its **SHA hash**.
3. Pouta converts the compiled frontmatter and markdown body into UTF-8 bytes and base64 encodes the data.
4. It sends a `PUT` request to GitHub's contents API with:
   *   A commit message (`Publish [label]: [title]`).
   *   The base64 encoded content.
   *   The target branch name (`repo_branch`).
   *   The existing file **SHA hash** (if present, to prevent write collisions).
5. Upon a successful commit, the document's SQLite status is set to `published`.

---

## 7. Sequence of Core Workflows

### A. Authentication & Workspace Setup
This diagram displays the user's initial sign-in and the loading of their repository configuration.

```mermaid
sequenceDiagram
    actor Writer as "Writer (User)"
    participant UI as "CMS React Dashboard"
    participant API as "Edge API (/api/auth)"
    participant GH as "GitHub Gateway"

    Writer->>UI: Clicks "Sign in with GitHub"
    UI->>API: GET /login
    API-->>Writer: Redirect to GitHub OAuth consent page
    Writer->>GH: Approves Pouta
    GH-->>API: Redirect to /callback?code=xxx
    API->>GH: POST /login/oauth/access_token
    GH-->>API: Return User OAuth Token
    API->>API: Encrypt User Token with AES-GCM
    API-->>UI: Set sealed session cookie & redirect to /
    UI->>API: GET /api/github/repos (Auth check)
    API->>GH: Fetch App Installations & Repos
    GH-->>UI: Render Repository Workspace Selection
```

### B. Saving & Publishing Drafts
This diagram displays the autosave draft cycle and the final Git publishing commit flow.

```mermaid
sequenceDiagram
    actor Writer as "Writer (User)"
    participant UI as "CMS React Dashboard"
    participant API as "Edge API (/api/content)"
    participant D1 as "D1 SQLite DB"
    participant GH as "GitHub Gateway"

    Note over Writer, D1: 1. The Draft Autosave Cycle
    Writer->>UI: Typings in Canvas Editor
    UI->>API: POST /save (ID, Title, JSON Blocks, Metadata)
    API->>API: Verify session & collaborator push access
    API->>D1: INSERT INTO documents ON CONFLICT UPDATE
    D1-->>UI: Confirm Draft Cached at Edge
    
    Note over Writer, GH: 2. The Publishing Commit Flow
    Writer->>UI: Clicks "Publish" Button
    UI->>API: POST /publish (ID)
    API->>D1: SELECT * FROM documents WHERE id = ?
    D1-->>API: Return JSON Blocks & Metadata
    API->>GH: GET /contents/pouta.config.json (Schema)
    GH-->>API: Return Config writePath & Fields
    API->>API: Serialize Block JSON to GFM Markdown
    API->>API: Compile dynamic Frontmatter
    API->>GH: GET /contents/{writePath} (Check SHA)
    GH-->>API: Return SHA (if exists)
    API->>GH: PUT /contents/{writePath} (Commit base64)
    GH-->>API: Commit Successful (200/201 OK)
    API->>D1: UPDATE documents SET status = 'published'
    API-->>UI: Alert Writer: "Successfully Published!"
```

---

## 8. Multi-Tenant Serverless Image Pipeline (Cloudflare R2)

Pouta manages image uploads and delivery at the Edge without third-party SaaS dependencies or Git repository bloat by utilizing **Cloudflare R2 Object Storage**.

```mermaid
sequenceDiagram
    actor Writer as "Writer (User)"
    participant Editor as "BlockNote Editor Canvas"
    participant API as "Edge API (/api/images/upload)"
    participant R2 as "Cloudflare R2 Bucket"
    
    Writer->>Editor: Pastes / Drops Image File
    Editor->>API: POST multipart/form-data (File, repo_owner, repo_name)
    API->>API: Verify session & collaborator push access
    API->>API: Validate file (< 5MB, safe image mime-type)
    API->>R2: PutObject (uploads/{owner}/{repo}/{uuid}-{name})
    R2-->>API: Confirm upload
    API-->>Editor: Return full custom domain URL (R2_PUBLIC_URL_PREFIX)
    Editor-->>Writer: Render image in editor canvas
```

### A. Size & Type Safety Constraints
To maintain fast client rendering and protect storage limits, the upload API performs strict pre-upload checks:
*   **Max Size**: Files are restricted to a maximum of **5MB** (`MAX_FILE_SIZE = 5 * 1024 * 1024`).
*   **Safe Mime-Types**: Restricted strictly to standard web image types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `image/avif`.

### B. Tenancy Namespace Isolation
To ensure multi-tenant boundary isolation, images are stored in R2 under keys prefixed by the active repository collaborator scope:
```
uploads/{repo_owner}/{repo_name}/{cryptographic_uuid}-{safe_filename}
```
*   `repo_owner` and `repo_name` are supplied by the React visual workspace and validated against the writer's token real-time collaborator permissions (`permissions.push === true`).
*   A cryptographically secure random UUID is prepended to prevent file-name collisions or overwrite attacks.

### C. Zero-Egress Edge Delivery
Images are served directly bypassing the Astro Worker:
*   **Custom Domain Routing**: An external CNAME or custom domain (e.g. `media.yourdomain.com`) is mapped directly to the R2 bucket in the Cloudflare dashboard.
*   **URL Prefixing**: The API resolves the environment variable `R2_PUBLIC_URL_PREFIX` to prepend the absolute serving path to the client. This guarantees zero-egress charges, CDN-level caching, and instant file rendering.

---

## 9. Edge-Native Cloudflare Workers AI Pipeline

Pouta integrates context-aware AI capabilities directly at the Edge using **Cloudflare Workers AI**. Rather than pulling in high-latency, third-party LLM APIs, it utilizes local serverless models executing on Cloudflare's global GPU network.

```mermaid
graph TD
    Client["React CMS Dashboard"] -->|1. POST Request| API["Edge AI Endpoint"]
    API -->|2. Paywall Gate check| Paywall["Paywall Validator"]
    Paywall -->|3. Query active subscription| D1["D1 SQLite Cache"]
    D1 -->|4. Active / Bypassed| Paywall
    Paywall -->|5. Proceed| WorkersAI["Cloudflare Workers AI Binding"]
    WorkersAI -->|6. Attempt Llama-3-8b-instruct| Llama3["Meta Llama-3-8b"]
    Llama3 -->|7. Success / Fail fallback| WorkersAI
    WorkersAI -.->|8. Fallback to Llama-2-7b-chat| Llama2["Meta Llama-2-7b"]
    WorkersAI -->|9. Raw Text Response| Parser["Clean & Validate Schema"]
    Parser -->|10. JSON Array / String| Client
```

### A. Multi-Modal AI Content Operations
*   **AI Assist (`/api/content/ai-assist`)**: Performs inline text generation, correction, expansion, or summarization based on the current ProseMirror block selection and custom prompts.
*   **SEO Description Generator (`/api/content/generate-description`)**: Analyzes the title and main content to compile an optimized SEO meta-description between 120 and 160 characters.
*   **Catchy Headline Recommender (`/api/content/generate-headlines`)**: Dynamically reads content semantics to suggest three alternative catchy, optimized headlines.
*   **Tag & Category Extractor (`/api/content/generate-categories`)**: Suggests 3 to 5 highly relevant, concise, lowercase category tags, filtering out any extraneous text, introductory markdown, or conversational LLM padding.

### B. Edge-Level Resiliency & Fallback Strategy
To guarantee 100% service uptime during high GPU demand or model deprecations, Pouta implements an automated failover loop:
1. It attempts to run the instruction on `@cf/meta/llama-3-8b-instruct`.
2. If the model throws an execution exception or returns empty, the catch block intercepts it, logs a warning, and immediately attempts execution on the fallback `@cf/meta/llama-2-7b-chat-fp16` model.
3. This failover happens transparently at the edge in less than 200ms without surfacing errors to the end-user.

---

## 10. SaaS Paywall Architecture & Stripe Webhook Sync

To enable subscription monetization, Pouta comes pre-equipped with an edge-caching **Paywall & Billing System** utilizing Stripe.

### A. Stripe Signature Verification Gateway
The webhook router (`/api/webhooks/stripe`) validates Stripe payloads using high-speed, edge-native cryptographic functions (Web Crypto API) instead of bloated external Node SDKs.
1. Extracts the signature header components: the Unix timestamp (`t`) and signature schemes (`v1`).
2. Generates a signed payload: `timestamp.rawPayloadBody`.
3. Dynamically imports the configured `STRIPE_WEBHOOK_SECRET` as a raw HMAC key using `crypto.subtle.importKey`.
4. Executes `crypto.subtle.verify` utilizing `HMAC` with `SHA-256`.
5. Compares signature bytes safely, ensuring that non-hex or malformed `v1` values are immediately rejected (HTTP 401) without throwing edge runtime crashes.

### B. Localized D1 Subscription Sync
Upon signature validation, the webhook translates Stripe lifecycle events into real-time D1 SQLite cache adjustments:
*   `checkout.session.completed`: Extracts `client_reference_id` or parses `metadata.repo_path` (containing `owner/repo`) to locate the billing workspace. Inserts a new record into `subscriptions`:
    ```sql
    INSERT INTO subscriptions (repo_owner, status, expires_at)
    VALUES (?, 'active', ?)
    ON CONFLICT (repo_owner) DO UPDATE SET status = 'active', expires_at = ?
    ```
*   `customer.subscription.updated`: Syncs active, past-due, or trial statuses down to the localized SQLite table.
*   `customer.subscription.deleted`: Instantly revokes subscription status, marking the cache record as inactive.

### C. The Edge Paywall Gate
When `PAYWALL_ENABLED = true` is configured:
1. Every advanced feature (like AI endpoints) runs a billing lookup:
   ```sql
   SELECT * FROM subscriptions WHERE repo_owner = ? AND status = 'active'
   ```
2. If no active record is found, it blocks execution and returns a `402 Payment Required` (for missing subscriptions) or a `403 Forbidden` (for invalid scopes), protecting API usage against unauthorized billing overheads.
