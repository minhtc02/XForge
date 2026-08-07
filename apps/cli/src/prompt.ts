import { createInterface } from "node:readline/promises";
import type { CliContext } from "./context.js";

/**
 * Interactive prompts, with the one rule that makes them safe.
 *
 * A prompt that fires in CI is worse than no prompt: it hangs the build, or
 * — as an earlier version of `xforge docs` did — writes its menu to stdout and
 * corrupts `--json` output while exiting 0 having done nothing. So prompting is
 * only ever attempted when all three hold:
 *
 *   - the caller did not pass an explicit value,
 *   - output is not machine-readable (`--json`),
 *   - both stdin and stdout are a terminal.
 *
 * {@link canPrompt} is the single gate; every caller must go through it and
 * have a non-interactive default ready for when it returns false.
 */

export function canPrompt(ctx: CliContext): boolean {
  return (
    !ctx.json && process.stdin.isTTY === true && process.stdout.isTTY === true
  );
}

export interface Choice<T> {
  value: T;
  label: string;
  /** Shown dimmed after the label. */
  hint?: string;
}

/**
 * Ask a question, resolving to `fallback` if stdin ends first.
 *
 * Two different things happen when input goes away: a real terminal sends
 * Ctrl+D and readline rejects, while a closed pipe just leaves the promise
 * pending forever. Neither should strand or crash a run that already has a
 * usable default, so both are funnelled into the same answer.
 */
async function askOrDefault(
  rl: ReturnType<typeof createInterface>,
  query: string,
  fallback: string,
): Promise<string> {
  const closed = new Promise<string>((resolve) => {
    rl.once("close", () => resolve(fallback));
  });
  try {
    return await Promise.race([rl.question(query), closed]);
  } catch {
    return fallback;
  }
}

/**
 * Ask the user to pick one of `choices`. Returns the default on an empty
 * answer, and re-asks on an invalid one. Prompts are written to stderr so
 * stdout stays clean for piping.
 *
 * Closed stdin resolves to the default rather than throwing: the terminal
 * looked interactive when we checked, so the caller already has a sensible
 * non-interactive answer, and failing a generation run over a lost stdin
 * helps nobody.
 */
export async function selectOne<T>(
  question: string,
  choices: Array<Choice<T>>,
  defaultIndex = 0,
): Promise<T> {
  if (choices.length === 0) {
    throw new Error("selectOne requires at least one choice");
  }
  const fallbackValue = choices[defaultIndex]!.value;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`\n${question}\n\n`);
    for (const [i, choice] of choices.entries()) {
      const marker = i === defaultIndex ? "›" : " ";
      const hint = choice.hint ? `  ${choice.hint}` : "";
      process.stderr.write(
        `  ${marker} ${String(i + 1).padStart(2)}. ${choice.label}${hint}\n`,
      );
    }
    for (;;) {
      const answer = (
        await askOrDefault(
          rl,
          `\nSelect [1-${choices.length}] (${defaultIndex + 1}): `,
          "",
        )
      ).trim();
      if (answer === "") return fallbackValue;
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
        return choices[index - 1]!.value;
      }
      process.stderr.write(
        `  Enter a number between 1 and ${choices.length}.\n`,
      );
    }
  } finally {
    rl.close();
  }
}

/** Ask a yes/no question. Closed stdin takes the default, as in {@link selectOne}. */
export async function confirm(
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = (await askOrDefault(rl, `\n${question} ${suffix}: `, ""))
      .trim()
      .toLowerCase();
    if (answer === "") return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
