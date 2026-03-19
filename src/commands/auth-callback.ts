import http from "http";
import { exec } from "child_process";

export const CALLBACK_PORT = 3003;
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  exec(`${cmd} "${url}"`);
}

export function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      const html = (title: string, body: string) =>
        `<html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;max-width:500px;margin:80px auto;text-align:center"><h2>${title}</h2><p>${body}</p></body></html>`;

      if (!code || returnedState !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(html("Authorization failed", "Missing code or state mismatch. Please try again."));
        server.close();
        reject(new Error("Authorization failed: missing code or state mismatch"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html("✅ Authorized!", "You can close this tab and return to the terminal."));
      server.close();
      resolve(code);
    });

    server.on("error", (err) => reject(new Error(`Callback server error: ${err.message}`)));
    server.listen(CALLBACK_PORT);

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authorization (5 min limit)"));
    }, 5 * 60 * 1000);

    server.on("close", () => clearTimeout(timeout));
  });
}
