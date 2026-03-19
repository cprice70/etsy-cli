# etsy-cli

A command-line interface for the [Etsy Open API v3](https://developers.etsy.com/documentation/).

## Installation

```bash
npm install -g @cprice70/etsy-cli
```

## Setup

You'll need an Etsy app. Create one at [etsy.com/developers](https://www.etsy.com/developers/your-apps):

1. Create a new app and set the redirect URI to `http://localhost:3003/callback`
2. Note your **Keystring** and **Shared Secret**

Then authenticate:

```bash
etsy auth login
```

You'll be prompted for:
- **API Key** — your app's Keystring
- **Shared Secret** — your app's Shared Secret
- **Complete OAuth?** — enter `y` for full access (required for write operations)

Your browser will open for authorization. Once approved, credentials are saved to `~/.config/etsy-cli/config.json`.

## Commands

### Auth

```bash
etsy auth login     # Authenticate with Etsy
etsy auth status    # Show current auth status
etsy auth logout    # Delete stored credentials
```

### Shop

```bash
etsy shop get               # Get your shop details
etsy shop get --json        # Output raw JSON
etsy shop get --shop <id>   # Use a specific shop ID
```

### Listings

```bash
etsy listings list                          # List active listings
etsy listings list --state draft            # Filter by state: active, draft, inactive
etsy listings list --limit 50 --offset 0    # Pagination
etsy listings list --json                   # Output raw JSON

etsy listings get --id <listing_id>         # Get a listing by ID
etsy listings get --id <listing_id> --json

etsy listings create                        # Create a new listing (interactive)
etsy listings update --id <listing_id> --title "New Title" --price 29.99 --quantity 5
```

### Orders

```bash
etsy orders list                    # List recent orders
etsy orders list --limit 50         # Up to 100 results
etsy orders list --start 1700000000 # Filter by Unix timestamp
etsy orders list --json

etsy orders get --id <receipt_id>   # Get a specific order
etsy orders get --id <receipt_id> --json
```

## Environment Variables

Credentials can be set via environment variables instead of the config file:

| Variable | Description |
|---|---|
| `ETSY_API_KEY` | Your app's Keystring |
| `ETSY_SHARED_SECRET` | Your app's Shared Secret |
| `ETSY_ACCESS_TOKEN` | OAuth access token |
| `ETSY_REFRESH_TOKEN` | OAuth refresh token |
| `ETSY_SHOP_ID` | Shop ID override |

## License

MIT
