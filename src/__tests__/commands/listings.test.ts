import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerListingsCommands } from "../../commands/listings.js";

describe("listings commands", () => {
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

  // ── listings list ──────────────────────────────────────────────────────────

  it("listings list renders table by default (active)", async () => {
    mockCall.mockResolvedValueOnce({
      results: [
        { listing_id: 1, title: "Hat", price: { amount: 1999, divisor: 100 }, quantity: 5, state: "active" },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "list"]);

    expect(mockCall).toHaveBeenCalledWith(
      "GET",
      "/application/shops/99999/listings/active",
      expect.objectContaining({ query: expect.objectContaining({ limit: "25" }) })
    );
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Hat");
  });

  it("listings list uses draft endpoint with --state draft", async () => {
    mockCall.mockResolvedValueOnce({ results: [] });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "list", "--state", "draft"]);

    expect(mockCall).toHaveBeenCalledWith(
      "GET",
      "/application/shops/99999/listings/draft",
      expect.anything()
    );
  });

  it("listings list outputs JSON with --json flag", async () => {
    const results = [{ listing_id: 1, title: "Hat" }];
    mockCall.mockResolvedValueOnce({ results });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "list", "--json"]);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(results, null, 2));
  });

  it("listings list prints message when empty", async () => {
    mockCall.mockResolvedValueOnce({ results: [] });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "list"]);

    expect(consoleSpy).toHaveBeenCalledWith("No listings found.");
  });

  it("listings list passes limit and offset options", async () => {
    mockCall.mockResolvedValueOnce({ results: [] });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "list", "--limit", "50", "--offset", "25"]);

    expect(mockCall).toHaveBeenCalledWith(
      "GET",
      expect.any(String),
      expect.objectContaining({ query: expect.objectContaining({ limit: "50", offset: "25" }) })
    );
  });

  // ── listings get ──────────────────────────────────────────────────────────

  it("listings get prints detail view", async () => {
    mockCall.mockResolvedValueOnce({
      listing_id: 42,
      title: "Fancy Hat",
      state: "active",
      quantity: 3,
    });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "get", "--id", "42"]);

    expect(mockCall).toHaveBeenCalledWith("GET", "/application/listings/42", {});
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Fancy Hat");
  });

  it("listings get outputs JSON with --json", async () => {
    const listing = { listing_id: 42, title: "Hat" };
    mockCall.mockResolvedValueOnce(listing);

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "get", "--id", "42", "--json"]);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(listing, null, 2));
  });

  // ── listings update ───────────────────────────────────────────────────────

  it("listings update sends only provided fields", async () => {
    mockCall.mockResolvedValueOnce({ listing_id: 42, title: "New Title" });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--title", "New Title"]);

    expect(mockCall).toHaveBeenCalledWith(
      "PATCH",
      "/application/shops/99999/listings/42",
      expect.objectContaining({ body: { title: "New Title" } })
    );
  });

  it("listings update handles multiple fields", async () => {
    mockCall.mockResolvedValueOnce({ listing_id: 42 });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync([
      "node", "test", "listings", "update", "--id", "42",
      "--price", "19.99", "--quantity", "10",
    ]);

    expect(mockCall).toHaveBeenCalledWith(
      "PATCH",
      "/application/shops/99999/listings/42",
      expect.objectContaining({ body: { price: 19.99, quantity: 10 } })
    );
  });

  it("listings update sends description when provided", async () => {
    mockCall.mockResolvedValueOnce({ listing_id: 42 });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync([
      "node", "test", "listings", "update", "--id", "42",
      "--description", "New description",
    ]);

    expect(mockCall).toHaveBeenCalledWith(
      "PATCH",
      "/application/shops/99999/listings/42",
      expect.objectContaining({ body: { description: "New description" } })
    );
  });

  it("listings update sends tags when provided", async () => {
    mockCall.mockResolvedValueOnce({ listing_id: 42 });

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--tags", "vintage,handmade,art"]);

    expect(mockCall).toHaveBeenCalledWith(
      "PATCH",
      "/application/shops/99999/listings/42",
      expect.objectContaining({ body: { tags: ["vintage", "handmade", "art"] } })
    );
  });

  it("listings update rejects tags with only whitespace", async () => {
    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--tags", "  ,  ,tag1"]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  // ── error handling ─────────────────────────────────────────────────────────

  it("listings list handles API errors", async () => {
    mockCall.mockRejectedValueOnce(new Error("API Error"));

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "list"]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("listings list shows auth hint on 401 error", async () => {
    mockCall.mockRejectedValueOnce(new Error("HTTP 401: Unauthorized"));

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "list"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("auth login"));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("listings get handles API errors", async () => {
    mockCall.mockRejectedValueOnce(new Error("API Error"));

    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "get", "--id", "42"]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("listings update with no flags shows error", async () => {
    const program = new Command();
    program.exitOverride();
    registerListingsCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "listings", "update", "--id", "42"]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
