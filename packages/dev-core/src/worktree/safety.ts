import { isAbsolute, normalize, relative, sep } from "node:path";

/**
 * Worktree safety validation (blueprint §4.5, §10, §16, master prompt §Worktree
 * safety). The main checkout is read-only; XForge Dev may only create/delete
 * worktrees under `.xforge/worktrees/`. These pure predicates are the guardrail
 * the planner and (future) worktree manager both call.
 */

export interface WorktreeSafetyContext {
  projectRoot: string;
  /** Root under which worktrees are allowed, e.g. `.xforge/worktrees`. */
  worktreeRootRel: string;
}

export type SafetyReason =
  | "outside-worktree-root"
  | "path-traversal"
  | "is-main-checkout"
  | "absolute-escape"
  | "empty-path";

export interface SafetyResult {
  safe: boolean;
  reason?: SafetyReason;
}

function toRelWithinRoot(projectRoot: string, target: string): string {
  const abs = isAbsolute(target)
    ? target
    : normalize(`${projectRoot}${sep}${target}`);
  return relative(projectRoot, abs);
}

/**
 * A worktree path is safe iff, resolved against the project root, it lives
 * strictly inside the worktree root and does not escape via `..`.
 */
export function isSafeWorktreePath(
  ctx: WorktreeSafetyContext,
  target: string,
): SafetyResult {
  if (!target || target.trim().length === 0) {
    return { safe: false, reason: "empty-path" };
  }
  const rel = toRelWithinRoot(ctx.projectRoot, target);

  // Escapes the project root entirely.
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { safe: false, reason: "absolute-escape" };
  }
  // Raw traversal segments anywhere in the requested path.
  if (
    target.split(/[\\/]/).some((seg) => seg === "..") &&
    !normalize(rel).startsWith(normalize(ctx.worktreeRootRel))
  ) {
    return { safe: false, reason: "path-traversal" };
  }
  // The main checkout root itself is never a worktree.
  if (rel === "" || rel === ".") {
    return { safe: false, reason: "is-main-checkout" };
  }
  const rootRel = normalize(ctx.worktreeRootRel);
  const relNorm = normalize(rel);
  if (relNorm !== rootRel && !relNorm.startsWith(rootRel + sep)) {
    return { safe: false, reason: "outside-worktree-root" };
  }
  return { safe: true };
}

/** Whether a path may be deleted by cleanup — only XForge-managed worktrees. */
export function isSafeToDelete(
  ctx: WorktreeSafetyContext,
  target: string,
): SafetyResult {
  const result = isSafeWorktreePath(ctx, target);
  if (!result.safe) return result;
  // Must be strictly *inside* the worktree root (never the root itself).
  const rel = normalize(toRelWithinRoot(ctx.projectRoot, target));
  const rootRel = normalize(ctx.worktreeRootRel);
  if (rel === rootRel) return { safe: false, reason: "is-main-checkout" };
  return { safe: true };
}

/** Branch name validation for `xforge/dev/<change-id>/<group>` (§10). */
export function isValidDevBranch(name: string): boolean {
  if (!/^xforge\/dev\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name))
    return false;
  // Reject refs git would reject / that could be dangerous.
  if (/\.\.|@\{|[\s~^:?*[\\]/.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".lock")) return false;
  return true;
}

/** Operations that must never target the main checkout (§10 forbidden list). */
export const FORBIDDEN_ON_MAIN = [
  "git reset --hard",
  "git merge into main",
  "git push --force",
  "direct source writes",
] as const;
