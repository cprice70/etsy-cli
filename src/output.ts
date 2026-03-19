import chalk from "chalk";
import Table from "cli-table3";

export function printTable(headers: string[], rows: (string | number)[][]): void {
  const table = new Table({
    head: headers.map((h) => chalk.cyan.bold(h)),
    style: { head: [] },
  });
  for (const row of rows) {
    table.push(row.map(String));
  }
  console.log(table.toString());
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(message));
}

export function printError(message: string): void {
  console.error(chalk.red(message));
}

export function printWarning(message: string): void {
  console.warn(chalk.yellow(message));
}

export function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden");
  }
  return false;
}

export function colorState(state: string): string {
  switch (state.toLowerCase()) {
    // Listing states
    case "active":      return chalk.green(state);
    case "draft":       return chalk.yellow(state);
    case "inactive":    return chalk.dim(state);
    case "expired":     return chalk.red(state);
    case "sold_out":    return chalk.red(state);
    // Receipt/order states
    case "paid":               return chalk.green(state);
    case "completed":          return chalk.green(state);
    case "open":               return chalk.yellow(state);
    case "payment_processing": return chalk.yellow(state);
    case "canceled":           return chalk.red(state);
    default:            return state;
  }
}
