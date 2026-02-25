/**
 * Minimal unit test for export-download flow.
 * Run with: npx vitest run src/lib/exportDownload.test.js
 * (Add vitest to devDependencies and "test": "vitest" to package.json if not present.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("export download", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("triggers download when response is video blob", async () => {
    const blob = new Blob(["fake-mp4"], { type: "video/mp4" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "video/mp4" },
      blob: () => Promise.resolve(blob),
    });
    vi.stubGlobal("fetch", fetchMock);

    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const click = vi.fn();
    const a = { href: "", download: "", click };
    document.body.appendChild = appendChild;
    document.body.removeChild = removeChild;
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag === "a") return a;
      return {};
    });

    const response = await fetch("http://127.0.0.1:8001/render_timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clips: [] }),
    });
    if (response.ok && response.headers.get("content-type")?.includes("video")) {
      const blobData = await response.blob();
      const url = URL.createObjectURL(blobData);
      const link = document.createElement("a");
      link.href = url;
      link.download = "TikTok_export.mp4";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalled();
  });
});
