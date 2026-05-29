# ☀️ Pouta CMS — Agent Instructions

This file provides authoritative context for AI coding assistants working on this codebase. Read it in full before making any changes.

---

## 1. Project Overview

**Pouta** is a SaaS-ready, framework-agnostic, Git-backed headless CMS engineered for the Edge. It is deployed on **Cloudflare Pages + Workers** and stores draft content in **Cloudflare D1** (SQLite at the edge). Final published content is committed as Markdown files directly to a user's GitHub repository via the GitHub App API.

The CMS targets **technical writers and content teams** who want a Notion-like editing experience with Git as the source of truth.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Astro](https://astro.build/) v6 (SSR mode via `@astrojs/cloudflare`) |
| UI Components | React 19 (`@astrojs/react`) |
| Rich Text Editor | BlockNote v0.51 (built on ProseMirror) |
| Runtime | Cloudflare Workers (Edge) |
| Database | Cloudflare D1 (SQLite at the edge) |
| Object Storage | Cloudflare R2 |
| AI Models | Cloudflare Workers AI (Llama 3, Llama 2, LLaVA) |
| Payments | Stripe (via webhook + D1 sync) |
| Language | TypeScript (strict) |
| Testing | Vitest v4 |
| Deploy Config | Wrangler v4 (`wrangler.jsonc`) |

---

## 3. Project Structure

```
cms/
├── src/
│   ├── components/          # React UI components
│   │   ├── BlockNoteEditor.tsx   # Rich text editor canvas
│   │   └── CMSWorkspace.tsx      # Main CMS dashboard shell
│   ├── pages/               # Astro file-based routing
│   │   ├── index.astro           # Landing / sign-in page
│   │   ├── admin/                # Admin dashboard pages
│   │   └── api/                  # Edge API endpoints (SSR, prerender=false)
│   │       ├── auth/             # OAuth login, callback, logout
│   │       ├── content/          # Draft CRUD, publish, AI assist
│   │       ├── github/           # Repo listing, config fetch
│   │       ├── images/           # R2 image upload
│   │       ├── subscription/     # Paywall / billing status
│   │       └── webhooks/         # Stripe webhook handler
│   └── utils/               # Shared edge utility functions
│       ├── auth.ts               # Session + collaborator helpers
│       ├── crypto.ts             # AES-GCM encryption/decryption
│       ├── githubApp.ts          # RS256 JWT + installation token logic
│       └── path.ts               # writePath resolution helpers
├── db/                      # D1 SQL migration files
├── tests/                   # Vitest unit tests
│   └── mocks/               # Edge binding mocks (e.g. cloudflare:workers)
├── ARCHITECTURE.md          # Full architectural reference (read this too)
├── wrangler.jsonc           # Cloudflare deployment configuration
├── wrangler.local.jsonc     # Local dev overrides
├── astro.config.mjs         # Astro configuration
├── vitest.config.ts         # Vitest configuration
└── .dev.vars                # Local environment variables (never commit secrets)
```

**Rules:**
- React components → `src/components/` (PascalCase filenames)
- API endpoints → `src/pages/api/` (each is an Astro `.ts` endpoint with `export const prerender = false`)
- Shared utilities → `src/utils/` (camelCase filenames)
- Tests → `tests/` (mirror the `src/` structure where possible)

---

## 4. Edge Runtime Constraints

> **This project runs on Cloudflare Workers. It does NOT run on Node.js.**

- ✅ Use **Web Crypto API** (`crypto.subtle`, `crypto.getRandomValues`) for all cryptographic operations
- ✅ Use the global **`fetch`** API for all HTTP requests
- ✅ Use **Cloudflare bindings** (`env.DB`, `env.MEDIA_BUCKET`, `env.AI`) for infrastructure access
- ❌ Never use `fs`, `path`, `os`, `child_process`, or any other Node.js built-in module
- ❌ Never use `Buffer` — use `Uint8Array`, `ArrayBuffer`, and `TextEncoder`/`TextDecoder` instead
- ❌ Never use Node.js crypto (`require('crypto')`) — use `crypto.subtle` instead
- ❌ Never import heavy Node.js-only npm packages (e.g., `stripe` SDK, `jsonwebtoken`, `bcrypt`)

All RSA JWT signing, AES-GCM encryption, HMAC verification, and SHA-256 hashing must use the **Web Crypto `SubtleCrypto` API**. See `src/utils/crypto.ts` and `src/utils/githubApp.ts` for reference implementations.

---

## 5. Security Rules (Non-Negotiable)

Every API endpoint **must** enforce the three-gate security model in this exact order:

```
GATE 1: Session Decryption
  → Call verifySession(request, env.SESSION_SECRET)
  → Throws on missing or invalid cookie → respond 401

GATE 2: Real-time Collaborator Check
  → Call verifyCollaborator(userToken, owner, repo)
  → Must return true (permissions.push === true on GitHub)
  → On false → respond 403

GATE 3: Scoped D1 Queries
  → All SQL queries must include: WHERE repo_owner = ? AND repo_name = ?
  → Never query documents without both owner and repo scope
```

Import helpers from `src/utils/auth.ts`:
- `verifySession(request, secret)` → returns the decrypted GitHub OAuth token
- `verifyCollaborator(userToken, owner, name)` → returns `boolean`

**Do not** bypass or skip any gate. Do not add unauthenticated read endpoints without explicit instruction. Read-only endpoints still require Gate 1 and Gate 2.

---

## 6. TypeScript Conventions

- **TypeScript-first**: all new files must be `.ts` or `.tsx`
- Prefer **explicit types** over inferred types for function parameters and return values
- Avoid `any` — use `unknown` + type narrowing, or define a proper interface
- Use `interface` for object shapes, `type` for unions and mapped types
- Astro endpoint context type: `APIContext` from `astro`
- Cloudflare env bindings are typed via `worker-configuration.d.ts` (auto-generated by `wrangler types`)
- Do not add type assertions (`as SomeType`) unless absolutely necessary; prefer narrowing

---

## 7. API Endpoint Conventions

Astro API routes live in `src/pages/api/` and export named HTTP method handlers:

```typescript
import type { APIContext } from 'astro';

export const prerender = false;

export async function POST({ request, locals }: APIContext): Promise<Response> {
  const env = locals.runtime.env;
  // ... gate 1, gate 2, gate 3, then business logic
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- Always access Cloudflare bindings via `locals.runtime.env`
- Return `Response` objects directly — never `throw` unhandled exceptions to the runtime
- On auth failure: `return new Response('Unauthorized', { status: 401 })`
- On forbidden: `return new Response('Forbidden', { status: 403 })`
- On bad input: `return new Response('Bad Request', { status: 400 })`
- On payment required: `return new Response('Payment Required', { status: 402 })`
- On server error: `return new Response('Internal Server Error', { status: 500 })`

---

## 8. Database (D1 SQLite)

- Access via `env.DB` (bound as `DB` in `wrangler.jsonc`)
- Use `env.DB.prepare(sql).bind(...args).run()` for writes
- Use `env.DB.prepare(sql).bind(...args).first()` for single-row reads
- Use `env.DB.prepare(sql).bind(...args).all()` for multi-row reads
- **Always** scope queries by `repo_owner` AND `repo_name`
- SQL migration files live in `db/`
- Do not use an ORM

---

## 9. GitHub Integration

Pouta uses two types of GitHub tokens:

| Token | Source | Purpose |
|---|---|---|
| User OAuth Token | Decrypted from `pouta_session` cookie | Authenticate as the user, check repo permissions |
| Installation Access Token | Generated via RS256 JWT → GitHub App API | Write files to the target repository |

- The GitHub App private key is stored as `GITHUB_APP_PRIVATE_KEY_B64` (base64 PKCS#8)
- Installation token generation lives in `src/utils/githubApp.ts`
- Tokens expire in 1 hour — always generate fresh installation tokens per request
- Never cache or persist installation access tokens

---

## 10. Content & Markdown Pipeline

- Draft content is stored as **BlockNote JSON blocks** in D1
- On publish, blocks are serialized to **GitHub Flavored Markdown (GFM)** with YAML frontmatter
- The `writePath` for each content type is defined in the target repo's `pouta.config.json`
- Images are uploaded to R2 under: `uploads/{repo_owner}/{repo_name}/{uuid}-{filename}`
- Image public URLs use the `R2_PUBLIC_URL_PREFIX` environment variable

---

## 11. AI Features (Workers AI)

- AI binding: `env.AI` (bound in `wrangler.jsonc`)
- Primary model: `@cf/meta/llama-3-8b-instruct`
- Fallback model: `@cf/meta/llama-2-7b-chat-fp16`
- Vision primary: `@cf/meta/llama-3.2-11b-vision-instruct`
- Vision fallback: `@cf/llava-hf/llava-1.5-7b-hf`
- Always implement a try/catch fallback chain — never let AI failures surface as 500 errors
- AI endpoints are paywall-gated when `PAYWALL_ENABLED=true` is set

---

## 12. Testing

- **Framework**: Vitest v4 (`vitest.config.ts`)
- **Test location**: `tests/` directory
- **Run tests**: `npx vitest run`
- **Run with coverage**: `npx vitest run --coverage`
- Cloudflare bindings are mocked via `tests/mocks/cloudflare-workers.ts`
- `src/components/BlockNoteEditor.tsx` and `src/components/CMSWorkspace.tsx` are **excluded** from coverage (require browser/ProseMirror context)
- Do not write tests that require a live D1 database or real GitHub API — mock them

---

## 13. Development Commands

```bash
# Start local dev server (Cloudflare Pages local simulation)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run tests
npx vitest run

# Run tests with coverage
npx vitest run --coverage

# Regenerate Cloudflare binding types
npm run generate-types

# Deploy to Cloudflare
wrangler deploy
```

Local environment variables go in `.dev.vars` (gitignored). See `.dev.vars.example` for required keys.

---

## 14. Dependency Policy

- **Never install a new npm package without explicit user approval**
- Always prefer Web APIs, Cloudflare bindings, or existing utilities over external libraries
- If a package is truly necessary, propose it first and explain why no native alternative exists
- The project intentionally avoids heavy SDKs (no `stripe`, no `jsonwebtoken`, no `@octokit/rest`)

---

## 15. Key Environment Variables

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Passphrase for AES-GCM session sealing |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_APP_PRIVATE_KEY_B64` | Base64-encoded PKCS#8 RSA private key |
| `GITHUB_CLIENT_ID` | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret |
| `R2_PUBLIC_URL_PREFIX` | Public base URL for R2 media bucket |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `PAYWALL_ENABLED` | `"true"` to enable subscription gates on AI features |

---

## 16. Important Files to Read

Before making significant changes, consult:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Full system design, crypto specs, data-flow diagrams
- [`src/utils/auth.ts`](./src/utils/auth.ts) — Session + collaborator verification helpers
- [`src/utils/crypto.ts`](./src/utils/crypto.ts) — AES-GCM encryption implementation
- [`src/utils/githubApp.ts`](./src/utils/githubApp.ts) — RS256 JWT + installation token generation
- [`wrangler.jsonc`](./wrangler.jsonc) — Cloudflare bindings and deployment config
