#!/usr/bin/env node
// @ts-check
/**
 * Emits the candidate range space the JDK oracle is probed with.
 *
 * Kept separate and deterministic because the candidate space is part of the artifact's provenance:
 * a closure is only as complete as the inputs it was probed with, so the space is hashed and locked
 * alongside the result.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spec = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const locale = JSON.parse(
  readFileSync(join(spec, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json"), "utf8"),
);

const candidates = new Set(locale.validity.languages);
for (const group of Object.values(locale.aliases)) {
  for (const { from, to } of /** @type {{from: string, to: string}[]} */ (group)) {
    for (const tag of [from, to]) {
      candidates.add(tag);
      for (const part of tag.split("-")) candidates.add(part);
    }
  }
}
// Extlang equivalences live under a macrolanguage prefix, so probe those combinations explicitly.
const PREFIXES = ["ar", "cmn", "i", "kok", "ms", "no", "sgn", "sr", "sw", "uz", "yue", "zh"];
const languages = [...locale.validity.languages].filter((l) => l.length >= 2 && l.length <= 3);
for (const prefix of PREFIXES) for (const l of languages) candidates.add(`${prefix}-${l}`);

const clean = [...candidates].filter((c) => c && /^[A-Za-z0-9-]+$/.test(c)).sort();
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "candidates.txt"), `${clean.join("\n")}\n`);
console.log(JSON.stringify({ candidates: clean.length, prefixes: PREFIXES.length }));
