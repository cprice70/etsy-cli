import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerShopCommands } from "../../commands/shop.js";

describe("shop commands", () => {
  const mockCall = vi.fn();
  const mockClient = { call: mockCall } as any;
  const resolveShopId = (_opts: { shop?: string }) => "12345";

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

  it("shop get prints shop details", async () => {
    mockCall.mockResolvedValueOnce({
      shop_id: 12345,
      shop_name: "MyShop",
      currency_code: "USD",
      listing_active_count: 42,
      is_vacation: false,
    });

    const program = new Command();
    program.exitOverride();
    registerShopCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "shop", "get"]);

    expect(mockCall).toHaveBeenCalledWith("GET", "/application/shops/12345", {});
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("MyShop");
    expect(output).toContain("USD");
    expect(output).toContain("42");
    expect(output).toContain("On Vacation");
  });

  it("shop get outputs JSON with --json flag", async () => {
    const shop = { shop_id: 12345, shop_name: "MyShop" };
    mockCall.mockResolvedValueOnce(shop);

    const program = new Command();
    program.exitOverride();
    registerShopCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "shop", "get", "--json"]);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(shop, null, 2));
  });

  it("shop get shows auth hint on 401 error", async () => {
    mockCall.mockRejectedValueOnce(new Error("HTTP 401: Unauthorized"));

    const program = new Command();
    program.exitOverride();
    registerShopCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "shop", "get"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("auth login"));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("shop get handles API errors gracefully", async () => {
    mockCall.mockRejectedValueOnce(new Error("API Error"));

    const program = new Command();
    program.exitOverride();
    registerShopCommands(program, mockClient, resolveShopId);

    await program.parseAsync(["node", "test", "shop", "get"]);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
