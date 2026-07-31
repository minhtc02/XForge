import { describe, expect, it } from "vitest";
import {
  PRIVACY_SERVICES,
  eraseCommand,
  isPrivacyService,
  openUrlCommand,
  privacyCommand,
  pushCommand,
  stateSetupCommands,
  uiCommand,
  ungrantableServices,
  uninstallCommand,
} from "./simctl.js";
import { stateBucketKey, type StateBucket } from "../models/test-case.js";

const ctx = {
  udid: "UDID-1",
  bundleId: "com.example.app",
  appPath: "/dd/Build/Products/Debug-iphonesimulator/App.app",
  pushPayloadDir: "/runs/XFRUN-1/push-payloads",
};

function bucket(overrides: Partial<StateBucket> = {}): StateBucket {
  return {
    fresh_install: false,
    reset_permissions: false,
    grant_permissions: [],
    revoke_permissions: [],
    ...overrides,
  };
}

describe("privacy services", () => {
  it("matches the list `xcrun simctl privacy` actually accepts", () => {
    // Verified against the tool. camera and notifications are absent, which is
    // exactly why the plan warns about them instead of pretending to grant them.
    expect(PRIVACY_SERVICES).not.toContain("camera");
    expect(PRIVACY_SERVICES).not.toContain("notifications");
    expect(isPrivacyService("location")).toBe(true);
    expect(isPrivacyService("photos")).toBe(true);
    expect(isPrivacyService("camera")).toBe(false);
  });

  it("refuses to build a command for an ungrantable service", () => {
    expect(() =>
      privacyCommand("UDID-1", "grant", "camera", "com.example.app"),
    ).toThrow(/cannot control "camera"/);
  });

  it("requires a bundle id for grant and revoke, not for reset", () => {
    expect(() => privacyCommand("UDID-1", "grant", "photos")).toThrow(
      /requires a bundle identifier/,
    );
    expect(privacyCommand("UDID-1", "reset", "all").args).toEqual([
      "simctl",
      "privacy",
      "UDID-1",
      "reset",
      "all",
    ]);
  });
});

describe("command builders", () => {
  it("never invokes a shell — args stay an array", () => {
    for (const spec of [
      uninstallCommand("UDID-1", "com.example.app"),
      openUrlCommand("UDID-1", "cuckoo://alarm/1"),
      pushCommand("UDID-1", "com.example.app", "/p/a.apns"),
      uiCommand("UDID-1", "appearance", "dark"),
      eraseCommand("UDID-1"),
    ]) {
      expect(spec.command).toBe("xcrun");
      expect(Array.isArray(spec.args)).toBe(true);
      expect(spec.args.join(" ")).not.toMatch(/[;&|]/);
    }
  });
});

describe("stateSetupCommands", () => {
  it("returns nothing for an empty bucket", () => {
    expect(stateSetupCommands(bucket(), ctx)).toEqual([]);
  });

  it("reinstalls before applying permissions, since install wipes them", () => {
    const commands = stateSetupCommands(
      bucket({ fresh_install: true, grant_permissions: ["location"] }),
      ctx,
    );
    const labels = commands.map((c) => c.label);
    expect(labels[0]).toContain("uninstall");
    expect(labels[1]).toContain("install");
    expect(labels[2]).toContain("privacy:grant:location");
  });

  it("resets permissions before granting them", () => {
    const labels = stateSetupCommands(
      bucket({ reset_permissions: true, grant_permissions: ["photos"] }),
      ctx,
    ).map((c) => c.label);
    expect(labels).toEqual([
      "simctl-privacy:reset:all",
      "simctl-privacy:grant:photos",
    ]);
  });

  it("emits no openurl in launch-arg mode — the test carries the link", () => {
    const launchArg = stateSetupCommands(
      bucket({ deep_link: "cuckoo://alarm/1" }),
      { ...ctx, deepLinkMode: "launch-arg" },
    );
    expect(launchArg).toEqual([]);

    const os = stateSetupCommands(bucket({ deep_link: "cuckoo://alarm/1" }), {
      ...ctx,
      deepLinkMode: "os",
    });
    expect(os.map((c) => c.label)).toEqual(["simctl-openurl:cuckoo://alarm/1"]);
  });

  it("defaults to launch-arg when no mode is given", () => {
    expect(
      stateSetupCommands(bucket({ deep_link: "cuckoo://x" }), ctx),
    ).toEqual([]);
  });

  it("applies appearance and content size via simctl ui", () => {
    const labels = stateSetupCommands(
      bucket({ appearance: "dark", content_size: "accessibility-large" }),
      ctx,
    ).map((c) => c.label);
    expect(labels).toEqual([
      "simctl-ui:appearance:dark",
      "simctl-ui:content_size:accessibility-large",
    ]);
  });

  it("resolves a push payload against the run's payload directory", () => {
    const [push] = stateSetupCommands(
      bucket({ push_payload: "alarm.apns" }),
      ctx,
    );
    expect(push?.args.at(-1)).toBe("/runs/XFRUN-1/push-payloads/alarm.apns");
  });
});

describe("ungrantableServices", () => {
  it("flags services simctl cannot handle so planning can warn early", () => {
    expect(
      ungrantableServices(
        bucket({ grant_permissions: ["location", "camera", "notifications"] }),
      ),
    ).toEqual(["camera", "notifications"]);
  });
});

describe("stateBucketKey", () => {
  it("is stable regardless of permission order", () => {
    expect(
      stateBucketKey(bucket({ grant_permissions: ["photos", "location"] })),
    ).toBe(
      stateBucketKey(bucket({ grant_permissions: ["location", "photos"] })),
    );
  });

  it("distinguishes different states and collapses the empty one", () => {
    expect(stateBucketKey(bucket())).toBe("default");
    expect(stateBucketKey(undefined)).toBe("default");
    expect(stateBucketKey(bucket({ fresh_install: true }))).toBe("fresh");
    expect(stateBucketKey(bucket({ appearance: "dark" }))).toBe("ui:dark");
  });
});
