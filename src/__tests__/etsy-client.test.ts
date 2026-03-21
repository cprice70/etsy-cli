import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EtsyClient } from "../etsy-client.js";

const BASE_URL = "https://openapi.etsy.com/v3";

describe("EtsyClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Bearer auth when accessToken is present", async () => {
    const client = new EtsyClient({
      accessToken: "mytoken",
      accessTokenExpiresAt: Date.now() / 1000 + 3600,
    });
    await client.call("GET", "/application/shops/123");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/application/shops/123`);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer mytoken");
  });

  it("uses x-api-key when only apiKey is present", async () => {
    const client = new EtsyClient({ apiKey: "myapikey" });
    await client.call("GET", "/application/shops/123");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("myapikey");
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("throws if oauth required but only apiKey set", async () => {
    const client = new EtsyClient({ apiKey: "myapikey" });
    await expect(client.call("GET", "/application/shops/123/receipts", { oauth: true }))
      .rejects.toThrow("OAuth");
  });

  it("appends query params to URL", async () => {
    const client = new EtsyClient({ apiKey: "key" });
    await client.call("GET", "/application/listings/active", {
      query: { limit: "10", offset: "0" },
    });
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=0");
  });

  it("sends JSON body for POST", async () => {
    const client = new EtsyClient({ accessToken: "tok", accessTokenExpiresAt: Date.now() / 1000 + 3600 });
    await client.call("POST", "/application/shops/123/listings", {
      body: { title: "Test" },
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "Test" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("proactively refreshes token when near expiry", async () => {
    // Token expires in 30 seconds (within 60s threshold)
    const client = new EtsyClient({
      accessToken: "expiring-token",
      refreshToken: "refresh-tok",
      clientId: "client123",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 30,
    });

    // First call: token refresh endpoint
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      })
      // Second call: actual API call
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ shop_id: 123 }),
      });

    const result = await client.call("GET", "/application/shops/123");

    // Two fetch calls: refresh first, then actual API call
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [refreshUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toContain("api.etsy.com");
    expect(result).toEqual({ shop_id: 123 });
    // Token updated on client
    expect(client["config"].accessToken).toBe("new-token");
  });

  it("reactively refreshes on 401 response", async () => {
    const client = new EtsyClient({
      accessToken: "stale-token",
      refreshToken: "refresh-tok",
      clientId: "client123",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    mockFetch
      // First call returns 401
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      // Refresh call
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "new-tok", refresh_token: "new-ref", expires_in: 3600 }),
      })
      // Retry call succeeds
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ shop_id: 123 }) });

    const result = await client.call("GET", "/application/shops/123");
    expect(result).toEqual({ shop_id: 123 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws on non-recoverable error response", async () => {
    const client = new EtsyClient({ apiKey: "key" });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    });
    await expect(client.call("GET", "/application/listings/999")).rejects.toThrow("404");
  });

  it("does not attempt refresh on 401 when using api-key-only auth", async () => {
    const client = new EtsyClient({ apiKey: "myapikey" });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid API key" }),
    });
    await expect(client.call("GET", "/application/shops/123")).rejects.toThrow("401");
    // Only one fetch call — no refresh attempt
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty object for 204 No Content", async () => {
    const client = new EtsyClient({ accessToken: "token", accessTokenExpiresAt: Date.now() / 1000 + 3600 });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("should not parse");
      },
    });

    const result = await client.call("POST", "/listings", { body: {} });
    expect(result).toEqual({});
  });

  it("sends PATCH requests", async () => {
    const client = new EtsyClient({ accessToken: "token", accessTokenExpiresAt: Date.now() / 1000 + 3600 });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.call("PATCH", "/listings/123", { body: { title: "New" } });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
  });

  it("sends DELETE requests", async () => {
    const client = new EtsyClient({ accessToken: "token", accessTokenExpiresAt: Date.now() / 1000 + 3600 });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.call("DELETE", "/listings/123", {});
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
  });

  it("formats x-api-key as keystring:secret when both apiKey and sharedSecret provided", async () => {
    const client = new EtsyClient({
      apiKey: "mykey",
      sharedSecret: "mysecret",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.call("GET", "/users", {});
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("mykey:mysecret");
  });

  it("uses apiKey alone when sharedSecret not provided", async () => {
    const client = new EtsyClient({
      apiKey: "mykey",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.call("GET", "/users", {});
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("mykey");
  });

  it("skips proactive refresh when ETSY_ACCESS_TOKEN env var is set", async () => {
    const originalEnv = process.env.ETSY_ACCESS_TOKEN;
    process.env.ETSY_ACCESS_TOKEN = "env-token";

    const client = new EtsyClient({
      accessToken: "config-token",
      refreshToken: "refresh",
      clientId: "client123",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 30, // expires in 30s
    });

    let refreshCalled = false;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("oauth/token")) {
        refreshCalled = true;
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await client.call("GET", "/test", {});
    expect(refreshCalled).toBe(false); // Should not refresh

    process.env.ETSY_ACCESS_TOKEN = originalEnv;
  });

  it("extracts message field from error response", async () => {
    const client = new EtsyClient({ apiKey: "key" });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: "Bad request details" }),
    });

    try {
      await client.call("GET", "/test", {});
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.message).toBe("HTTP 400: Bad request details");
    }
  });

  it("throws error if refresh response lacks access_token", async () => {
    // Ensure env var is not set
    delete process.env.ETSY_ACCESS_TOKEN;

    const client = new EtsyClient({
      accessToken: "expiring-token",
      refreshToken: "refresh",
      clientId: "client123",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 20, // expires in 20s (within 60s threshold)
    });

    let refreshAttempted = false;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("oauth/token")) {
        refreshAttempted = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ refresh_token: "new-refresh" }), // Missing access_token
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    try {
      await client.call("GET", "/test", {});
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(refreshAttempted).toBe(true);
      expect(e.message).toContain("invalid response from server");
    }
  });
});
