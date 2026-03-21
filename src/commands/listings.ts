import readline from "readline/promises";
import { Command } from "commander";
import type { EtsyClient } from "../etsy-client.js";
import { printTable, printJson, printError, printSuccess, colorState, isAuthError } from "../output.js";

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
        if (isAuthError(err)) {
          printError("Hint: run 'etsy auth login' to re-authenticate.");
        }
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
        if (isAuthError(err)) {
          printError("Hint: run 'etsy auth login' to re-authenticate.");
        }
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

        const price = parseFloat(priceStr);
        if (isNaN(price)) {
          printError("Invalid price: must be a number (e.g. 19.99)");
          process.exit(1);
          return;
        }
        const quantity = parseInt(quantityStr, 10);
        if (isNaN(quantity)) {
          printError("Invalid quantity: must be an integer");
          process.exit(1);
          return;
        }
        const taxonomyId = parseInt(taxonomyIdStr, 10);
        if (isNaN(taxonomyId)) {
          printError("Invalid taxonomy ID: must be an integer");
          process.exit(1);
          return;
        }

        const body: Record<string, unknown> = {
          title: title.trim(),
          description: description.trim(),
          price,
          quantity,
          type: type.trim(),
          taxonomy_id: taxonomyId,
          who_made: whoMade.trim(),
          when_made: whenMade.trim(),
          is_supply: isSupplyStr.trim().toLowerCase() === "y",
        };

        if (shippingProfileIdStr.trim()) {
          const shippingProfileId = parseInt(shippingProfileIdStr.trim(), 10);
          if (isNaN(shippingProfileId)) {
            printError("Invalid shipping profile ID: must be an integer");
            process.exit(1);
            return;
          }
          body.shipping_profile_id = shippingProfileId;
        }

        const result = await client.call(
          "POST",
          `/application/shops/${shopId}/listings`,
          { body, oauth: true }
        ) as { listing_id?: number };

        printSuccess(`Created listing ID: ${result.listing_id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to create listing: ${message}`);
        if (isAuthError(err)) {
          printError("Hint: run 'etsy auth login' to re-authenticate.");
        }
        process.exit(1);
        return;
      } finally {
        rl.close();
        process.stdin.destroy();
      }
    });

  listings
    .command("update")
    .description("Update a listing")
    .requiredOption("--id <id>", "Listing ID")
    .option("--title <text>", "New title")
    .option("--description <text>", "New description")
    .option("--tags <tags>", "Comma-separated tags (max 13)")
    .option("--price <amount>", "New price")
    .option("--quantity <n>", "New quantity")
    .option("--state <state>", "New state: active, inactive, draft")
    .option("--interactive", "Interactive mode with current value defaults")
    .option("--shop <id>", "Shop ID override")
    .action(async (opts: { id: string; title?: string; description?: string; tags?: string; price?: string; quantity?: string; state?: string; shop?: string; interactive?: boolean }) => {
      let rl: any;
      try {
        const shopId = resolveShopId({ shop: opts.shop });

        // Interactive mode: fetch current values and prompt user
        if (opts.interactive) {
          rl = readline.createInterface({ input: process.stdin, output: process.stdout });

          // Fetch current listing
          const current = await client.call("GET", `/application/listings/${opts.id}`, {}) as Listing & { tags?: string[] | string; description?: string };

          // Prompt for each field with current value as default
          const newTitle = await rl.question(`Title [Current: "${current.title || ""}"]: `);
          const newDescription = await rl.question(`Description [Current: "${current.description || ""}"]: `);
          const currentTags = Array.isArray(current.tags) ? current.tags.join(",") : (current.tags || "");
          const newTags = await rl.question(`Tags [Current: "${currentTags}"]: `);
          const newQuantity = await rl.question(`Quantity [Current: ${current.quantity || ""}]: `);
          const currentPrice = current.price ? (current.price.amount / current.price.divisor).toFixed(2) : "";
          const newPrice = await rl.question(`Price [Current: ${currentPrice}]: `);
          const newState = await rl.question(`State [Current: ${current.state || ""}]: `);

          // Build opts from user input (only non-empty values)
          if (newTitle.trim()) opts.title = newTitle.trim();
          else delete opts.title;
          if (newDescription.trim()) opts.description = newDescription.trim();
          else delete opts.description;
          if (newTags.trim()) opts.tags = newTags.trim();
          else delete opts.tags;
          if (newQuantity.trim()) opts.quantity = newQuantity.trim();
          else delete opts.quantity;
          if (newPrice.trim()) opts.price = newPrice.trim();
          else delete opts.price;
          if (newState.trim()) opts.state = newState.trim();
          else delete opts.state;
        }

        const validStates = ["active", "inactive", "draft"];
        if (opts.state !== undefined && !validStates.includes(opts.state)) {
          printError(`Invalid state: "${opts.state}". Must be one of: active, inactive, draft`);
          process.exit(1);
          return;
        }

        const body: Record<string, unknown> = {};

        if (opts.title !== undefined) body.title = opts.title;
        if (opts.description !== undefined) {
          const trimmed = opts.description.trim();
          if (!trimmed) {
            printError("Invalid description: cannot be empty or whitespace-only");
            process.exit(1);
            return;
          }
          body.description = trimmed;
        }
        if (opts.tags !== undefined) {
          const tagArray = opts.tags
            .split(",")
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

          if (tagArray.length === 0) {
            printError("Invalid tags: cannot be empty");
            process.exit(1);
            return;
          }

          if (tagArray.length > 13) {
            printError("Invalid tags: maximum 13 tags allowed");
            process.exit(1);
            return;
          }

          const uniqueTags = new Set(tagArray);
          if (uniqueTags.size !== tagArray.length) {
            printError("Invalid tags: duplicate tags found");
            process.exit(1);
            return;
          }

          body.tags = tagArray;
        }
        if (opts.price !== undefined) {
          const price = parseFloat(opts.price);
          if (isNaN(price) || price <= 0) {
            printError("Invalid price: must be a positive number (e.g. 19.99)");
            process.exit(1);
            return;
          }
          body.price = price;
        }
        if (opts.quantity !== undefined) {
          const quantity = parseInt(opts.quantity, 10);
          if (isNaN(quantity) || quantity < 0) {
            printError("Invalid quantity: must be a non-negative integer");
            process.exit(1);
            return;
          }
          body.quantity = quantity;
        }
        if (opts.state !== undefined) body.state = opts.state;

        if (Object.keys(body).length === 0) {
          printError("No fields to update. Provide at least one of: --title, --description, --tags, --price, --quantity, --state");
          process.exit(1);
          return;
        }

        const result = await client.call(
          "PATCH",
          `/application/shops/${shopId}/listings/${opts.id}`,
          { body, oauth: true }
        ) as Listing;

        console.log(`Updated listing ${result.listing_id ?? opts.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to update listing: ${message}`);
        if (isAuthError(err)) {
          printError("Hint: run 'etsy auth login' to re-authenticate.");
        }
        process.exit(1);
        return;
      } finally {
        if (rl) {
          rl.close();
          process.stdin.destroy();
        }
      }
    });
}
