import readline from "readline/promises";
import crypto from "crypto";
import { Command } from "commander";
import { loadConfig, saveConfig, deleteConfig, getConfigPath, type Config } from "../config.js";
import { printSuccess, printError, printWarning } from "../output.js";
import { CALLBACK_PORT, REDIRECT_URI, openBrowser, waitForCallback } from "./auth-callback.js";

const OAUTH_SCOPES = "listings_r listings_w transactions_r shops_r";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function maskSecret(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  codeVerifier: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number; user_id?: number | string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      `Token exchange failed: ${err.error_description ?? err.error ?? response.status}`
    );
  }

  const data = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; user_id?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token ||
      typeof data.refresh_token !== "string" || !data.refresh_token) {
    throw new Error("Invalid token response: missing access_token or refresh_token");
  }
  return data as { access_token: string; refresh_token: string; expires_in: number; user_id?: number | string };
}

async function detectShopId(
  accessToken: string,
  xApiKey: string,
  userId?: number | string
): Promise<string | undefined> {
  try {
    let resolvedUserId = userId;

    // If user_id not provided, fetch current user via /application/users/me
    if (!resolvedUserId) {
      const meRes = await fetch(`https://openapi.etsy.com/v3/application/users/me`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "x-api-key": xApiKey,
        },
      });

      if (!meRes.ok) return undefined;

      const me = await meRes.json() as { user_id?: number | string };
      resolvedUserId = me.user_id;
      if (!resolvedUserId) return undefined;
    }

    // Get shops for user
    const shopsRes = await fetch(
      `https://openapi.etsy.com/v3/application/users/${resolvedUserId}/shops`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "x-api-key": xApiKey,
        },
      }
    );

    if (!shopsRes.ok) return undefined;

    const shops = await shopsRes.json() as { shop_id?: number };
    return shops.shop_id ? String(shops.shop_id) : undefined;
  } catch {
    return undefined;
  }
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Store Etsy credentials interactively")
    .action(async () => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      try {
        const apiKey = await rl.question("API Key (keystring): ");
        if (!apiKey.trim()) {
          printError("API Key is required");
          process.exit(1);
          return;
        }

        const sharedSecret = await rl.question("Shared Secret: ");
        if (!sharedSecret.trim()) {
          printError("Shared Secret is required");
          process.exit(1);
          return;
        }

        const clientId = await rl.question("Client ID (same as API Key / keystring): ");
        if (!clientId.trim()) {
          printError("Client ID is required");
          process.exit(1);
          return;
        }

        const currentConfig = loadConfig();
        const partialConfig: Partial<Config> = {
          ...currentConfig,
          apiKey: apiKey.trim(),
          sharedSecret: sharedSecret.trim(),
          clientId: clientId.trim(),
        };

        // Save API key and client ID immediately for public read access
        saveConfig(partialConfig);

        const doOAuth = await rl.question("Complete OAuth for full access? (y/N): ");

        if (doOAuth.trim().toLowerCase() === "y") {
          const codeVerifier = generateCodeVerifier();
          const codeChallenge = generateCodeChallenge(codeVerifier);
          const state = crypto.randomBytes(16).toString("hex");

          const authUrl =
            `https://www.etsy.com/oauth/connect` +
            `?response_type=code` +
            `&client_id=${encodeURIComponent(clientId.trim())}` +
            `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
            `&scope=${encodeURIComponent(OAUTH_SCOPES)}` +
            `&state=${state}` +
            `&code_challenge=${codeChallenge}` +
            `&code_challenge_method=S256`;

          console.log("\nOpening browser for authorization...");
          console.log("(If it doesn't open, visit this URL manually:)\n");
          console.log(authUrl);
          console.log(`\nWaiting for callback on http://localhost:${CALLBACK_PORT}...\n`);

          openBrowser(authUrl);
          const code = await waitForCallback(state);

          process.stdout.write("Exchanging code for tokens... ");
          const tokens = await exchangeCodeForTokens(code, clientId.trim(), codeVerifier);
          process.stdout.write("done\n");

          partialConfig.accessToken = tokens.access_token;
          partialConfig.refreshToken = tokens.refresh_token;
          partialConfig.accessTokenExpiresAt =
            Math.floor(Date.now() / 1000) + tokens.expires_in;

          process.stdout.write("Detecting shop ID... ");
          const xApiKey = sharedSecret.trim()
            ? `${apiKey.trim()}:${sharedSecret.trim()}`
            : apiKey.trim();
          const shopId = await detectShopId(tokens.access_token, xApiKey, tokens.user_id);
          if (shopId) {
            process.stdout.write(`found: ${shopId}\n`);
            partialConfig.shopId = shopId;
          } else {
            process.stdout.write("not found\n");
            const manualShopId = await rl.question("Enter your Shop ID manually (or press Enter to skip): ");
            if (manualShopId.trim()) {
              partialConfig.shopId = manualShopId.trim();
            }
          }
        }

        saveConfig(partialConfig);
        printSuccess(`Config saved to ${getConfigPath()}`);
      } catch (err) {
        printError(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      } finally {
        rl.close();
        process.stdin.destroy();
      }
    });

  auth
    .command("status")
    .description("Show current authentication status")
    .action(() => {
      try {
        const config = loadConfig();
        const configPath = getConfigPath();
        const hasOAuth = !!(config.accessToken && config.refreshToken);
        const statusLabel = config.apiKey ? "Configured" : "Not configured";
        const printStatus = config.apiKey ? printSuccess : printWarning;

        let expiryStr = "(not set)";
        if (config.accessTokenExpiresAt) {
          expiryStr = new Date(config.accessTokenExpiresAt * 1000).toISOString();
        }

        console.log("");
        console.log("Etsy CLI Status:");
        console.log("  API Key:        " + maskSecret(config.apiKey));
        console.log("  Shared Secret:  " + maskSecret(config.sharedSecret));
        console.log("  Client ID:      " + maskSecret(config.clientId));
        console.log("  OAuth:          " + (hasOAuth ? "configured" : "not configured"));
        console.log("  Access Token:   " + maskSecret(config.accessToken));
        console.log("  Token Expiry:   " + expiryStr);
        console.log("  Refresh Token:  " + maskSecret(config.refreshToken));
        console.log("  Shop ID:        " + (config.shopId || "(not set)"));
        console.log("  Config File:    " + configPath);
        console.log("");
        printStatus(statusLabel);
        console.log("");
      } catch (err) {
        printError(`Status check failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Delete stored credentials")
    .action(async () => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(
          "This will delete all stored credentials and require full re-setup. Continue? (y/N): "
        );
        if (answer.trim().toLowerCase() !== "y") {
          console.log("Aborted.");
          return;
        }
        deleteConfig();
        printSuccess("Logged out. Config file deleted.");
      } catch (err) {
        printError(`Logout failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      } finally {
        rl.close();
        process.stdin.destroy();
      }
    });
}
