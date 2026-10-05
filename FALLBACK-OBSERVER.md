# Portable fallback-observer profile

`generated/fallback-observer/v1.json` is a versioned supplemental profile for
successful per-key fallback observation. The frozen Java 3.1.0 behavioral corpus
predates the observer API; this profile leaves that corpus and its ID partitions
unchanged. Its oracle is the common behavior of Java 3.1.1, JavaScript and Swift,
verified by profile-driven tests in all three ports. The artifact's SHA-256 is
`4c844d73e8d333dde8432cb9e76fcdeb22b4937b50a632205fe74855b6e57d18`.

One fixture defines four catalog locales and a fixed `en-GB → en-001 → en → fr`
candidate chain. Two catalog variants add an unmatched alternative and two
separate rendering failures. Twelve cases record the lookup result, candidate
attempts, policy calls, failure-handler count and the exact observer
channel/event:

| Case | Discriminator |
|---|---|
| `observer.first-candidate` | First-candidate success has no observer or policy call |
| `observer.third-candidate` | Two failures produce one ordered event |
| `observer.fourth-candidate` | Three failures produce one ordered event |
| `observer.exhausted` | Total failure calls the handler, never the observer |
| `observer.policy-stops` | Policy refusal prevents the later successful candidate |
| `observer.throws` | Observer error propagates without calling the failure handler |
| `observer.per-call-replaces` | Per-call observer replaces the instance observer |
| `observer.negotiation-only` | Negotiation reports fallback, but first-candidate success has no event |
| `observer.no-matching-alternative` | A missed alternative and a missing key keep distinct reasons |
| `observer.distinct-causes` | Each resolution failure retains its own marker error through policy and event |
| `observer.per-call-inherits` | Explicit per-call null retains the instance observer |
| `observer.reentrant` | An observer's nested lookup emits a second ordered event |

Each port checks the event/result match-reference identity when an event is
returned. The event projection omits translation text and caller values;
`causeIdentity` requires each runtime's policy callback and event to retain
the same two distinct marker objects. The language-neutral fields normalize
only enum spelling and observer channels. The reentrant row checks both results
and match-reference identities; its policy calls record the outer lookup before
the nested lookup, and the two observer events retain that order. Port-specific
tests retain broader coverage for concurrent lookups, native event construction
and JavaScript thenable refusal. This profile does not adopt Java
3.1.1's known `lvariant` candidate-validation regression.

The shared checker validates exact profile shape, case inventory and event/trace
relationships. Each port keeps a byte-identical test snapshot and pins its
digest; no consumer package loads a sibling checkout. Run the shared and port
checks from their repository roots:

```sh
npm run check:fallback-observer
python3 tools/check_fallback_observer.py --sibling-check  # with sibling ports present
mvn -q -Dtest=FallbackObserverProfileTests test
node --test test/fallback-observer-profile.test.js
swift test --filter FallbackObserverProfileTests
```

The final three commands run in Java, JavaScript and Swift respectively. These
are development/test artifacts only. The profile adds no runtime dependency or
network loading behavior to any port.
