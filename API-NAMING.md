# Public API naming across ports

Shared concepts use shared names. New ports, including Swift, should keep the vocabulary established
by Java and JavaScript unless the language's type system, runtime, or API conventions give a concrete
reason to differ. Concision or a personal naming preference is not sufficient reason.

## Shared vocabulary

| Concept | Name |
|---|---|
| Supplies catalogs once during construction | `localizedStringSupplier` |
| Supplies the requested locale | `localeSupplier` |
| Supplies a negotiated locale match | `localeMatchSupplier` |
| Orders candidate locales within a language | `tiebreakerLocalesByLanguageCode` |
| Decides whether translation lookup continues after a candidate fails | `translationFallbackPolicy` |
| Handles a final translation failure | `translationFailureHandler` |
| Receives a loading or validation warning | `warningHandler` |
| Locale matching interface and match result | `LocaleMatcher`, `LocaleMatchResult` |
| Match diagnostic property on results, options, and events | `localeMatchResult` |
| Options for a translation call | `TranslationOptions` |
| Translation result and status | `TranslationResult`, `TranslationResultStatus` |
| Bidi mode and resolver/warning callback types | `BidiIsolation`, `PhoneticResolver`, `LocalizedStringWarningHandler` |
| Language-form types | `LanguageForm`, `Gender`, `GrammaticalCase`, `Definiteness`, `Classifier`, `Formality`, `Clusivity`, `Animacy`, `Cardinality`, `Ordinality`, `Phonetic` |
| Translation failure types | `TranslationFailure`, `TranslationFailureReason`, `TranslationFailureHandler`, `TranslationFailureResponse` |

Java's `LocalizedStringLoadingException` maps to JavaScript's `LocalizedStringLoadingError`.
Named TypeScript types should be importable through public package entry points rather than requiring
callers to reconstruct them from anonymous return types or private module paths.

The observer for successful fallback is named `translationFallbackObserver`, with
`TranslationFallbackEvent` and `TranslationFallbackObserver` types, in JavaScript and Java 3.1.1.
Other ports adding the same feature should use those names and event fields.

Keep the same option names in construction, per-call options, configuration records, and manifests
when they describe the same setting. Enum values should keep the same words, using the language's
normal casing and separators: Java's `BidiIsolation.ALWAYS` is JavaScript's `"always"`.

## Language-specific differences

Representations may follow their language: Java builders versus JavaScript factory functions and
options objects; Java `Locale` values versus JavaScript BCP 47 strings; Java exception classes versus
JavaScript error classes; Java overloads versus explicitly named JavaScript functions. Features that
depend on a runtime, such as Java classpath loading, need not acquire artificial counterparts.

A different name must have its reason documented in the port's public API documentation. Review the
shared vocabulary before releasing a new port or adding a public concept. This naming policy does
not declare formal behavioral parity between ports.

## Post-1.0.0 parity review

The following differences are explicit follow-up work, not requirements for JavaScript 1.0.0:

- Review locale-supplier callback signatures: Java passes a matcher; JS closes over an optional matcher
- Review per-call negotiation: Java accepts language ranges; JS accepts an already negotiated result
- Decide whether JS should expose Java's configurable runtime limits
- Assess Java's plural-category integer and decimal example-value helpers for JS
- Record ordinal and range data imports as a browser delivery difference
- Assess JS-only browser selection, manifests, and SSR verification for other ports
- Include successful fallback observation in the shared behavioral corpus after Java 3.1.1 is released
- Perform the deferred formal API and behavioral parity audit

Built-in reload support is deferred separately. Existing `Strings` instances remain immutable.
