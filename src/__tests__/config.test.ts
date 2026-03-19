import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Must mock fs before importing config
vi.mock("fs");

describe("config", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear env vars
    delete process.env.ETSY_API_KEY;
    delete process.env.ETSY_ACCESS_TOKEN;
    delete process.env.ETSY_REFRESH_TOKEN;
    delete process.env.ETSY_SHOP_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Note: vi.mock("fs") is hoisted by Vitest's transformer before any imports,
  // so repeated `await import("../config.js")` calls return the cached module
  // that already references the mocked `fs`. This is safe and intentional.
  it("loadConfig returns empty object when config file does not exist", async () => {
    const { loadConfig } = await import("../config.js");
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config).toEqual({});
  });

  it("loadConfig reads values from config file", async () => {
    const { loadConfig } = await import("../config.js");
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ apiKey: "key123", shopId: "shop456" })
    );
    const config = loadConfig();
    expect(config.apiKey).toBe("key123");
    expect(config.shopId).toBe("shop456");
  });

  it("loadConfig env vars override file values", async () => {
    const { loadConfig } = await import("../config.js");
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ apiKey: "file-key" })
    );
    process.env.ETSY_API_KEY = "env-key";
    const config = loadConfig();
    expect(config.apiKey).toBe("env-key");
  });

  it("saveConfig writes JSON to config file", async () => {
    const { saveConfig } = await import("../config.js");
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    const writeSpy = vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    saveConfig({ apiKey: "mykey" });
    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][1] as string;
    expect(JSON.parse(written)).toMatchObject({ apiKey: "mykey" });
  });

  it("deleteConfig unlinks config file", async () => {
    const { deleteConfig } = await import("../config.js");
    const unlinkSpy = vi.mocked(fs.unlinkSync).mockImplementation(() => {});
    deleteConfig();
    expect(unlinkSpy).toHaveBeenCalledOnce();
  });

  it("deleteConfig ignores error if file does not exist", async () => {
    const { deleteConfig } = await import("../config.js");
    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => deleteConfig()).not.toThrow();
  });
});
