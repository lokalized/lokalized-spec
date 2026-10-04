#!/usr/bin/env node
// Development-only independent observations from the pinned JS source snapshot.
// This file does not implement manifest semantics or run a network loader.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const [sourceDirectory, inputPath] = process.argv.slice(2);
if (!sourceDirectory || !inputPath || process.argv.length !== 4)
  throw new Error("Usage: manifest_contract_oracle.mjs SOURCE_DIRECTORY INPUT_JSON");
const source = (path) => pathToFileURL(resolve(sourceDirectory, path)).href;
const manifest = await import(source("src/load/manifest.js"));
const identity = await import(source("src/load/identity.js"));
const planning = await import(source("src/load/planning.js"));
const runPlan = await import(source("src/load/run-plan.js"));
const { decode } = await import(source("src/data/provenance.js"));
const { RUNTIME_METADATA } = await import(source("src/internal/runtime-metadata.js"));
const pinned = decode();
const buildIdentity = {
  cldrVersion: pinned.cldrVersion,
  dataFingerprint: pinned.dataFingerprint,
  behavioralVectorsVersion: RUNTIME_METADATA.behavioralVectorsVersion,
  localeDataMode: RUNTIME_METADATA.localeDataMode,
  cardinalityMode: RUNTIME_METADATA.cardinalityMode,
  ianaRegistryDate: RUNTIME_METADATA.ianaRegistryDate,
  ianaDataFingerprint: RUNTIME_METADATA.ianaDataFingerprint,
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function errorObservation(error, depth = 0) {
  if (!(error instanceof Error) || depth > 4)
    throw new Error("Oracle raised an unregistered non-Error or cyclic/deep cause");
  const observation = { name: error.name, message: error.message };
  for (const name of ["code", "source", "line", "column", "path"])
    if (name in error) observation[name] = error[name];
  if ("cause" in error && error.cause !== undefined)
    observation.cause = errorObservation(error.cause, depth + 1);
  return observation;
}
function identityObservation(input) {
  const bytes = identity.catalogIdentityBytes(input);
  const result = identity.computeCatalogIdentity(input);
  if (sha256(bytes) !== result.catalogFingerprint)
    throw new Error("Independent Node SHA-256 disagrees with library identity");
  return {
    identity: result,
    projection: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    canonicalBytesBase64: Buffer.from(bytes).toString("base64"),
    byteCount: bytes.length,
    sha256: sha256(bytes),
  };
}
function observe(row) {
  const input = row.input;
  const options = "optionsJSON" in input ? JSON.parse(input.optionsJSON) : undefined;
  try {
    let value;
    switch (row.operation) {
    case "validateStringsManifest":
      value = manifest.validateStringsManifest(JSON.parse(input.manifestJSON), options); break;
    case "parseStringsManifest":
      value = manifest.parseStringsManifest(input.carrier === "text" ? input.text
        : new Uint8Array(Buffer.from(input.documentBase64, "base64")), options); break;
    case "localeConfigurationForManifest":
      value = manifest.localeConfigurationForManifest(JSON.parse(input.manifestJSON), options); break;
    case "computeCatalogIdentity":
      value = identityObservation(JSON.parse(input.identityInputJSON)); break;
    case "identityForManifest": {
      const projected = identity.catalogIdentityInputFor(JSON.parse(input.manifestJSON));
      value = { input: projected, ...identityObservation(projected) }; break;
    }
    case "chain":
      value = planning.chain(JSON.parse(input.manifestJSON), input.lookupLocale, options); break;
    case "fetchSet":
      value = planning.fetchSet(JSON.parse(input.manifestJSON), input.lookupLocale, options); break;
    case "wholeManifestPlan":
      value = runPlan.wholeManifestPlan(manifest.validateStringsManifest(JSON.parse(input.manifestJSON), options)); break;
    default: throw new Error("Unregistered oracle operation: " + row.operation);
    }
    return { outcome: "returned", value };
  } catch (error) {
    return { outcome: "threw", error: errorObservation(error) };
  }
}
const inputs = JSON.parse(readFileSync(inputPath, "utf8"));
const output = {
  nodeVersion: process.version,
  buildIdentity,
  cases: inputs.map((row) => ({ ...row, expected: observe(row) })),
};
process.stdout.write(JSON.stringify(output, null, 2) + "\n");
