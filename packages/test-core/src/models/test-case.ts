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
  steps: z.array(TestStep).default([]),
  expected_results: z.array(z.string()).default([]),
  automation: AutomationStrategy,
  environment: TestEnvironment.optional(),
  confidence: Confidence.default(0.5),
  /** Where this case came from (§6 source provenance). */
  provenance: z.array(Provenance).default([]),
});
export type TestCase = z.infer<typeof TestCase>;
