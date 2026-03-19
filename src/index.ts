#!/usr/bin/env node
import { program } from "commander";
import { loadConfig } from "./config.js";
import { createClient, EtsyClient } from "./etsy-client.js";
import { printError } from "./output.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerShopCommands } from "./commands/shop.js";
import { registerListingsCommands } from "./commands/listings.js";
import { registerOrdersCommands } from "./commands/orders.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const config = loadConfig();

program
  .name("etsy")
  .description("Etsy Open API v3 CLI")
  .version(version);

// Auth commands don't need a client
registerAuthCommands(program);

// For all other commands, try to create the client.
// If config is missing credentials, commands that need the client error at runtime.
let client: EtsyClient | null = null;

try {
  client = createClient(config);
} catch {
  // Config incomplete — auth commands still work
}

// Proxy defers the "not configured" error to runtime
const clientProxy = new Proxy({} as EtsyClient, {
  get(_target, prop) {
    if (!client) {
      printError('Not configured. Run "etsy auth login" to set up credentials.');
      process.exit(1);
    }
    const val = (client as any)[prop as string];
    return typeof val === "function" ? val.bind(client) : val;
  },
});

function resolveShopId(opts: { shop?: string }): string {
  const shopId = opts.shop ?? config.shopId;
  if (!shopId) {
    printError(
      'Shop ID is required. Use --shop <id>, set ETSY_SHOP_ID, or run "etsy auth login".'
    );
    process.exit(1);
  }
  return shopId;
}

registerShopCommands(program, clientProxy, resolveShopId);
registerListingsCommands(program, clientProxy, resolveShopId);
registerOrdersCommands(program, clientProxy, resolveShopId);

program.parse();
