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
 * order — so two runs on two machines produce identical bytes. That is verified, not assumed:
 * `--check` rebuilds and compares.
 *
 *   node tools/data-archive.mjs --write | --check
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(spec, "dist");
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
  ["generated/iana-language-range-equivalents.json", "iana-language-range-equivalents.json"],
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
  console.log(JSON.stringify({ status: "written", archive: `dist/${prefix}.tar`, members: manifest.contents.length + 1, bytes: tar.length, sha256: sha256(tar) }));
} else {
  if (!existsSync(archivePath)) {
    console.error(JSON.stringify({ status: "missing", detail: "run --write" }));
    process.exit(1);
  }
  const onDisk = readFileSync(archivePath);
  if (!onDisk.equals(tar)) {
    console.error(JSON.stringify({ status: "stale-or-irreproducible", detail: "rebuild differs from dist/; run --write" }));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", archive: `dist/${prefix}.tar`, sha256: sha256(tar) }));
}
