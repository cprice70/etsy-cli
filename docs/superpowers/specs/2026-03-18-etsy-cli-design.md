# Etsy CLI Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

A TypeScript Node.js CLI tool (`etsy`) for accessing the Etsy Open API v3. Modeled after `amazon-sp-cli` in structure and patterns. Supports both API key (public read-only) and OAuth 2.0 (authenticated read/write) access modes.

## Architecture

```
src/
  index.ts          # Entry point: loads config, registers command groups
  config.ts         # Loads/saves ~/.config/etsy-cli/config.json, env var overrides
  etsy-client.ts    # Thin fetch wrapper around Etsy Open API v3
  output.ts         # printTable, printJson, printSuccess, printError, colorState
  commands/
    auth.ts         # login, status, logout
    listings.ts     # list, get, create, update
    orders.ts       # list, get
    shop.ts         # get
```

**Tech stack:** TypeScript, Commander, chalk, cli-table3, Vitest. No Etsy SDK — direct HTTP via `fetch` (Node 18+ built-in).

## Config

Stored at `~/.config/etsy-cli/config.json`:

```json
{
  "apiKey": "...",
  "accessToken": "...",
  "refreshToken": "...",
  "accessTokenExpiresAt": 1234567890,
  "shopId": "..."
}
```

Environment variable overrides:
- `ETSY_API_KEY`
- `ETSY_ACCESS_TOKEN`
- `ETSY_REFRESH_TOKEN`
- `ETSY_SHOP_ID`

Config is always `Partial<Config>`. The client validates completeness at call time.

## Etsy Client (`etsy-client.ts`)

Thin wrapper around `fetch`:

```typescript
class EtsyClient {
  call(method: string, path: string, options?: { query?: Record<string, string>, body?: unknown }): Promise<unknown>
}
```

**Auth selection (per call):**
- OAuth available → `Authorization: Bearer <accessToken>` header
- API key only → `x-api-key` header (public endpoints only)
- If command requires OAuth but only API key is set → error: "This command requires OAuth. Run `etsy auth login` and complete the OAuth step."

**Token refresh (proactive):** Before each OAuth call, check if `accessTokenExpiresAt` is within 60 seconds of expiry. If so, refresh proactively. Also refresh reactively on 401 responses (one retry). On refresh failure, error with a clear message. If `ETSY_ACCESS_TOKEN` is supplied via env var (no `accessTokenExpiresAt` available), skip the proactive check and only refresh on 401.

**Base URL:** `https://openapi.etsy.com/v3`

**Note on auth endpoints:** OAuth token operations (exchange and refresh) use `https://api.etsy.com/v3/public/oauth/token` — a different hostname from the API base URL. These calls are made directly via `fetch` in `auth.ts`, not through `EtsyClient.call()`.

## Auth Flow

### Setup prerequisites

Users must create an Etsy app at https://www.etsy.com/developers/your-apps and set the redirect URI to `https://www.etsy.com/oauth/connect` (Etsy's out-of-band redirect for manual copy-paste flows).

### `etsy auth login`

1. Prompts for API key (keystring) — stored immediately for public read access
2. Prompts for Client ID (from their Etsy app)
3. Asks whether to complete OAuth for full access (y/N)
4. If yes:
   - Generates `code_verifier` (random 43–128 char URL-safe string) and derives `code_challenge` (SHA-256 of verifier, base64url-encoded) per PKCE spec (RFC 7636)
   - Prints authorization URL: `https://www.etsy.com/oauth/connect?response_type=code&client_id=<clientId>&redirect_uri=https://www.etsy.com/oauth/connect&scope=<scopes>&state=<random>&code_challenge=<challenge>&code_challenge_method=S256`
   - Instructs user to visit URL, authorize, and paste the `code` query parameter from the redirect URL
   - Exchanges code for tokens via `POST https://api.etsy.com/v3/public/oauth/token` with `grant_type=authorization_code`, `client_id`, `redirect_uri`, `code`, `code_verifier`
   - Stores `access_token`, `refresh_token`, and `expires_at` (current time + `expires_in` seconds)
5. Auto-detects shop ID: first calls `POST https://api.etsy.com/v3/public/oauth/token/introspect` with the access token to retrieve the `user_id`, then calls `GET /application/users/{userId}/shops` — saves first shop's `shop_id`
6. Saves all to config file

**OAuth scopes:** `listings_r listings_w transactions_r shops_r`

### `etsy auth status`

Shows masked credentials (API key, access token, refresh token), token expiry, shop ID, config file path, and whether OAuth is configured.

### `etsy auth logout`

Prints: "This will delete all stored credentials and require full re-setup. Continue? (y/N)"
On confirmation, deletes config file.

## Command Groups

All commands registered in `index.ts`: `auth`, `shop`, `listings`, `orders`.

Most non-auth commands accept `--shop <id>` to override the default shop ID from config. Exceptions: `listings get` (listing ID is globally unique, no shop ID needed).

### `shop`
- `shop get` — `GET /application/shops/{shopId}`. Detail view: name, currency, listing count, status. Options: `--shop <id>`, `--json`.

### `listings`

**`listings list`**
- Options: `--state <active|draft|inactive>` (default: active), `--limit <n>` (default: 25, max: 100), `--offset <n>` (default: 0), `--shop <id>`, `--json`
- Endpoint mapping by state:
  - `active` → `GET /application/shops/{shopId}/listings/active`
  - `draft` → `GET /application/shops/{shopId}/listings/draft`
  - `inactive` → `GET /application/shops/{shopId}/listings/inactive`
- Table columns: listing ID, title, price, quantity, state

**`listings get --id <id>`**
- `GET /application/listings/{listingId}`
- Full detail view (all non-null fields printed as key: value). Options: `--json`.
- Does not require or use `--shop` (listing ID is globally unique).

**`listings create`**
- Interactive prompts for required fields: title, description, price, quantity, type (physical/digital/download), taxonomy_id, shipping_profile_id, who_made, when_made, is_supply
- Note: `taxonomy_id` can be found at https://developer.etsy.com/documentation/reference/#operation/getBuyerTaxonomy; `shipping_profile_id` can be listed via `GET /application/shops/{shopId}/shipping-profiles` (out of scope for v1 — users must look up IDs manually or via `--json` calls)
- Prints created listing ID on success

**`listings update --id <id>`**
- Flags: `--price <amount>`, `--quantity <n>`, `--title <text>`, `--state <active|inactive|draft>`
- `PATCH /application/listings/{listingId}` with only provided fields

### `orders`

**`orders list`**
- `GET /application/shops/{shopId}/receipts`
- Options: `--limit <n>` (default: 25, max: 100), `--offset <n>` (default: 0), `--start <date>` (ISO 8601, e.g. `2024-01-01` — converted to Unix timestamp for `min_created`), `--end <date>` (converted to Unix timestamp for `max_created`), `--shop <id>`, `--json`
- Table columns: receipt ID, buyer name, date, total, status

**`orders get --id <id>`**
- `GET /application/shops/{shopId}/receipts/{receiptId}`
- Detail view including line items (transactions array from the receipt response; `transactions_r` scope covers both receipts and their embedded transactions). Options: `--shop <id>`, `--json`.

## Output

`output.ts`:
- `printTable(headers, rows)` — colored headers via chalk + cli-table3
- `printJson(data)` — pretty-printed JSON
- `printSuccess/printError/printWarning` — colored console output
- `colorState(state)` — color-codes states:
  - Listing states: `active` → green, `draft` → yellow, `inactive` → dim, `expired` → red, `sold_out` → red
  - Receipt/order states: `paid` → green, `completed` → green, `open` → yellow, `payment_processing` → yellow, `canceled` → red

## Error Handling

- Auth errors (401/403) → hint to re-authenticate
- Missing OAuth config → hint to run `etsy auth login` and complete OAuth step
- Missing shop ID → hint to run `etsy auth login` or use `--shop <id>`
- All command actions wrapped in try/catch → `printError` + `process.exit(1)`

## Testing

Vitest tests per command module. Pattern mirrors amazon-sp-cli:
- Mock `client.call` via `vi.fn()`
- Spy on `console.log`/`console.error` and `process.exit`
- Parse commands via `program.parseAsync(["node", "test", ...args])`
- Tests excluded from `tsconfig.json` compilation

## Entry Point (`index.ts`)

- Loads config
- Registers `auth` commands (no client needed)
- Attempts to create `EtsyClient`; on failure, commands that use it error at runtime via a Proxy (same pattern as amazon-sp-cli)
- `resolveShopId(opts)` helper: `opts.shop ?? config.shopId ?? printError + process.exit(1)`
