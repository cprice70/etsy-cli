import readline from "readline/promises";
import crypto from "crypto";
import { Command } from "commander";
import { loadConfig, saveConfig, deleteConfig, getConfigPath, type Config } from "../config.js";
import { printSuccess, printError, printWarning } from "../output.js";

const OAUTH_SCOPES = "listings_r listings_w transactions_r shops_r";
const REDIRECT_URI = "https://www.etsy.com/oauth/connect";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const INTROSPECT_URL = "https://api.etsy.com/v3/public/oauth/token/introspect";

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
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
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

  return response.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

async function detectShopId(accessToken: string): Promise<string | undefined> {
  try {
    // Introspect to get user_id
    const introspectRes = await fetch(INTROSPECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });

    if (!introspectRes.ok) return undefined;

    const introspect = await introspectRes.json() as { user_id?: number };
    if (!introspect.user_id) return undefined;

    // Get shops for user
    const shopsRes = await fetch(
      `https://openapi.etsy.com/v3/application/users/${introspect.user_id}/shops`,
      {
        headers: { "Authorization": `Bearer ${accessToken}` },
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
        }

        const clientId = await rl.question("Client ID (from your Etsy app): ");
        if (!clientId.trim()) {
          printError("Client ID is required");
          process.exit(1);
        }

        const partialConfig: Partial<Config> = {
          apiKey: apiKey.trim(),
          clientId: clientId.trim(),
        };

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

          console.log("\nVisit this URL to authorize:\n");
          console.log(authUrl);
          console.log(
            "\nAfter authorizing, copy the `code` query parameter from the redirect URL."
          );

          const code = await rl.question("\nPaste the authorization code: ");
          if (!code.trim()) {
            printError("Authorization code is required");
            process.exit(1);
          }

          process.stdout.write("Exchanging code for tokens... ");
          const tokens = await exchangeCodeForTokens(code.trim(), clientId.trim(), codeVerifier);
          process.stdout.write("done\n");

          partialConfig.accessToken = tokens.access_token;
          partialConfig.refreshToken = tokens.refresh_token;
          partialConfig.accessTokenExpiresAt =
            Math.floor(Date.now() / 1000) + tokens.expires_in;

          process.stdout.write("Detecting shop ID... ");
          const shopId = await detectShopId(tokens.access_token);
          if (shopId) {
            process.stdout.write(`found: ${shopId}\n`);
            partialConfig.shopId = shopId;
          } else {
            process.stdout.write("not found\n");
            const shopIdInput = await rl.question(
              "Shop ID (find it in your Etsy shop URL or dashboard): "
            );
            partialConfig.shopId = shopIdInput.trim() || undefined;
          }
        }

        saveConfig(partialConfig);
        printSuccess(`Config saved to ${getConfigPath()}`);
      } catch (err) {
        printError(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      } finally {
        rl.close();
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
      }
    });
}
