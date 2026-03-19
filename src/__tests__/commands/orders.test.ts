import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerOrdersCommands } from "../../commands/orders.js";

describe("orders commands", () => {
  const mockCall = vi.fn();
  const mockClient = { call: mockCall } as any;
  const resolveShopId = (_opts: { shop?: string }) => "99999";

  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    mockCall.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  // ── orders list ───────────────────────────────────────────────────────────

  it("orders list renders table by default", async () => {
    mockCall.mockResolvedValueOnce({
      results: [
        {
          receipt_id: 1001,
          name: "Jane Doe",
          create_timestamp: 1700000000,
          grandtotal: { amount: 2999, divisor: 100, currency_code: "USD" },
          status: "paid",
        },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "list"]);

    expect(mockCall).toHaveBeenCalledWith(
      "GET",
      "/application/shops/99999/receipts",
      expect.objectContaining({ query: expect.objectContaining({ limit: "25" }) })
    );
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Jane Doe");
  });

  it("orders list outputs JSON with --json flag", async () => {
    const results = [{ receipt_id: 1001 }];
    mockCall.mockResolvedValueOnce({ results });

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "list", "--json"]);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(results, null, 2));
  });

  it("orders list converts ISO date to unix timestamp for --start", async () => {
    mockCall.mockResolvedValueOnce({ results: [] });

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "list", "--start", "2024-01-01"]);

    const callArgs = mockCall.mock.calls[0];
    const query = callArgs[2].query;
    expect(query.min_created).toBe(String(Math.floor(new Date("2024-01-01").getTime() / 1000)));
  });

  it("orders list prints message when empty", async () => {
    mockCall.mockResolvedValueOnce({ results: [] });

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "list"]);

    expect(consoleSpy).toHaveBeenCalledWith("No orders found.");
  });

  // ── orders get ────────────────────────────────────────────────────────────

  it("orders get prints receipt detail view", async () => {
    mockCall.mockResolvedValueOnce({
      receipt_id: 1001,
      name: "Jane Doe",
      status: "paid",
      transactions: [
        { listing_id: 42, title: "Hat", quantity: 1, price: { amount: 2999, divisor: 100 } },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "get", "--id", "1001"]);

    expect(mockCall).toHaveBeenCalledWith(
      "GET",
      "/application/shops/99999/receipts/1001",
      expect.objectContaining({ oauth: true })
    );
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Jane Doe");
    expect(output).toContain("Hat");
  });

  it("orders get outputs JSON with --json", async () => {
    const receipt = { receipt_id: 1001, name: "Jane Doe" };
    mockCall.mockResolvedValueOnce(receipt);

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "get", "--id", "1001", "--json"]);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(receipt, null, 2));
  });

  // ── error handling ─────────────────────────────────────────────────────────

  it("orders list handles API errors", async () => {
    mockCall.mockRejectedValueOnce(new Error("API Error"));

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "list"]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("orders list shows auth hint on 401 error", async () => {
    mockCall.mockRejectedValueOnce(new Error("HTTP 401: Unauthorized"));

    const program = new Command();
    program.exitOverride();
    registerOrdersCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "orders", "list"]);

    expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, expect.stringContaining("auth login"));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
