import { describe, expect, it, vi } from "vitest";
import { HttpFigmaAdapter } from "./http-adapter.js";

/**
 * The behaviour that matters most here is what happens when Figma is *not*
 * available. A missing token or an expired one is an environment condition, so
 * it must degrade to "no reference" — never fail a run, and never throw.
 */

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

const NODE_BODY = {
  version: "123456",
  nodes: {
    "10:23": {
      document: {
        name: "Alarm List",
        absoluteBoundingBox: { width: 393, height: 852 },
      },
    },
  },
};

describe("HttpFigmaAdapter", () => {
  it("reads frame size and file version from a node", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NODE_BODY));
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const metadata = await adapter.fetchNodeMetadata({ node_id: "10:23" });
    expect(metadata?.name).toBe("Alarm List");
    expect(metadata?.width).toBe(393);
    expect(metadata?.height).toBe(852);
    expect(await adapter.fileVersion()).toBe("123456");
  });

  it("sends the token as a header, never in the URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NODE_BODY));
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "secret-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchNodeMetadata({ node_id: "10:23" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).not.toContain("secret-token");
    expect(init.headers["X-Figma-Token"]).toBe("secret-token");
  });

  it("returns null without a token instead of throwing", async () => {
    const fetchImpl = vi.fn();
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await adapter.authenticate()).toBe(false);
    expect(await adapter.fetchNodeMetadata({ node_id: "10:23" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on a non-2xx response", async () => {
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "tok",
      fetchImpl: (async () =>
        jsonResponse({}, false)) as unknown as typeof fetch,
    });
    expect(await adapter.fetchNodeMetadata({ node_id: "10:23" })).toBeNull();
  });

  it("returns null on a network error rather than propagating it", async () => {
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "tok",
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND");
      }) as unknown as typeof fetch,
    });
    await expect(
      adapter.fetchNodeMetadata({ node_id: "10:23" }),
    ).resolves.toBeNull();
  });

  it("returns null for a node the file does not contain", async () => {
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "tok",
      fetchImpl: (async () =>
        jsonResponse({ nodes: {} })) as unknown as typeof fetch,
    });
    expect(await adapter.fetchNodeMetadata({ node_id: "99:99" })).toBeNull();
  });

  it("fetches a node once, however often it is referenced", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NODE_BODY));
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchNodeMetadata({ node_id: "10:23" });
    const before = fetchImpl.mock.calls.length;
    await adapter.fetchNodeMetadata({ node_id: "10:23" });
    expect(fetchImpl.mock.calls.length).toBe(before);
  });

  it("flattens design variables into name/value pairs", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("/variables/")
        ? jsonResponse({
            meta: {
              variables: {
                v1: { name: "color/primary", valuesByMode: { m: "#FF0000" } },
                v2: { name: "font/body", valuesByMode: { m: 17 } },
                v3: { name: "ignored", valuesByMode: { m: { r: 1 } } },
              },
            },
          })
        : jsonResponse(NODE_BODY),
    );
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const metadata = await adapter.fetchNodeMetadata({ node_id: "10:23" });
    expect(metadata?.variables).toEqual({
      "color/primary": "#FF0000",
      "font/body": 17,
    });
  });

  it("captures a snapshot carrying the file version", async () => {
    const adapter = new HttpFigmaAdapter({
      fileKey: "abc",
      token: "tok",
      fetchImpl: (async () =>
        jsonResponse(NODE_BODY)) as unknown as typeof fetch,
    });
    const snapshot = await adapter.captureSnapshot({ node_id: "10:23" });
    expect(snapshot?.figma_file_version).toBe("123456");
    expect(snapshot?.screenshot_path).toBe("10_23.png");
  });
});
