import { z } from "zod";
import {
  AutomationFramework,
  Confidence,
  Priority,
  Provenance,
  TestType,
} from "./enums.js";

/**
 * TestCase and its parts (blueprint §8.2, master prompt §6).
 *
 * A test case is deterministic, evidence-linked, and never invents
 * requirements: references point at real requirement ids / source files /
 * design nodes surfaced by XForge Core.
 */

export const RequirementReference = z.object({
  id: z.string().min(1),
});
export type RequirementReference = z.infer<typeof RequirementReference>;

export const CodeReference = z.object({
  file: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
});
export type CodeReference = z.infer<typeof CodeReference>;

export const DesignReference = z.object({
  figma_node_id: z.string().min(1),
  state: z.string().optional(),
  device: z.string().optional(),
  /** Whether the mapping is confirmed or needs confirmation before run (§11.3). */
  mapping_confidence: Confidence.default(0.5),
});
export type DesignReference = z.infer<typeof DesignReference>;

export const TestStep = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  target: z.string().optional(),
  value: z.union([z.string(), z.array(z.string())]).optional(),
});
export type TestStep = z.infer<typeof TestStep>;

/** What an assertion checks. Each kind maps to a concrete XCTAssert call. */
export const AssertionKind = z.enum([
  "exists",
  "not-exists",
  "label-equals",
  "label-contains",
  "count-equals",
  "enabled",
  "selected",
  "screen-is",
]);
export type AssertionKind = z.infer<typeof AssertionKind>;

/**
 * A machine-checkable expectation (§14, "exit-0 trap").
 *
 * `expected_results` are human sentences; an {@link Assertion} is the part a
 * generated test can actually verify. Every assertion keeps `source_text` so a
 * failure can be traced back to the expectation it came from.
 */
export const Assertion = z.object({
  id: z.string().min(1),
  kind: AssertionKind,
  /** Accessibility identifier of the element under test. */
  target: z.string().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  /** The `expected_results` sentence this assertion encodes. */
  source_text: z.string().optional(),
});
export type Assertion = z.infer<typeof Assertion>;

/**
 * OS-level state a case needs before it runs (optimization plan §B).
 *
 * This is a *precondition*, deliberately not a {@link TestStep}: `simctl` runs
 * in the host process, outside the test bundle, so it cannot be interleaved
 * between cases within one `xcodebuild` invocation. Cases sharing a bucket are
 * sharded together and the state is applied once, before that shard runs.
 */
export const StateBucket = z.object({
  /** Uninstall + reinstall the app — the only true first-run (FTU) state. */
  fresh_install: z.boolean().default(false),
  /** `simctl privacy reset all` before granting anything. */
  reset_permissions: z.boolean().default(false),
  /** Services to pre-grant. Only simctl-supported services are valid. */
  grant_permissions: z.array(z.string()).default([]),
  revoke_permissions: z.array(z.string()).default([]),
  /** URL to open; delivery depends on `state.deep_link_mode`. */
  deep_link: z.string().optional(),
  /** Filename of an `.apns` payload to send with `simctl push`. */
  push_payload: z.string().optional(),
  appearance: z.enum(["light", "dark"]).optional(),
  /** Dynamic Type size, e.g. `accessibility-extra-large`. */
  content_size: z.string().optional(),
});
export type StateBucket = z.infer<typeof StateBucket>;

/** Stable key for grouping cases that share a state (used for sharding). */
export function stateBucketKey(bucket?: StateBucket): string {
  if (!bucket) return "default";
  const parts = [
    bucket.fresh_install ? "fresh" : "",
    bucket.reset_permissions ? "reset" : "",
    bucket.grant_permissions.length > 0
      ? `grant:${[...bucket.grant_permissions].sort().join("+")}`
      : "",
    bucket.revoke_permissions.length > 0
      ? `revoke:${[...bucket.revoke_permissions].sort().join("+")}`
      : "",
    bucket.deep_link ? `link:${bucket.deep_link}` : "",
    bucket.push_payload ? `push:${bucket.push_payload}` : "",
    bucket.appearance ? `ui:${bucket.appearance}` : "",
    bucket.content_size ? `size:${bucket.content_size}` : "",
  ].filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join("|") : "default";
}

export const TestData = z.object({
  key: z.string().min(1),
  value: z.string(),
});
export type TestData = z.infer<typeof TestData>;

export const TestEnvironment = z.object({
  locale: z.string().default("en-US"),
  timezone: z.string().default("UTC"),
  appearance: z.enum(["light", "dark"]).default("light"),
  device: z.string().optional(),
  runtime: z.string().optional(),
});
export type TestEnvironment = z.infer<typeof TestEnvironment>;

export const AutomationStrategy = z.object({
  framework: AutomationFramework.default("xcuitest"),
  execution_group: z.string().optional(),
  simulator_profile: z.string().optional(),
  /** True when the case cannot be automated as-is (see TestabilityIssue). */
  blocked: z.boolean().default(false),
});
export type AutomationStrategy = z.infer<typeof AutomationStrategy>;

export const TestCase = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  feature: z.string().min(1),
  types: z.array(TestType).min(1),
  priority: Priority,
  risk_score: z.number().min(0).max(10),
  requirements: z.array(z.string()).default([]),
  code_references: z.array(CodeReference).default([]),
  design_references: z.array(DesignReference).default([]),
  preconditions: z.array(z.string()).default([]),
  /** OS-level state this case needs; drives sharding, not step order. */
  state: StateBucket.optional(),
  steps: z.array(TestStep).default([]),
  expected_results: z.array(z.string()).default([]),
  /**
   * Machine-checkable form of `expected_results`. A case with expectations but
   * no assertions cannot fail on behaviour — the testability analyzer flags it.
   */
  assertions: z.array(Assertion).default([]),
  automation: AutomationStrategy,
  environment: TestEnvironment.optional(),
  confidence: Confidence.default(0.5),
  /** Where this case came from (§6 source provenance). */
  provenance: z.array(Provenance).default([]),
});
export type TestCase = z.infer<typeof TestCase>;
