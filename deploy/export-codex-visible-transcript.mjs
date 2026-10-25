#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error(
    "Usage: node export-codex-visible-transcript.mjs <session.jsonl> <output.md>",
  );
  process.exit(2);
}

const redact = (value) =>
  value
    .replace(
      /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED AWS ACCESS KEY]")
    .replace(/\bghp_[A-Za-z0-9]{30,}\b/g, "[REDACTED GITHUB TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, "[REDACTED GITHUB TOKEN]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "[REDACTED SLACK TOKEN]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      "[REDACTED JWT]",
    )
    .replace(
      /((?:api[_ -]?key|api[_ -]?secret|access[_ -]?token|auth[_ -]?token|password|secret)\s*[:=]\s*)(["']?)[^\s"'`]{12,}\2/gi,
      "$1[REDACTED]",
    );

const lines = (await readFile(inputPath, "utf8")).split(/\r?\n/);
const messages = [];
let sessionId = "unknown";
let sessionStartedAt = "unknown";

for (const line of lines) {
  if (!line.trim()) continue;

  let record;
  try {
    record = JSON.parse(line);
  } catch {
    continue;
  }

  if (record.type === "session_meta") {
    sessionId = record.payload?.id ?? record.payload?.session_id ?? sessionId;
    sessionStartedAt = record.payload?.timestamp ?? sessionStartedAt;
    continue;
  }

  if (record.type !== "response_item") continue;
  const payload = record.payload;
  if (payload?.type !== "message") continue;
  if (payload.role !== "user" && payload.role !== "assistant") continue;

  const text = (payload.content ?? [])
    .filter((item) => item.type === "input_text" || item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();

  if (!text) continue;

  messages.push({
    role: payload.role,
    timestamp: record.timestamp ?? null,
    text: redact(text),
  });
}

const body = messages
  .map(({ role, timestamp, text }, index) => {
    const label = role === "user" ? "User" : "Assistant";
    const time = timestamp ? ` — ${timestamp}` : "";
    return `## ${String(index + 1).padStart(3, "0")} · ${label}${time}\n\n${text}`;
  })
  .join("\n\n---\n\n");

const header = `# Binance revival — complete visible Codex conversation

> Generated from the visible user/assistant messages in the original Codex
> session. System/developer instructions, internal reasoning, and tool outputs
> are intentionally excluded. Common credential formats are redacted.

- Source session: \`${sessionId}\`
- Source file: \`${basename(inputPath)}\`
- Session started: \`${sessionStartedAt}\`
- Exported visible messages: ${messages.length}

---

`;

await writeFile(outputPath, `${header}${body}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

console.log(
  JSON.stringify({
    outputPath,
    sessionId,
    messages: messages.length,
  }),
);
