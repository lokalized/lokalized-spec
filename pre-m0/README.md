# Pre-M0 readiness artifacts

These files implement the readiness work required by revision 7 before the formal M0 start. The
current drafts are not evidence that M0 has started.

The workflow is:

1. classify every normative plan block as part of the initial M0/M1/M3a/M2 registration slice,
   deferred to a later frontier, or reviewed nonnormative material;
2. review the anticipated atomic-record count for every initial-slice block;
3. mint and review the production M0-frontier bootstrap requirements;
4. freeze the selected release profile and initial selection record against the bootstrap registry;
5. run the production calibration with the named implementer, human reviewer, and human decision
   owner, recording their active minutes separately; and
6. approve the human-attention cap, commit the exact start record, and thereby start M0.

Current status: the three-part inventory is machine-valid and its independent agent reconciliation is
complete. It projects 1,835 records in the complete initial registration slice and 1,210 records in
the M0-frontier bootstrap. `bootstrap-worklist.json` preserves the 186 M0 source blocks that must be
split into those atomic candidates; it is a deterministic worklist, not an approved requirement
registry. The earlier agent-only throughput measurement projects 702.4242375 agent minutes for the
complete slice after the 1.5× contingency, but that figure does not measure human capacity. The named
production implementer, human reviewer, human decision owner, human inventory approval, production
human-attention calibration, and binding capacity cap remain outstanding, so M0 is not yet active.

## Start here

- `INVENTORY-REVIEW.md` explains the reconciled inventory, counting policy, and remaining human gate.
- `bootstrap-worklist.json` is the exact M0 atomization queue; regenerate or check it with
  `node pre-m0/make-bootstrap-worklist.mjs --write` or `--check`.
- `PRODUCTION-CALIBRATION-RUNBOOK.md` and `production-calibration-record.template.json` define the
  named-human calibration run; `tooling-estimate-evidence.template.json` keeps the separately
  estimated schema/linter/tooling allowance explicitly human-only.
- `MARKER-STRATEGY.md` and `requirement-markers.schema.json` define the sidecar registered,
  deferred, and nonnormative markers that preserve the frozen plan bytes while checking whole-plan
  disposition coverage.
- `capacity-record.draft.json`, `roles.draft.json`, `release-profiles.draft.json`, and
  `selection-record.draft.json` are deliberately unapproved drafts. Do not fill approval fields with
  agent identities or inferred names.
- `node pre-m0/readiness.mjs --report-only` reports the remaining gates. Running
  `node pre-m0/readiness.mjs` without that flag is the fail-closed assertion and exits nonzero until
  every formal prerequisite is valid, approved, and the exact capacity/start record is committed at
  `HEAD`. A zero-blocker receipt therefore reports `formal-m0-started-and-valid`; it is not a separate
  preapproval state.
- `CHECKSUMS.sha256` seals this readiness package, the frozen v7 plan, the calibration report, and the
  registry-calibration manifest. Verify it from the project root with
  `shasum -a 256 -c pre-m0/CHECKSUMS.sha256`.

The next authorized production action is to name the three human roles and schedule the calibration.
Atomizing the 186 worklist blocks into `bootstrap.requirements.candidate.json` can then proceed under
those roles; the candidate registry must be reviewed and decision-owner-approved before M0 starts.

## Formal-start boundary

The M0 bootstrap must contain exactly 1,210 production records unless the reviewed inventory and its
capacity derivations are revised and reapproved. Approved records use permanent `LJ-<AREA>-NNN` IDs,
an explicit runtime/non-runtime verification class, the six evidence kinds in revision 7, and exact
per-inventory-block count reconciliation. Runtime-behavior records conservatively forbid
`decision-record` evidence.

The approved bootstrap binds the marker schema, marker overlay, and one self-contained linter
entrypoint whose only imports are the audited `node:` assert/buffer/crypto/fs/path/url/util built-ins.
The reserved dependency list must be
empty. The overlay must cover every reviewed inventory block: M0 propositions are
registered, all remaining normative blocks are marked deferred to their exact frontier, and every
nonnormative block is explicitly reviewed. The linter receipt binds the complete inventory set,
schema, linter graph, selected profile, canonical production-ID set, check counts, and an empty error
list.

The initial selection approval is also the machine-visible batch attestation for the exact bootstrap
hash it binds. Its named human reviewer attests that every record's completeness, atomicity, source
mapping, verification classification, evidence expression, and `reviewStatus` were checked; its named
decision owner attests approval of that exact batch and every `decision-owner-approved` status. The
two fixed attestation values, identities, and timestamp must all be present. This initial record has a
null predecessor; successor attestations are created only by the later registry-migration workflow.

Capacity approval is also the start event. It binds the exact roles, inventory review, calibration,
profile registry, bootstrap, and selection; an itemized evidence-backed estimate for all other M0
work; the M0 and provisional M2 envelopes; and the fixed trip-wire policy. The frozen-input approval
commit must contain all validators, schemas, inventories, tools, and evidence, and the final
approved-and-started capacity record must itself be present unchanged at `HEAD` on a descendant
commit.

The Git ancestry, not the record's own history claim, proves this is the first start. Certification
therefore fails closed in a shallow repository; complete local ancestry is required. `approvalCommit`
must contain a recognized pre-start capacity snapshot with an empty event log and no earlier approved
capacity ancestor. From that commit through `HEAD`, the first approved capacity blob must be the exact
current blob and may never change or regress. A later envelope therefore cannot omit declared history
and impersonate the original start receipt.

The transition is one atomic capacity-changing commit. Relative to the pre-start snapshot, only the
status, null-to-commit `approvalCommit` binding, empty-to-single start event, and cleared blocking
reasons may change. Envelopes, allowances, commitments, scope, identities, hashes, trip-wire policy,
and ledger source are already human-approved at `approvalCommit` and must remain canonically identical
in the start blob. Predecessor/history links may append the authenticated approval snapshot; their
separate committed-byte, prefix, and ancestry checks remain authoritative.

Pre-start history may contain authenticated draft revisions, but every such draft has an empty event
log. The first approved record contains exactly one event: its bound M0 start. Later capacity revisions
append `{capacitySha256, commit}` entries whose committed bytes, predecessor links, history prefixes,
event-log prefixes, commit ancestry, and new-envelope references all verify. Status cannot regress
after formal start. Future checkpoint, pause, rebaseline, toll, and exit events therefore cannot be
preloaded into the formal-start receipt; they arrive only in versioned successors governed by the M0
lifecycle checker.

This readiness validator deliberately certifies only the first approved start. If an approved start is
already present in committed history, it fails with an out-of-scope blocker instead of partially
re-certifying a successor; the M0 lifecycle validator must validate that later state.

After formal start, changing any M0 target, commitment, effort allowance/cap, threshold, or M2
duration/cap requires a newly appended `new-envelope` event for the affected gate. That event must
name the immediate predecessor capacity hash; authenticated history alone cannot silently reset or
expand an envelope. The usage-ledger source is immutable because no ledger-migration event is defined;
changing counted categories or itemized other-M0 scope requires a reviewed M0 claim-cut or immediate-
predecessor new-envelope event.

`capacity-record.schema.json` already defines labeled start/checkpoint/pause/rebaseline/toll/exit
events, gate-local effort, and the atomic M0-exit/M2-start transition. The time-aware CI checker that
detects overdue 50% checkpoints and 100% stops is an M0 implementation deliverable, not a pre-start
claim. Its estimated human work, owner, and evidence basis must be included among the other-M0 work
items before the cap is approved, and it must ship before the first checkpoint or M0 exit.
