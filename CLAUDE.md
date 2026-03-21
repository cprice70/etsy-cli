# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Run with file watching via tsx
npm test             # Run tests once with Vitest
npm run test:watch   # Run tests in watch mode
```

To run a single test file:
```bash
npx vitest run src/__tests__/etsy-client.test.ts
```

## Architecture

**etsy-cli** is a TypeScript CLI tool (ES2022, CommonJS) that wraps the Etsy Open API v3. It uses Commander.js for argument parsing and publishes as `@cprice70/etsy-cli`.

### Data Flow

1. `src/index.ts` — entry point; loads config, creates an `EtsyClient` wrapped in a lazy proxy (so auth commands work even with incomplete config), then registers all command groups
2. `src/config.ts` — reads/writes `~/.config/etsy-cli/config.json` (mode 0o600); env vars (`ETSY_API_KEY`, `ETSY_ACCESS_TOKEN`, etc.) override persisted values
3. `src/etsy-client.ts` — HTTP client; sends `x-api-key` + `Authorization: Bearer` headers; handles proactive token refresh (< 60s to expiry) and reactive 401 retry
4. `src/commands/` — one file per command group; each exports `registerXxxCommands(program, client, resolveShopId)`
5. `src/output.ts` — all terminal formatting (chalk colors, cli-table3 tables, JSON mode)

### OAuth PKCE Flow

`auth login` generates a code verifier/challenge, opens the browser for Etsy consent, and spins up a local HTTP server on port 3003 to receive the callback. The authorization code is exchanged for access + refresh tokens which are saved to config.

### Adding a New Command Group

1. Create `src/commands/<group>.ts` exporting `registerXxxCommands(program, client, resolveShopId)`
2. Import and call it in `src/index.ts`
3. Add tests in `src/__tests__/commands/<group>.test.ts`

### Output Convention

All commands accept `--json` to emit raw API JSON. Without it, use `src/output.ts` helpers (`formatTable`, `colorizeState`, etc.) for human-readable output.
