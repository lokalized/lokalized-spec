# Pre-M0 inventory reconciliation

Status: machine-valid and independently agent-reconciled; awaiting human review and decision-owner
approval.

This note records the completed independent reconciliation behind
`inventory-review.draft.json`. It does not approve the inventory or start M0.

## Frozen basis

- Plan SHA-256: `4ace5e349bedd45b16cd87182aed3306d33fae92b034ed01ddb93bc733c5f62d`
- Inventory schema SHA-256: `110ce5e2a63eff90484168c16725e93e313ec003f852160c4e1ae3d3f979ab84`
- Sections 1–4 SHA-256: `0b11f71f0814d2942be5ebd35145abfc3ade8d0d4cfc708ac53c4a328a7f5106`
- Sections 5–7 SHA-256: `c3f90652961e263616d878ff5991dfb2fbb408359d88324aa3b24baa52f591ba`
- Sections 8–14 SHA-256: `96e8f156430bfd031fd8427a7ba2c57c6689d3660c20c3d66ca336a073150199`

The validator reports 632 classified source blocks and 1,835 anticipated records in the complete
initial registration slice. Frontier memberships are 1,210 for M0, 213 for M1, 155 for M2, and 257
for M3a. A record can belong to more than one frontier, so those membership counts must not be added.

The deterministic M0 worklist contains 186 source blocks whose estimates total 1,210 atomic
candidates. Those estimates are capacity inputs; they are not minted production requirements.

## Reconciliation method

Each plan section was inventoried, independently reread, and reconciled against the exact frozen plan
bytes. The final pass checked disposition, first registration frontier, owner, parity class,
anticipated atomization count, duplicate requirements, and mixed clauses that needed separate blocks.
The inventory validator then checked source bounds and section scope, IDs, anchors, milestone
relations, and aggregate counts. `audit-coverage.mjs` supplied a heuristic heading/fence/table scan;
independent agent rereads and reconciliation—not that heuristic—established the coverage disposition.

Clause-specific anchors are intentional. When one physical sentence or paragraph contains obligations
with different owners, frontiers, or parity classes, blocks may share or overlap line ranges. Their
`sourceAnchor` values must identify distinct clauses, and the eventual atomic records must preserve the
exact clause provenance. Line-range overlap is not permission to duplicate a normative requirement.

## Calibration cross-check

The section 2.2 scratch calibration remains a throughput measurement, not a capacity approval. Its 77
accepted records reconcile exactly as 23 registered before M3a, 35 before M3b, 13 before M7, and 6
before M8. Six additional source markers were reviewed as nonnormative. This confirmed that only the
23-record earliest frontier belongs in the corresponding early registry slice; the full 77-record
sample must not be treated as one M0-sized batch.

The dry run's 0.255195 agent minutes per accepted record, multiplied by all 1,835 projected initial
records and the required 1.5 contingency, yields 702.4242375 agent minutes. That is retained only as a
planning signal. It does not bound implementer, reviewer, or decision-owner attention.

## Material reconciliation decisions

- Duplicate restatements were marked nonnormative and point back to their canonical §1–§4 inventory
  IDs rather than minting later-frontier copies.
- Mixed data-production, oracle, documentation, browser-graph, edge-worker, lifecycle, and
  regeneration clauses were split so registration frontier and owner are internally consistent.
- The exact selector remains owned by M4. Earlier milestones freeze the public surface and data
  contracts, but do not move full plural-selector implementation into the initial runtime skeleton.
- Source summaries that merely navigate to an already registered contract are zero-record
  nonnormative blocks; they remain in the inventory so their treatment is reviewable.
- Appendix A is a nonnormative revision summary. Appendix B's type table and omitted-method sentence
  are nonnormative crosswalks to canonical contracts; its distinct Java-public-surface cross-check is
  an M0 process requirement with two anticipated records. This closed the final Appendix coverage
  gap and raised the reconciled totals by four blocks and two initial records.
- The heuristic scan's four uncovered signals are labels rather than propositions: “Required
  behavior:” (line 2068), “Before generator extraction:” (2379), “Measurements include:” (2844), and
  the decision-table header (3018). They require no additional inventory records.
- Where a block has an independent `M3b` registration frontier but an M4/M5b/M6 owner, M3b is only
  the corpus-registration deadline. Activation and declared evidence-producer milestones remain
  constrained to ancestors of or equality with the owning exit milestone.

## Remaining human gate

The named human reviewer must inspect the inventory and the named human decision owner must approve it.
Their identities and timestamp belong in `inventory-review.draft.json`; changing that file changes its
hash and therefore requires the capacity record to bind the new exact bytes. Until both approvals are
present, the inventory basis remains `agent-reviewed-awaiting-human` and formal M0 remains inactive.
