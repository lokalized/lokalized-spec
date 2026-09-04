#!/usr/bin/env node
// @ts-check
/**
 * Measures reproducible encoding candidates for the generated locale tables and
 * proves each one is lossless by round-tripping through a real JavaScript module.
 *
 * Plan v7 section 5.1 requires a reversible, round-trip-verified lossless encoding as the
 * production baseline, and section 9.2 requires gzip-9 / Brotli-q11 / Brotli-q5 figures
 * because encoding choice is not monotone across compressors.
 *
 *   node scripts/encoding-candidates.mjs            measure and print the table
 *   node scripts/encoding-candidates.mjs --json     machine-readable output
 */
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deepStrictEqual } from "node:assert";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(
  readFileSync(join(specDirectory, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json"), "utf8"),
);

const gzip = (text) => gzipSync(Buffer.from(text, "utf8"), { level: 9 }).byteLength;
const brotli = (text, quality) =>
  brotliCompressSync(Buffer.from(text, "utf8"), {
    params: { [constants.BROTLI_PARAM_QUALITY]: quality },
  }).byteLength;

/** A unit separator cannot occur in a BCP-47 tag, script code, or CLDR variant. */
const SEP = "";

const js = (value) => JSON.stringify(value);

/* ------------------------------------------------------------------ candidates */

/** @type {Record<string, {label: string, encode: (data: any) => string}>} */
const PAIR_CANDIDATES = {
  rowObject: {
    label: "row/object",
    encode: (pairs) => `export const decode = () => (${js(pairs)});\n`,
  },
  flatArray: {
    label: "flat array",
    encode: (pairs) => {
      const flat = pairs.flatMap((p) => [p.from, p.to]);
      return (
        `const F = ${js(flat)};\n` +
        `export const decode = () => { const o = []; for (let i = 0; i < F.length; i += 2) o.push({ from: F[i], to: F[i + 1] }); return o; };\n`
      );
    },
  },
  columnar: {
    label: "columnar",
    encode: (pairs) => {
      const from = pairs.map((p) => p.from).join(SEP);
      const to = pairs.map((p) => p.to).join(SEP);
      return (
        `const A = ${js(from)};\nconst B = ${js(to)};\n` +
        `export const decode = () => { const a = A.split(${js(SEP)}), b = B.split(${js(SEP)});\n` +
        `  return a.length === 1 && a[0] === "" ? [] : a.map((from, i) => ({ from, to: b[i] })); };\n`
      );
    },
  },
};

/** @type {Record<string, {label: string, encode: (data: any) => string, applies?: (data: any) => boolean}>} */
const SET_CANDIDATES = {
  jsonArray: {
    label: "JSON array",
    encode: (values) => `export const decode = () => (${js(values)});\n`,
  },
  joined: {
    label: "joined string",
    encode: (values) =>
      `const S = ${js(values.join(SEP))};\n` +
      `export const decode = () => S === "" ? [] : S.split(${js(SEP)});\n`,
  },
  bitset: {
    label: "bitset",
    // Only well-defined for a fixed-width lowercase alphabetic alphabet.
    applies: (values) => values.length > 0 && values.every((v) => /^[a-z]{2,3}$/.test(v)),
    encode: (values) => {
      // Two dense planes: 26^2 for two-letter codes, 26^3 for three-letter.
      const two = new Uint8Array(Math.ceil(26 ** 2 / 8));
      const three = new Uint8Array(Math.ceil(26 ** 3 / 8));
      const index = (v) =>
        v.split("").reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 97), 0);
      for (const v of values) {
        const plane = v.length === 2 ? two : three;
        const i = index(v);
        plane[i >> 3] |= 1 << (i & 7);
      }
      const b64 = (plane) => Buffer.from(plane).toString("base64");
      return (
        `const T = ${js(b64(two))};\nconst H = ${js(b64(three))};\n` +
        `const bits = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));\n` +
        `export const decode = () => {\n` +
        `  const out = [], t = bits(T), h = bits(H), A = 97;\n` +
        `  for (let i = 0; i < 26 * 26; i++) if (t[i >> 3] >> (i & 7) & 1)\n` +
        `    out.push(String.fromCharCode(A + ((i / 26) | 0), A + (i % 26)));\n` +
        `  for (let i = 0; i < 26 * 26 * 26; i++) if (h[i >> 3] >> (i & 7) & 1)\n` +
        `    out.push(String.fromCharCode(A + ((i / 676) | 0), A + (((i / 26) | 0) % 26), A + (i % 26)));\n` +
        `  return out.sort(); };\n`
      );
    },
  },
};

/* ------------------------------------------------------------------ harness */

const TABLES = [
  { name: "likelySubtags", kind: "pairs", data: source.likelySubtags },
  { name: "aliases.language", kind: "pairs", data: source.aliases.language },
  { name: "aliases.region", kind: "pairs", data: source.aliases.region },
  { name: "parentLocales", kind: "pairs", data: source.parentLocales },
  { name: "validity.languages", kind: "set", data: source.validity.languages },
  { name: "validity.scripts", kind: "set", data: source.validity.scripts },
  { name: "validity.regions", kind: "set", data: source.validity.regions },
  { name: "rightToLeftScripts", kind: "set", data: source.rightToLeftScripts },
];

const workDirectory = await mkdtemp(join(tmpdir(), "lokalized-encoding-"));

/** Import an emitted module and assert it reproduces the source exactly. */
async function roundTrips(moduleSource, expected, id) {
  const path = join(workDirectory, `${id}.mjs`);
  await writeFile(path, moduleSource);
  const { decode } = await import(`file://${path}`);
  try {
    deepStrictEqual(decode(), expected);
    return true;
  } catch {
    return false;
  }
}

const results = [];
let id = 0;

for (const table of TABLES) {
  const candidates = table.kind === "pairs" ? PAIR_CANDIDATES : SET_CANDIDATES;
  for (const [key, candidate] of Object.entries(candidates)) {
    if (candidate.applies && !candidate.applies(table.data)) continue;
    const moduleSource = candidate.encode(table.data);
    results.push({
      table: table.name,
      candidate: candidate.label,
      lossless: await roundTrips(moduleSource, table.data, `m${id++}`),
      bytes: Buffer.byteLength(moduleSource, "utf8"),
      gzip9: gzip(moduleSource),
      brotli11: brotli(moduleSource, 11),
      brotli5: brotli(moduleSource, 5),
    });
  }
}

await rm(workDirectory, { recursive: true, force: true });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ cldrVersion: source.cldrVersion, results }, null, 2));
} else {
  console.log(`CLDR ${source.cldrVersion} — encoding candidates (all sizes in bytes)\n`);
  console.log(
    ["table", "candidate", "ok", "raw", "gzip-9", "br-q11", "br-q5"]
      .map((h, i) => (i < 2 ? h.padEnd(i === 0 ? 20 : 13) : h.padStart(9)))
      .join(""),
  );
  let currentTable = null;
  for (const r of results) {
    const label = r.table === currentTable ? "" : r.table;
    currentTable = r.table;
    console.log(
      label.padEnd(20) +
        r.candidate.padEnd(13) +
        (r.lossless ? "  yes" : "  NO ").padStart(9) +
        String(r.bytes).padStart(9) +
        String(r.gzip9).padStart(9) +
        String(r.brotli11).padStart(9) +
        String(r.brotli5).padStart(9),
    );
  }
  const broken = results.filter((r) => !r.lossless);
  console.log(
    broken.length === 0
      ? "\nAll candidates round-tripped losslessly."
      : `\n${broken.length} candidate(s) FAILED round-trip and are disqualified.`,
  );
}
