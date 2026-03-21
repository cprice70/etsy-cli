# Listings Update Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the `etsy listings update` command to support description, tags, and add interactive edit mode with current values as defaults.

**Architecture:** Extend the existing update command with new CLI options and add `--interactive` flag that reuses the current listing fetch to show defaults. Interactive mode uses readline prompts (pattern from create command). All validation happens client-side before API calls. Design is extensible—adding new fields requires only ~5 lines per field.

**Tech Stack:** TypeScript, Commander.js, Node.js readline, Vitest

---

## File Structure

**Files to modify:**
- `src/commands/listings.ts` — expand update command with new options, interactive mode
- `src/__tests__/commands/listings.test.ts` — add tests for new fields and interactive mode

**No new files needed.** Interactive mode reuses readline (already imported in create command).

---

## Implementation Plan

### Task 1: Add Description Field to Update Command

**Files:**
- Modify: `src/commands/listings.ts:211-267` (update command)
- Modify: `src/__tests__/commands/listings.test.ts:138-173` (update tests)

**Context:** The update command currently accepts `--title`, `--price`, `--quantity`, `--state`. We'll add `--description` with validation (non-empty after trim).

- [ ] **Step 1: Write failing test for description field**

Add this test to `src/__tests__/commands/listings.test.ts` after the existing update tests (after line 173):

```typescript
it("listings update sends description when provided", async () => {
  mockCall.mockResolvedValueOnce({ listing_id: 42, description: "Updated desc" });

  const program = new Command();
  program.exitOverride();
  registerListingsCommands(program, mockClient, resolveShopId);

  await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--description", "New description"]);

  expect(mockCall).toHaveBeenCalledWith(
    "PATCH",
    "/application/shops/99999/listings/42",
    expect.objectContaining({ body: { description: "New description" } })
  );
});
```

- [ ] **Step 2: Verify test fails**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected output: FAIL - "description" is undefined in options

- [ ] **Step 3: Add description field to update command**

Edit `src/commands/listings.ts` at line 217 (after `--state` option). Change the action line 220 to include description:

**Before (line 217-220):**
```typescript
    .option("--state <state>", "New state: active, inactive, draft")
    .option("--shop <id>", "Shop ID override")
    .action(async (opts: { id: string; title?: string; price?: string; quantity?: string; state?: string; shop?: string }) => {
```

**After:**
```typescript
    .option("--state <state>", "New state: active, inactive, draft")
    .option("--description <text>", "New description")
    .option("--shop <id>", "Shop ID override")
    .action(async (opts: { id: string; title?: string; price?: string; quantity?: string; state?: string; description?: string; shop?: string }) => {
```

Then add validation and body assignment after the price block (after line 240):

```typescript
        if (opts.description !== undefined) {
          const trimmed = opts.description.trim();
          if (!trimmed) {
            printError("Invalid description: cannot be empty or whitespace-only");
            process.exit(1);
            return;
          }
          body.description = trimmed;
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: PASS (test about description now passes)

- [ ] **Step 5: Commit**

```bash
git add src/commands/listings.ts src/__tests__/commands/listings.test.ts
git commit -m "feat: add --description option to listings update command"
```

---

### Task 2: Add Tags Field to Update Command

**Files:**
- Modify: `src/commands/listings.ts:211-267` (update command)
- Modify: `src/__tests__/commands/listings.test.ts` (add tag tests)

**Context:** Tags are comma-separated strings. Validation: split by comma, trim each, filter empty, max 13 items, reject duplicates.

- [ ] **Step 1: Write failing test for tags field**

Add this test to `src/__tests__/commands/listings.test.ts` after Task 1's test:

```typescript
it("listings update sends tags when provided", async () => {
  mockCall.mockResolvedValueOnce({ listing_id: 42 });

  const program = new Command();
  program.exitOverride();
  registerListingsCommands(program, mockClient, resolveShopId);

  await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--tags", "vintage,handmade,art"]);

  expect(mockCall).toHaveBeenCalledWith(
    "PATCH",
    "/application/shops/99999/listings/42",
    expect.objectContaining({ body: { tags: ["vintage", "handmade", "art"] } })
  );
});
```

- [ ] **Step 2: Verify test fails**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: FAIL - tags option not recognized

- [ ] **Step 3: Add tags field and parsing logic**

Edit `src/commands/listings.ts` at line 218 (after description option):

```typescript
    .option("--tags <tags>", "Comma-separated tags (max 13)")
```

Update the action type signature (line 220) to include `tags`:

```typescript
    .action(async (opts: { id: string; title?: string; price?: string; quantity?: string; state?: string; description?: string; tags?: string; shop?: string }) => {
```

Add tags validation and body assignment after the description block:

```typescript
        if (opts.tags !== undefined) {
          const tagArray = opts.tags
            .split(",")
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

          if (tagArray.length === 0) {
            printError("Invalid tags: cannot be empty");
            process.exit(1);
            return;
          }

          if (tagArray.length > 13) {
            printError("Invalid tags: maximum 13 tags allowed");
            process.exit(1);
            return;
          }

          const uniqueTags = new Set(tagArray);
          if (uniqueTags.size !== tagArray.length) {
            printError("Invalid tags: duplicate tags found");
            process.exit(1);
            return;
          }

          body.tags = tagArray;
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: PASS (tags test now passes)

- [ ] **Step 5: Add test for tag validation (empty string rejection)**

Add this test after the tags test:

```typescript
it("listings update rejects tags with only whitespace", async () => {
  const program = new Command();
  program.exitOverride();
  registerListingsCommands(program, mockClient, resolveShopId);

  await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--tags", "  ,  ,tag1"]);

  expect(consoleErrorSpy).toHaveBeenCalled();
  expect(processExitSpy).toHaveBeenCalledWith(1);
});
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/listings.ts src/__tests__/commands/listings.test.ts
git commit -m "feat: add --tags option with validation to listings update"
```

---

### Task 3: Update Error Message for Empty Fields

**Files:**
- Modify: `src/commands/listings.ts:245-249`

**Context:** The error message that says "No fields to update" needs to include description and tags.

- [ ] **Step 1: Update error message**

Edit `src/commands/listings.ts` at line 245-249:

**Before:**
```typescript
        if (Object.keys(body).length === 0) {
          printError("No fields to update. Provide at least one of: --title, --price, --quantity, --state");
          process.exit(1);
          return;
        }
```

**After:**
```typescript
        if (Object.keys(body).length === 0) {
          printError("No fields to update. Provide at least one of: --title, --description, --tags, --price, --quantity, --state");
          process.exit(1);
          return;
        }
```

- [ ] **Step 2: Run tests to ensure nothing broke**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/commands/listings.ts
git commit -m "chore: update error message for listings update to include new fields"
```

---

### Task 4: Add Interactive Flag and Mode

**Files:**
- Modify: `src/commands/listings.ts:211-267` (add interactive flag and logic)
- Modify: `src/__tests__/commands/listings.test.ts` (add interactive mode tests)

**Context:** Interactive mode fetches current listing, prompts user for each field with current value as default, and only sends changed fields. Must follow the create command's resource cleanup pattern (rl.close() + process.stdin.destroy()).

- [ ] **Step 1: Write failing test for interactive mode**

Add this test to `src/__tests__/commands/listings.test.ts`:

```typescript
it("listings update with --interactive fetches current listing and prompts", async () => {
  // Mock the fetch
  mockCall.mockResolvedValueOnce({
    listing_id: 42,
    title: "Old Title",
    description: "Old desc",
    quantity: 5,
    price: { amount: 2999, divisor: 100 },
    state: "active"
  });
  // Mock the update
  mockCall.mockResolvedValueOnce({ listing_id: 42 });

  const program = new Command();
  program.exitOverride();
  registerListingsCommands(program, mockClient, resolveShopId);

  // Mock readline to simulate user pressing Enter for all fields
  const rl = require("readline/promises");
  const originalCreateInterface = rl.createInterface;
  vi.spyOn(rl, "createInterface").mockReturnValue({
    question: vi.fn()
      .mockResolvedValueOnce("") // title
      .mockResolvedValueOnce("") // description
      .mockResolvedValueOnce("") // tags
      .mockResolvedValueOnce("") // quantity
      .mockResolvedValueOnce("") // price
      .mockResolvedValueOnce(""), // state
    close: vi.fn(),
  } as any);

  await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--interactive"]);

  // Verify it fetched the listing first
  expect(mockCall).toHaveBeenNthCalledWith(1, "GET", "/application/listings/42", {});
  // Verify it called update (second call)
  expect(mockCall).toHaveBeenNthCalledWith(2, "PATCH", "/application/shops/99999/listings/42", expect.anything());
});
```

- [ ] **Step 2: Verify test fails**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: FAIL - interactive option not recognized

- [ ] **Step 3: Add interactive option and implement logic**

Edit `src/commands/listings.ts` at line 219 (add after --shop option):

```typescript
    .option("--interactive", "Interactive edit mode (prompts for fields)")
```

Update the action type signature (line 220) to include interactive:

```typescript
    .action(async (opts: { id: string; title?: string; price?: string; quantity?: string; state?: string; description?: string; tags?: string; shop?: string; interactive?: boolean }) => {
```

Add this logic at the START of the try block, right after `const shopId = resolveShopId({ shop: opts.shop });` (after line 222):

```typescript
        // Interactive mode: fetch current values and prompt user
        if (opts.interactive) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          try {
            // Fetch current listing
            const current = await client.call("GET", `/application/listings/${opts.id}`, {}) as Listing & { tags?: string[] | string; description?: string };

            // Prompt for each field with current value as default
            const newTitle = await rl.question(`Title [Current: "${current.title || ""}"]: `);
            const newDescription = await rl.question(`Description [Current: "${current.description || ""}"]: `);
            const currentTags = Array.isArray(current.tags) ? current.tags.join(",") : current.tags || "";
            const newTags = await rl.question(`Tags [Current: "${currentTags}"]: `);
            const newQuantity = await rl.question(`Quantity [Current: ${current.quantity || ""}]: `);
            const currentPrice = current.price ? (current.price.amount / current.price.divisor).toFixed(2) : "";
            const newPrice = await rl.question(`Price [Current: ${currentPrice}]: `);
            const newState = await rl.question(`State [Current: ${current.state || ""}]: `);

            // Build body from user input (only non-empty values)
            if (newTitle.trim()) opts.title = newTitle.trim();
            if (newDescription.trim()) opts.description = newDescription.trim();
            if (newTags.trim()) opts.tags = newTags.trim();
            if (newQuantity.trim()) opts.quantity = newQuantity.trim();
            if (newPrice.trim()) opts.price = newPrice.trim();
            if (newState.trim()) opts.state = newState.trim();
          } finally {
            rl.close();
            process.stdin.destroy();
          }
        }
```

Then skip the validation and body building for interactive mode. Move the existing validation code into an `if (!opts.interactive)` block OR restructure to build body from opts regardless. Simpler approach: keep validation as-is since opts now has the interactively-entered values.

Actually, the above approach is cleaner but requires adjusting the flow. Let me revise:

Replace the entire action block (lines 220-267) with this refactored version:

```typescript
    .action(async (opts: { id: string; title?: string; price?: string; quantity?: string; state?: string; description?: string; tags?: string; shop?: string; interactive?: boolean }) => {
      let rl: any;
      try {
        const shopId = resolveShopId({ shop: opts.shop });

        // Interactive mode: fetch current values and prompt user
        if (opts.interactive) {
          rl = readline.createInterface({ input: process.stdin, output: process.stdout });

          // Fetch current listing
          const current = await client.call("GET", `/application/listings/${opts.id}`, {}) as Listing & { tags?: string[] | string; description?: string };

          // Prompt for each field with current value as default
          const newTitle = await rl.question(`Title [Current: "${current.title || ""}"]: `);
          const newDescription = await rl.question(`Description [Current: "${current.description || ""}"]: `);
          const currentTags = Array.isArray(current.tags) ? current.tags.join(",") : (current.tags || "");
          const newTags = await rl.question(`Tags [Current: "${currentTags}"]: `);
          const newQuantity = await rl.question(`Quantity [Current: ${current.quantity || ""}]: `);
          const currentPrice = current.price ? (current.price.amount / current.price.divisor).toFixed(2) : "";
          const newPrice = await rl.question(`Price [Current: ${currentPrice}]: `);
          const newState = await rl.question(`State [Current: ${current.state || ""}]: `);

          // Build opts from user input (only non-empty values)
          if (newTitle.trim()) opts.title = newTitle.trim();
          else delete opts.title;
          if (newDescription.trim()) opts.description = newDescription.trim();
          else delete opts.description;
          if (newTags.trim()) opts.tags = newTags.trim();
          else delete opts.tags;
          if (newQuantity.trim()) opts.quantity = newQuantity.trim();
          else delete opts.quantity;
          if (newPrice.trim()) opts.price = newPrice.trim();
          else delete opts.price;
          if (newState.trim()) opts.state = newState.trim();
          else delete opts.state;
        }

        const validStates = ["active", "inactive", "draft"];
        if (opts.state !== undefined && !validStates.includes(opts.state)) {
          printError(`Invalid state: "${opts.state}". Must be one of: active, inactive, draft`);
          process.exit(1);
          return;
        }

        const body: Record<string, unknown> = {};

        if (opts.title !== undefined) body.title = opts.title;
        if (opts.description !== undefined) {
          const trimmed = opts.description.trim();
          if (!trimmed) {
            printError("Invalid description: cannot be empty or whitespace-only");
            process.exit(1);
            return;
          }
          body.description = trimmed;
        }
        if (opts.tags !== undefined) {
          const tagArray = opts.tags
            .split(",")
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

          if (tagArray.length === 0) {
            printError("Invalid tags: cannot be empty");
            process.exit(1);
            return;
          }

          if (tagArray.length > 13) {
            printError("Invalid tags: maximum 13 tags allowed");
            process.exit(1);
            return;
          }

          const uniqueTags = new Set(tagArray);
          if (uniqueTags.size !== tagArray.length) {
            printError("Invalid tags: duplicate tags found");
            process.exit(1);
            return;
          }

          body.tags = tagArray;
        }
        if (opts.price !== undefined) {
          const price = parseFloat(opts.price);
          if (isNaN(price) || price <= 0) {
            printError("Invalid price: must be a positive number (e.g. 19.99)");
            process.exit(1);
            return;
          }
          body.price = price;
        }
        if (opts.quantity !== undefined) {
          const quantity = parseInt(opts.quantity, 10);
          if (isNaN(quantity) || quantity < 0) {
            printError("Invalid quantity: must be a non-negative integer");
            process.exit(1);
            return;
          }
          body.quantity = quantity;
        }
        if (opts.state !== undefined) body.state = opts.state;

        if (Object.keys(body).length === 0) {
          printError("No fields to update. Provide at least one of: --title, --description, --tags, --price, --quantity, --state");
          process.exit(1);
          return;
        }

        const result = await client.call(
          "PATCH",
          `/application/shops/${shopId}/listings/${opts.id}`,
          { body, oauth: true }
        ) as Listing;

        console.log(`Updated listing ${result.listing_id ?? opts.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError(`Failed to update listing: ${message}`);
        if (isAuthError(err)) {
          printError("Hint: run 'etsy auth login' to re-authenticate.");
        }
        process.exit(1);
        return;
      } finally {
        if (rl) {
          rl.close();
          process.stdin.destroy();
        }
      }
    });
```

Note: I've also improved price validation to reject zero/negative values.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: PASS (interactive test now passes)

- [ ] **Step 5: Add test for interactive mode with user providing values**

Add this test:

```typescript
it("listings update --interactive only sends changed fields", async () => {
  mockCall.mockResolvedValueOnce({
    listing_id: 42,
    title: "Old Title",
    description: "Old desc",
    quantity: 5,
    price: { amount: 2999, divisor: 100 },
    state: "active"
  });
  mockCall.mockResolvedValueOnce({ listing_id: 42 });

  const program = new Command();
  program.exitOverride();
  registerListingsCommands(program, mockClient, resolveShopId);

  const rl = require("readline/promises");
  vi.spyOn(rl, "createInterface").mockReturnValue({
    question: vi.fn()
      .mockResolvedValueOnce("New Title") // title - changed
      .mockResolvedValueOnce("") // description - unchanged
      .mockResolvedValueOnce("") // tags - unchanged
      .mockResolvedValueOnce("") // quantity - unchanged
      .mockResolvedValueOnce("") // price - unchanged
      .mockResolvedValueOnce(""), // state - unchanged
    close: vi.fn(),
  } as any);

  await program.parseAsync(["node", "test", "listings", "update", "--id", "42", "--interactive"]);

  // Should only send title in the body
  expect(mockCall).toHaveBeenNthCalledWith(2, "PATCH", "/application/shops/99999/listings/42", expect.objectContaining({ body: { title: "New Title" } }));
});
```

- [ ] **Step 6: Run tests to verify**

```bash
npm test -- src/__tests__/commands/listings.test.ts
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/commands/listings.ts src/__tests__/commands/listings.test.ts
git commit -m "feat: add --interactive mode to listings update with current value defaults"
```

---

### Task 5: Verify All Tests Pass

**Files:**
- Test: `src/__tests__/commands/listings.test.ts`

**Context:** Final validation that all tests pass and code compiles.

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass, 60+ passing

- [ ] **Step 2: Build project**

```bash
npm run build
```

Expected: tsc compiles without errors

- [ ] **Step 3: Verify no regressions**

Run a quick smoke test of the updated command (if you have credentials):

```bash
npm start -- listings update --help
```

Expected: Help text shows all new options (--description, --tags, --interactive)

- [ ] **Step 4: Final commit summary**

```bash
git log --oneline -5
```

Verify all 4 feature commits are present

---

## Summary

**Total steps:** 19 discrete steps across 5 tasks

**Key implementation points:**
1. Description field added with whitespace-only validation
2. Tags field added with comma-splitting, deduplication, max 13 limit
3. Interactive mode fetches current listing, prompts user, only sends changed fields
4. Resource cleanup follows create command pattern (rl.close() + process.stdin.destroy())
5. Price validation improved (rejects zero/negative)
6. Error message updated to list all supported fields

**Extensibility:** Adding new fields in future is 5-8 lines per field (option, type, validation, body assignment).

**Design preserved:** Backward compatible, follows existing patterns, TDD approach throughout.
