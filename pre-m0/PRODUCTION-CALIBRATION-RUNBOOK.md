# Production registry calibration runbook

Status: ready to schedule; not yet run

This reruns the section 2.2 calibration with the people and workflow that will be used for production
registration. Its purpose is to measure the scarce capacity named by plan section 10.4: active human
implementer, reviewer, and decision-owner attention. Agent wall time is captured separately and never
substituted for human time.

## Preconditions

- Name the production implementer, human reviewer, and human decision owner in `roles.draft.json`.
- Assign a unique `runId` and bind the exact approved role file with `rolesSha256`.
- Freeze the candidate production registry schema, source-marker grammar, and validation tool. The
  calibration validator must be a self-contained single-file entrypoint whose only imports are
  from the audited `node:` assert/buffer/crypto/fs/path/url/util allowlist. The outer readiness check
  selects the stable or legacy experimental permission flag supported by the running Node 22+ release
  and limits reads to exact bound inputs; undeclared helpers therefore fail closed.
- Record a canonical POSIX path relative to `pre-m0/` plus SHA-256 for the schema, grammar, validator,
  accepted scratch registry, annotated source, and monotonic timer log (`../registry-calibration/...`
  is valid; absolute paths and redundant `./` segments are not). Record SHA-256 for the plan and exact
  section 2.2 bytes.
- Start from `production-calibration-record.draft.json`; do not treat the earlier
  `REGISTRY-EFFORT-CALIBRATION.md` agent dry run as the production calibration.
- Use a timer that exposes monotonic start/stop values from one uninterrupted timing process. UTC
  timestamps may be recorded for auditability but are not the measured clock.
- Do not reuse `CAL-*` IDs as production `LJ-*` IDs.

## Timed procedure

1. The production implementer classifies all section 2.2 blocks, splits every normative clause, and
   creates provisional records with statement, source anchor, frontier, owner, parity class, and
   evidence kind.
2. The human reviewer checks completeness, atomicity, exact source/registry equality, classifications,
   frontiers, owners, parity classes, and evidence kinds. Record active reviewer minutes, not elapsed
   waiting time.
3. The implementer performs requested splits, merges, rejections, and wording repairs. Record agent
   wall minutes and active human implementer minutes in separate fields.
4. The human decision owner resolves product or workflow choices and approves or rejects the accepted
   batch. Record per-record active minutes separately from fixed batch-level decision minutes.
5. The reviewer reruns the exact frozen validator, preserves its JSON receipt, and records the bound
   accepted artifacts and final counts.

## Required measurements

Record monotonic boundaries and elapsed seconds for authoring, review, rework, decision review, and
final verification. Also record:

- one `sourceUnitLedger` entry for every checked section-2.2 source unit, with all provisional CAL IDs
  produced from that unit in the initial pass; the validator derives initial-record and initially-split
  unit counts from this ledger instead of trusting headline numbers;
- initial and accepted counts, requested splits and their net added records, merge groups and their
  net removed records, net records removed by rejection/reclassification, and reworked records;
- separate agent authoring, review, and rework wall minutes;
- separate active human implementer, reviewer, and decision-owner minutes;
- fixed batch-level decision-owner minutes;
- separately estimated human schema/linter/tooling minutes, the responsible production role, a
  written basis, and an exact path/hash binding to structured estimate evidence created from
  `tooling-estimate-evidence.template.json`; and
- every role identity, the implementer's attestation, reviewer approval, and decision-owner approval.

The timed human intervals reconcile only the four active-human fields. Implementer and reviewer time
must each be positive, and per-record plus fixed decision-owner time must be positive in aggregate.
Either decision-owner component may be zero only with the corresponding `zeroMinuteReasons` entry.
The tooling estimate is not a fabricated timer interval; it lives in `toolingEstimate` with its role,
basis, and evidence binding. That JSON evidence must itemize included human work, bind the same human
minutes/role/basis, carry reviewer and decision-owner approval, and explicitly exclude agent runtime
and unattended machine runtime.

The formal rate is:

~~~text
human minutes per accepted record =
  (active human implementer minutes
   + active human reviewer minutes
   + per-record active human decision-owner minutes)
  / accepted records

initial-slice human allowance =
  human minutes per accepted record
  * reviewed initial-slice record count
  * contingency factor (minimum 1.5)
  + fixed decision-owner minutes
  + separately estimated human schema/linter/tooling minutes
~~~

The current machine-valid and agent-reconciled inventory count is 1,835. It remains a draft input
until human review and decision-owner approval finish. If that count changes, recompute the derived
allowance and re-approve the exact calibration bytes without rerunning the timed phases; rerun the
timed calibration when the named people, workflow, schema, marker grammar, or tooling materially
changes the measured rate.

## Acceptance gate

The calibration may bind the M0 cap only when all three named people participated, implementer and
reviewer time are positive, combined decision-owner time is positive, the role-file hash matches,
monotonic timing is complete and phase ordered, all accepted records pass the exact frozen validator,
and its receipt matches every bound artifact. The receipt has format version 1, status `valid`, an
empty error list, the marker-grammar hash, exact accepted-record count, source-unit count, and derived
initially-split unit count. Human intervals in `production-calibration-timer-log.template.json` must
reconcile to active-human minutes without participant overlap; tooling remains the separate bound
estimate described above. The implementer attests to participation, the reviewer approves the batch,
and the decision owner approves both the batch and the fixed decision allowance. Until
then, preserve the result as a dry run or rejected calibration and leave formal M0 inactive. The
capacity record binds the approved JSON's exact path and SHA-256; editing or replacing that calibration
invalidates capacity approval until its derivations and binding are recomputed.
