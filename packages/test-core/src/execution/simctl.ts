import type { StateBucket } from "../models/test-case.js";
import type { CommandSpec } from "./runner.js";

/**
 * System-level simulator state control (optimization plan §B).
 *
 * Everything here builds {@link CommandSpec} values; nothing executes. That
 * keeps state setup dry-runnable and unit-testable, and means the exact command
 * list a run will issue is visible before approval (§19).
 *
 * Two facts from `xcrun simctl` shape this module, both verified against the
 * tool rather than assumed:
 *
 *  1. `simctl privacy` grants only a fixed service list. **camera and
 *     notifications are not in it** — those need an in-test alert handler
 *     instead, which is why {@link privacyCommand} refuses them outright.
 *  2. simctl runs in the *host* process, outside the test bundle. It therefore
 *     cannot be interleaved between cases inside one `xcodebuild` invocation —
 *     state is applied per shard, which is what {@link stateSetupCommands} emits.
 */

/** Services `xcrun simctl privacy grant` accepts (verified against the tool). */
export const PRIVACY_SERVICES = [
  "all",
  "calendar",
  "contacts-limited",
  "contacts",
  "location",
  "location-always",
  "photos-add",
  "photos",
  "media-library",
  "microphone",
  "motion",
  "reminders",
  "siri",
] as const;
export type PrivacyService = (typeof PRIVACY_SERVICES)[number];

export type PrivacyAction = "grant" | "revoke" | "reset";

export function isPrivacyService(value: string): value is PrivacyService {
  return (PRIVACY_SERVICES as readonly string[]).includes(value);
}

export function uninstallCommand(udid: string, bundleId: string): CommandSpec {
  return {
    label: `simctl-uninstall:${bundleId}`,
    command: "xcrun",
    args: ["simctl", "uninstall", udid, bundleId],
  };
}

export function installCommand(udid: string, appPath: string): CommandSpec {
  return {
    label: `simctl-install:${appPath}`,
    command: "xcrun",
    args: ["simctl", "install", udid, appPath],
  };
}

/**
 * Grant/revoke/reset a privacy service. Throws for a service simctl cannot
 * control, so an impossible plan fails at build time rather than silently
 * producing a command that errors mid-run.
 */
export function privacyCommand(
  udid: string,
  action: PrivacyAction,
  service: string,
  bundleId?: string,
): CommandSpec {
  if (!isPrivacyService(service)) {
    throw new Error(
      `simctl privacy cannot control "${service}". Supported: ${PRIVACY_SERVICES.join(", ")}. ` +
        "Handle this permission with an in-test alert monitor instead.",
    );
  }
  if (action !== "reset" && !bundleId) {
    throw new Error(`simctl privacy ${action} requires a bundle identifier`);
  }
  return {
    label: `simctl-privacy:${action}:${service}`,
    command: "xcrun",
    args: [
      "simctl",
      "privacy",
      udid,
      action,
      service,
      ...(bundleId ? [bundleId] : []),
    ],
  };
}

export function openUrlCommand(udid: string, url: string): CommandSpec {
  return {
    label: `simctl-openurl:${url}`,
    command: "xcrun",
    args: ["simctl", "openurl", udid, url],
  };
}

export function pushCommand(
  udid: string,
  bundleId: string,
  payloadPath: string,
): CommandSpec {
  return {
    label: `simctl-push:${bundleId}`,
    command: "xcrun",
    args: ["simctl", "push", udid, bundleId, payloadPath],
  };
}

/** `simctl ui <udid> appearance light|dark` / `content_size <size>`. */
export function uiCommand(
  udid: string,
  option: "appearance" | "content_size" | "increase_contrast",
  value: string,
): CommandSpec {
  return {
    label: `simctl-ui:${option}:${value}`,
    command: "xcrun",
    args: ["simctl", "ui", udid, option, value],
  };
}

export function eraseCommand(udid: string): CommandSpec {
  return {
    label: "simctl-erase",
    command: "xcrun",
    args: ["simctl", "erase", udid],
  };
}

export function terminateCommand(udid: string, bundleId: string): CommandSpec {
  return {
    label: `simctl-terminate:${bundleId}`,
    command: "xcrun",
    args: ["simctl", "terminate", udid, bundleId],
  };
}

export interface StateSetupContext {
  udid: string;
  bundleId: string;
  /** Path to the built `.app`, needed to reinstall after a fresh-install wipe. */
  appPath?: string;
  /** Directory holding generated `.apns` payload files. */
  pushPayloadDir?: string;
  /**
   * How a deep link is delivered. `launch-arg` keeps per-case granularity
   * inside a single xcodebuild invocation; `os` is a real OS handoff but costs
   * this bucket its own invocation.
   */
  deepLinkMode?: "launch-arg" | "os";
}

/**
 * The ordered command list that puts a simulator into a bucket's state, run
 * between `install-app` and `run-tests`.
 *
 * Order matters: a fresh install wipes the container, so permissions and deep
 * links must be applied *after* it.
 */
export function stateSetupCommands(
  bucket: StateBucket,
  ctx: StateSetupContext,
): CommandSpec[] {
  const commands: CommandSpec[] = [];

  if (bucket.fresh_install) {
    commands.push(uninstallCommand(ctx.udid, ctx.bundleId));
    if (ctx.appPath) commands.push(installCommand(ctx.udid, ctx.appPath));
  }

  if (bucket.reset_permissions) {
    commands.push(privacyCommand(ctx.udid, "reset", "all", ctx.bundleId));
  }
  for (const service of bucket.grant_permissions ?? []) {
    commands.push(privacyCommand(ctx.udid, "grant", service, ctx.bundleId));
  }
  for (const service of bucket.revoke_permissions ?? []) {
    commands.push(privacyCommand(ctx.udid, "revoke", service, ctx.bundleId));
  }

  if (bucket.appearance) {
    commands.push(uiCommand(ctx.udid, "appearance", bucket.appearance));
  }
  if (bucket.content_size) {
    commands.push(uiCommand(ctx.udid, "content_size", bucket.content_size));
  }

  // A deep link delivered via launch argument is the generated test's job, not
  // the orchestrator's — only the OS-level mode produces a command here.
  if (bucket.deep_link && (ctx.deepLinkMode ?? "launch-arg") === "os") {
    commands.push(openUrlCommand(ctx.udid, bucket.deep_link));
  }

  if (bucket.push_payload && ctx.pushPayloadDir) {
    commands.push(
      pushCommand(
        ctx.udid,
        ctx.bundleId,
        `${ctx.pushPayloadDir}/${bucket.push_payload}`,
      ),
    );
  }

  return commands;
}

/**
 * Services a bucket asks for that simctl cannot grant. Callers surface these as
 * testability issues at plan time so nothing is discovered mid-run (§4.1).
 */
export function ungrantableServices(bucket: StateBucket): string[] {
  return [
    ...(bucket.grant_permissions ?? []),
    ...(bucket.revoke_permissions ?? []),
  ].filter((s) => !isPrivacyService(s));
}
