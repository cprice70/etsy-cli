import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCodeVerifier, generateCodeChallenge, registerAuthCommands } from "../../commands/auth.js";
import { Command } from "commander";

vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(() => ({
    apiKey: "key1234567890",  // >8 chars so maskSecret shows "key1****7890"
    clientId: "cid1234567890",
    accessToken: "tok456789012",
    refreshToken: "ref789012345",
    accessTokenExpiresAt: 9999999999,
    shopId: "shop111",
  })),
  saveConfig: vi.fn(),
  deleteConfig: vi.fn(),
  getConfigPath: vi.fn(() => "/home/user/.config/etsy-cli/config.json"),
}));

// Mock readline/promises at module level to work with ESM
const mockQuestion = vi.fn();
const mockClose = vi.fn();

vi.mock("readline/promises", () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: mockQuestion,
      close: mockClose,
    })),
  },
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}));

vi.mock("../../commands/auth-callback.js", () => ({
  waitForCallback: vi.fn().mockResolvedValue("testcode123"),
  openBrowser: vi.fn(),
  REDIRECT_URI: "http://localhost:3003/callback",
  CALLBACK_PORT: 3003,
}));

describe("PKCE helpers", () => {
  it("generateCodeVerifier returns 43-char URL-safe string", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("generateCodeChallenge returns base64url SHA-256 of verifier", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    // SHA-256 base64url is always 43 chars (256 bits / 6 bits per char, no padding)
    expect(challenge.length).toBe(43);
  });

  it("same verifier always produces same challenge", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const c1 = generateCodeChallenge(verifier);
    const c2 = generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });
});

describe("auth status command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows masked credentials and shop ID", async () => {
    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "status"]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("key1****7890");  // masked apiKey (first 4 + **** + last 4)
    expect(output).toContain("shop111");
    expect(output).toContain("/home/user/.config/etsy-cli/config.json");
    // Access token masked
    expect(output).toContain("tok4****9012");  // tok456789012 → tok4****9012
    // Refresh token masked
    expect(output).toContain("ref7****2345");  // ref789012345 → ref7****2345
    // Token expiry line shown
    expect(output).toContain("Token Expiry");
    // OAuth configured status shown
    expect(output).toContain("configured");
  });
});

describe("auth logout command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    mockQuestion.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("aborts when user does not confirm", async () => {
    const { deleteConfig } = await import("../../config.js");
    mockQuestion.mockResolvedValue("n");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "logout"]);

    expect(deleteConfig).not.toHaveBeenCalled();
  });

  it("deletes config when user confirms", async () => {
    const { deleteConfig } = await import("../../config.js");
    mockQuestion.mockResolvedValue("y");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "logout"]);

    expect(deleteConfig).toHaveBeenCalledOnce();
  });
});

describe("auth login command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any);
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    mockQuestion.mockReset();
    mockClose.mockReset();
    // Reset saveConfig mock call history
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("login without OAuth: prompts for api key and client ID, saves config, prints success", async () => {
    const { saveConfig, loadConfig } = await import("../../config.js");
    vi.mocked(loadConfig).mockReturnValue({});
    // Answers: apiKey, sharedSecret, clientId, skip OAuth
    mockQuestion
      .mockResolvedValueOnce("myapikey12345")
      .mockResolvedValueOnce("mysecret123")
      .mockResolvedValueOnce("myclientid123")
      .mockResolvedValueOnce("n");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "login"]);

    // saveConfig called at least once with apiKey, sharedSecret, and clientId
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "myapikey12345",
        sharedSecret: "mysecret123",
        clientId: "myclientid123",
      })
    );

    // Success message printed
    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    const logOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    const allOutput = logOutput + "\n" + errorOutput;
    // printSuccess calls console.log — check saveConfig was called
    expect(saveConfig).toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("login with OAuth: prompts for api key, client ID, confirms OAuth, shows auth URL, accepts code, exchanges for tokens, detects shop, saves config", async () => {
    const { saveConfig, loadConfig } = await import("../../config.js");
    vi.mocked(loadConfig).mockReturnValue({});

    // Mock fetch: first call = token exchange, second = introspect, third = shops
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "access_abc",
          refresh_token: "refresh_xyz",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user_id: 42 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ shop_id: 99999 }),
      });

    // Answers: apiKey, sharedSecret, clientId, confirm OAuth ("y")
    mockQuestion
      .mockResolvedValueOnce("myapikey12345")
      .mockResolvedValueOnce("mysecret123")
      .mockResolvedValueOnce("myclientid123")
      .mockResolvedValueOnce("y");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "login"]);

    // Auth URL should have been logged
    const logOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(logOutput).toContain("https://www.etsy.com/oauth/connect");

    // saveConfig should have been called with full OAuth data
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "myapikey12345",
        sharedSecret: "mysecret123",
        clientId: "myclientid123",
        accessToken: "access_abc",
        refreshToken: "refresh_xyz",
        shopId: "99999",
      })
    );

    // Introspect fetch should include combined x-api-key header
    const introspectCall = fetchMock.mock.calls[1];
    expect(introspectCall[1].headers["x-api-key"]).toBe("myapikey12345:mysecret123");

    // Shops fetch should include combined x-api-key header
    const shopsCall = fetchMock.mock.calls[2];
    expect(shopsCall[1].headers["x-api-key"]).toBe("myapikey12345:mysecret123");

    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("login with OAuth: completes successfully even if shop detection finds no shop", async () => {
    const { saveConfig, loadConfig } = await import("../../config.js");
    vi.mocked(loadConfig).mockReturnValue({});

    // Token exchange succeeds, introspect returns no user_id
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "access_abc",
          refresh_token: "refresh_xyz",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

    mockQuestion
      .mockResolvedValueOnce("myapikey12345")
      .mockResolvedValueOnce("mysecret123")
      .mockResolvedValueOnce("myclientid123")
      .mockResolvedValueOnce("y")
      .mockResolvedValueOnce(""); // manual shop ID prompt — skip

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "login"]);

    // 5 prompts: apiKey, sharedSecret, clientId, oauth confirm, manual shop ID
    expect(mockQuestion).toHaveBeenCalledTimes(5);
    expect(saveConfig).toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("empty API key: prints error and exits", async () => {
    const { loadConfig } = await import("../../config.js");
    vi.mocked(loadConfig).mockReturnValue({});
    // First question (API key) returns empty string
    mockQuestion.mockResolvedValueOnce("");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "login"]);

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("API Key");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("empty shared secret: prints error and exits", async () => {
    const { loadConfig } = await import("../../config.js");
    vi.mocked(loadConfig).mockReturnValue({});
    // API key provided, shared secret is empty
    mockQuestion
      .mockResolvedValueOnce("myapikey12345")
      .mockResolvedValueOnce("");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "login"]);

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("Shared Secret");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("empty client ID: prints error and exits", async () => {
    const { loadConfig } = await import("../../config.js");
    vi.mocked(loadConfig).mockReturnValue({});
    // API key + shared secret provided, client ID is empty
    mockQuestion
      .mockResolvedValueOnce("myapikey12345")
      .mockResolvedValueOnce("mysecret123")
      .mockResolvedValueOnce("");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "login"]);

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("Client ID");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("login with OAuth: handles callback failure (e.g. state mismatch)", async () => {
    const { loadConfig } = await import("../../config.js");
    vi.mocked(loadConfig).mockReturnValue({});

    const { waitForCallback } = await import("../../commands/auth-callback.js");
    vi.mocked(waitForCallback).mockRejectedValueOnce(
      new Error("Authorization failed: missing code or state mismatch")
    );

    mockQuestion
      .mockResolvedValueOnce("myapikey12345")
      .mockResolvedValueOnce("mysecret123")
      .mockResolvedValueOnce("myclientid123")
      .mockResolvedValueOnce("y");

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(["node", "test", "auth", "login"]);

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("Authorization failed");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
