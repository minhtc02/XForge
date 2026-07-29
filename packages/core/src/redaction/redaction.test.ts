import { describe, expect, it } from "vitest";
import {
  containsSecret,
  isSensitiveFile,
  redact,
  redactWithReport,
  REDACTION_PLACEHOLDER,
} from "./index.js";

describe("isSensitiveFile", () => {
  it.each([
    ".env",
    "config/.env.local",
    "certs/key.pem",
    "AuthKey.p8",
    "profile.mobileprovision",
    "App/GoogleService-Info.plist",
    "Sources/Secrets.swift",
    "secrets.yaml",
    "config/credentials",
    "id_rsa",
  ])("flags %s as sensitive", (path) => {
    expect(isSensitiveFile(path)).toBe(true);
  });

  it.each([
    "Sources/App/AlarmView.swift",
    "README.md",
    "docs/prd.md",
    "env.ts",
    "environment.swift",
  ])("does not flag %s", (path) => {
    expect(isSensitiveFile(path)).toBe(false);
  });

  it("handles Windows separators", () => {
    expect(isSensitiveFile("App\\GoogleService-Info.plist")).toBe(true);
  });
});

describe("redact", () => {
  it("redacts bearer tokens while keeping the label", () => {
    const out = redact("Authorization: Bearer abcdef1234567890XYZ");
    expect(out).toBe(`Authorization: Bearer ${REDACTION_PLACEHOLDER}`);
    expect(out).not.toContain("abcdef1234567890XYZ");
  });

  it("redacts secret assignments in code", () => {
    const out = redact('let apiKey = "sk-1234567890abcdef"');
    expect(out).toContain(REDACTION_PLACEHOLDER);
    expect(out).not.toContain("sk-1234567890abcdef");
  });

  it("redacts JSON client_secret", () => {
    const out = redact('{"client_secret": "supersecretvalue123"}');
    expect(out).not.toContain("supersecretvalue123");
  });

  it("redacts AWS access key ids", () => {
    expect(redact("key AKIAIOSFODNN7EXAMPLE here")).not.toContain(
      "AKIAIOSFODNN7EXAMPLE",
    );
  });

  it("redacts GitHub tokens", () => {
    const token = "ghp_" + "a".repeat(36);
    expect(redact(`token: ${token}`)).not.toContain(token);
  });

  it("redacts Google API keys", () => {
    const key = "AIza" + "B".repeat(35);
    expect(redact(key)).not.toContain(key);
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1Ni.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4";
    expect(redact(`jwt=${jwt}`)).not.toContain(jwt);
  });

  it("redacts PEM private key blocks", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA1234567890",
      "abcdefghijklmnopqrstuvwxyz",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const out = redact(pem);
    expect(out).not.toContain("MIIEpAIBAAKCAQEA1234567890");
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it("leaves ordinary text untouched", () => {
    const text = "AlarmScheduler schedules a UNUserNotification at 08:00.";
    expect(redact(text)).toBe(text);
  });

  it("reports which rules fired", () => {
    const { redactions } = redactWithReport(
      'Bearer abcdef1234567890 and apiKey="longsecret123"',
    );
    expect(redactions).toContain("bearer-token");
    expect(redactions).toContain("secret-assignment");
  });

  it("containsSecret detects presence", () => {
    expect(containsSecret('password = "hunter2secret"')).toBe(true);
    expect(containsSecret("just some prose")).toBe(false);
  });
});
