/**
 * Property list parsing for `Info.plist` and `*.entitlements` (blueprint §6.2,
 * Phase 3 "plist/entitlement extraction").
 *
 * Dependency-free XML plist reader in the same spirit as the Swift parser: a
 * deterministic line scanner that records 1-based line numbers so every derived
 * permission or capability carries evidence. Nested `<dict>`s are flattened —
 * that is exactly what we want for `CFBundleURLTypes`, whose URL schemes live
 * one dict deep.
 *
 * Binary plists are not decoded; callers get an empty entry list rather than a
 * guess (§3.3 — never assert without evidence).
 */

export type PlistValue = string | string[] | boolean;

export interface PlistEntry {
  key: string;
  value: PlistValue;
  /** 1-based line of the `<key>` element. */
  line: number;
}

const KEY_RE = /<key>([^<]*)<\/key>/;
const STRING_RE = /<string>([\s\S]*?)<\/string>/;
const INTEGER_RE = /<integer>([^<]*)<\/integer>/;
const REAL_RE = /<real>([^<]*)<\/real>/;

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** True when the content looks like a binary (not XML) plist. */
export function isBinaryPlist(content: string): boolean {
  return content.startsWith("bplist");
}

/**
 * Parse an XML plist into flat key/value entries. Keys nested inside dicts are
 * returned alongside top-level ones; array values collapse to their string
 * members.
 */
export function parsePlist(content: string): PlistEntry[] {
  if (isBinaryPlist(content)) return [];
  const lines = content.split("\n");
  const entries: PlistEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const keyMatch = KEY_RE.exec(lines[i] ?? "");
    if (!keyMatch?.[1]) continue;
    const key = decodeXmlEntities(keyMatch[1]).trim();
    if (key.length === 0) continue;

    // The value is whatever follows the key element, possibly on the same line.
    const afterKey = (lines[i] ?? "").slice(
      keyMatch.index + keyMatch[0].length,
    );
    const parsed = readValue(lines, i, afterKey);
    if (parsed) entries.push({ key, value: parsed.value, line: i + 1 });
    // Deliberately do NOT skip past the value: an array of dicts (e.g.
    // `CFBundleURLTypes`) holds keys of its own, and skipping would swallow
    // them. Plain `<string>` members never look like keys, so re-scanning the
    // consumed lines is harmless.
  }
  return entries;
}

interface ReadResult {
  value: PlistValue;
  /** Index of the last line consumed. */
  endLine: number;
}

function readValue(
  lines: string[],
  keyLine: number,
  remainderOfKeyLine: string,
): ReadResult | undefined {
  // Scan from the remainder of the key's line, then subsequent lines.
  let cursor = keyLine;
  let text = remainderOfKeyLine;
  for (let guard = 0; guard < lines.length; guard++) {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      if (/<true\s*\/>/.test(trimmed)) return { value: true, endLine: cursor };
      if (/<false\s*\/>/.test(trimmed))
        return { value: false, endLine: cursor };
      if (/<array\s*\/>/.test(trimmed)) return { value: [], endLine: cursor };
      if (/<dict\s*\/>/.test(trimmed)) return { value: [], endLine: cursor };

      const str = STRING_RE.exec(trimmed);
      if (str) {
        return { value: decodeXmlEntities(str[1] ?? ""), endLine: cursor };
      }
      const int = INTEGER_RE.exec(trimmed) ?? REAL_RE.exec(trimmed);
      if (int) return { value: (int[1] ?? "").trim(), endLine: cursor };

      if (/<array>/.test(trimmed)) return readArray(lines, cursor);
      // A nested <dict> is not a value of its own; its inner keys are picked up
      // by the outer scan, so stop here without consuming lines.
      if (/<dict>/.test(trimmed)) return undefined;
    }
    cursor += 1;
    if (cursor >= lines.length) return undefined;
    text = lines[cursor] ?? "";
  }
  return undefined;
}

/** Collect `<string>` members until the matching `</array>`. */
function readArray(lines: string[], startLine: number): ReadResult {
  const values: string[] = [];
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/<array>/.test(line)) depth += 1;
    const str = STRING_RE.exec(line);
    if (str) values.push(decodeXmlEntities(str[1] ?? ""));
    if (/<\/array>/.test(line)) {
      depth -= 1;
      if (depth <= 0) return { value: values, endLine: i };
    }
  }
  return { value: values, endLine: lines.length - 1 };
}

/**
 * Map an `NS…UsageDescription` key to the privacy service it guards. The name
 * matches Apple's own wording so it lines up with `simctl privacy` services.
 */
export const PERMISSION_KEYS: Readonly<Record<string, string>> = {
  NSCameraUsageDescription: "camera",
  NSMicrophoneUsageDescription: "microphone",
  NSPhotoLibraryUsageDescription: "photos",
  NSPhotoLibraryAddUsageDescription: "photos-add",
  NSLocationWhenInUseUsageDescription: "location",
  NSLocationAlwaysAndWhenInUseUsageDescription: "location-always",
  NSLocationAlwaysUsageDescription: "location-always",
  NSContactsUsageDescription: "contacts",
  NSCalendarsUsageDescription: "calendar",
  NSCalendarsFullAccessUsageDescription: "calendar",
  NSRemindersUsageDescription: "reminders",
  NSRemindersFullAccessUsageDescription: "reminders",
  NSMotionUsageDescription: "motion",
  NSHealthShareUsageDescription: "health-share",
  NSHealthUpdateUsageDescription: "health-update",
  NSBluetoothAlwaysUsageDescription: "bluetooth",
  NSBluetoothPeripheralUsageDescription: "bluetooth",
  NSSpeechRecognitionUsageDescription: "speech-recognition",
  NSSiriUsageDescription: "siri",
  NSFaceIDUsageDescription: "face-id",
  NSAppleMusicUsageDescription: "media-library",
  NSUserTrackingUsageDescription: "user-tracking",
  NSLocalNetworkUsageDescription: "local-network",
};

/**
 * Privacy services that `xcrun simctl privacy grant` can pre-authorize. The
 * rest must be handled another way (system alert interception or a test hook) —
 * XForge Test relies on this to warn *before* a run instead of timing out
 * mid-run.
 */
export const SIMCTL_GRANTABLE_SERVICES: ReadonlySet<string> = new Set([
  "calendar",
  "contacts",
  "contacts-limited",
  "location",
  "location-always",
  "media-library",
  "microphone",
  "motion",
  "photos",
  "photos-add",
  "reminders",
  "siri",
]);

/** Entitlement keys worth surfacing as capabilities. */
export const ENTITLEMENT_LABELS: Readonly<Record<string, string>> = {
  "aps-environment": "Push Notifications",
  "com.apple.developer.aps-environment": "Push Notifications",
  "com.apple.developer.healthkit": "HealthKit",
  "com.apple.developer.icloud-services": "iCloud",
  "com.apple.developer.icloud-container-identifiers": "iCloud Containers",
  "com.apple.developer.applesignin": "Sign in with Apple",
  "com.apple.developer.associated-domains": "Associated Domains",
  "com.apple.developer.in-app-payments": "Apple Pay",
  "com.apple.developer.siri": "SiriKit",
  "com.apple.security.application-groups": "App Groups",
  "com.apple.developer.usernotifications.time-sensitive":
    "Time Sensitive Notifications",
  "com.apple.developer.networking.wifi-info": "Wi-Fi Information",
};

export interface PlistFacts {
  /** `NS…UsageDescription` → { service, purpose } */
  permissions: Array<{
    key: string;
    service: string;
    purpose: string;
    line: number;
  }>;
  /** Entitlement capabilities, labelled. */
  capabilities: Array<{ key: string; label: string; line: number }>;
  /** `UIBackgroundModes` values. */
  backgroundModes: string[];
  /** URL schemes from `CFBundleURLSchemes` (deep-link entry points). */
  urlSchemes: string[];
  /** `CFBundleIdentifier`, when declared literally. */
  bundleIdentifier?: string;
}

/** Derive the iOS-relevant facts from one parsed plist/entitlements file. */
export function plistFacts(entries: PlistEntry[]): PlistFacts {
  const facts: PlistFacts = {
    permissions: [],
    capabilities: [],
    backgroundModes: [],
    urlSchemes: [],
  };

  for (const entry of entries) {
    const service = PERMISSION_KEYS[entry.key];
    if (service && typeof entry.value === "string") {
      facts.permissions.push({
        key: entry.key,
        service,
        purpose: entry.value,
        line: entry.line,
      });
      continue;
    }
    const label = ENTITLEMENT_LABELS[entry.key];
    if (label) {
      facts.capabilities.push({ key: entry.key, label, line: entry.line });
      continue;
    }
    if (entry.key === "UIBackgroundModes" && Array.isArray(entry.value)) {
      facts.backgroundModes = entry.value;
      continue;
    }
    if (entry.key === "CFBundleURLSchemes" && Array.isArray(entry.value)) {
      facts.urlSchemes.push(...entry.value);
      continue;
    }
    if (
      entry.key === "CFBundleIdentifier" &&
      typeof entry.value === "string" &&
      !entry.value.includes("$(")
    ) {
      facts.bundleIdentifier = entry.value;
    }
  }
  return facts;
}
