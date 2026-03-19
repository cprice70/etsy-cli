import fs from "fs";
import path from "path";
import os from "os";

export interface Config {
  apiKey: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  shopId: string;
}

export function getConfigPath(): string {
  return path.join(os.homedir(), ".config", "etsy-cli", "config.json");
}

export function loadConfig(): Partial<Config> {
  const configPath = getConfigPath();
  let fileConfig: Partial<Config> = {};

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    fileConfig = JSON.parse(raw) as Partial<Config>;
  } catch {
    // File doesn't exist or is invalid
  }

  const config: Partial<Config> = { ...fileConfig };

  if (process.env.ETSY_API_KEY) config.apiKey = process.env.ETSY_API_KEY;
  if (process.env.ETSY_ACCESS_TOKEN) config.accessToken = process.env.ETSY_ACCESS_TOKEN;
  if (process.env.ETSY_REFRESH_TOKEN) config.refreshToken = process.env.ETSY_REFRESH_TOKEN;
  if (process.env.ETSY_SHOP_ID) config.shopId = process.env.ETSY_SHOP_ID;

  return config;
}

export function saveConfig(config: Partial<Config>): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function deleteConfig(): void {
  const configPath = getConfigPath();
  try {
    fs.unlinkSync(configPath);
  } catch {
    // File doesn't exist — ignore
  }
}
