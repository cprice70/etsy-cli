# @cprice70/etsy-sdk Shared Library Design

**Date:** 2026-03-21
**Status:** Draft
**Scope:** Design for extracting shared Etsy API logic into reusable library for CLI, MCP server, and web app

---

## Overview

Create a standalone npm package `@cprice70/etsy-sdk` that provides core Etsy API functionality (HTTP client + validation) used by multiple clients:
- CLI (existing, will refactor to use library)
- MCP server (future)
- Web app (future)

**Goal:** Single source of truth for API communication and validation logic across all clients.

---

## Current State

**etsy-cli** currently contains:
- `src/etsy-client.ts` — HTTP client with token refresh
- `src/commands/listings.ts` — Validation logic scattered in command handlers
- Validation rules: price (positive), quantity (non-negative), tags (max 13, no duplicates), description (non-empty), state (enum)

**Problem:** Each new client (MCP, web) would duplicate this validation logic.

---

## Design

### Architecture

**Directory structure at `/Users/cprice/Projects/`:**

```
Projects/
├── etsy-sdk/                        (NEW: separate SDK package)
│   ├── src/
│   │   ├── client.ts               (EtsyClient HTTP client)
│   │   ├── validators.ts           (validation functions)
│   │   ├── types.ts                (TypeScript interfaces)
│   │   └── __tests__/              (unit tests)
│   ├── package.json                (standalone npm package)
│   ├── tsconfig.json
│   ├── README.md
│   └── .github/
│       └── workflows/              (GitHub Actions CI/CD)
│
└── etsy-cli/                        (EXISTING: CLI updated to use SDK)
    ├── src/                         (CLI refactored to import from @cprice70/etsy-sdk)
    │   ├── commands/listings.ts     (imports validators from sdk)
    │   ├── config.ts
    │   ├── output.ts
    │   └── index.ts
    ├── package.json                (depends on @cprice70/etsy-sdk)
    ├── tsconfig.json
    └── .github/
        └── workflows/              (GitHub Actions CI/CD)
```

**Location:** Separate GitHub repository: `github.com/cprice70/etsy-sdk` (independent from CLI)

**Independence:** SDK is completely standalone. CLI (and future MCP/web) install it as an npm dependency from npm registry.

### Module Structure

#### `sdk/src/client.ts` — EtsyClient

**Export:**
```typescript
export class EtsyClient {
  constructor(config: Partial<Config>);
  call(method: string, path: string, options: CallOptions): Promise<unknown>;
}

export interface Config {
  apiKey?: string;
  sharedSecret?: string;
  clientId: string;              // Required for OAuth token refresh
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
}

export interface CallOptions {
  query?: Record<string, string>;
  body?: unknown;
  oauth?: boolean;
}
```

**Responsibilities:**
- HTTP request building (headers, URL, body)
- Token refresh: proactive (< 60 sec to expiry) + reactive (catch 401)
- Error parsing and throwing
- Fetch-based implementation (Node.js 18+)

**Does NOT handle:**
- Validating input data
- Determining what API calls to make

**Important:** Token refresh **mutates** the config object passed to constructor. Clients must:
- Save updated tokens after API calls (if using file-based storage)
- Or provide injectable `onTokenRefresh` callback for credential updates

**Preserved behavior:**
- x-api-key format: `keystring:shared_secret` (if apiKey + sharedSecret provided)
- Bearer token in Authorization header (if accessToken provided)
- 204 No Content responses return empty object
- Supports multiple auth modes: OAuth-only, API key-only, or both

---

#### `sdk/src/validators.ts` — Validation Functions

**Exports:**

```typescript
export interface ValidationResult {
  valid: boolean;
  error?: string;
  parsed?: unknown;  // optional: for validators that parse data
}

export function validatePrice(price: string): ValidationResult;
export function validateQuantity(quantity: string): ValidationResult;
export function validateTags(tags: string): ValidationResult & { parsed?: string[] };
export function validateDescription(description: string): ValidationResult;
export function validateState(state: string): ValidationResult;
```

**Validation Rules:**

| Field | Rule | Error Message |
|-------|------|---------------|
| price | > 0, parseFloat | "Invalid price: must be a positive number (e.g. 19.99)" |
| quantity | >= 0, integer | "Invalid quantity: must be a non-negative integer" |
| tags | split(","), trim, filter empty, max 13, no duplicates | "Invalid tags: {specific reason}" |
| description | non-empty after trim, no whitespace-only | "Invalid description: cannot be empty or whitespace-only" |
| state | one of: active, inactive, draft | "Invalid state: must be active, inactive, or draft" |

**Return behavior:**
- `valid: true` — input passed validation, `parsed` field has processed data (for tags: array)
- `valid: false` — input failed validation, `error` field has user-friendly message

---

#### `sdk/src/types.ts` — TypeScript Interfaces

**Exports:**
```typescript
// Re-export Config from client (single source of truth)
export type { Config } from './client.js';

// Etsy API response types
export interface Listing {
  listing_id?: number;
  title?: string;
  description?: string;
  price?: ListingPrice;
  quantity?: number;
  state?: string;
  tags?: string[] | string;
  [key: string]: unknown;
}

export interface ListingPrice {
  amount: number;
  divisor: number;
  currency_code?: string;
}

// ... other Etsy API types
```

**Note:** Config is defined in `client.ts` and re-exported from `types.ts` to maintain a single source of truth.

---

### Credential Persistence Strategy

Since token refresh mutates the config object, clients must handle persistence:

#### CLI (file-based):
```typescript
const client = new EtsyClient(config);
const result = await client.call(...);

// After calls that might refresh token, save updated config
if (config.accessToken !== originalToken) {
  saveConfigToFile(config);  // CLI responsibility
}
```

#### MCP Server (environment + memory):
```typescript
const config = {
  clientId: process.env.ETSY_CLIENT_ID,
  accessToken: process.env.ETSY_ACCESS_TOKEN,
  refreshToken: process.env.ETSY_REFRESH_TOKEN
};
const client = new EtsyClient(config);

// Tokens refreshed in memory, but not persisted to env
// MCP server will restart fresh or store in separate mechanism
```

#### Web App (session + database):
```typescript
const client = new EtsyClient(session.etsyCredentials);
const result = await client.call(...);

// Save refreshed tokens back to session/database
session.etsyCredentials = { ...session.etsyCredentials, ...client.config };
```

---

### Client Usage Patterns

#### CLI (refactored):
```typescript
import { EtsyClient, validatePrice, validateTags } from '@cprice70/etsy-sdk';

// 1. Load credentials however CLI needs to
const config = loadConfigFromFile(); // from ~/.config/etsy-cli/config.json

// 2. Create client
const client = new EtsyClient(config);

// 3. Validate input
const priceResult = validatePrice(opts.price);
if (!priceResult.valid) {
  printError(`Invalid price: ${priceResult.error}`);
  process.exit(1);
}

// 4. Make API call
const body = { price: parseFloat(opts.price) };
const result = await client.call('PATCH', `/application/shops/${shopId}/listings/${id}`, {
  body,
  oauth: true
});
```

#### MCP Server (future):
```typescript
import { EtsyClient, validateTags } from '@cprice70/etsy-sdk';

// Load from environment or arguments
const client = new EtsyClient({
  apiKey: process.env.ETSY_API_KEY,
  sharedSecret: process.env.ETSY_SHARED_SECRET,
  accessToken: process.env.ETSY_ACCESS_TOKEN,
  refreshToken: process.env.ETSY_REFRESH_TOKEN
});

// Use same validation
const tagsResult = validateTags(userInput);
if (!tagsResult.valid) {
  throw new Error(tagsResult.error);
}
```

#### Web App (future):
```typescript
import { EtsyClient, validateDescription } from '@cprice70/etsy-sdk';

// Load from session/database
const client = new EtsyClient(session.etsyCredentials);

// Validate on backend before API call
const descResult = validateDescription(formData.description);
if (!descResult.valid) {
  return { error: descResult.error };
}
```

---

### Data Flow

```
Client receives input
    ↓
Client calls validator from @cprice70/etsy-sdk
    ↓
Validator returns { valid, error?, parsed? }
    ↓
If invalid: Client shows error
If valid: Client builds request body
    ↓
Client calls EtsyClient (from @cprice70/etsy-sdk)
    ↓
EtsyClient handles:
  - Token refresh if needed
  - HTTP request building
  - Error parsing
    ↓
Client receives response
```

---

### Separate Package Setup

**etsy-sdk repository** (independent npm package):

**`etsy-sdk/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "lib": ["ES2020"],
    "outDir": "./build",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "node_modules"]
}
```

**`etsy-sdk/package.json`:**
```json
{
  "name": "@cprice70/etsy-sdk",
  "version": "0.0.1",
  "description": "Shared Etsy API client and validation",
  "type": "module",
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "files": ["build"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/cprice70/etsy-sdk"
  }
}
```

**Development workflow:**

1. **SDK development and publishing** (in etsy-sdk repo):
   ```bash
   npm run build
   npm test
   npm publish  # Publishes to npm registry as @cprice70/etsy-sdk
   ```

2. **CLI uses published SDK** (in etsy-cli repo):
   ```json
   {
     "dependencies": {
       "@cprice70/etsy-sdk": "^0.0.1"
     }
   }
   ```

3. **Local development** (if modifying SDK while developing CLI):
   ```bash
   # In etsy-cli repo
   npm install ../etsy-sdk  # Install local version
   # Or use npm link for development mode
   ```

---

### Package Structure

**`packages/sdk/package.json`:**
```json
{
  "name": "@cprice70/etsy-sdk",
  "version": "0.0.1",
  "description": "Shared Etsy API client and validation for etsy-cli, MCP server, web app",
  "type": "module",
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "exports": {
    ".": "./build/index.js"
  },
  "files": ["build"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**No production dependencies** (uses built-in fetch).

**`packages/sdk/src/index.ts`:**
```typescript
export { EtsyClient } from './client.js';
export type { Config, CallOptions } from './client.js';

export {
  validatePrice,
  validateQuantity,
  validateTags,
  validateDescription,
  validateState
} from './validators.js';
export type { ValidationResult } from './validators.js';

export type {
  Listing,
  ListingPrice,
  // ... other types
} from './types.js';
```

---

### CLI Refactoring

**Impact on existing CLI:**
1. Remove validation logic from `src/commands/listings.ts` (price, quantity, tags, description, state)
2. Import validators and EtsyClient from `@cprice70/etsy-sdk` npm package
3. Deprecate local `src/etsy-client.ts` (no longer needed, use SDK version)
4. Add `@cprice70/etsy-sdk` as dependency in CLI's `package.json`

**Before implementing CLI changes:**
- SDK must be built and published to npm as `@cprice70/etsy-sdk` version 0.0.1
- CLI then depends on that published version

**Result:** CLI becomes thinner, focused on:
- Command parsing (Commander.js)
- Config management (load/save credentials from `~/.config`)
- Output formatting (chalk, cli-table3)
- Integration with SDK (EtsyClient, validators)
- CLI-specific concerns (interactive mode, table output)

---

### Testing

#### SDK Tests (`packages/sdk/src/__tests__/`):
- `client.test.ts` — EtsyClient behavior (mocked fetch)
  - Token refresh: proactive, reactive 401
  - Error parsing
  - Header building (x-api-key format)
- `validators.test.ts` — Each validator
  - Valid inputs pass, return parsed data
  - Invalid inputs fail with helpful error
  - Edge cases (whitespace, duplicates, limits)

#### CLI Tests:
- Updated to mock `@cprice70/etsy-sdk` (no changes to test approach)
- Tests verify integration points (validators called, client used correctly)

---

### Error Handling

**EtsyClient errors:**
- 404 → "HTTP 404: Resource not found"
- 401/403 → "HTTP 401: Unauthorized" (client handles retry)
- 400 with error message → "HTTP 400: {message from API}"
- Network/parsing errors → descriptive messages

**Validator errors:**
- Specific, user-friendly messages
- No technical jargon (e.g., "max 13 tags allowed" not "array length > 13")

---

### Extensibility

**Adding a new field** (e.g., `materials`):
1. Add to `validators.ts`: `export function validateMaterials(...)`
2. Export from `index.ts`
3. Add test in `validators.test.ts`
4. CLI/MCP/web import and use
5. Add to types.ts if needed

No changes needed to EtsyClient or core architecture.

---

### Success Criteria

- ✅ EtsyClient works identically to current CLI implementation
- ✅ All validation logic extracted and accessible
- ✅ CLI refactored to use library with no behavior changes
- ✅ All CLI tests pass
- ✅ SDK tests have 100% coverage of client and validators
- ✅ MCP server and web app can easily integrate the library
- ✅ Single source of truth for Etsy API logic across clients

---

### Future Enhancements

- Additional field validators as needed (materials, shippingProfileId, etc.)
- Helper functions (formatPrice, parsePrice) if multiple clients need them
- Shared error handling utilities
- Potentially: config loading/saving helpers (if pattern emerges across clients)

---

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SDK version mismatch across clients | Monorepo helps; semantic versioning; clear changelog |
| Validation logic diverges from API | Automated tests; same tests run in CLI, SDK, MCP |
| Client-specific needs | Design is flexible; each client can extend validators locally if needed |
| Extract is complex | Incremental: extract validators first, then EtsyClient, test at each step |

---

## Decision Log

- **Separate npm package vs. monorepo:** Chose separate package (simpler initial setup, migrate to monorepo later if needed)
- **What to export:** EtsyClient + validators + types. Not config helpers (too client-specific)
- **Credentials handling:** Constructor parameters (each client manages loading)
- **Validation return format:** `{ valid, error?, parsed? }` (clear, extensible)
