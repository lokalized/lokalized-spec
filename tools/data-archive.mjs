#!/usr/bin/env node
// @ts-check
/**
 * Stages the reproducible data-only archive required by plan v7 M1.
 *
 * "Data-only" means exactly the language-neutral artifacts a non-JVM implementation needs, plus the
 * locks that pin them. No source, no tooling, no tests.
 *
 * "Reproducible" is taken literally: the tar is written here rather than shelled out to `tar`,
 * because GNU and BSD tar differ and both embed environment-dependent metadata by default. Every
 * variable field is fixed — mtime 0, uid/gid 0, empty uname/gname, mode 0644, entries in sorted
 * order — so two runs on two machines produce identical bytes.
 *
 * TWO MACHINES is the half that went unchecked until 2026-09-20. `dist/` is gitignored, so `--check`
 * compared a rebuild against a tar that only ever existed on the machine that wrote it: locally that
 * catches an edited input nobody re-archived, in CI it reported `missing` and exited 1 on every run
 * — which is why the gate had never actually executed there. The archive's bytes are a function of
 * committed inputs alone, so its digest is deterministic and machine-independent, and it is now
 * RECORDED in `generated/data-archive-lock.json` and compared on every `--check`. That arm needs no
 * `dist/`, so it runs in CI, and it is the first thing here that can fail when two machines disagree.
 *
 * `--check` therefore has two arms, and reports which ran:
 *   - lock     — rebuild vs the committed digest. Always. A missing lock FAILS; absence is never
 *                agreement.
 *   - on-disk  — rebuild vs `dist/`, when a local archive exists. Unchanged, and still the arm that
 *                notices a stale local file.
 *
 *   node tools/data-archive.mjs --write | --check
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(spec, "dist");
const lockPath = join(spec, "generated", "data-archive-lock.json");
const vendorRoot = "vendor/lokalized-java/src/build/resources/cldr";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jcs = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`;
};

/** Source path -> path inside the archive. Sorted by archive path before writing. */
const MEMBERS = [
  [`${vendorRoot}/cldr-locale-data.json`, "cldr-locale-data.json"],
  [`${vendorRoot}/cldr-plural-data.json`, "cldr-plural-data.json"],
  [`${vendorRoot}/cldr-conformance-vectors.json`, "cldr-conformance-vectors.json"],
  ["generated/cldr-data-lock.json", "cldr-data-lock.json"],
  ["generated/iana-language-equivalences.json", "iana-language-equivalences.json"],
  ["generated/iana-data-lock.json", "iana-data-lock.json"],
  ["generated/IANA-PROVENANCE.md", "IANA-PROVENANCE.md"],
  ["THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md"],
  ["LICENSE", "LICENSE"],
];

/** One 512-byte ustar header with every environment-dependent field pinned. */
function header(name, size) {
  const buf = Buffer.alloc(512);
  const put = (text, offset, length) => buf.write(text.slice(0, length - 1), offset, "utf8");
  const octal = (value, offset, length) => buf.write(value.toString(8).padStart(length - 1, "0"), offset, "ascii");

  if (Buffer.byteLength(name) > 99) throw new Error(`archive member name too long for ustar: ${name}`);
  put(name, 0, 100);
  octal(0o644, 100, 8);
  octal(0, 108, 8); // uid
  octal(0, 116, 8); // gid
  octal(size, 124, 12);
  octal(0, 136, 12); // mtime — fixed, this is the usual source of irreproducibility
  buf.write("        ", 148, "ascii"); // checksum placeholder: spaces during computation
  buf.write("0", 156, "ascii"); // typeflag: regular file
  buf.write("ustar\0", 257, "binary");
  buf.write("00", 263, "ascii");
  // uname/gname deliberately empty: they leak the building account otherwise.
  octal(0, 329, 8);
  octal(0, 337, 8);

  let checksum = 0;
  for (const byte of buf) checksum += byte;
  buf.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return buf;
}

function build() {
  const cldrVersion = JSON.parse(readFileSync(join(spec, vendorRoot, "cldr-locale-data.json"), "utf8")).cldrVersion;
  const prefix = `lokalized-data-${cldrVersion}`;

  const entries = MEMBERS.map(([source, archived]) => {
    const full = join(spec, source);
    if (!existsSync(full)) throw new Error(`missing archive member: ${source}`);
    return { archived, bytes: readFileSync(full) };
  });

  // An in-archive manifest, so the archive is self-describing once detached from this repo.
  const manifest = {
    formatVersion: 1,
    cldrVersion,
    contents: entries
      .map((e) => ({ path: e.archived, bytes: e.bytes.length, sha256: sha256(e.bytes) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
  entries.push({ archived: "MANIFEST.json", bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") });

  entries.sort((a, b) => a.archived.localeCompare(b.archived));

  const chunks = [];
  for (const entry of entries) {
    chunks.push(header(`${prefix}/${entry.archived}`, entry.bytes.length));
    chunks.push(entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024)); // two zero blocks terminate a tar

  return { prefix, tar: Buffer.concat(chunks), manifest };
}

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: node tools/data-archive.mjs --write | --check");
  process.exit(2);
}

const { prefix, tar, manifest } = build();
const archivePath = join(distDir, `${prefix}.tar`);

/** The committed record of what a correct build produces. Not an archive member — it names the archive. */
const lockFor = (bytes) => ({
  formatVersion: 1,
  note: "Digest of the reproducible data-only archive. dist/ is gitignored, so this is the only committed record of what tools/data-archive.mjs must produce. Regenerate with --write.",
  archive: `dist/${prefix}.tar`,
  prefix,
  cldrVersion: manifest.cldrVersion,
  members: manifest.contents.length + 1,
  bytes: bytes.length,
  sha256: sha256(bytes),
});

if (mode === "write") {
  mkdirSync(distDir, { recursive: true });
  writeFileSync(archivePath, tar);
  // Rebuild immediately and compare: reproducibility claimed without checking is not a claim.
  const again = build().tar;
  if (!again.equals(tar)) {
    console.error("archive is NOT reproducible: two builds in the same process differ");
    process.exit(1);
  }
  writeFileSync(join(distDir, `${prefix}.tar.sha256`), `${sha256(tar)}  ${prefix}.tar\n`);
  writeFileSync(lockPath, `${JSON.stringify(lockFor(tar), null, 2)}\n`);
  console.log(JSON.stringify({ status: "written", archive: `dist/${prefix}.tar`, lock: "generated/data-archive-lock.json", members: manifest.contents.length + 1, bytes: tar.length, sha256: sha256(tar) }));
} else {
  const arms = [];

  // Arm 1: the committed digest. Machine-independent, needs no dist/, so this is the arm CI runs.
  if (!existsSync(lockPath)) {
    console.error(JSON.stringify({ status: "no-lock", detail: "generated/data-archive-lock.json is absent; run --write. A check with nothing to compare against has not passed, it has not run." }));
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const rebuilt = lockFor(tar);
  const drifted = Object.keys(rebuilt)
    .filter((k) => k !== "note")
    .filter((k) => JSON.stringify(lock[k]) !== JSON.stringify(rebuilt[k]))
    .map((k) => ({ field: k, recorded: lock[k] ?? null, rebuilt: rebuilt[k] }));
  if (drifted.length > 0) {
    console.error(JSON.stringify({ status: "lock-drift", detail: "a rebuild does not reproduce the committed archive digest; if an input changed deliberately, run --write", drifted }, null, 2));
    process.exit(1);
  }
  arms.push("lock");

  // Arm 2: the local archive, when there is one. Absent in CI by design — dist/ is gitignored.
  if (existsSync(archivePath)) {
    if (!readFileSync(archivePath).equals(tar)) {
      console.error(JSON.stringify({ status: "stale-or-irreproducible", detail: "rebuild differs from dist/; run --write" }));
      process.exit(1);
    }
    arms.push("on-disk");
  }

  console.log(JSON.stringify({ status: "current", archive: `dist/${prefix}.tar`, sha256: sha256(tar), checked: arms }));
}
