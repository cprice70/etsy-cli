# Listings Update Expansion Design

**Date:** 2026-03-21
**Author:** Claude Code
**Status:** Draft

## Overview

Expand the `etsy listings update` command to support more fields (description, tags, etc.) and add an interactive mode for detailed editing of existing listings.

## Current State

The `update` command currently supports:
- `--title`, `--price`, `--quantity`, `--state`
- Dry CLI-only, non-interactive

## Goals

1. Add support for commonly-updated fields: description, tags
2. Provide interactive mode for full editing experience
3. Design for easy extensibility (adding new fields requires minimal changes)
4. Maintain backward compatibility with existing CLI flags

## Design

### Interaction Model

**CLI mode (existing):**
```bash
etsy listings update --id 123 --title "New Title" --description "New desc"
```

**Interactive mode (new):**
```bash
etsy listings update --id 123 --interactive
```

When `--interactive` is used:
- Fetches current listing values
- Prompts user for each field with current value as default
- User presses Enter to skip/keep current value
- Only sends changed fields to API

### Supported Fields (Phase 1)

| Field | CLI Option | Type | Notes |
|-------|-----------|------|-------|
| Title | `--title <text>` | string | Listing title |
| Description | `--description <text>` | string | Listing description |
| Tags | `--tags <tags>` | string | Comma-separated, max 13 tags |
| Quantity | `--quantity <n>` | integer | Inventory count |
| Price | `--price <amount>` | float | USD price |
| State | `--state <state>` | enum | active\|inactive\|draft |

### Implementation Details

#### CLI Mode
```typescript
.option("--title <text>", "New title")
.option("--description <text>", "New description")
.option("--tags <tags>", "Comma-separated tags")
.option("--quantity <n>", "New quantity")
.option("--price <amount>", "New price")
.option("--state <state>", "New state: active, inactive, draft")
.option("--interactive", "Interactive edit mode")
```

#### Interactive Mode Flow

1. **Fetch current listing**
   - Use same endpoint as CLI mode (will be determined during implementation based on API response)
   - Extract current values for title, quantity, price, state
   - Note: description and tags may require special handling if not in standard response

2. **Prompt user** (one per field)
   ```
   Title [Current: "Vintage Hat"]:
   Description [Current: "A nice hat"]:
   Tags [Current: "vintage,clothing"]:
   Quantity [Current: 5]:
   Price [Current: 29.99]:
   State [Current: active]:
   ```

3. **Build diff**
   - Only include fields where user provided a new value
   - Empty updates rejected (same as CLI mode)
   - **Resource cleanup:** Always call `rl.close()` and `process.stdin.destroy()` in finally block (same pattern as create command)

4. **Send PATCH request**
   - `/application/shops/{shopId}/listings/{id}`
   - Body: `{ title, description, tags, quantity, price, state }` (only changed fields)

#### Validation

| Field | Validation |
|-------|-----------|
| title | Non-empty after trim, error if whitespace-only |
| description | Non-empty after trim, error if whitespace-only |
| tags | Split by comma, trim each, filter empty strings, max 13 items, error if empty array result |
| quantity | Parse as integer, must be >= 0, error if negative |
| price | Parse as float, must be > 0, error if zero or negative |
| state | Must be one of: active, inactive, draft, case-sensitive |

**Implementation notes:**
- All string inputs: trim, reject if result is empty/whitespace-only
- Tags: reject duplicates after trim, error with specific message about which tag is duplicate
- Quantity: validate >= 0 before API call
- Price: decimal places handled by parseFloat (API constraints TBD)
- State: exact case match to valid values

#### Error Handling

| Scenario | Behavior |
|----------|----------|
| Listing not found (404) | "Listing not found. Check ID and shop." |
| Unauthorized (403) | "Authentication failed. Run `etsy auth login`." |
| Invalid field value | "Invalid {field}: {reason}. E.g., price must be a number." |
| No fields provided | "No fields to update. Provide at least one field." |

### Data Flow

```
User input (CLI flags or interactive)
    ↓
[Validate & parse fields]
    ↓
[If --interactive: fetch current values & prompt]
    ↓
[Build update body (only changed fields)]
    ↓
PATCH /application/shops/{shopId}/listings/{id}
    ↓
Success: "Updated listing {id}"
```

### Extensibility

Adding a new field in the future is trivial:

1. Add CLI option: `.option("--newfield <value>", "Description")`
2. Add to type: `newfield?: string;` in action callback
3. Add to validation block: `if (opts.newfield !== undefined) { ... validate ... }`
4. Add to body: `if (opts.newfield !== undefined) body.newfield = opts.newfield;`
5. Update tests: verify new field in expected body

No architectural changes needed.

## Testing Strategy

### Unit Tests

**CLI mode:**
- Each field validates correctly (price, quantity, state, tags)
- Invalid values rejected with helpful messages
- Multiple fields can be updated together
- Unchanged fields not sent to API

**Interactive mode:**
- Fetches current listing
- Displays current values as defaults
- Only sends changed fields
- Skipped fields (Enter) not sent

**Error cases:**
- 404 listing not found
- 403 unauthorized
- Invalid field values caught before API call

### Test Structure
- Update existing `listings.test.ts` cases to cover new fields
- Add interactive mode tests (mock readline input)
- Add new validation tests for each field type

## Success Criteria

- ✅ All 6 fields updateable via CLI flags
- ✅ Interactive mode fetches and shows current values
- ✅ Validation prevents invalid data reaching API
- ✅ Backward compatible (existing commands still work)
- ✅ All tests pass (100% coverage of new code)
- ✅ Easy to add new fields in future (documented extensibility)

## Implementation Notes

### API Constraints (To Verify During Implementation)

These should be verified via Etsy API testing:
- **Description field**: Confirm it's returned in GET listing response and updateable via PATCH
- **Tags field**: Confirm representation in API (array vs comma-separated), max length per tag
- **Price decimal precision**: Confirm Etsy's precision requirements (e.g., .01, .001)
- **State transitions**: Determine if all transitions are allowed or if validation needed
- **Fetch endpoint for interactive mode**: Confirm which endpoint returns all necessary fields for defaults

### Resource Cleanup

Interactive mode must use the same pattern as create command:
```typescript
finally {
  rl.close();
  process.stdin.destroy();  // CRITICAL: prevents process hanging
}
```

## Future Enhancements

- Additional fields: materials, shippingProfileId, returnPolicyId, etc.
- Batch update multiple listings
- Field descriptions/help in interactive mode
- Preset templates for common updates
- State transition validation if API requires it
