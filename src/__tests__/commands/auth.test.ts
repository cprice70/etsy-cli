import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCodeVerifier, generateCodeChallenge, registerAuthCommands } from "../../commands/auth.js";
import { Command } from "commander";

vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(() => ({
    apiKey: "key1234567890",  // >8 chars so maskSecret shows "key1****7890"
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
