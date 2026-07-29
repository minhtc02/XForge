/**
 * Secret redaction & sensitive-file filtering (blueprint §7, §23).
 *
 * Two responsibilities:
 *  1. Decide whether a file is sensitive enough that its *contents* must never
 *     be read, prompted, logged, or embedded in evidence/docs.
 *  2. Redact secret-looking substrings from any text that does flow into
 *     prompts, logs, evidence, project model, or generated docs.
 *
 * The redactor is intentionally conservative: false positives (over-redacting)
 * are acceptable; leaking a real secret is not.
 */

/** Glob-ish suffixes / names whose file contents must never be read. */
export const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[^/]*)?$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.key$/i,
  /\.keystore$/i,
  /\.mobileprovision$/i,
  /\.cer$/i,
  /(^|\/)GoogleService-Info\.plist$/i,
  /(^|\/)Secrets\.swift$/i,
  /(^|\/)secrets?\.(ya?ml|json|txt)$/i,
  /(^|\/)credentials?(\.[^/]*)?$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.p8$/i,
];

/**
 * Return true if the given path points at a file whose contents are considered
 * sensitive and must not be read/ingested.
 */
export function isSensitiveFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return SENSITIVE_FILE_PATTERNS.some((re) => re.test(normalized));
}

/** Placeholder inserted in place of a redacted secret. */
export const REDACTION_PLACEHOLDER = "«redacted»";

interface RedactionRule {
  name: string;
  pattern: RegExp;
  /** Build the replacement, optionally keeping a non-secret prefix/label. */
  replace: (match: string, ...groups: string[]) => string;
}

const KEEP = (label: string) => `${label}${REDACTION_PLACEHOLDER}`;

/**
 * Ordered redaction rules. Each pattern uses the global flag so `String.replace`
 * covers every occurrence. Rules that capture a leading label keep it so the
 * surrounding text stays readable (e.g. `Authorization: Bearer «redacted»`).
 */
const RULES: RedactionRule[] = [
  // PEM / private key blocks (multi-line).
  {
    name: "private-key-block",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () =>
      `-----BEGIN PRIVATE KEY-----${REDACTION_PLACEHOLDER}-----END PRIVATE KEY-----`,
  },
  // Authorization: Bearer <token>
  {
    name: "bearer-token",
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/g,
    replace: (_m, prefix) => KEEP(prefix ?? "Bearer "),
  },
  // Basic auth header
  {
    name: "basic-auth",
    pattern: /\b(Basic\s+)[A-Za-z0-9+/]{12,}=*/g,
    replace: (_m, prefix) => KEEP(prefix ?? "Basic "),
  },
  // AWS access key id
  {
    name: "aws-access-key-id",
    pattern: /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
  // GitHub tokens
  {
    name: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
  // Slack tokens
  {
    name: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
  // Google API key
  {
    name: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
  // Private key / secret assignment: apiKey = "...", "client_secret": "...", etc.
  {
    name: "secret-assignment",
    pattern:
      /(["']?(?:api[_-]?key|secret|client[_-]?secret|password|passwd|token|access[_-]?token|private[_-]?key|auth[_-]?token)["']?\s*[:=]\s*)(["'])([^"'\n]{6,})(["'])/gi,
    replace: (_m, prefix, open) =>
      `${prefix}${open}${REDACTION_PLACEHOLDER}${open}`,
  },
  // JWTs (three base64url segments)
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
];

export interface RedactionResult {
  text: string;
  /** Rule names that fired at least once. */
  redactions: string[];
}

/** Redact secrets from text, reporting which rule categories fired. */
export function redactWithReport(input: string): RedactionResult {
  let text = input;
  const fired: string[] = [];
  for (const rule of RULES) {
    let matched = false;
    text = text.replace(rule.pattern, (...args) => {
      matched = true;
      // args: match, ...groups, offset, whole, [namedGroups]
      const groups = args.slice(1, -2) as string[];
      return rule.replace(args[0] as string, ...groups);
    });
    if (matched) fired.push(rule.name);
  }
  return { text, redactions: fired };
}

/** Redact secrets from a string, returning only the sanitized text. */
export function redact(input: string): string {
  return redactWithReport(input).text;
}

/** True if the text still appears to contain a secret after redaction attempts. */
export function containsSecret(input: string): boolean {
  return redactWithReport(input).redactions.length > 0;
}
