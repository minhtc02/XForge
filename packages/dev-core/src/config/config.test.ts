import { describe, expect, it } from "vitest";
import { ConfigError } from "@xforge/shared";
import {
  DEV_CONFIG_VERSION,
  defaultDevConfig,
  validateDevConfig,
} from "./index.js";

describe("dev config", () => {
  it("defaults every verification action to opt-in and docs sync off", () => {
    const cfg = validateDevConfig({ version: DEV_CONFIG_VERSION });
    expect(cfg.execution.build).toBe("opt_in");
    expect(cfg.execution.test).toBe("opt_in");
    expect(cfg.execution.ui_verification).toBe("opt_in");
    expect(cfg.execution.performance_verification).toBe("opt_in");
    expect(cfg.spec_changes.sync_on_code_accept).toBe(false);
    expect(cfg.acceptance.allow_code_accept_with_unsynced_spec).toBe(true);
    expect(cfg.integration.merge_to_main).toBe(false);
    expect(cfg.worktrees.main_checkout_read_only).toBe(true);
  });

  it("keeps docs as the default source of truth with user override on", () => {
    const cfg = defaultDevConfig();
    expect(cfg.source_of_truth.default_logic).toBe("docs");
    expect(cfg.source_of_truth.user_request_overrides_docs).toBe(true);
  });

  it("rejects an unsupported version and non-objects", () => {
    expect(() => validateDevConfig({ version: 99 })).toThrow(ConfigError);
    expect(() => validateDevConfig(7)).toThrow(ConfigError);
  });

  it("preserves overrides", () => {
    const cfg = validateDevConfig({
      version: DEV_CONFIG_VERSION,
      worktrees: { cleanup_after_accept: "remove" },
      base_branch: "develop",
    });
    expect(cfg.worktrees.cleanup_after_accept).toBe("remove");
    expect(cfg.base_branch).toBe("develop");
  });
});
