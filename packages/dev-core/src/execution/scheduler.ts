import type { ImplementationGroup } from "../models/plan.js";

/**
 * Dependency-aware group scheduler (blueprint §10 strategy: dependency-aware,
 * Roadmap Phase 3). Turns the implementation task graph into ordered *waves* of
 * groups that may run in parallel: a group appears only after every group in its
 * `depends_on` has completed. Groups that share files are never placed in the
 * same wave as another file-sharing group, keeping conflicting writes
 * sequential (§10). Pure and deterministic — the orchestrator executes the
 * waves, this only computes the order.
 */

export interface SchedulePlan {
  /** Ordered waves; every group in a wave may run concurrently. */
  waves: ImplementationGroup[][];
  /** Cyclic dependency group ids, if any (execution refuses to proceed). */
  cycles: string[];
}

export function scheduleGroups(groups: ImplementationGroup[]): SchedulePlan {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const remaining = new Set(groups.map((g) => g.id));
  const done = new Set<string>();
  const waves: ImplementationGroup[][] = [];

  while (remaining.size > 0) {
    // Every group whose dependencies are all satisfied is eligible now.
    const ready = [...remaining]
      .filter((id) => {
        const g = byId.get(id);
        if (!g) return false;
        return g.depends_on.every((dep) => done.has(dep) || !byId.has(dep));
      })
      .map((id) => byId.get(id)!);

    if (ready.length === 0) {
      // Nothing can advance → the rest form one or more cycles.
      return { waves, cycles: [...remaining].sort() };
    }

    // File-sharing groups must be serialised: keep at most one per wave.
    const wave: ImplementationGroup[] = [];
    let tookSharer = false;
    const deferred: ImplementationGroup[] = [];
    for (const g of ready) {
      if (g.shares_files) {
        if (tookSharer) {
          deferred.push(g);
          continue;
        }
        tookSharer = true;
      }
      wave.push(g);
    }
    // Deferred file-sharers stay in `remaining` for the next wave.
    for (const g of wave) {
      remaining.delete(g.id);
      done.add(g.id);
    }
    waves.push(wave);
  }

  return { waves, cycles: [] };
}

/** Max concurrency for a schedule given a config `max_parallel` value. */
export function resolveMaxParallel(
  maxParallel: "auto" | number,
  waveSize: number,
): number {
  if (maxParallel === "auto") return Math.max(1, waveSize);
  return Math.max(1, Math.min(maxParallel, waveSize));
}
