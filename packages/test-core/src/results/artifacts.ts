import type { CommandSpec } from "../execution/runner.js";

/**
 * Result-bundle artifact extraction (blueprint §23, optimization plan Phase 4
 * task 1 and Phase 5 task 1).
 *
 * XCUITest screenshots and the accessibility probe dump both land inside the
 * `.xcresult` bundle as attachments. Getting them onto disk needs `xcresulttool`.
 * Following the pattern used everywhere else in this package, the shell plumbing
 * is expressed as {@link CommandSpec} values and the parsing is pure — so the
 * whole path is unit-testable without Xcode installed.
 */

/** `xcrun xcresulttool get --format json` for a bundle's root object. */
export function xcresultRootCommand(bundlePath: string): CommandSpec {
  return {
    label: `xcresult-root:${bundlePath}`,
    command: "xcrun",
    args: [
      "xcresulttool",
      "get",
      "--format",
      "json",
      "--path",
      bundlePath,
      "--legacy",
    ],
  };
}

/** `xcrun xcresulttool get` for one object id inside the bundle. */
export function xcresultObjectCommand(
  bundlePath: string,
  objectId: string,
): CommandSpec {
  return {
    label: `xcresult-object:${objectId}`,
    command: "xcrun",
    args: [
      "xcresulttool",
      "get",
      "--format",
      "json",
      "--path",
      bundlePath,
      "--id",
      objectId,
      "--legacy",
    ],
  };
}

/** `xcrun xcresulttool export` for one attachment payload. */
export function xcresultExportCommand(
  bundlePath: string,
  objectId: string,
  outputPath: string,
): CommandSpec {
  return {
    label: `xcresult-export:${objectId}`,
    command: "xcrun",
    args: [
      "xcresulttool",
      "export",
      "--type",
      "file",
      "--path",
      bundlePath,
      "--id",
      objectId,
      "--output-path",
      outputPath,
      "--legacy",
    ],
  };
}

/** An attachment reference recovered from an xcresult test summary. */
export interface AttachmentRef {
  /** Attachment name as set by the test (`att.name = "..."`). */
  name: string;
  /** Payload object id used with `xcresulttool export`. */
  id: string;
  /** Uniform type identifier, e.g. `public.png` / `public.json`. */
  uti?: string;
  /** Test identifier the attachment belongs to, when known. */
  testIdentifier?: string;
}

/**
 * The (deeply nested, typed-value) shape xcresulttool emits. We only reach for
 * the few fields we need and tolerate anything else being absent.
 */
interface TypedValue {
  _value?: string;
  _values?: unknown[];
}

function str(node: unknown): string | undefined {
  const value = (node as TypedValue | undefined)?._value;
  return typeof value === "string" ? value : undefined;
}

function list(node: unknown): unknown[] {
  const values = (node as TypedValue | undefined)?._values;
  return Array.isArray(values) ? values : [];
}

/**
 * Walk an xcresult JSON object and collect every attachment reference. The
 * traversal is structural rather than schema-bound so a minor Xcode format
 * change degrades to "found nothing", never to a crash.
 */
export function collectAttachments(root: unknown): AttachmentRef[] {
  const found: AttachmentRef[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown, testIdentifier?: string): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    const record = node as Record<string, unknown>;
    const identifier = str(record.identifier) ?? testIdentifier;

    const payloadId = str(
      (record.payloadRef as Record<string, unknown> | undefined)?.id,
    );
    const name = str(record.name) ?? str(record.filename);
    if (payloadId && name) {
      found.push({
        name,
        id: payloadId,
        uti: str(record.uniformTypeIdentifier),
        ...(identifier ? { testIdentifier: identifier } : {}),
      });
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, identifier);
      } else if (value && typeof value === "object") {
        for (const item of list(value)) visit(item, identifier);
        visit(value, identifier);
      }
    }
  };

  visit(root);
  return found;
}

/** Attachments whose UTI or name marks them as PNG screenshots. */
export function screenshotAttachments(
  attachments: AttachmentRef[],
): AttachmentRef[] {
  return attachments.filter(
    (a) => a.uti === "public.png" || /\.png$/i.test(a.name),
  );
}

/** The probe dump attachment, if this bundle contains one. */
export function probeAttachment(
  attachments: AttachmentRef[],
): AttachmentRef | undefined {
  return attachments.find((a) => a.name === "xforge-probe");
}
