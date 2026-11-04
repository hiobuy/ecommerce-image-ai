import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scrubSecrets } from "../shared/scrub.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(full);
    return [full];
  }));
  return files.flat();
}

test("scrub removes bearer tokens and the configured key", () => {
  const secret = "custom-secret-value-123";
  const scrubbed = scrubSecrets({
    message: `token ${secret} and Bearer abc.def hio_live_abcdef`,
    authorization: "Bearer abc",
  }, [secret]);
  assert.equal(JSON.stringify(scrubbed).includes(secret), false);
  assert.equal(JSON.stringify(scrubbed).includes("hio_live_abcdef"), false);
  assert.equal(JSON.stringify(scrubbed).includes("Bearer abc"), false);
});

test("source does not store the API key in the browser", async () => {
  const paths = [
    ...await filesIn(path.join(root, "client/src")),
    ...await filesIn(path.join(root, "server/src")),
    ...await filesIn(path.join(root, "shared")),
  ];
  for (const file of paths) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /hio_(live|test)_[A-Za-z0-9]+/);
    assert.doesNotMatch(text, /localStorage|sessionStorage/);
  }
  for (const file of [path.join(root, "README.md"), path.join(root, ".env.example")]) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /hio_(live|test)_[A-Za-z0-9]+/);
  }
});

test("browser fetches in the client stay on the local demo API", async () => {
  const sources = await filesIn(path.join(root, "client/src"));
  for (const file of sources) {
    const text = await readFile(file, "utf8");
    const fetches = text.match(/fetch\(\s*[`'"]([^`'"]+)/g) ?? [];
    for (const match of fetches) assert.match(match, /\/api/);
  }
});
