import { Command } from "commander";
import type { EtsyClient } from "../etsy-client.js";
import { printJson, printError } from "../output.js";

interface ShopResult {
  shop_id?: number;
  shop_name?: string;
  currency_code?: string;
  listing_active_count?: number;
  is_vacation?: boolean;
  [key: string]: unknown;
}

export function registerShopCommands(
  program: Command,
  client: EtsyClient,
  resolveShopId: (opts: { shop?: string }) => string
): void {
  const shop = program.command("shop").description("View shop information");

  shop
    .command("get")
    .description("Get your shop details")
    .option("--shop <id>", "Shop ID override")
    .option("--json", "Output raw JSON")
    .action(async (opts: { shop?: string; json?: boolean }) => {
      try {
        const shopId = resolveShopId({ shop: opts.shop });
        const result = await client.call("GET", `/application/shops/${shopId}`, {}) as ShopResult;

        if (opts.json) {
          printJson(result);
          return;
        }

        console.log("");
        console.log(`  Shop Name:       ${result.shop_name ?? ""}`);
        console.log(`  Shop ID:         ${result.shop_id ?? shopId}`);
        console.log(`  Currency:        ${result.currency_code ?? ""}`);
        console.log(`  Active Listings: ${result.listing_active_count ?? 0}`);
        console.log(`  On Vacation:     ${result.is_vacation ? "yes" : "no"}`);
        console.log("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to get shop: ${message}`);
        process.exit(1);
      }
    });
}
