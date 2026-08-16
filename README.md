# Al Sugri Ops — SaaS

Multi-tenant cloud-ready version of Al Sugri Ops: production, inventory, sales and reconciliation for beverage factories.

Each customer gets their own **workspace (organization)** with isolated data. Users sign up, create a factory, and invite is left for a later iteration (v1 is single-user-per-org via the account that created it; the same account can own multiple factories).

## What’s new vs the local version

| Local app | SaaS version |
|-----------|--------------|
| One shared `db.json` on LAN | Multi-tenant store (`users`, `organizations`, `memberships`, `org_data`) |
| No login | Email + password auth (JWT) |
| Role picker (anyone can be Owner) | Role comes from membership (`owner` / `supervisor` / `seller`) |
| LAN IP only | Designed to run on a public host with HTTPS |
| Last-write-wins whole file | Optimistic concurrency with `version` field (409 on conflict) |
| Offline cache per browser | Same offline cache, now **per organization** |

Domain UI (dashboard, rolls, production, leakage, factory vs mobile sales, seller balances, expenses) is the same industrial dark UI.

## Quick start (development)

```bash
npm install
npm run dev
```

- API + data server: `http://localhost:3001`
- Vite UI (proxies `/api`): open the Local URL Vite prints (usually `http://localhost:5173`)

Create an account on the signup screen (email, password, your name, factory name).

## Production (single process)

```bash
npm install
npm run build
npm start
```

Server listens on port **3001** and serves the built frontend + API from the same origin.

```bash
PORT=3001 JWT_SECRET=use-a-long-random-string npm start
```

Point a reverse proxy (Caddy, nginx, Cloudflare) at that port for HTTPS.

## API overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/signup` | no | `{ email, password, name, orgName }` → user + org + token |
| POST | `/api/auth/login` | no | `{ email, password }` → user + orgs + token |
| GET | `/api/me` | Bearer | Current user + organizations |
| POST | `/api/orgs` | Bearer | Create another factory `{ name }` |
| GET | `/api/orgs/:orgId/db` | Bearer + member | Factory data blob |
| PUT | `/api/orgs/:orgId/db` | Bearer + member | Save factory data (send `version` for concurrency) |

## Data model

- **users** — accounts
- **organizations** — factories / workspaces
- **memberships** — user ↔ org with role (`owner` \| `supervisor` \| `seller`) and optional `seller_name`
- **org_data** — JSON document per org (same shape as the original app), plus `version` / `updated_at`

## Production controls

The SaaS API now enforces the critical production rules server-side:

- Production requires a configured Koyo.
- Production requires a roll assigned to that Koyo.
- Production quantities cannot exceed the packaging-bag inventory available before the transaction.
- Production consumes packaging-bag inventory and the selected roll's remaining raw material.
- New production records must use the server's current date; backdating and future-dating are rejected.
- Existing production records cannot be edited in place.
- Historical production records cannot be deleted.
- Koyos are organization-specific and can be added from Settings; the legacy Koyo 1 / Koyo 2 configuration is migrated automatically.
- A Koyo referenced by rolls or production history cannot be removed.
- Negative inventory quantities are rejected.
- Roll assignments must reference a configured Koyo.

The UI also uses **Packaging bags** instead of the old "Empty bags" terminology while retaining the existing `emptyBags` storage key for backward compatibility with existing customer data.

## Security documentation

Security and operational safeguards are intentionally documented here rather than displayed as an in-app security alert. The application uses password hashing, authentication rate limiting, organization membership checks, optimistic concurrency, and server-side production validation.

## Google Sign-In on Railway

Required Railway variables:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
APP_URL=https://YOUR-RAILWAY-DOMAIN
```

Optional:

```text
OAUTH_REDIRECT_BASE=https://YOUR-RAILWAY-DOMAIN
```

Google Cloud OAuth configuration must use the exact callback:

```text
https://YOUR-RAILWAY-DOMAIN/api/auth/google/callback
```

The domain must be HTTPS and must exactly match the Railway public domain used by the application. Do not add a trailing slash to `APP_URL`.

If Google Sign-In redirects back with an error, check the Railway server logs for the OAuth error and verify that the Google Cloud redirect URI exactly matches the callback above.

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3001` | HTTP port |
| `JWT_SECRET` | dev default | **Change in production** |
| `JWT_EXPIRES` | `30d` | Token lifetime |
| `NODE_ENV` | — | Set `production` for static file serving |

Data lives at `server/data/store.json` (created automatically).

## Not in v1 (by design)

- Team invites / join links
- Stripe billing
- Fine-grained seller-only write permissions on the API (UI still filters tabs; API allows member writes)
- Email verification / password reset
- Normalized SQL tables for every production row (still a versioned JSON document per org for fast migration)

These are the natural next product steps once the multi-tenant shell is in use.

## Migrating from the local app

1. Export or copy records from the old `server/data/db.json`.
2. Sign up in the SaaS app for that factory.
3. Paste/import into the live workspace (manual for v1), or write a one-off script that `PUT`s the blob to `/api/orgs/:id/db` with a valid token.

## License

Private — Al Sugri Beverages / project owners.
