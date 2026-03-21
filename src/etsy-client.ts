export { EtsyClient, type Config, type CallOptions } from '@cprice70/etsy-sdk';
import { EtsyClient, type Config } from '@cprice70/etsy-sdk';

export function createClient(config: Partial<Config>): EtsyClient {
  return new EtsyClient(config);
}
