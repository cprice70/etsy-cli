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

**Token refresh:** On 401 response, automatically attempts one token refresh using the stored refresh token, then retries. On refresh failure, errors with a clear message.

**Base URL:** `https://openapi.etsy.com/v3`

## Auth Flow

`etsy auth login`:
1. Prompts for API key (keystring)
2. Asks whether to complete OAuth for full access
3. If yes: prints authorization URL (with client ID + scopes), waits for user to paste the authorization code
4. Exchanges code for access + refresh tokens
5. Auto-detects and saves shop ID from `GET /application/users/me/shops`
6. Saves all to config file

OAuth scopes requested: `listings_r listings_w transactions_r shops_r`

`etsy auth status`: Shows masked credentials (API key, access token, refresh token) and shop ID, config file path.

`etsy auth logout`: Deletes config file.

## Command Groups

### `shop`
- `shop get` — `GET /application/shops/{shopId}`. Detail view: name, currency, listing count, status. Options: `--shop <id>`, `--json`.

### `listings`
- `listings list` — `GET /application/shops/{shopId}/listings/active`. Table: listing ID, title, price, quantity, state. Options: `--state <active|draft|inactive>`, `--limit <n>`, `--shop <id>`, `--json`.
- `listings get --id <id>` — `GET /application/listings/{listingId}`. Full detail view.
- `listings create` — Interactive prompts for required fields: title, description, price, quantity, taxonomy ID, shipping profile ID, who_made, when_made, is_supply. Prints created listing ID on success.
- `listings update --id <id>` — Accepts field flags (`--price`, `--quantity`, `--title`, `--state`). Patches only provided fields via `PATCH /application/listings/{listingId}`.

### `orders`
- `orders list` — `GET /application/shops/{shopId}/receipts`. Table: receipt ID, buyer name, date, total, status. Options: `--limit <n>`, `--start <date>`, `--end <date>`, `--shop <id>`, `--json`.
- `orders get --id <id>` — `GET /application/shops/{shopId}/receipts/{receiptId}`. Detail view including line items.

All commands accept `--shop <id>` to override the default shop ID from config.

## Output

`output.ts` re-used from amazon-sp-cli pattern:
- `printTable(headers, rows)` — colored headers via chalk + cli-table3
- `printJson(data)` — pretty-printed JSON
- `printSuccess/printError/printWarning` — colored console output
- `colorState(state)` — color-codes listing/order states

## Error Handling

- Auth errors (401/403) → hint to re-authenticate
- Missing config → hint to run `etsy auth login`
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
- Attempts to create `EtsyClient`; on failure, commands that use it error at runtime via a Proxy
- `resolveShopId(opts)` helper: `opts.shop ?? config.shopId ?? error`
