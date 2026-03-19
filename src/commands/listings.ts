import readline from "readline/promises";
import { Command } from "commander";
import type { EtsyClient } from "../etsy-client.js";
import { printTable, printJson, printError, colorState } from "../output.js";

interface ListingPrice {
  amount: number;
  divisor: number;
  currency_code?: string;
}

interface Listing {
  listing_id?: number;
  title?: string;
  price?: ListingPrice;
  quantity?: number;
  state?: string;
  [key: string]: unknown;
}

interface ListingsResult {
  results?: Listing[];
}

const STATE_ENDPOINTS: Record<string, string> = {
  active: "active",
  draft: "draft",
  inactive: "inactive",
};

function formatPrice(price?: ListingPrice): string {
  if (!price) return "";
  const amount = price.amount / price.divisor;
  return `${price.currency_code ?? "$"}${amount.toFixed(2)}`;
}

export function registerListingsCommands(
  program: Command,
  client: EtsyClient,
  resolveShopId: (opts: { shop?: string }) => string
): void {
  const listings = program.command("listings").description("Manage listings");

  listings
    .command("list")
    .description("List shop listings")
    .option("--state <state>", "Listing state: active, draft, inactive", "active")
    .option("--limit <n>", "Number of results (max 100)", "25")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--shop <id>", "Shop ID override")
    .option("--json", "Output raw JSON")
    .action(async (opts: { state: string; limit: string; offset: string; shop?: string; json?: boolean }) => {
      try {
        const shopId = resolveShopId({ shop: opts.shop });
        const endpoint = STATE_ENDPOINTS[opts.state] ?? "active";
        const limit = Math.min(parseInt(opts.limit, 10) || 25, 100);

        const result = await client.call(
          "GET",
          `/application/shops/${shopId}/listings/${endpoint}`,
          { query: { limit: String(limit), offset: opts.offset } }
        ) as ListingsResult;

        const items = result.results ?? [];

        if (opts.json) {
          printJson(items);
          return;
        }

        if (items.length === 0) {
          console.log("No listings found.");
          return;
        }

        const rows = items.map((l) => [
          String(l.listing_id ?? ""),
          l.title ?? "",
          formatPrice(l.price),
          String(l.quantity ?? ""),
          colorState(l.state ?? ""),
        ]);

        printTable(["ID", "Title", "Price", "Qty", "State"], rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to list listings: ${message}`);
        process.exit(1);
        return;
      }
    });

  listings
    .command("get")
    .description("Get a listing by ID")
    .requiredOption("--id <id>", "Listing ID")
    .option("--json", "Output raw JSON")
    .action(async (opts: { id: string; json?: boolean }) => {
      try {
        const result = await client.call("GET", `/application/listings/${opts.id}`, {}) as Listing;

        if (opts.json) {
          printJson(result);
          return;
        }

        console.log("");
        for (const [key, value] of Object.entries(result)) {
          if (value !== null && value !== undefined) {
            const display = typeof value === "object" ? JSON.stringify(value) : String(value);
            console.log(`  ${key}: ${display}`);
          }
        }
        console.log("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to get listing: ${message}`);
        process.exit(1);
        return;
      }
    });

  listings
    .command("create")
    .description("Create a new listing (interactive)")
    .option("--shop <id>", "Shop ID override")
    .action(async (opts: { shop?: string }) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const shopId = resolveShopId({ shop: opts.shop });

        const title = await rl.question("Title: ");
        const description = await rl.question("Description: ");
        const priceStr = await rl.question("Price (e.g. 19.99): ");
        const quantityStr = await rl.question("Quantity: ");
        const type = await rl.question("Type (physical/digital/download): ");
        const taxonomyIdStr = await rl.question("Taxonomy ID (see https://developer.etsy.com): ");
        const shippingProfileIdStr = await rl.question("Shipping Profile ID (physical only, or press Enter to skip): ");
        const whoMade = await rl.question("Who made it? (i_did/someone_else/collective): ");
        const whenMade = await rl.question("When made? (e.g. 2020_2024): ");
        const isSupplyStr = await rl.question("Is supply? (y/N): ");

        const body: Record<string, unknown> = {
          title: title.trim(),
          description: description.trim(),
          price: parseFloat(priceStr),
          quantity: parseInt(quantityStr, 10),
          type: type.trim(),
          taxonomy_id: parseInt(taxonomyIdStr, 10),
          who_made: whoMade.trim(),
          when_made: whenMade.trim(),
          is_supply: isSupplyStr.trim().toLowerCase() === "y",
        };

        if (shippingProfileIdStr.trim()) {
          body.shipping_profile_id = parseInt(shippingProfileIdStr.trim(), 10);
        }

        const result = await client.call(
          "POST",
          `/application/shops/${shopId}/listings`,
          { body, oauth: true }
        ) as { listing_id?: number };

        console.log(`Created listing ID: ${result.listing_id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to create listing: ${message}`);
        process.exit(1);
        return;
      } finally {
        rl.close();
      }
    });

  listings
    .command("update")
    .description("Update a listing")
    .requiredOption("--id <id>", "Listing ID")
    .option("--title <text>", "New title")
    .option("--price <amount>", "New price")
    .option("--quantity <n>", "New quantity")
    .option("--state <state>", "New state: active, inactive, draft")
    .action(async (opts: { id: string; title?: string; price?: string; quantity?: string; state?: string }) => {
      try {
        const body: Record<string, unknown> = {};

        if (opts.title !== undefined) body.title = opts.title;
        if (opts.price !== undefined) body.price = parseFloat(opts.price);
        if (opts.quantity !== undefined) body.quantity = parseInt(opts.quantity, 10);
        if (opts.state !== undefined) body.state = opts.state;

        if (Object.keys(body).length === 0) {
          printError("No fields to update. Provide at least one of: --title, --price, --quantity, --state");
          process.exit(1);
          return;
        }

        const result = await client.call(
          "PATCH",
          `/application/listings/${opts.id}`,
          { body, oauth: true }
        ) as Listing;

        console.log(`Updated listing ${result.listing_id ?? opts.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to update listing: ${message}`);
        process.exit(1);
        return;
      }
    });
}
