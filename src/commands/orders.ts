import { Command } from "commander";
import type { EtsyClient } from "../etsy-client.js";
import { printTable, printJson, printError, colorState, isAuthError } from "../output.js";

interface ReceiptTotal {
  amount: number;
  divisor: number;
  currency_code?: string;
}

interface Transaction {
  listing_id?: number;
  title?: string;
  quantity?: number;
  price?: ReceiptTotal;
}

interface Receipt {
  receipt_id?: number;
  name?: string;
  create_timestamp?: number;
  grandtotal?: ReceiptTotal;
  status?: string;
  transactions?: Transaction[];
  [key: string]: unknown;
}

interface ReceiptsResult {
  results?: Receipt[];
}

function formatTotal(total?: ReceiptTotal): string {
  if (!total) return "";
  const amount = total.amount / total.divisor;
  return `${total.currency_code ?? "$"}${amount.toFixed(2)}`;
}

export function registerOrdersCommands(
  program: Command,
  client: EtsyClient,
  resolveShopId: (opts: { shop?: string }) => string
): void {
  const orders = program.command("orders").description("View orders (receipts)");

  orders
    .command("list")
    .description("List orders")
    .option("--limit <n>", "Number of results (max 100)", "25")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--start <date>", "ISO 8601 start date (e.g. 2024-01-01)")
    .option("--end <date>", "ISO 8601 end date")
    .option("--shop <id>", "Shop ID override")
    .option("--json", "Output raw JSON")
    .action(async (opts: { limit: string; offset: string; start?: string; end?: string; shop?: string; json?: boolean }) => {
      try {
        const shopId = resolveShopId({ shop: opts.shop });
        const limit = Math.min(parseInt(opts.limit, 10) || 25, 100);

        const query: Record<string, string> = {
          limit: String(limit),
          offset: opts.offset,
        };

        if (opts.start) {
          query.min_created = String(Math.floor(new Date(opts.start).getTime() / 1000));
        }
        if (opts.end) {
          query.max_created = String(Math.floor(new Date(opts.end).getTime() / 1000));
        }

        const result = await client.call(
          "GET",
          `/application/shops/${shopId}/receipts`,
          { query, oauth: true }
        ) as ReceiptsResult;

        const receipts = result.results ?? [];

        if (opts.json) {
          printJson(receipts);
          return;
        }

        if (receipts.length === 0) {
          console.log("No orders found.");
          return;
        }

        const rows = receipts.map((r) => [
          String(r.receipt_id ?? ""),
          r.name ?? "",
          r.create_timestamp ? new Date(r.create_timestamp * 1000).toISOString().split("T")[0] : "",
          formatTotal(r.grandtotal),
          colorState(r.status ?? ""),
        ]);

        printTable(["Receipt ID", "Buyer", "Date", "Total", "Status"], rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to list orders: ${message}`);
        if (isAuthError(err)) {
          printError("Hint: run 'etsy auth login' to re-authenticate.");
        }
        process.exit(1);
      }
    });

  orders
    .command("get")
    .description("Get a single order by receipt ID")
    .requiredOption("--id <id>", "Receipt ID")
    .option("--shop <id>", "Shop ID override")
    .option("--json", "Output raw JSON")
    .action(async (opts: { id: string; shop?: string; json?: boolean }) => {
      try {
        const shopId = resolveShopId({ shop: opts.shop });

        const result = await client.call(
          "GET",
          `/application/shops/${shopId}/receipts/${opts.id}`,
          { oauth: true }
        ) as Receipt;

        if (opts.json) {
          printJson(result);
          return;
        }

        console.log("");
        console.log(`  Receipt ID: ${result.receipt_id ?? opts.id}`);
        console.log(`  Buyer:      ${result.name ?? ""}`);
        console.log(`  Status:     ${colorState(result.status ?? "")}`);
        console.log(`  Total:      ${formatTotal(result.grandtotal)}`);

        if (result.transactions && result.transactions.length > 0) {
          console.log("\n  Line Items:");
          for (const txn of result.transactions) {
            const price = txn.price ? formatTotal(txn.price) : "";
            console.log(`    - ${txn.title ?? ""} (x${txn.quantity ?? 1}) ${price}`);
          }
        }

        console.log("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to get order: ${message}`);
        if (isAuthError(err)) {
          printError("Hint: run 'etsy auth login' to re-authenticate.");
        }
        process.exit(1);
      }
    });
}
