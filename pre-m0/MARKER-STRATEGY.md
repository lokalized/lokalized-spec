# Frozen-plan requirement-marker strategy

## Purpose

`IMPLEMENTATION-PLAN-v7.md` is an immutable reviewed input. Its exact SHA-256 is
`4ace5e349bedd45b16cd87182aed3306d33fae92b034ed01ddb93bc733c5f62d`. Requirement
markers therefore live in a checked sidecar overlay rather than as comments inserted into the plan.
This preserves the plan hash used by the inventories, calibration, bootstrap, and capacity artifacts
while still materializing the clause-level marker contract in section 8.6.

The marker overlay is data, not an alternative source of requirements. Normative statement text,
parity class, milestones, profiles, and evidence expressions remain in the requirement registry or
reviewed inventory. Its discriminated entries materialize all three section 8.6 dispositions without
changing the plan: `registered` for minted M0 propositions, `deferred` for every remaining
selected-profile normative inventory block, and `nonnormative` for every reviewed nonnormative block.

## Artifact and hash direction

The binding direction is deliberately acyclic:

1. The marker overlay binds `sourcePlanSha256`, the selected profile, all three exact inventory files,
   and each disposition entry's source coordinates and hashes. Registered entries additionally bind
   their registry statement hashes.
2. The marker overlay does not contain the bootstrap artifact's path or hash.
3. The approved bootstrap binds the exact marker schema and overlay through path/SHA-256 pairs. It
   separately binds the executable registry-linter entrypoint. The linter is one self-contained ESM
   file whose only imports are the audited `node:` assert/buffer/crypto/fs/path/url/util allowlist;
   the graph's reserved dependency list is therefore empty, eliminating an unprovable
   declared-versus-actual dependency gap.
4. A linter receipt is produced after those inputs are fixed and may bind all of them without becoming
   an input to any of their hashes.

Artifact bindings use SHA-256 of the exact checked-in file bytes. A changed overlay or linter is a new
artifact identity and requires a new bootstrap approval or successor attestation as applicable; an
approved file is never silently rewritten in place.
Binding paths are canonical POSIX paths relative to `pre-m0/`; absolute, backslash, symlink, and
redundantly normalized paths are rejected so an approval remains portable to another clone.

## Marker representation

`requirement-markers.schema.json` defines the sidecar envelope and entry union. Source line numbers
are one-based and refer to the exact frozen plan bytes identified by `sourcePlanSha256`.
`sourceBlockSha256` uses the same convention as the bootstrap registry: hash the UTF-8 plan lines
covered by `inventoryId`, joined by LF with no added trailing LF. Registered-entry
`statementSha256` hashes the exact UTF-8 JCS encoding of the corresponding registry statement string,
including its JSON quotes and escapes.

For a registered entry, the line range locates one atomic clause inside its inventoried block. Multiple
atomic propositions may share a physical line or source block, so a source range alone is not identity.
The complete checked correspondence is the requirement ID, inventory ID, source-block hash, line
range, source anchor, and statement hash. A deferred entry instead carries the reviewed reduced
`registrationBefore` frontier, reviewer, and rationale. A nonnormative entry carries its reviewer and
rationale. Deferred and nonnormative entries cover their exact inventory block; they do not mint IDs.

Candidate registered entries may use temporary `BOOT-M0-NNNN` IDs while atomization and review are
in progress. They may also contain already-minted production IDs. Candidate IDs have no immutability
or acceptance status. An overlay with `status: "approved"` accepts only permanent
`LJ-<AREA>-NNN` registered IDs; the executable linter must reject approval if a temporary ID remains.

At bootstrap approval, every M0-frontier inventory block has exactly its reviewed
`anticipatedAtomicRecords` count of registered entries. Every other normative block—including
initial-slice M1/M3a/M2 work not yet minted—has exactly one deferred entry with its exact frontier.
Every reviewed nonnormative block has exactly one nonnormative entry. If atomization changes an M0
count, revise and reapprove the inventory and capacity basis instead of silently accepting drift.

## Bootstrap approval flow

1. Generate a candidate overlay from the reviewed inventory and bootstrap worklist without modifying
   the frozen plan. Seed one deferred or nonnormative entry for every block outside the M0 registered
   closure.
2. Atomize each selected M0-frontier proposition into one independently verifiable registry statement,
   then review its source coordinates and hashes.
3. Mint permanent production IDs and replace every temporary marker ID. The registry's `sourceMarker`
   value is the same permanent ID represented by the corresponding sidecar marker.
4. Validate the approved whole-plan overlay with the exact bound schema and executable registry
   linter.
5. Hash the exact schema, overlay, and self-contained linter entrypoint. Record those bindings and the
   required empty dependency list in the approved bootstrap.
6. Run the linter against the now-bound bootstrap and retain its machine-readable receipt with the
   approval evidence.

The outer readiness validator executes that entrypoint under Node's permission model (selecting the
stable or legacy experimental flag supported by the running Node 22+ release) with filesystem
read access limited to the entrypoint and the exact bound plan, inventory, marker, schema, and
bootstrap bytes. An undeclared helper import therefore fails at execution even if it is disguised by
comments or dynamic syntax; filesystem writes, child processes, workers, and native addons remain
denied. The static contract also rejects global network and dynamic builtin-loader surfaces because
Node's permission model does not fence network access.

The initial selection record that binds the exact bootstrap hash is the batch approval record. Its
fixed reviewer attestation means the named reviewer checked completeness, atomicity, source mapping,
verification classification, evidence expressions, and per-record review statuses across those exact
bytes. Its fixed owner attestation means the named decision owner approved that exact batch and all
records marked `decision-owner-approved`. An approved selection without both identities, the strict
timestamp, and both fixed attestation values fails closed.

The same mechanism can produce later sidecar revisions for the rest of the initial slice and deferred
registration batches. It does not authorize changing revision 7 of the plan.

## Executable linter contract

Schema validation is necessary but cannot prove cross-file correspondence. The exact linter bound by
the approved bootstrap must fail closed unless all of the following are true:

- the plan bytes hash to the overlay's exact `sourcePlanSha256`, the selected profile matches, and the
  three source-inventory bindings equal the reviewed inventory set in validator order;
- the overlay status is `approved`, every ID has production form, and requirement IDs are unique;
- every `inventoryId` resolves to exactly one reviewed inventory block;
- every line range is ordered, lies within both the frozen plan and its inventory block, and its
  `sourceAnchor` agrees with the reviewed atomic-clause mapping;
- every `sourceBlockSha256` recomputes from the frozen plan and equals both the inventory-derived value
  and the corresponding registry value;
- each approved bootstrap requirement has exactly one registered entry, each registered entry names
  exactly one bootstrap requirement, and no unknown, duplicate, or omitted ID exists on either side;
- each marker's source coordinates and anchor equal its registry record, its `requirementId` equals the
  registry ID and `sourceMarker`, and its `statementSha256` equals both the registry field and a fresh
  hash of the registry statement's JCS string encoding; and
- every M0 inventory block has exactly its reviewed atomic count of registered entries;
- every remaining selected-profile normative inventory block has exactly one deferred entry whose
  frontier equals the reviewed inventory, and every nonnormative inventory block has exactly one
  reviewed nonnormative entry; and
- the registered, deferred, and nonnormative classes are mutually exclusive per inventory block and
  together cover the entire reviewed plan inventory.

This is one-to-one source/statement/ID correspondence. The linter does not infer semantic atomicity;
the human review attestation remains authoritative for deciding where one proposition ends and another
begins.

## Receipt

Every linter run emits a machine-readable receipt. A passing receipt records at least:

- receipt format version and pass/fail status;
- exact plan, canonical inventory-set, marker-schema, marker-overlay, bootstrap-registry, and
  canonical linter-graph SHA-256 values; the graph contains the entrypoint and required empty
  dependency list;
- selected release-profile identity;
- requirement and registered/deferred/nonnormative marker counts, total/covered inventory-block
  counts, plus the SHA-256 of the JCS-encoded exact sorted production-ID set;
- the recomputed source-block and statement-hash check counts; and
- an empty error list.

A failing receipt records the same available input identities and deterministic error codes but is not
approval evidence. Volatile timestamps, durations, and host details may accompany a receipt as
attestation metadata, but they are excluded from any canonical reproducibility comparison.

## Change handling

Revision 7 remains frozen. If its wording must change, create a new plan revision with a new plan hash,
inventory, marker overlay, and bootstrap decision rather than rebasing this overlay. A registry
statement or source mapping change after approval follows the registry migration rules and produces a
new content-addressed overlay plus successor selection attestation. Retired requirement IDs remain
tombstones and are never reassigned.
