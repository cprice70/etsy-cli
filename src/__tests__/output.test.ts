import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("output helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("colorState", () => {
    it("colors listing states correctly", async () => {
      const { colorState } = await import("../output.js");
      // chalk strips color codes in test — just check the state string is present
      expect(colorState("active")).toContain("active");
      expect(colorState("draft")).toContain("draft");
      expect(colorState("inactive")).toContain("inactive");
      expect(colorState("expired")).toContain("expired");
      expect(colorState("sold_out")).toContain("sold_out");
    });

    it("colors order states correctly", async () => {
      const { colorState } = await import("../output.js");
      expect(colorState("paid")).toContain("paid");
      expect(colorState("completed")).toContain("completed");
      expect(colorState("open")).toContain("open");
      expect(colorState("canceled")).toContain("canceled");
    });

    it("returns unknown state unchanged", async () => {
      const { colorState } = await import("../output.js");
      expect(colorState("unknown_state")).toBe("unknown_state");
    });
  });

  describe("printJson", () => {
    it("prints pretty JSON to console", async () => {
      const { printJson } = await import("../output.js");
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printJson({ foo: "bar" });
      expect(spy).toHaveBeenCalledWith(JSON.stringify({ foo: "bar" }, null, 2));
    });
  });

  describe("printSuccess/printError/printWarning", () => {
    it("printSuccess calls console.log", async () => {
      const { printSuccess } = await import("../output.js");
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printSuccess("ok");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("printError calls console.error", async () => {
      const { printError } = await import("../output.js");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      printError("bad");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("printWarning calls console.warn", async () => {
      const { printWarning } = await import("../output.js");
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      printWarning("hmm");
      expect(spy).toHaveBeenCalledOnce();
    });
  });
});
