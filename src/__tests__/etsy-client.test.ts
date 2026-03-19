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
});
