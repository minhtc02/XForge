import { ValidationError } from "@xforge/shared";
import { z } from "zod";
import { ProjectModel } from "./schema.js";

export * from "./enums.js";
export * from "./schema.js";

/**
 * Parse and validate an unknown value as a {@link ProjectModel}.
 * Throws {@link ValidationError} with structured issue details on failure.
 */
export function parseProjectModel(input: unknown): ProjectModel {
  const result = ProjectModel.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Project Model failed validation", {
      details: { issues: formatZodIssues(result.error) },
    });
  }
  return result.data;
}

/** Serialize a Project Model to stable, pretty-printed JSON. */
export function serializeProjectModel(model: ProjectModel): string {
  return JSON.stringify(model, null, 2) + "\n";
}

/** Parse a JSON string into a validated Project Model. */
export function parseProjectModelJson(json: string): ProjectModel {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new ValidationError("Project Model JSON is not valid JSON", {
      cause,
    });
  }
  return parseProjectModel(raw);
}

/** Flatten Zod issues into a plain, serializable array. */
export function formatZodIssues(
  error: z.ZodError,
): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
