# Current API inventories and historical oracle replay

The Java surface audit and frozen behavioral/IANA oracle checks intentionally
have different source inputs. The surface audit reads the current Java public
API plus the frozen plan and numbered surface amendments. Its A35 rows account
for Java 3.1.1's fallback event/observer/preceding failure, already implemented by
JS and Swift. An inventory row does not create a shared behavioral observation.

`generated/behavioral-vectors.json` and `generated/iana-jdk-check.json` instead
record the exact Java source build that produced their observations. Their
library source SHA-256 is
`db1f440a5641e419cf1f1a2d8fd89b2f6d7b63d65b9ee0316a0a7f83a76fa1e0`.
The local `3.1.0` tag resolves to Java commit
`63b63e47c982f7a87873c52ac2289cc0392f3329` and contains those exact 62 package
source files plus the recorded version `3.1.0`. The Corretto 21.0.11 oracle is
also part of the receipt. Tag names alone are insufficient; the source aggregate
and recorded outputs must match.

M8L replays this source-only Git archive in a temporary directory, freshly
compiling its Java classes on the pinned JDK with `--release 9`. Only existing
compile-time annotation jars are used (`jspecify` and `jsr305`); they are not
Swift dependencies. No Git checkout, commit, oracle refresh, remote download or
canonical artifact write is needed. Both actual checks pass: 116,658 IANA probes
(339 refusals and 26 recorded JDK differences), and all 2,381 behavioral cases
plus five seed rows. The corpus byte SHA-256 remains
`1eb74caf8524c0a3b33dca99addb268c86b64eb8321fac03257474ddaa3c9753`.

## Selecting inputs

Use the ordinary current sibling for `check:surface`. For the two frozen-runtime
checks, point `LOKALIZED_JAVA_DIR` at a separately prepared source/class build
whose aggregate matches the historical receipt:

```sh
npm run check:surface
LOKALIZED_JAVA_DIR=/path/to/frozen-java-build npm run check:iana
LOKALIZED_JAVA_DIR=/path/to/frozen-java-build npm run check:vectors
```

That directory needs the exact historical `pom.xml`, `src/main/java`, vendored
IANA inputs and freshly compiled `target/classes`. Obtain source bytes from the
exact commit above using `git archive`; verify the source aggregate before
compilation. The existing oracle tools validate their inputs and outputs; do
not edit receipts to claim a newer build produced historical observations.
Normal source-independent shared artifact gates use the current spec checkout.

The default umbrella `npm run check` deliberately uses a single Java directory.
With the current Java checkout, it now passes the surface gate, then refuses
`check:iana` because library version/source provenance differs from the historical
record. Running against the old source build would instead make the new surface
rows stale. M8L's explicit gate matrix runs each gate with its correct input:
current API inventory, pinned historical oracle replay and current shared
artifacts. All 21 gates pass in that matrix. It preserves the umbrella failure as a useful mismatch diagnostic;
it does not soften any gate or silently refresh the corpus.

Shared observer vectors remain deferred under [the naming policy](API-NAMING.md).
Known diagnostic and manifest behavior amendments use their own versioned
profiles and retained historical references. A future deliberate baseline/oracle
refresh must review changed answers and update every affected pin/port together.
