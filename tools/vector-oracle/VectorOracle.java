/*
 * Behavioral-vector oracle for plan v7 M3a.
 *
 * This program does NOT check expectations. It EXECUTES cases against an unmodified
 * lokalized-java 3.0.0 and EMITS what that implementation actually does. The corpus is therefore
 * authoritative by construction: there is no hand-written `expected` block for Java to disagree
 * with, which is the same principle that made the IANA equivalence table zero-divergence.
 *
 * It lives in package com.lokalized only to reuse the library's own JSON parser, so the oracle
 * never introduces a second parser whose bugs could be mistaken for library behavior. Fixture
 * strings files are materialized to disk by the Node driver and read back through the real
 * LocalizedStringLoader, so loading is exercised rather than simulated.
 *
 * Usage: java -cp <lokalized-classes>:<this> com.lokalized.VectorOracle <request.json> <out.json>
 */
package com.lokalized;

import com.lokalized.MinimalJson.Json;
import com.lokalized.MinimalJson.JsonArray;
import com.lokalized.MinimalJson.JsonObject;
import com.lokalized.MinimalJson.JsonValue;

import java.io.InputStream;
import java.net.URL;
import java.net.URLClassLoader;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.SortedSet;
import java.util.TreeMap;

public final class VectorOracle {

	public static void main(String[] args) throws Exception {
		if (args.length != 2) {
			System.err.println("usage: VectorOracle <request.json> <out.json>");
			System.exit(2);
		}

		JsonObject request = Json.parse(Files.readString(Paths.get(args[0]), StandardCharsets.UTF_8)).asObject();
		JsonObject fixtures = request.get("fixtures").asObject();
		JsonArray cases = request.get("cases").asArray();

		// The (axis, name, renderName) table is VERIFIED against Java, never derived by stripping a
		// presumed prefix -- plan section 3.7 forbids that derivation, so the oracle must not rely on
		// it either. See buildLanguageForms.
		buildLanguageForms(request.get("languageFormConstantsByAxis").asObject());

		// One Strings instance per fixture, built once and shared, so a case cannot accidentally
		// depend on construction order.
		// Every fixture failure is collected rather than thrown on the first one: during case authoring
		// a single run should name every broken fixture, not just the alphabetically-first.
		Map<String, Strings> byFixture = new LinkedHashMap<>();
		Map<String, String> fixtureProblems = new LinkedHashMap<>();
		Map<String, String> fixtureDirectories = new LinkedHashMap<>();
		for (JsonObject.Member member : fixtures) {
			JsonObject config = member.getValue().asObject();
			fixtureDirectories.put(member.getName(), config.getString("dir", null));
			// A fixture that is DELIBERATELY unloadable is the subject of the load and parse clauses,
			// so construction failure is recorded rather than fatal. It only becomes fatal below, and
			// only for a case that actually needs a Strings instance.
			if (config.get("loadOnly") != null && config.get("loadOnly").asBoolean()) continue;
			try {
				byFixture.put(member.getName(), buildStrings(config));
			} catch (RuntimeException e) {
				fixtureProblems.put(member.getName(), e.getClass().getSimpleName() + ": " + e.getMessage());
			}
		}

		List<Object> results = new ArrayList<>();
		for (JsonValue element : cases) {
			JsonObject testCase = element.asObject();
			String id = testCase.getString("id", null);
			String fixtureId = testCase.getString("fixture", null);
			String operation = testCase.getString("operation", null);
			boolean needsStrings = !"load".equals(operation) && !"parse".equals(operation)
					&& !"loadClasspath".equals(operation) && !"loadClasspathResources".equals(operation)
					// `construct` exists precisely to OBSERVE a refused construction, so it must survive a
					// fixture that could not be built. Every other operation still aborts the run, because
					// for them a missing Strings is an authoring mistake rather than the subject.
					&& !"construct".equals(operation);
			Strings strings = byFixture.get(fixtureId);
			if (needsStrings && strings == null) {
				String reason = fixtureProblems.containsKey(fixtureId)
						? "fixture could not be constructed -- " + fixtureProblems.get(fixtureId)
						: "unknown or load-only fixture";
				throw new IllegalStateException("case " + id + " names fixture " + fixtureId + ": " + reason);
			}

			Map<String, Object> row = new TreeMap<>();
			row.put("id", id);
			OBSERVED_FAILURES.clear();
			PHONETIC_CALLS.clear();
			POLICY_CALLS.clear();
			SUPPLIER_CALLS.clear();
			try {
				row.put("expected", execute(strings, operation,
						testCase.get("input") == null ? new JsonObject() : testCase.get("input").asObject(),
						fixtureDirectories.get(fixtureId), fixtures.get(fixtureId).asObject()));
			} catch (RuntimeException e) {
				// A throwing case is a legitimate observation, not an oracle failure. Record the
				// identity of the throw; the message text is deliberately included because several
				// required fixtures assert contextualization.
				Map<String, Object> thrown = new TreeMap<>();
				thrown.put("type", e.getClass().getName());
				thrown.put("message", e.getMessage());
				thrown.put("causeType", e.getCause() == null ? null : e.getCause().getClass().getName());
				Map<String, Object> wrapper = new TreeMap<>();
				wrapper.put("thrown", thrown);
				// A case that throws often threw BECAUSE of a failure the handler saw first; that
				// observation is the more informative half and must not be discarded with the stack.
				if (!OBSERVED_FAILURES.isEmpty()) wrapper.put("failures", describeObservedFailures(null));
				addCallbackChannels(wrapper);
				row.put("expected", wrapper);
			}
			results.add(row);
		}

		Map<String, Object> out = new TreeMap<>();
		out.put("oracle", "lokalized-java");
		out.put("javaVersion", System.getProperty("java.version"));
		out.put("results", results);

		StringBuilder sb = new StringBuilder();
		writeCanonical(out, sb);
		Files.writeString(Paths.get(args[1]), sb.toString(), StandardCharsets.UTF_8);
		System.err.println("oracle: fixtures=" + byFixture.size() + " cases=" + results.size());
	}

	/** Build a Strings from a fixture whose strings files the driver already wrote to disk. */
	/**
	 * Optional evidence that a constructed instance is USABLE and not merely allocated.
	 *
	 * Supplying input.probeKey asks the new instance for that key, so a `constructed: true` row can be
	 * backed by an answer rather than by the absence of a throw. Cases whose subject is a REFUSAL are
	 * the reason `construct` exists and need no probe; they record null.
	 */
	private static Object describeConstructionProbe(Strings strings, JsonObject input) {
		String probeKey = input.getString("probeKey", null);
		if (probeKey == null) return null;
		Map<String, Object> probe = new TreeMap<>();
		try {
			probe.put("value", strings.get(probeKey));
			probe.put("threwType", null);
		} catch (RuntimeException e) {
			// A key that throws is still evidence the instance is live, so this is recorded rather
			// than rethrown -- it would otherwise be indistinguishable from a construction failure.
			probe.put("value", null);
			probe.put("threwType", e.getClass().getName());
		}
		return probe;
	}

	/** The first locale's catalog from a loaded fixture, used to give a degenerate map real content. */
	private static Iterable<LocalizedString> firstCatalogOf(Map<Locale, Set<LocalizedString>> loaded) {
		for (Set<LocalizedString> catalog : loaded.values()) return catalog;
		return new ArrayList<>();
	}

	private static Strings buildStrings(JsonObject config) {
		Path directory = Paths.get(config.getString("dir", null));

		// Loading limits are fixture configuration because several section 8.3 clauses are only
		// REACHABLE with a raised limit -- notably alternative nesting, where each level costs several
		// JSON levels and the loader's JSON-depth cap is hit long before the validator's own depth cap.
		Map<Locale, Set<LocalizedString>> loaded =
				LocalizedStringLoader.loadFromFilesystem(directory, loadingOptionsFrom(config.get("loadingOptions")));

		// DefaultStrings requires exactly one ambient locale source even when every case passes an
		// explicit per-call locale. Fixtures name it so the ingress matrix of section 8.3 can vary it
		// deliberately rather than inheriting whatever the fallback happens to be.
		Locale instanceLocale = Locale.forLanguageTag(
				config.getString("instanceLocale", config.getString("fallbackLocale", null)));

		// DELIBERATELY DEGENERATE CONFIGURATIONS. DefaultStrings' constructor performs a series of
		// validations that no well-formed fixture can reach, because this builder always installs exactly
		// one catalog source and exactly one locale source. Those validations are real portable contract
		// -- the JS `createStrings` object literal can express every shape below, several of which a Java
		// caller cannot -- so a fixture may name one. The set is CLOSED and each value maps to one
		// documented refusal; an unknown value is an authoring error and fails loudly rather than
		// silently building a valid instance and closing the branch with a passing case.
		JsonValue overridesValue = config.get("constructionOverrides");
		JsonObject overrides = overridesValue == null || overridesValue.isNull()
				? new JsonObject() : overridesValue.asObject();
		String catalogSource = overrides.getString("catalogSource", null);
		String localeSource = overrides.getString("localeSource", null);

		Strings.Builder builder = Strings.withFallbackLocale(
				Locale.forLanguageTag(config.getString("fallbackLocale", null)));

		if (catalogSource == null) {
			builder = builder.localizedStringSupplier(() -> loaded);
		} else switch (catalogSource) {
			// DefaultStrings.java:250 -- no catalog source at all.
			case "omit": break;
			// :262 -- a supplier that answers null, which is not the same as supplying nothing.
			case "returnsNull": builder = builder.localizedStringSupplier(() -> null); break;
			// :273 -- a null locale key. A JS Map catalog can carry one; a plain object cannot.
			case "nullLocaleKey": {
				Map<Locale, Iterable<LocalizedString>> degenerate = new LinkedHashMap<>();
				degenerate.put(null, firstCatalogOf(loaded));
				builder = builder.localizedStringSupplier(() -> degenerate);
				break;
			}
			// :280 -- two DISTINCT Locale keys that lowercase to the same BCP 47 tag.
			//
			// MEASURED, NOT ASSUMED. The disposition proposed 'en' and 'EN'; those are the same Locale
			// (Locale.forLanguageTag("EN").equals(new Locale("en"))), so they collapse to one map entry
			// and never reach the check -- a case built on them would have closed this branch while
			// specifying nothing. Variant case is preserved where language, region and private-use case
			// are all normalized, so en_US_POSIX and en_US_posix are unequal keys whose tags collide.
			case "duplicateNormalizedTag": {
				Map<Locale, Iterable<LocalizedString>> degenerate = new LinkedHashMap<>();
				degenerate.put(new Locale("en", "US", "POSIX"), firstCatalogOf(loaded));
				degenerate.put(new Locale("en", "US", "posix"), firstCatalogOf(loaded));
				builder = builder.localizedStringSupplier(() -> degenerate);
				break;
			}
			// :286 -- a null catalog for one locale, which a port might read as an empty catalog.
			case "nullCatalogValue": {
				Map<Locale, Iterable<LocalizedString>> degenerate = new LinkedHashMap<>();
				degenerate.put(Locale.forLanguageTag("en"), null);
				builder = builder.localizedStringSupplier(() -> degenerate);
				break;
			}
			// :293 -- a null entry INSIDE an otherwise valid catalog, whose failure mode is a silently
			// smaller catalog rather than a refusal.
			case "nullEntry": {
				List<LocalizedString> withHole = new ArrayList<>();
				for (LocalizedString each : firstCatalogOf(loaded)) { withHole.add(each); break; }
				withHole.add(null);
				Map<Locale, Iterable<LocalizedString>> degenerate = new LinkedHashMap<>();
				degenerate.put(Locale.forLanguageTag("en"), withHole);
				builder = builder.localizedStringSupplier(() -> degenerate);
				break;
			}
			// :500 -- the SAME key twice inside one locale's iterable. A catalog map cannot express this
			// and neither can a JS record; an ARRAY catalog on either side can, and a port that builds a
			// plain object from one silently keeps the LAST, which is the opposite of Java's refusal.
			// The same node twice is enough: :500 keys on the string, not on node identity.
			case "duplicateKey": {
				List<LocalizedString> repeated = new ArrayList<>();
				for (LocalizedString each : firstCatalogOf(loaded)) { repeated.add(each); repeated.add(each); break; }
				Map<Locale, Iterable<LocalizedString>> degenerate = new LinkedHashMap<>();
				degenerate.put(Locale.forLanguageTag("en"), repeated);
				builder = builder.localizedStringSupplier(() -> degenerate);
				break;
			}
			default:
				throw new IllegalArgumentException("unknown constructionOverrides.catalogSource '" + catalogSource + "'");
		}

		// DefaultStrings requires EXACTLY ONE of these (DefaultStrings.java:255), so they are mutually
		// exclusive here too. Absent both, the ambient locale is the fixture's constant instanceLocale,
		// which is what every pre-existing fixture gets.
		JsonValue matchSupplier = config.get("localeMatchSupplier");
		JsonValue localeSupplier = config.get("localeSupplier");
		if (localeSource != null) {
			// DefaultStrings.java:254 is `(localeSupplier == null) == (localeMatchSupplier == null)`, so it
			// refuses BOTH degenerate arms. Only the both-absent arm is expressible through the ordinary
			// fixture fields (by omission); the both-present arm needs this override, and it is the arm a
			// JS object literal reaches most easily.
			// Only "omit" exists. A "both" arm was written and MEASURED: it constructed successfully,
			// because Strings.Builder.localeSupplier nulls localeMatchSupplier and vice versa
			// (Strings.java:288-289, 310-311), so the both-present state cannot be built and the second
			// setter wins. Keeping it would have been dead machinery behind a case that observed nothing.
			if ("omit".equals(localeSource)) {
				// install neither
			} else if ("explicitNullLocaleSupplier".equals(localeSource)) {
				// Strings.java:288's NULL arm. `localeSupplier(null)` does NOT clear a locale-match
				// supplier already set -- only a NON-null value replaces it -- so this CONSTRUCTS and the
				// match supplier decides. The asymmetry is the whole point: a builder that cleared on null
				// would leave no locale source at all and refuse at DefaultStrings:254, and a JS caller
				// writing `{ localeMatchResolver: fn, localeResolver: undefined }` must reach the same
				// state, not the refusal.
				builder = builder.localeMatchSupplier(localeMatchSupplierFrom(matchSupplier)).localeSupplier(null);
			} else if ("explicitNullMatchSupplier".equals(localeSource)) {
				// Strings.java:310's NULL arm, the mirror.
				builder = builder.localeSupplier(localeSupplierFrom(localeSupplier)).localeMatchSupplier(null);
			} else {
				throw new IllegalArgumentException("unknown constructionOverrides.localeSource '" + localeSource + "'");
			}
		} else if (matchSupplier != null && !matchSupplier.isNull()) {
			if (localeSupplier != null && !localeSupplier.isNull())
				throw new IllegalArgumentException("a fixture may set localeSupplier or localeMatchSupplier, not both");
			builder = builder.localeMatchSupplier(localeMatchSupplierFrom(matchSupplier));
		} else if (localeSupplier != null && !localeSupplier.isNull()) {
			builder = builder.localeSupplier(localeSupplierFrom(localeSupplier));
		} else {
			builder = builder.localeSupplier(matcher -> instanceLocale);
		}

		// A DEGENERATE TIEBREAKER MAP. Three shapes that a JSON `tiebreakers` object cannot spell -- a
		// null list, a null entry inside a list, and a NULL KEY -- and each is a DefaultStrings refusal a
		// JS caller CAN reach, because plan 3.1 types the construction input as a `TiebreakerMap` and a
		// `Map` can carry a null key where a record cannot. Same closed-set discipline as catalogSource:
		// one documented refusal per value, an unknown value fails the build loudly.
		String tiebreakerSource = overrides.getString("tiebreakerSource", null);
		JsonValue tiebreakers = config.get("tiebreakers");
		if (tiebreakerSource != null) {
			Map<String, List<Locale>> degenerate = new LinkedHashMap<>();
			switch (tiebreakerSource) {
				// :335 -- a null tiebreaker locale LIST for a language code. `{ en: null }` in JS.
				case "nullList": degenerate.put("en", null); break;
				// :343 -- a null entry INSIDE a list. `{ en: [null] }` in JS.
				case "nullEntry": {
					List<Locale> withHole = new ArrayList<>();
					withHole.add(null);
					degenerate.put("en", withHole);
					break;
				}
				// :2650, through normalizedTiebreakerLanguageCode -- a NULL LANGUAGE CODE. Only a Map can
				// present one, on either side.
				case "nullLanguageCode":
					degenerate.put(null, new ArrayList<>(Arrays.asList(Locale.forLanguageTag("en"))));
					break;
				default:
					throw new IllegalArgumentException("unknown constructionOverrides.tiebreakerSource '" + tiebreakerSource + "'");
			}
			builder = builder.tiebreakerLocalesByLanguageCode(degenerate);
		} else if (tiebreakers != null && !tiebreakers.isNull()) {
			Map<String, List<Locale>> byLanguage = new LinkedHashMap<>();
			for (JsonObject.Member member : tiebreakers.asObject()) {
				List<Locale> locales = new ArrayList<>();
				for (JsonValue tag : member.getValue().asArray()) locales.add(Locale.forLanguageTag(tag.asString()));
				byLanguage.put(member.getName(), locales);
			}
			builder = builder.tiebreakerLocalesByLanguageCode(byLanguage);
		}

		// THE LIBRARY'S OWN DEFAULTS, which no fixture could reach before this.
		//
		// The handler and the policy are ALWAYS installed below, wrapping the library default when the
		// fixture names none, so the observation channels exist without a fixture opting in. That is
		// behavior-neutral for every channel -- and it means DefaultStrings:472 and :473, where the
		// library SELECTS its own default because the caller supplied nothing, never executed. A port
		// whose default handler was throw-on-missing, or whose default policy was "never fall back",
		// passed every case in the corpus.
		//
		// `instanceCallbacks: "libraryDefaults"` installs NEITHER, so those two selections run. The cost
		// is the recording channels, which is why it is an override rather than the norm: a fixture that
		// takes it is observable only through `construct`'s probe, and `construct` emits no channels.
		if ("libraryDefaults".equals(overrides.getString("instanceCallbacks", null))) {
			if (config.get("translationFailureHandler") != null && !config.get("translationFailureHandler").isNull())
				throw new IllegalArgumentException("instanceCallbacks 'libraryDefaults' cannot be combined with a named translationFailureHandler");
			if (config.get("translationFallbackPolicy") != null && !config.get("translationFallbackPolicy").isNull())
				throw new IllegalArgumentException("instanceCallbacks 'libraryDefaults' cannot be combined with a named translationFallbackPolicy");
		} else if (overrides.get("instanceCallbacks") != null) {
			throw new IllegalArgumentException("unknown constructionOverrides.instanceCallbacks '" + overrides.getString("instanceCallbacks", null) + "'");
		} else {
			builder = builder.translationFailureHandler(handlerFrom(config.get("translationFailureHandler")));

			TranslationFallbackPolicy policy = policyFrom(config.get("translationFallbackPolicy"));
			builder = builder.translationFallbackPolicy(recordingPolicy(
					policy != null ? policy : TranslationFallbackPolicy.fallbackOnMissingTranslationOrNoMatchingAlternative()));
		}

		JsonValue resolver = config.get("phoneticResolver");
		if (resolver != null && !resolver.isNull()) builder = builder.phoneticResolver(resolverFrom(resolver));

		TranslationRuntimeLimits runtimeLimits = runtimeLimitsFrom(config.get("runtimeLimits"));
		if (runtimeLimits != null) builder = builder.runtimeLimits(runtimeLimits);

		BidiIsolation bidiIsolation = bidiFrom(config.get("bidiIsolation"));
		if (bidiIsolation != null) builder = builder.bidiIsolation(bidiIsolation);

		return builder.build();
	}

	private static Map<String, Object> execute(Strings strings, String operation, JsonObject input,
																						String fixtureDirectory, JsonObject fixtureConfig) {
		Map<String, Object> expected = new TreeMap<>();

		switch (operation) {
			case "getResult": {
				String key = input.getString("key", null);
				String localeTag = input.getString("locale", null);

				// Null rather than an empty map when absent: the two take different paths through
				// DefaultStrings, and conflating them would silently change what the seed cases observe.
				Map<String, Object> placeholders = input.get("placeholders") == null
						? null
						: decodePlaceholders(input.get("placeholders").asObject());

				// A NULL PLACEHOLDER NAME (DefaultStrings:690). JSON has no null object key, so the case
				// asks for one with a flag instead. Java refuses it explicitly and a JS `Map` placeholder
				// source -- which plan 3.2 blesses for generated and untrusted keys -- can carry one, so
				// the refusal is portable. Applied AFTER decoding so the case can still supply ordinary
				// placeholders alongside it, which is what keeps the row from being answerable by an
				// unrelated missing-placeholder failure.
				if (input.getBoolean("nullPlaceholderName", false)) {
					if (placeholders == null) placeholders = new LinkedHashMap<>();
					placeholders.put(null, "ignored");
				}

				TranslationResult result = strings.getResult(key, placeholders, optionsFrom(input));

				expected.put("result", describeResult(result));
				if (!OBSERVED_FAILURES.isEmpty()) expected.put("failures", describeObservedFailures(result));
				addCallbackChannels(expected);

				// The second channel. Plan section 8.3 locks "the two-channel behavior, not merely the
				// final translation": what the matcher SELECTS (what a JS delivery would have had to
				// fetch) is observed separately from what resolution RESOLVES to.
				if (localeTag != null)
					expected.put("match", describeMatch(strings.matchFor(Locale.forLanguageTag(localeTag))));
				break;
			}
			case "get": {
				// CORRECTED. This comment used to read "a 'throw' handler surfaces here as a thrown case
				// while getResult() would have returned the key". That is FALSE, and the corpus this very
				// class emitted says so: throwExceptionFor is called from translateOrFail (DefaultStrings
				// :762), which is BELOW the getResult/get split, so a THROW_EXCEPTION response escapes
				// both entry points identically. 71 getResult rows record a thrown block -- 8 of them
				// MissingTranslationException, two named '...getresult-throws-too' precisely to pin the
				// pair (failure-handler.throw.instance.get-throws-missing-translation-exception and
				// .getresult-throws-too record the SAME exception from the two calls). COUNTED, not
				// recalled: the corpus holds exactly two such ids, failure-handler.no-matching-
				// alternative.throw.getresult-throws-too and failure-handler.throw.instance
				// .getresult-throws-too. The earlier 'three' was written from intent, which is the
				// recurring way these notes go wrong.
				//
				// What get() actually decides is narrower: it returns TranslationResult#getTranslation(),
				// so a RETURN_KEY or RETURN_STRING response is observable here only as that string, and
				// the status / attempted locales / match that getResult carries are lost. That is why a
				// family authored on get() is the right place for the message of a throw and the wrong
				// place for the shape of a result -- not because the two differ about throwing.
				String key = input.getString("key", null);
				Map<String, Object> placeholders = input.get("placeholders") == null
						? null
						: decodePlaceholders(input.get("placeholders").asObject());
				String translation = strings.get(key, placeholders, optionsFrom(input));
				expected.put("translation", translation);
				if (!OBSERVED_FAILURES.isEmpty()) expected.put("failures", describeObservedFailures(null));
				addCallbackChannels(expected);
				break;
			}
			case "matchFor": {
				// Two distinct solvers: the single-locale kernel, and the whole-list one the browser
				// chooser uses. Section 8.3 requires them to agree where both apply.
				List<Locale.LanguageRange> ranges = languageRangesFrom(input.get("languageRanges"));
				// matchFor has no TranslationOptions and therefore no builder: `locale` and `languageRanges`
				// here select an OVERLOAD, and the ternary below silently prefers ranges. An input carrying
				// both would record the range overload's answer while reading as though it had asked about
				// the locale one -- the same implied-precedence accident `perCallOverrideOrder` exists to
				// remove from optionsFrom, and there is no order to state here because nothing clears
				// anything. Refused outright, loudly, so it cannot be banked as a `thrown` row.
				JsonValue matchForLocale = input.get("locale");
				boolean matchForLocalePresent = matchForLocale != null && !matchForLocale.isNull();
				if (ranges != null && matchForLocalePresent)
					throw new AssertionError("matchFor input carries both a locale and languageRanges; those "
							+ "name two different OVERLOADS, not two overrides, so the case must ask exactly one");
				if (input.get("perCallOverrideOrder") != null)
					throw new AssertionError("matchFor input declares perCallOverrideOrder; matchFor builds no "
							+ "TranslationOptions, so there are no mutually-clearing setters for an order to decide");
				expected.put("match", describeMatch(ranges != null
						? strings.matchFor(ranges)
						: strings.matchFor(Locale.forLanguageTag(input.getString("locale", null)))));
				addCallbackChannels(expected);
				break;
			}
			case "acceptLanguage": {
				// The RAW Accept-Language field value as an observation. bestMatchForAcceptLanguage is a DEFAULT
				// interface method that DefaultStrings does not override, and nothing else in this harness reaches
				// it: the `matchFor` operation parses its header with Locale.LanguageRange.parse before the library
				// is entered (languageRangesFrom), which is the exact bypass that left com.lokalized.LocaleMatcher
				// at 0 of 36 branches. Parsing and normalization are the SUBJECT here, so the string is handed over
				// untouched.
				//
				// A MISSING `header` key is an authoring mistake, not an observation, and it is signalled with an
				// Error rather than a RuntimeException ON PURPOSE: main()'s wrapper would turn a RuntimeException
				// into a plausible-looking `thrown` row and bank a case that observes nothing. An Error escapes
				// main() and fails the build loudly. ingest.mjs refuses the same shape earlier still.
				JsonValue headerValue = input.get("header");
				if (headerValue == null)
					throw new AssertionError("acceptLanguage case has no input.header; an absent header is spelled "
							+ "as an explicit JSON null, never by omitting the key");
				String header = headerValue.isNull() ? null : headerValue.asString();

				// No inline try/catch, unlike `construct`. This contract is FAIL-SOFT: null, blank, comma-only,
				// malformed, over-4,096-code-unit and over-32-expanded input all return the configured fallback
				// rather than throwing. A `thrown` row here is therefore itself the finding, and main()'s wrapper
				// already records one.
				//
				// One tag is the whole channel: bestMatchForAcceptLanguage returns a bare Locale, so describeMatch's
				// fields do not exist on this path. Recording the parsed range list through a delegating matcher
				// would credit the same coverage but emit a field no JS implementation produces from its public
				// surface, forcing an attribution rule in conformance.mjs and constraining M7's negotiator shape.
				// The fixture carries the discrimination instead: its fallback and its ambient instance locale are
				// deliberately DIFFERENT tags, so "returned the fallback" and "matched a catalog" are distinct
				// answers rather than one indistinguishable one.
				Map<String, Object> observed = new TreeMap<>();
				observed.put("bestMatch", strings.bestMatchForAcceptLanguage(header).toLanguageTag());
				expected.put("acceptLanguage", observed);
				addCallbackChannels(expected);
				break;
			}
			case "construct": {
				// Strings CONSTRUCTION as an observation. DefaultStrings' constructor performs ~19 distinct
				// validations -- tiebreaker permutations, fallback reachability, supplier conflicts -- and
				// every one of them was unobservable before this operation existed: main() builds one Strings
				// per fixture BEFORE any case runs and collects the failures into a map it never emits, so a
				// refusal could only ever be recorded as a fixture nobody references. That closes a branch
				// while specifying nothing, which is worse than leaving it open.
				//
				// The refusal identity is the discriminator: a port that accepts an input Java refuses, or
				// refuses with a different exception, differs HERE and nowhere else.
				Map<String, Object> observed = new TreeMap<>();
				try {
					Strings constructed = buildStrings(fixtureConfig);
					observed.put("constructed", true);
					observed.put("failureType", null);
					observed.put("failureMessage", null);
					// A success row should say more than "nothing was thrown" where it cheaply can; see
					// describeConstructionProbe. Refusal cases -- the reason this operation exists -- need no
					// probe and record null.
					observed.put("probe", describeConstructionProbe(constructed, input));
				} catch (RuntimeException e) {
					observed.put("constructed", false);
					observed.put("failureType", e.getClass().getName());
					observed.put("failureMessage", withoutTemporaryPaths(e.getMessage()));
					observed.put("probe", null);
				}
				expected.put("construct", observed);
				break;
			}
			case "define": {
				// A HAND-BUILT LocalizedString, compared against the fixture's loaded catalog.
				//
				// LocalizedString.equals and the equals methods of its four nested value types were entirely
				// unreachable from this harness: every LocalizedString the corpus has ever seen came from one
				// LocalizedStringLoader run, and nothing ever compared two of them. `equals` is only entered
				// when a SECOND, independently-created instance exists to compare against, and until now the
				// only way to make one was a second classpath root -- transport this harness does not have.
				//
				// The transport that works needs neither: DefaultStrings$LocalizedStringSet.contains
				// (DefaultStrings.java:3186-3193) does `localizedStringsByKey.get(arg.getKey())` and then
				// `arg.equals(candidate)`, so handing it a programmatically-built LocalizedString reaches
				// LocalizedString.equals and, through the placeholder map and the alternative worklist, every
				// nested equals below it. getLocalizedStringsByLocale() is public on DefaultStrings and this
				// class already lives in package com.lokalized, so both halves are ordinary API here.
				//
				// `catalogKeyPresent` IS AN INVARIANT RE-CHECKED AT EXECUTION TIME, not a discriminator any
				// corpus row exercises -- an earlier version of this comment called it a second observation
				// channel, and measurement corrects that. A bare `contains` genuinely cannot tell "the catalog
				// has no such key" from "the fields differed" (the first never reaches :165; it returns at :140
				// with a null candidate), but ingest.mjs REFUSES a constructible probe whose key the fixture
				// does not define, so the missing-key row is unreachable and this field is `true` on every
				// built row and `null` on the two refusals -- never `false`. What it buys is that the ingest
				// gate cannot silently rot: if that gate were ever weakened, a false here would appear in the
				// corpus and the row it appears on would be visibly the wrong shape.
				// (A deliberate absent-key row would make the channel live and would close
				// LocalizedString#equals:140's null arm, currently 2/4 -- but that arm is dispositioned
				// nonportable, so there is no `required` gain and the gate as built costs nothing.)
				//
				// DELIBERATELY NOT OBSERVED: toString (DiagnosticRenderer carries a whole-class nonportable
				// disposition the port does not reproduce) and hashCode (four nonportable branches). Entering
				// either would cascade stale dispositions for no required-branch gain. LocalizedStringSet
				// intentionally overrides contains with a key lookup, so no hash of a LocalizedString is taken.
				Map<String, Object> observed = new TreeMap<>();
				JsonValue model = input.get("localizedString");
				// An Error, not a RuntimeException: main()'s wrapper would turn a RuntimeException into a
				// plausible `thrown` row and bank a case that observes nothing. See buildLocalizedString.
				if (model == null)
					throw new AssertionError("define case has no input.localizedString");

				LocalizedString built;
				try {
					built = buildLocalizedString(model);
					observed.put("built", true);
					observed.put("failureType", null);
					observed.put("failureMessage", null);
				} catch (RuntimeException e) {
					// A REFUSED construction is a first-class subject here, not a harness failure: it is how
					// LocalizedString#<init>:110 ("either a translation or at least one alternative") and
					// ExpressionTranslation#<init>:871 ("alternatives must not be empty") are specified. That is
					// why one operation serves both the equals cluster and the two construction refusals.
					observed.put("built", false);
					observed.put("failureType", e.getClass().getName());
					observed.put("failureMessage", withoutTemporaryPaths(e.getMessage()));
					observed.put("contains", null);
					observed.put("catalogKeyPresent", null);
					expected.put("define", observed);
					break;
				}

				Locale locale = Locale.forLanguageTag(input.getString("locale", null));
				Set<LocalizedString> catalog = ((DefaultStrings) strings).getLocalizedStringsByLocale().get(locale);
				if (catalog == null)
					throw new AssertionError("define case names locale '" + input.getString("locale", null)
							+ "', which the fixture does not load");

				// Computed by iterating the catalog rather than through getKeysForLocale: that method throws for
				// an unsupported locale and has its own uncovered guard, and this channel exists to EXPLAIN a
				// false row, not to add a second thing that can fail.
				boolean catalogKeyPresent = false;
				for (LocalizedString candidate : catalog)
					if (candidate.getKey().equals(built.getKey())) { catalogKeyPresent = true; break; }

				observed.put("contains", catalog.contains(built));
				observed.put("catalogKeyPresent", catalogKeyPresent);
				expected.put("define", observed);
				break;
			}
			case "load": {
				// The whole-directory load, as an OBSERVATION. A load that fails is the subject of several
				// section 8.3 clauses, so its failure identity is recorded rather than aborting the run.
				List<LocalizedStringWarning> warnings = new ArrayList<>();
				LocalizedStringWarningHandler handler = warnings::add;
				Map<String, Object> observed = new TreeMap<>();
				try {
					Map<Locale, Set<LocalizedString>> loaded = LocalizedStringLoader.loadFromFilesystem(
							Paths.get(fixtureDirectory), handler, loadingOptionsFrom(fixtureConfig.get("loadingOptions")));

					// Locale tags plus per-locale key counts and the keys themselves: a partial load is only
					// distinguishable from a complete one by WHAT arrived, not by whether it threw.
					Map<String, Object> keysByLocale = new TreeMap<>();
					for (Map.Entry<Locale, Set<LocalizedString>> entry : loaded.entrySet()) {
						List<Object> keys = new ArrayList<>();
						for (LocalizedString localizedString : entry.getValue()) keys.add(localizedString.getKey());
						java.util.Collections.sort(keys, (a, b) -> ((String) a).compareTo((String) b));
						keysByLocale.put(entry.getKey().toLanguageTag(), keys);
					}
					observed.put("locales", new ArrayList<Object>(keysByLocale.keySet()));
					observed.put("keysByLocale", keysByLocale);
					observed.put("failed", false);
					observed.put("failureType", null);
					observed.put("failureMessage", null);
				} catch (RuntimeException e) {
					observed.put("locales", new ArrayList<>());
					observed.put("keysByLocale", new TreeMap<>());
					observed.put("failed", true);
					observed.put("failureType", e.getClass().getName());
					// Paths are stripped: they contain a per-run temporary directory and would make the
					// corpus irreproducible.
					observed.put("failureMessage", withoutTemporaryPaths(e.getMessage()));
				}
				observed.put("warnings", describeWarnings(warnings));
				expected.put("load", observed);
				break;
			}
			case "parse": {
				// The single-file entry point. Reaches the parser with raw BYTES, which is the only way to
				// observe malformed UTF-8, unpaired surrogates, and duplicate JSON members -- none of which
				// survive being written from a JSON object.
				List<LocalizedStringWarning> warnings = new ArrayList<>();
				LocalizedStringWarningHandler handler = warnings::add;
				String fileName = input.getString("file", null);
				String source = input.getString("source", fileName);
				Locale locale = Locale.forLanguageTag(input.getString("locale", null));
				Map<String, Object> observed = new TreeMap<>();
				try (InputStream stream = Files.newInputStream(Paths.get(fixtureDirectory, fileName))) {
					Set<LocalizedString> parsed = LocalizedStringLoader.parse(stream, locale, source, handler,
							loadingOptionsFrom(fixtureConfig.get("loadingOptions")));
					List<Object> keys = new ArrayList<>();
					for (LocalizedString localizedString : parsed) keys.add(localizedString.getKey());
					java.util.Collections.sort(keys, (a, b) -> ((String) a).compareTo((String) b));
					observed.put("keys", keys);
					observed.put("failed", false);
					observed.put("failureType", null);
					observed.put("failureMessage", null);
				} catch (java.io.IOException | RuntimeException e) {
					observed.put("keys", new ArrayList<>());
					observed.put("failed", true);
					observed.put("failureType", e.getClass().getName());
					observed.put("failureMessage", withoutTemporaryPaths(e.getMessage()));
				}
				observed.put("warnings", describeWarnings(warnings));
				expected.put("parse", observed);
				break;
			}
			case "loadClasspath": {
				// The SECOND discovery path. A URLClassLoader rooted at the fixtures directory makes the
				// materialized fixtures classpath-visible without touching the JVM's own classpath, so
				// classpath discovery is exercised for real rather than simulated.
				List<LocalizedStringWarning> warnings = new ArrayList<>();
				Map<String, Object> observed = new TreeMap<>();
				String classpathPackage = input.getString("package", new java.io.File(fixtureDirectory).getName());
				try (URLClassLoader loader = classpathLoaderFor(fixtureDirectory)) {
					Map<Locale, Set<LocalizedString>> loaded = LocalizedStringLoader.loadFromClasspath(
							loader, classpathPackage, warnings::add, loadingOptionsFrom(fixtureConfig.get("loadingOptions")));
					describeLoaded(loaded, observed);
				} catch (java.io.IOException | RuntimeException e) {
					observed.put("locales", new ArrayList<>());
					observed.put("keysByLocale", new TreeMap<>());
					observed.put("failed", true);
					observed.put("failureType", e.getClass().getName());
					observed.put("failureMessage", withoutTemporaryPaths(e.getMessage()));
				}
				observed.put("warnings", describeWarnings(warnings));
				expected.put("load", observed);
				break;
			}
			case "loadClasspathResources": {
				// Exact resources by locale, bypassing discovery entirely. Unlike discovery this path
				// permits META-INF/versions, which is itself worth a case.
				List<LocalizedStringWarning> warnings = new ArrayList<>();
				Map<String, Object> observed = new TreeMap<>();
				Map<Locale, String> resources = new LinkedHashMap<>();
				for (JsonObject.Member member : input.get("resources").asObject())
					resources.put(Locale.forLanguageTag(member.getName()), member.getValue().asString());
				try (URLClassLoader loader = classpathLoaderFor(fixtureDirectory)) {
					// The classloader-taking overload is not public for this entry point, so the loader is
					// installed as the thread context classloader for the duration of the call.
					ClassLoader previous = Thread.currentThread().getContextClassLoader();
					Thread.currentThread().setContextClassLoader(loader);
					try {
						describeLoaded(LocalizedStringLoader.loadFromClasspathResources(
								resources, warnings::add, loadingOptionsFrom(fixtureConfig.get("loadingOptions"))), observed);
					} finally {
						Thread.currentThread().setContextClassLoader(previous);
					}
				} catch (java.io.IOException | RuntimeException e) {
					observed.put("locales", new ArrayList<>());
					observed.put("keysByLocale", new TreeMap<>());
					observed.put("failed", true);
					observed.put("failureType", e.getClass().getName());
					observed.put("failureMessage", withoutTemporaryPaths(e.getMessage()));
				}
				observed.put("warnings", describeWarnings(warnings));
				expected.put("load", observed);
				break;
			}
			case "languageForms": {
				// Every (axis, name, renderName) tuple, emitted from Java's own enum constants.
				List<Object> tuples = new ArrayList<>();
				for (Map.Entry<String, Enum<?>> entry : LANGUAGE_FORMS.entrySet()) {
					String[] parts = entry.getKey().split("/", 2);
					Map<String, Object> tuple = new TreeMap<>();
					tuple.put("axis", parts[0]);
					tuple.put("name", parts[1]);
					tuple.put("renderName", entry.getValue().name());
					// What the value actually interpolates to, which is the reason renderName exists.
					tuple.put("rendered", entry.getValue().toString());
					tuples.add(tuple);
				}
				expected.put("tuples", tuples);
				break;
			}
			case "cardinalityForNumber": {
				Locale locale = Locale.forLanguageTag(input.getString("locale", null));
				Number number = asNumber(decodeValue(input.get("value")));
				Cardinality cardinality = input.get("visibleDecimalPlaces") == null
						? Cardinality.forNumber(number, locale)
						: Cardinality.forNumber(number, input.get("visibleDecimalPlaces").asInt(), locale);
				expected.put("classification", describeForm("cardinality", cardinality));
				break;
			}
			case "cardinalityForOperands": {
				expected.put("classification", describeForm("cardinality", Cardinality.forOperands(
						(PluralOperands) decodeValue(input.get("value")),
						Locale.forLanguageTag(input.getString("locale", null)))));
				break;
			}
			case "cardinalityForRange": {
				expected.put("classification", describeForm("cardinality", Cardinality.forRange(
						(Cardinality) decodeValue(input.get("start")),
						(Cardinality) decodeValue(input.get("end")),
						Locale.forLanguageTag(input.getString("locale", null)))));
				break;
			}
			case "ordinalityForNumber": {
				expected.put("classification", describeForm("ordinality", Ordinality.forNumber(
						asNumber(decodeValue(input.get("value"))),
						Locale.forLanguageTag(input.getString("locale", null)))));
				break;
			}
			case "ordinalityForOperands": {
				expected.put("classification", describeForm("ordinality", Ordinality.forOperands(
						(PluralOperands) decodeValue(input.get("value")),
						Locale.forLanguageTag(input.getString("locale", null)))));
				break;
			}
			case "supportedCardinalitiesForLocale": {
				expected.put("classifications", describeForms("cardinality",
						Cardinality.supportedCardinalitiesForLocale(Locale.forLanguageTag(input.getString("locale", null)))));
				break;
			}
			case "supportedOrdinalitiesForLocale": {
				expected.put("classifications", describeForms("ordinality",
						Ordinality.supportedOrdinalitiesForLocale(Locale.forLanguageTag(input.getString("locale", null)))));
				break;
			}
			default:
				throw new IllegalArgumentException("unsupported operation: " + operation);
		}

		return expected;
	}

	private static LocalizedStringLoadingOptions loadingOptionsFrom(JsonValue limits) {
		if (limits == null || limits.isNull()) return LocalizedStringLoadingOptions.defaults();
		LocalizedStringLoadingOptions.Builder builder = LocalizedStringLoadingOptions.builder();
		JsonObject options = limits.asObject();
		if (options.get("maximumJsonNestingDepth") != null) builder = builder.maximumJsonNestingDepth(options.get("maximumJsonNestingDepth").asInt());
		if (options.get("maximumTranslationNodes") != null) builder = builder.maximumTranslationNodes(options.get("maximumTranslationNodes").asInt());
		if (options.get("maximumWarnings") != null) builder = builder.maximumWarnings(options.get("maximumWarnings").asInt());
		if (options.get("maximumLocalizedStringsFiles") != null) builder = builder.maximumLocalizedStringsFiles(options.get("maximumLocalizedStringsFiles").asInt());
		if (options.get("maximumInputBytes") != null) builder = builder.maximumInputBytes(options.get("maximumInputBytes").asInt());
		if (options.get("maximumReaderCharacters") != null) builder = builder.maximumReaderCharacters(options.get("maximumReaderCharacters").asInt());
		if (options.get("maximumDiscoveryEntries") != null) builder = builder.maximumDiscoveryEntries(options.get("maximumDiscoveryEntries").asInt());
		if (options.get("maximumTotalInputBytes") != null) builder = builder.maximumTotalInputBytes(options.get("maximumTotalInputBytes").asLong());
		if (options.get("exhaustiveClasspathSearch") != null) builder = builder.exhaustiveClasspathSearch(options.get("exhaustiveClasspathSearch").asBoolean());
		return builder.build();
	}

	/**
	 * A classloader rooted at the PARENT of the fixture directory, so `getResources("<fixture id>")`
	 * resolves to the fixture's own files and nothing else on the real classpath interferes.
	 */
	private static URLClassLoader classpathLoaderFor(String fixtureDirectory) throws java.io.IOException {
		Path root = Paths.get(fixtureDirectory).getParent();
		// A directory URL must end in "/" or URLClassLoader treats it as a JAR. Path.toUri() already
		// appends one for an existing directory; the guard covers the case where it does not.
		String text = root.toUri().toString();
		if (!text.endsWith("/")) text = text + "/";
		try {
			return new URLClassLoader(new URL[] { new java.net.URI(text).toURL() }, null);
		} catch (java.net.URISyntaxException e) {
			throw new java.io.IOException("cannot build a classpath root URL for " + root, e);
		}
	}

	private static void describeLoaded(Map<Locale, Set<LocalizedString>> loaded, Map<String, Object> observed) {
		Map<String, Object> keysByLocale = new TreeMap<>();
		for (Map.Entry<Locale, Set<LocalizedString>> entry : loaded.entrySet()) {
			List<Object> keys = new ArrayList<>();
			for (LocalizedString localizedString : entry.getValue()) keys.add(localizedString.getKey());
			java.util.Collections.sort(keys, (a, b) -> ((String) a).compareTo((String) b));
			keysByLocale.put(entry.getKey().toLanguageTag(), keys);
		}
		observed.put("locales", new ArrayList<Object>(keysByLocale.keySet()));
		observed.put("keysByLocale", keysByLocale);
		observed.put("failed", false);
		observed.put("failureType", null);
		observed.put("failureMessage", null);
	}

	/** Warning records, in the order the handler received them. Order is part of the observation. */
	private static List<Object> describeWarnings(List<LocalizedStringWarning> warnings) {
		List<Object> out = new ArrayList<>();
		for (LocalizedStringWarning warning : warnings) {
			Map<String, Object> row = new TreeMap<>();
			row.put("type", warning.getType().name());
			row.put("message", withoutTemporaryPaths(warning.getMessage()));
			row.put("source", withoutTemporaryPaths(warning.getSource()));
			row.put("locale", warning.getLocale().map(Locale::toLanguageTag).orElse(null));
			row.put("key", warning.getKey().orElse(null));
			row.put("placeholder", warning.getPlaceholder().orElse(null));
			row.put("missingLanguageForms", new ArrayList<Object>(new java.util.TreeSet<>(warning.getMissingLanguageForms())));
			out.add(row);
		}
		return out;
	}

	/**
	 * Remove the per-run temporary directory from a diagnostic.
	 *
	 * Fixture files live under a fresh mkdtemp directory on every run, so any message quoting a full
	 * path would make the corpus differ from one run to the next and defeat the drift gate. Only the
	 * final path segment -- the part the fixture actually names -- is kept.
	 */
	private static String withoutTemporaryPaths(String message) {
		if (message == null) return null;
		return message
				.replaceAll("file:/[^\\s'\"]*/lokalized-vectors-[^/\\s'\"]*/fixtures/", "<fixtures>/")
				.replaceAll("/[^\\s'\"]*/lokalized-vectors-[^/\\s'\"]*/fixtures/", "<fixtures>/");
	}

	/**
	 * The ONE per-call override order this oracle will apply, named by the case rather than implied.
	 *
	 * TranslationOptions.Builder.locale and .languageRanges each NULL the other when handed a non-null
	 * value (TranslationOptions.java:309-313 and :330-333), so a call that sets both is decided by
	 * APPLICATION ORDER: the last one applied is the one that survives into build(). The private
	 * constructor's both-present guard (:70-71) is therefore dead by construction -- no Java caller can
	 * reach it -- and the corpus can never record a both-present TranslationOptions. What it CAN record
	 * is the order dependence itself, which is a real, observable property of the public builder.
	 *
	 * Before this existed the order was hard-coded here (locale, then ranges) and two corpus rows
	 * recorded the range-driven answer as though it were THE answer Java gives for a both-present call.
	 * It is not: it is the answer for one of two orders, and reversing the two lines below reverses the
	 * recorded outcome. That made the corpus encode an accident of this file. The order is now stated by
	 * the case, in a JSON ARRAY -- ordered by construction, unlike the object key order of `input`, which
	 * is exactly the accident being eliminated.
	 */
	private static final List<String> ORDERABLE_PER_CALL_OVERRIDES = List.of("locale", "languageRanges");

	/**
	 * Decode `input.perCallOverrideOrder` and check it against what the input actually presents.
	 *
	 * Fail-loud with AssertionError, on the `acceptLanguage` precedent: main()'s wrapper turns a
	 * RuntimeException into a plausible-looking `thrown` row, which would bank an authoring mistake as
	 * an observation. An Error escapes main() and fails the build. ingest.mjs refuses the same shapes
	 * earlier still; this is the backstop for a case file edited by hand.
	 *
	 * @return the order to apply the two mutually-clearing setters in, never null
	 */
	private static List<String> perCallOverrideOrder(JsonObject input, boolean localePresent, boolean rangesPresent) {
		JsonValue declared = input.get("perCallOverrideOrder");
		boolean orderDecides = localePresent && rangesPresent;

		if (!orderDecides) {
			// Declaring an order where only one of the two setters will run states a proposition the run
			// cannot observe. Refused rather than ignored: a field that is silently inert is a field that
			// looks like it is doing something.
			if (declared != null)
				throw new AssertionError("input.perCallOverrideOrder is declared but decides nothing: it is "
						+ "meaningful only when the input presents BOTH a locale and a non-null languageRanges, "
						+ "because those are the only two TranslationOptions.Builder setters that clear each other");
			return ORDERABLE_PER_CALL_OVERRIDES;
		}

		if (declared == null || !declared.isArray())
			throw new AssertionError("this input presents both a locale and languageRanges, whose "
					+ "TranslationOptions.Builder setters clear each other, so the outcome is decided by "
					+ "APPLICATION ORDER; the case must state it as "
					+ "\"perCallOverrideOrder\": [\"locale\", \"languageRanges\"] or the reverse");

		List<String> order = new ArrayList<>();
		for (JsonValue element : declared.asArray()) order.add(element.asString());
		// A CLOSED set, checked as an exact permutation. An unknown or repeated name would otherwise
		// silently apply a partial order and record a believable outcome for a state nobody described.
		if (order.size() != ORDERABLE_PER_CALL_OVERRIDES.size() || !new java.util.HashSet<>(order).equals(new java.util.HashSet<>(ORDERABLE_PER_CALL_OVERRIDES)))
			throw new AssertionError("input.perCallOverrideOrder must be an exact permutation of "
					+ ORDERABLE_PER_CALL_OVERRIDES + "; got " + order);
		return order;
	}

	/** Per-call TranslationOptions. Section 8.3's ingress matrix varies these against the instance. */
	private static TranslationOptions optionsFrom(JsonObject input) {
		String localeTag = input.getString("locale", null);
		JsonValue handler = input.get("translationFailureHandler");
		JsonValue policy = input.get("translationFallbackPolicy");
		JsonValue bidi = input.get("bidiIsolation");

		JsonValue rangeSpec = input.get("languageRanges");
		List<Locale.LanguageRange> ranges = languageRangesFrom(rangeSpec);
		// PRESENT means "will actually be applied to the builder". `"languageRanges": null` is a present
		// key that sets nothing (languageRangesFrom returns null for it), so it leaves no order to state
		// -- which is why the two owed-null-options rows carrying a locale beside an explicit null range
		// need no order field and are refused one.
		List<String> order = perCallOverrideOrder(input, localeTag != null, ranges != null);

		if (localeTag == null && handler == null && policy == null && bidi == null && rangeSpec == null) return TranslationOptions.none();
		if (handler == null && policy == null && bidi == null && rangeSpec == null) return TranslationOptions.forLocale(Locale.forLanguageTag(localeTag));

		TranslationOptions.Builder builder = TranslationOptions.builder();
		// The two mutually-clearing setters, applied in the order the CASE names. Every other setter
		// below is order-independent: none of them clears a sibling, so none takes part in the order.
		for (String override : order) {
			if (override.equals("locale")) {
				if (localeTag != null) builder = builder.locale(Locale.forLanguageTag(localeTag));
			} else {
				if (ranges != null) builder = builder.languageRanges(ranges);
			}
		}
		// A per-call handler REPLACES the instance handler (DefaultStrings.java:684), so it is wrapped
		// too -- otherwise setting one would silently switch the observation channel off.
		if (handler != null && !handler.isNull()) builder = builder.translationFailureHandler(handlerFrom(handler));
		if (policy != null && !policy.isNull()) builder = builder.translationFallbackPolicy(recordingPolicy(policyFrom(policy)));
		if (bidi != null && !bidi.isNull()) builder = builder.bidiIsolation(bidiFrom(bidi));
		return builder.build();
	}

	// --- options and policies ---------------------------------------------------------------------

	/**
	 * Failures observed by the handler during the case currently executing.
	 *
	 * A recording wrapper is installed around EVERY handler, including the library default, so every
	 * case gets a failure-observation channel without opting in. The wrapper delegates to the real
	 * handler, so it is behavior-neutral: the library default is TranslationFailureHandler.returnKey()
	 * (DefaultStrings.java:472) and that is what an unconfigured fixture still gets.
	 *
	 * Single-threaded by construction -- the oracle runs cases in sequence -- and cleared before each.
	 */
	private static final List<TranslationFailure> OBSERVED_FAILURES = new ArrayList<>();

	private static TranslationFailureHandler recording(TranslationFailureHandler delegate) {
		return failure -> {
			OBSERVED_FAILURES.add(failure);
			return delegate.handle(failure);
		};
	}

	/**
	 * Callback invocations observed during the case currently executing.
	 *
	 * Section 8.2 requires callbacks to be referenced by versioned fixture ID rather than embedded as
	 * code, so every callback here is a NAMED BEHAVIOR. Each is wrapped in a recorder, which turns the
	 * callback itself into an observation channel: what it was called with, how often, and in what
	 * order. Several section 8.3 clauses are only answerable that way -- "no policy call after the
	 * final distinct candidate" is a statement about calls that did NOT happen.
	 */
	private static final List<Map<String, Object>> PHONETIC_CALLS = new ArrayList<>();
	private static final List<Map<String, Object>> POLICY_CALLS = new ArrayList<>();

	/** Named PhoneticResolver behaviors, each wrapped so its invocations are recorded. */
	private static PhoneticResolver resolverFrom(JsonValue spec) {
		PhoneticResolver delegate = delegateResolverFrom(spec);
		return (term, locale) -> {
			Map<String, Object> call = new TreeMap<>();
			call.put("term", term);
			// The locale the resolver is HANDED. Under the donor rule this is the supplying locale, not
			// the requested one, and a port that passes the wrong one is only detectable here.
			call.put("locale", locale == null ? null : locale.toLanguageTag());
			PHONETIC_CALLS.add(call);
			try {
				Phonetic resolved = delegate.resolve(term, locale);
				call.put("returned", resolved == null ? null : resolved.name());
				call.put("threw", null);
				return resolved;
			} catch (RuntimeException e) {
				call.put("returned", null);
				call.put("threw", e.getClass().getName());
				throw e;
			}
		};
	}

	private static PhoneticResolver delegateResolverFrom(JsonValue spec) {
		JsonObject config = spec.asObject();
		String behavior = config.getString("behavior", null);
		switch (behavior) {
			case "constant": {
				Phonetic phonetic = (Phonetic) LANGUAGE_FORMS.get("phonetic/" + config.getString("phonetic", null));
				if (phonetic == null) throw new IllegalArgumentException("unknown phonetic constant: " + config.getString("phonetic", null));
				return (term, locale) -> phonetic;
			}
			case "by-term": {
				Map<String, Phonetic> mapping = new LinkedHashMap<>();
				for (JsonObject.Member member : config.get("mapping").asObject())
					mapping.put(member.getName(), (Phonetic) LANGUAGE_FORMS.get("phonetic/" + member.getValue().asString()));
				String fallbackName = config.getString("default", null);
				Phonetic fallback = fallbackName == null ? null : (Phonetic) LANGUAGE_FORMS.get("phonetic/" + fallbackName);
				return (term, locale) -> mapping.containsKey(term) ? mapping.get(term) : fallback;
			}
			case "by-locale": {
				// Makes the LOCALE ARGUMENT observable in the returned value, not merely in the record.
				Map<String, Phonetic> mapping = new LinkedHashMap<>();
				for (JsonObject.Member member : config.get("mapping").asObject())
					mapping.put(member.getName(), (Phonetic) LANGUAGE_FORMS.get("phonetic/" + member.getValue().asString()));
				String fallbackName = config.getString("default", null);
				Phonetic fallback = fallbackName == null ? null : (Phonetic) LANGUAGE_FORMS.get("phonetic/" + fallbackName);
				return (term, locale) -> {
					String tag = locale == null ? "" : locale.toLanguageTag();
					return mapping.containsKey(tag) ? mapping.get(tag) : fallback;
				};
			}
			case "first-letter-vowel":
				return (term, locale) -> term != null && term.length() > 0 && "aeiouAEIOU".indexOf(term.charAt(0)) >= 0
						? Phonetic.VOWEL : Phonetic.CONSONANT;
			case "return-null":
				return (term, locale) -> null;
			case "throw": {
				String message = config.getString("message", "phonetic resolver failed deliberately");
				return (term, locale) -> { throw new IllegalStateException(message); };
			}
			default:
				throw new IllegalArgumentException("unknown phonetic resolver behavior: " + behavior);
		}
	}

	private static void addCallbackChannels(Map<String, Object> expected) {
		if (!PHONETIC_CALLS.isEmpty()) expected.put("resolverCalls", new ArrayList<Object>(PHONETIC_CALLS));
		if (!POLICY_CALLS.isEmpty()) expected.put("policyCalls", new ArrayList<Object>(POLICY_CALLS));
		if (!SUPPLIER_CALLS.isEmpty()) expected.put("supplierCalls", new ArrayList<Object>(SUPPLIER_CALLS));
	}

	/**
	 * Wrap a policy so every consultation is recorded, including the ones that never happen.
	 *
	 * The arguments are recorded BEFORE the delegate runs and the outcome is filled in afterwards --
	 * the same shape `resolverFrom` already uses (VectorOracle.java:930-950) and for the same reason.
	 * Recording after the call made a THROWING policy's consultation unobservable: the whole
	 * policyCalls channel came back absent, so a port could pass every `throw-in-policy` row while
	 * handing the policy the wrong reason, locale or cause on that final consultation.
	 *
	 * `threw` is written ONLY on the throwing path, so a policy that RETURNS null (`return-null`,
	 * which Java then rejects at DefaultStrings.java:735) stays distinguishable from one that threw:
	 * both record `decision: null`, and only the latter names the exception. Every non-throwing
	 * consultation keeps its exact four-key shape, so no existing `expected` block moves.
	 */
	private static TranslationFallbackPolicy recordingPolicy(TranslationFallbackPolicy delegate) {
		return (reason, locale, cause) -> {
			Map<String, Object> call = new TreeMap<>();
			call.put("reason", reason == null ? null : reason.name());
			call.put("locale", locale == null ? null : locale.toLanguageTag());
			call.put("causeType", cause == null ? null : cause.getClass().getName());
			call.put("decision", null);
			POLICY_CALLS.add(call);
			try {
				Boolean decision = delegate.shouldTryNextLocale(reason, locale, cause);
				call.put("decision", decision);
				return decision;
			} catch (RuntimeException e) {
				call.put("threw", e.getClass().getName());
				throw e;
			}
		};
	}

	/** What an ambient locale/match supplier returned for the case currently executing. */
	private static final List<Map<String, Object>> SUPPLIER_CALLS = new ArrayList<>();

	/** Parse an Accept-Language style header, or explicit {range, weight} pairs, into ranges. */
	private static List<Locale.LanguageRange> languageRangesFrom(JsonValue spec) {
		if (spec == null || spec.isNull()) return null;
		if (spec.isString()) return Locale.LanguageRange.parse(spec.asString());
		List<Locale.LanguageRange> ranges = new ArrayList<>();
		for (JsonValue element : spec.asArray()) {
			if (element.isString()) { ranges.add(new Locale.LanguageRange(element.asString())); continue; }
			JsonObject entry = element.asObject();
			ranges.add(entry.get("weight") == null
					? new Locale.LanguageRange(entry.getString("range", null))
					: new Locale.LanguageRange(entry.getString("range", null), entry.get("weight").asDouble()));
		}
		return ranges;
	}

	/** The ambient locale ingress: a caller-supplied function handed the matcher itself. */
	private static java.util.function.Function<LocaleMatcher, Locale> localeSupplierFrom(JsonValue spec) {
		JsonObject config = spec.asObject();
		String behavior = config.getString("behavior", null);
		return matcher -> {
			Locale supplied;
			switch (behavior) {
				case "constant":
					supplied = Locale.forLanguageTag(config.getString("locale", null));
					break;
				case "match-ranges":
					// The realistic browser shape: negotiate the ambient locale from Accept-Language.
					supplied = matcher.matchFor(languageRangesFrom(config.get("ranges")))
							.getLocale().orElse(matcher.matchFor(languageRangesFrom(config.get("ranges"))).getFallbackLocale());
					break;
				default:
					throw new IllegalArgumentException("unknown locale supplier behavior: " + behavior);
			}
			Map<String, Object> call = new TreeMap<>();
			call.put("kind", "localeSupplier");
			call.put("returnedLocale", supplied == null ? null : supplied.toLanguageTag());
			call.put("returnedMatchType", null);
			SUPPLIER_CALLS.add(call);
			return supplied;
		};
	}

	/**
	 * The negotiation ingress: a caller-supplied function returning a whole LocaleMatchResult.
	 *
	 * `fabricated` uses LocaleMatchResult's public constructor to hand the library a match the matcher
	 * would never have produced. Section 8.3 requires the "intentional lookup difference" for supplied
	 * matches to be preserved, which is only observable when the supplied match disagrees with reality.
	 */
	private static java.util.function.Function<LocaleMatcher, LocaleMatchResult> localeMatchSupplierFrom(JsonValue spec) {
		JsonObject config = spec.asObject();
		String behavior = config.getString("behavior", null);
		return matcher -> {
			LocaleMatchResult supplied;
			switch (behavior) {
				case "match-ranges":
					supplied = matcher.matchFor(languageRangesFrom(config.get("ranges")));
					break;
				case "match-locale":
					supplied = matcher.matchFor(Locale.forLanguageTag(config.getString("locale", null)));
					break;
				case "fabricated": {
					List<Locale.LanguageRange> requested = config.get("ranges") == null
							? new ArrayList<>() : languageRangesFrom(config.get("ranges"));
					String localeTag = config.getString("locale", null);
					String rangeText = config.getString("range", null);
					List<Locale> considered = new ArrayList<>();
					if (config.get("consideredLocales") != null)
						for (JsonValue tag : config.get("consideredLocales").asArray()) considered.add(Locale.forLanguageTag(tag.asString()));
					supplied = new LocaleMatchResult(
							requested,
							localeTag == null ? null : Locale.forLanguageTag(localeTag),
							rangeText == null ? null : new Locale.LanguageRange(rangeText),
							fabricatedWeightFrom(config.get("weight")),
							LocaleMatchType.valueOf(config.getString("matchType", "NONE")),
							Locale.forLanguageTag(config.getString("fallbackLocale", "en")),
							considered);
					break;
				}
				default:
					throw new IllegalArgumentException("unknown locale match supplier behavior: " + behavior);
			}
			Map<String, Object> call = new TreeMap<>();
			call.put("kind", "localeMatchSupplier");
			call.put("returnedLocale", supplied.getLocale().map(Locale::toLanguageTag).orElse(null));
			call.put("returnedMatchType", supplied.getMatchType().name());
			SUPPLIER_CALLS.add(call);
			return supplied;
		};
	}

	/**
	 * A fabricated match's effective weight, including the NON-FINITE value JSON cannot spell.
	 *
	 * LocaleMatchResult:111 refuses a weight that is not finite, at most 0, or above 1. The last two
	 * are ordinary JSON numbers and the corpus has both; the FIRST cannot be written in JSON at all,
	 * so its arm was unreachable while a JS caller can pass `Infinity` or `NaN` without trying. The
	 * string sentinels are a CLOSED set of two, and an unrecognized string fails the build loudly
	 * rather than defaulting to a finite number, which would close the branch with a case that
	 * observed the wrong refusal.
	 *
	 * The two sentinels are not interchangeable and only ONE of them discriminates the clause.
	 * POSITIVE_INFINITY is also caught by `effectiveWeight > 1.0`, so a port that dropped the
	 * finiteness test entirely still refuses it -- measured on lokalized-js, where deleting
	 * `!Number.isFinite(effectiveWeight)` left the infinity row passing. NaN is the discriminating
	 * value: `NaN > 1.0` and `NaN <= 0.0` are both false here and in JS, so `!Double.isFinite(w)` is
	 * the only conjunct that can reject it. Reaching the branch is not discriminating it, and the
	 * infinity row alone only reached it.
	 */
	private static Double fabricatedWeightFrom(JsonValue weight) {
		if (weight == null || weight.isNull()) return null;
		if (!weight.isString()) return weight.asDouble();
		String sentinel = weight.asString();
		if ("infinity".equals(sentinel)) return Double.POSITIVE_INFINITY;
		if ("nan".equals(sentinel)) return Double.NaN;
		throw new IllegalArgumentException("unknown fabricated match weight sentinel '" + sentinel + "'");
	}

	/** Named handler behaviors. Section 8.2 requires callbacks by versioned id, never embedded code. */
	private static TranslationFailureHandler handlerFrom(JsonValue spec) {
		if (spec == null || spec.isNull()) return recording(TranslationFailureHandler.returnKey());
		JsonObject config = spec.asObject();
		String behavior = config.getString("behavior", null);
		switch (behavior) {
			case "return-key":
				return recording(TranslationFailureHandler.returnKey());
			case "throw":
				return recording(TranslationFailureHandler.throwException());
			case "return-string": {
				String text = config.getString("text", null);
				return recording(failure -> TranslationFailureResponse.returnString(text));
			}
			case "throw-in-handler": {
				// Section 8.3 "callback exceptions": the handler itself fails. Recorded BEFORE throwing,
				// so the corpus still shows the failure the handler was called for.
				String message = config.getString("message", "handler failed deliberately");
				return recording(failure -> { throw new IllegalStateException(message); });
			}
			case "return-null":
				// A handler that returns null rather than a response. DefaultStrings.java:749-750 wraps the
				// call in requireNonNull, so Java answers with a NullPointerException carrying a message it
				// composes itself. The port's refusal of a null response was derived by READING that line
				// (plan open question 7); this behavior is what lets the corpus state it instead.
				return recording(failure -> null);
			default:
				throw new IllegalArgumentException("unknown failure handler behavior: " + behavior);
		}
	}

	private static TranslationFallbackPolicy policyFrom(JsonValue spec) {
		if (spec == null || spec.isNull()) return null;
		if (spec.isObject()) return customPolicyFrom(spec.asObject());
		String name = spec.asString();
		switch (name) {
			case "missing-or-no-match": return TranslationFallbackPolicy.fallbackOnMissingTranslationOrNoMatchingAlternative();
			case "any-failure": return TranslationFallbackPolicy.fallbackOnAnyFailure();
			case "never": return TranslationFallbackPolicy.neverFallback();
			default: throw new IllegalArgumentException("unknown fallback policy: " + name);
		}
	}

	/** A caller-supplied policy, referenced by name. Object form; the string form selects a built-in. */
	private static TranslationFallbackPolicy customPolicyFrom(JsonObject config) {
		String behavior = config.getString("behavior", null);
		switch (behavior) {
			case "continue-for-locales": {
				Set<String> tags = new java.util.LinkedHashSet<>();
				for (JsonValue tag : config.get("locales").asArray()) tags.add(tag.asString());
				return (reason, locale, cause) -> locale != null && tags.contains(locale.toLanguageTag());
			}
			case "continue-for-reasons": {
				Set<String> reasons = new java.util.LinkedHashSet<>();
				for (JsonValue reason : config.get("reasons").asArray()) reasons.add(reason.asString());
				return (reason, locale, cause) -> reason != null && reasons.contains(reason.name());
			}
			case "throw-in-policy": {
				String message = config.getString("message", "fallback policy failed deliberately");
				return (reason, locale, cause) -> { throw new IllegalStateException(message); };
			}
			case "return-null":
				// The policy-side counterpart of `return-null` above, and of the resolver's, which has had
				// one since M5. DefaultStrings.java:734-735 rejects it with requireNonNull. Distinguishable
				// from throw-in-policy in the record: both leave `decision` null, and only a throw names an
				// exception in `threw`.
				return (reason, locale, cause) -> null;
			default:
				throw new IllegalArgumentException("unknown custom fallback policy behavior: " + behavior);
		}
	}

	private static BidiIsolation bidiFrom(JsonValue spec) {
		return spec == null || spec.isNull() ? null : BidiIsolation.valueOf(spec.asString());
	}

	private static TranslationRuntimeLimits runtimeLimitsFrom(JsonValue spec) {
		if (spec == null || spec.isNull()) return null;
		JsonObject config = spec.asObject();
		TranslationRuntimeLimits.Builder builder = TranslationRuntimeLimits.builder();
		for (JsonObject.Member member : config) {
			int value = member.getValue().asInt();
			switch (member.getName()) {
				case "maximumNumberPrecision": builder = builder.maximumNumberPrecision(value); break;
				case "maximumAbsoluteNumberScale": builder = builder.maximumAbsoluteNumberScale(value); break;
				case "maximumVisibleDecimalPlaces": builder = builder.maximumVisibleDecimalPlaces(value); break;
				case "maximumCompactExponent": builder = builder.maximumCompactExponent(value); break;
				case "maximumExpressionCharacters": builder = builder.maximumExpressionCharacters(value); break;
				case "maximumExpressionTokens": builder = builder.maximumExpressionTokens(value); break;
				case "maximumExpressionNestingDepth": builder = builder.maximumExpressionNestingDepth(value); break;
				case "maximumGeneratedPlaceholderDepth": builder = builder.maximumGeneratedPlaceholderDepth(value); break;
				case "maximumInterpolatedOutputCharacters": builder = builder.maximumInterpolatedOutputCharacters(value); break;
				case "maximumGeneratedExpansionCharacters": builder = builder.maximumGeneratedExpansionCharacters(value); break;
				default: throw new IllegalArgumentException("unknown runtime limit: " + member.getName());
			}
		}
		return builder.build();
	}

	/** What the failure handler was handed, plus whether it saw the SAME match object as the result. */
	private static List<Object> describeObservedFailures(TranslationResult result) {
		LocaleMatchResult fromResult = result == null ? null : result.getLocaleMatchResult().orElse(null);
		List<Object> out = new ArrayList<>();
		for (TranslationFailure failure : OBSERVED_FAILURES) {
			Map<String, Object> row = new TreeMap<>();
			row.put("key", failure.getKey());
			row.put("reason", failure.getReason().name());
			row.put("lookupLocale", failure.getLookupLocale().toLanguageTag());
			row.put("attemptedLocales", tags(failure.getAttemptedLocales()));
			row.put("message", failure.getMessage());
			row.put("placeholderNames", new ArrayList<Object>(new java.util.TreeSet<>(failure.getPlaceholders().keySet())));
			row.put("causeType", failure.getCause().map(c -> (Object) c.getClass().getName()).orElse(null));
			row.put("causeMessage", failure.getCause().map(Throwable::getMessage).orElse(null));
			LocaleMatchResult fromFailure = failure.getLocaleMatchResult().orElse(null);
			row.put("localeMatchResult", fromFailure == null ? null : describeMatch(fromFailure));
			// Section 8.3 requires "identical match-object identity through result, failure, fallback
			// observer, and thrown-failure paths". Reference identity is only checkable here, in Java.
			//
			// TRI-STATE on purpose. The get() and thrown paths produce no result object, so there is
			// nothing to compare against; reporting `false` there would conflate "the two objects
			// differ" with "the comparison could not be made" and invent a divergence that does not
			// exist. Null means not comparable.
			row.put("matchObjectIdenticalToResult",
					fromResult == null ? null : Boolean.valueOf(fromFailure == fromResult));
			out.add(row);
		}
		return out;
	}

	// --- the `define` model decoder -----------------------------------------------------------------

	/**
	 * Decode ONE hand-built LocalizedString from a case input.
	 *
	 * The vocabulary is deliberately the SAME one a fixture strings file uses -- key, translation,
	 * commentary, placeholders, alternatives; a placeholder is {value|range, translations} or
	 * {translation, alternatives} -- so a case author writes the probe in the shape they already know
	 * and a reader can diff it against the fixture line by line. Only the public API is used
	 * (LocalizedString's own constructor is private), so nothing here can build a shape the loader
	 * could not also produce.
	 *
	 * EVERY authoring mistake throws an Error, never a RuntimeException. The `define` clause catches
	 * RuntimeException to record a REFUSED construction as an observation; if a mistyped member or an
	 * unknown language-form name arrived as a RuntimeException it would be banked as `built: false`
	 * with a plausible-looking failure identity -- a case that closes a branch while specifying
	 * nothing, which is the exact anti-pattern this operation exists to avoid. An Error escapes
	 * main() and fails the build loudly instead. Same rule as constructionOverrides' closed set.
	 *
	 * THAT RULE WAS A CLAIM, NOT A FACT, UNTIL IT WAS MEASURED, and it was false in five places. An
	 * adversarial review ran mistyped probes through this decoder on the pinned JDK and found that a
	 * numeric `translation`, an object `alternatives`, a numeric language-form branch text, a numeric
	 * placeholder `value` and -- worst -- a `range` missing its `end` were all banked as plausible
	 * `built: false` refusals: MinimalJson's bare `asString()` / `asArray()` / `asObject()` raise
	 * UnsupportedOperationException, and `range.getString("end", null)` defaulted to null before
	 * LanguageFormTranslationRange's requireNonNull saw it, banking a NullPointerException with a NULL
	 * failureMessage. Every accessor below is therefore TYPE-CHECKED first, through the four `define*`
	 * helpers, and `range` must carry both a string `start` and a string `end`. ingest.mjs's key gate
	 * does not catch any of this -- its `constructible()` predicate judges {key, translation: 5}
	 * constructible -- so the check has to live here.
	 */
	private static LocalizedString buildLocalizedString(JsonValue model) {
		if (!model.isObject()) throw new AssertionError("define input.localizedString must be an object");
		JsonValue key = model.asObject().get("key");
		if (key == null || !key.isString())
			throw new AssertionError("define input.localizedString needs a string 'key'");
		return localizedStringFrom(key.asString(), model, true);
	}

	/**
	 * The four typed accessors the decoder uses INSTEAD of MinimalJson's bare asString/asArray/asObject.
	 *
	 * The bare accessors throw UnsupportedOperationException, which is a RuntimeException, which the
	 * `define` clause catches and banks as a construction refusal. These throw AssertionError, which
	 * escapes main() and fails the build with the offending node named. `where` is the node's path in
	 * the case input, so the message points at the JSON the author actually wrote.
	 */
	private static String defineString(String where, JsonValue node) {
		if (node == null || !node.isString())
			throw new AssertionError("define " + where + " must be a string; got " + node);
		return node.asString();
	}

	private static JsonObject defineObject(String where, JsonValue node) {
		if (node == null || !node.isObject())
			throw new AssertionError("define " + where + " must be an object; got " + node);
		return node.asObject();
	}

	private static JsonArray defineArray(String where, JsonValue node) {
		if (node == null || !node.isArray())
			throw new AssertionError("define " + where + " must be an array; got " + node);
		return node.asArray();
	}

	/** A member that may be an explicit JSON null -- a legitimate input -- but never a wrong type. */
	private static String defineNullableString(String where, JsonValue node) {
		return node.isNull() ? null : defineString(where, node);
	}

	/**
	 * @param key            this node's key. At the top level that is the translation key; for an
	 *                       ALTERNATIVE it is the expression string, because the loader passes
	 *                       member.getName() as the child's key (LocalizedStringLoader.java:2272-2275).
	 *                       That is what makes LocalizedString#equals:165's unequal-key arm reachable
	 *                       at all: at the top level contains() looked the candidate up BY this key, so
	 *                       the two keys are equal by construction and :165 can only ever be false there.
	 * @param allowKeyMember whether a literal "key" member is permitted -- true only at the top level,
	 *                       where the key is written inline rather than carried by the enclosing member.
	 */
	private static LocalizedString localizedStringFrom(String key, JsonValue body, boolean allowKeyMember) {
		LocalizedString.Builder builder = new LocalizedString.Builder(key);
		// A bare string is a translation-only node, exactly as in a strings file.
		if (body.isString()) return builder.translation(body.asString()).build();
		if (!body.isObject())
			throw new AssertionError("define model node '" + key + "' must be a string or an object");

		JsonObject object = body.asObject();
		for (JsonObject.Member member : object) {
			String name = member.getName();
			if (name.equals("key") && allowKeyMember) continue;
			if (!name.equals("translation") && !name.equals("commentary")
					&& !name.equals("placeholders") && !name.equals("alternatives"))
				throw new AssertionError("unknown define model member '" + name + "' on node '" + key + "'");
		}

		// PRESENCE, not truthiness, throughout: an explicit null translation is a legitimate input and is
		// how the <init>:110 refusal is reached alongside an absent one.
		JsonValue translation = object.get("translation");
		if (translation != null)
			builder = builder.translation(defineNullableString("node '" + key + "' member 'translation'", translation));
		JsonValue commentary = object.get("commentary");
		if (commentary != null)
			builder = builder.commentary(defineNullableString("node '" + key + "' member 'commentary'", commentary));

		JsonValue placeholders = object.get("placeholders");
		if (placeholders != null && !placeholders.isNull()) {
			Map<String, LocalizedString.PlaceholderDefinition> definitions = new LinkedHashMap<>();
			for (JsonObject.Member member : defineObject("node '" + key + "' member 'placeholders'", placeholders))
				definitions.put(member.getName(), placeholderDefinitionFrom(member.getName(), member.getValue()));
			builder = builder.placeholderDefinitions(definitions);
		}

		JsonValue alternatives = object.get("alternatives");
		if (alternatives != null && !alternatives.isNull()) {
			List<LocalizedString> children = new ArrayList<>();
			for (JsonValue element : defineArray("node '" + key + "' member 'alternatives'", alternatives)) {
				if (!element.isObject() || element.asObject().size() != 1)
					throw new AssertionError("each define alternative must be an object with exactly one expression, "
							+ "matching the loader's array-order-is-precedence rule; offending node '" + key + "'");
				for (JsonObject.Member member : element.asObject())
					children.add(localizedStringFrom(member.getName(), member.getValue(), false));
			}
			builder = builder.alternatives(children);
		}

		return builder.build();
	}

	/** A placeholder definition in the strings-file vocabulary: language-form, or generated fragment. */
	private static LocalizedString.PlaceholderDefinition placeholderDefinitionFrom(String name, JsonValue value) {
		if (!value.isObject()) throw new AssertionError("define placeholder '" + name + "' must be an object");
		JsonObject object = value.asObject();
		for (JsonObject.Member member : object) {
			String member_name = member.getName();
			if (!member_name.equals("value") && !member_name.equals("range") && !member_name.equals("translations")
					&& !member_name.equals("translation") && !member_name.equals("alternatives"))
				throw new AssertionError("unknown define placeholder member '" + member_name + "' on '" + name + "'");
		}

		JsonValue valueMember = object.get("value");
		JsonValue rangeMember = object.get("range");
		JsonValue translationsMember = object.get("translations");
		JsonValue translationMember = object.get("translation");
		JsonValue alternativesMember = object.get("alternatives");

		boolean languageForm = valueMember != null || rangeMember != null || translationsMember != null;
		boolean template = translationMember != null || alternativesMember != null;
		// The loader refuses a mixed placeholder outright, so a mixed model would describe an object no
		// loaded catalog can contain and its equals row would compare nothing meaningful.
		if (languageForm == template)
			throw new AssertionError("define placeholder '" + name + "' must use language-form members "
					+ "[value, range, translations] or template members [translation, alternatives], not both or neither");

		if (template) {
			String fragmentTranslation = translationMember == null
					? null : defineString("placeholder '" + name + "' member 'translation'", translationMember);
			if (fragmentTranslation == null)
				throw new AssertionError("define placeholder '" + name + "' needs a 'translation'");
			// PRESENCE of the alternatives member selects the two-argument constructor even when the list is
			// EMPTY. That is deliberate and is the only route to ExpressionTranslation#<init>:871; routing an
			// empty list to the one-argument constructor would quietly build a valid object instead.
			if (alternativesMember == null) return new LocalizedString.ExpressionTranslation(fragmentTranslation);
			List<LocalizedString.ExpressionAlternative> fragmentAlternatives = new ArrayList<>();
			for (JsonValue element : defineArray("placeholder '" + name + "' member 'alternatives'", alternativesMember)) {
				if (!element.isObject() || element.asObject().size() != 1)
					throw new AssertionError("each define fragment alternative must be an object with exactly one expression; "
							+ "offending placeholder '" + name + "'");
				for (JsonObject.Member member : element.asObject())
					fragmentAlternatives.add(new LocalizedString.ExpressionAlternative(member.getName(),
							defineString("placeholder '" + name + "' alternative '" + member.getName() + "'", member.getValue())));
			}
			return new LocalizedString.ExpressionTranslation(fragmentTranslation, fragmentAlternatives);
		}

		if (translationsMember == null)
			throw new AssertionError("define placeholder '" + name + "' needs 'translations'");
		Map<LanguageForm, String> byForm = new LinkedHashMap<>();
		for (JsonObject.Member member : defineObject("placeholder '" + name + "' member 'translations'", translationsMember))
			byForm.put(languageFormNamed(member.getName()),
					defineString("placeholder '" + name + "' form '" + member.getName() + "'", member.getValue()));

		if ((valueMember == null) == (rangeMember == null))
			throw new AssertionError("define placeholder '" + name + "' needs exactly one of 'value' and 'range'");
		if (valueMember != null)
			return new LocalizedString.LanguageFormTranslation(
					defineString("placeholder '" + name + "' member 'value'", valueMember), byForm);

		// BOTH ends required, and required to be STRINGS. getString("end", null) would default a missing
		// end to null, and LanguageFormTranslationRange's requireNonNull(end) carries no message, so an
		// omitted end used to bank a NullPointerException with a null failureMessage as a refusal.
		JsonObject range = defineObject("placeholder '" + name + "' member 'range'", rangeMember);
		return new LocalizedString.LanguageFormTranslation(
				new LocalizedString.LanguageFormTranslationRange(
						defineString("placeholder '" + name + "' range 'start'", range.get("start")),
						defineString("placeholder '" + name + "' range 'end'", range.get("end"))), byForm);
	}

	/**
	 * The allowlisted constant name -> the Java LanguageForm it denotes, WITHOUT a second table.
	 *
	 * LANGUAGE_FORMS is keyed "axis/NAME" and is itself verified against Java's enums at startup; the
	 * names already carry their axis ("CARDINALITY_ONE"), so a bare-name lookup is unambiguous. Reusing
	 * it means a define case cannot name a form the allowlist does not contain, and cannot drift from
	 * the (axis, name, renderName) tuple table section 3.7 forbids deriving.
	 */
	private static LanguageForm languageFormNamed(String name) {
		LanguageForm found = null;
		for (Map.Entry<String, Enum<?>> entry : LANGUAGE_FORMS.entrySet()) {
			if (!entry.getKey().endsWith("/" + name)) continue;
			if (found != null) throw new AssertionError("language form name '" + name + "' is ambiguous across axes");
			found = (LanguageForm) entry.getValue();
		}
		if (found == null) throw new AssertionError("not an allowlisted language form: '" + name + "'");
		return found;
	}

	// --- typed values -----------------------------------------------------------------------------

	/** (axis + "/" + JS constant name) -> the Java enum constant it denotes. */
	private static final Map<String, Enum<?>> LANGUAGE_FORMS = new java.util.LinkedHashMap<>();

	private static final Map<String, Enum<?>[]> AXES = new java.util.LinkedHashMap<>();
	static {
		AXES.put("cardinality", Cardinality.values());
		AXES.put("ordinality", Ordinality.values());
		AXES.put("gender", Gender.values());
		AXES.put("grammatical-case", GrammaticalCase.values());
		AXES.put("definiteness", Definiteness.values());
		AXES.put("classifier", Classifier.values());
		AXES.put("formality", Formality.values());
		AXES.put("clusivity", Clusivity.values());
		AXES.put("animacy", Animacy.values());
		AXES.put("phonetic", Phonetic.values());
	}

	/**
	 * Pair each JS constant name with a Java enum constant WITHOUT assuming an axis prefix.
	 *
	 * For each name, the unique enum constant E such that the name ends with "_" + E.name() is the
	 * match. Uniqueness and completeness are asserted in both directions, so this is a verification of
	 * the tuple table rather than a derivation of it: if Java's constants ever change, or the
	 * allowlist drifts, the oracle refuses to run instead of emitting a plausible-looking table.
	 */
	private static void buildLanguageForms(JsonObject constantsByAxis) {
		for (Map.Entry<String, Enum<?>[]> axis : AXES.entrySet()) {
			JsonValue declared = constantsByAxis.get(axis.getKey());
			if (declared == null) throw new IllegalStateException("allowlist has no axis " + axis.getKey());

			Set<Enum<?>> claimed = new java.util.LinkedHashSet<>();
			for (JsonValue nameValue : declared.asArray()) {
				String name = nameValue.asString();
				Enum<?> matched = null;
				for (Enum<?> candidate : axis.getValue()) {
					if (!name.endsWith("_" + candidate.name())) continue;
					if (matched != null)
						throw new IllegalStateException(name + " matches both " + matched.name() + " and " + candidate.name());
					matched = candidate;
				}
				if (matched == null)
					throw new IllegalStateException("no Java constant for " + axis.getKey() + " " + name);
				if (!claimed.add(matched))
					throw new IllegalStateException("two names map to " + axis.getKey() + " " + matched.name());
				LANGUAGE_FORMS.put(axis.getKey() + "/" + name, matched);
			}

			if (claimed.size() != axis.getValue().length)
				throw new IllegalStateException("axis " + axis.getKey() + ": allowlist covers " + claimed.size()
						+ " of " + axis.getValue().length + " Java constants");
		}
	}

	private static Map<String, Object> describeForm(String axis, Enum<?> form) {
		String name = null;
		for (Map.Entry<String, Enum<?>> entry : LANGUAGE_FORMS.entrySet())
			if (entry.getValue() == form && entry.getKey().startsWith(axis + "/")) name = entry.getKey().substring(axis.length() + 1);
		Map<String, Object> row = new TreeMap<>();
		row.put("axis", axis);
		row.put("name", name);
		row.put("renderName", form.name());
		return row;
	}

	private static List<Object> describeForms(String axis, SortedSet<? extends Enum<?>> forms) {
		List<Object> out = new ArrayList<>();
		for (Enum<?> form : forms) out.add(describeForm(axis, form));
		return out;
	}

	private static Map<String, Object> decodePlaceholders(JsonObject placeholders) {
		Map<String, Object> decoded = new LinkedHashMap<>();
		for (JsonObject.Member member : placeholders) decoded.put(member.getName(), decodeValue(member.getValue()));
		return decoded;
	}

	/**
	 * Decode one placeholder value.
	 *
	 * Numbers are carried as TAGGED STRINGS rather than JSON numbers wherever the exact type or
	 * precision matters: JSON has one number type, so `1e18` and `1.0` would otherwise reach Java as
	 * whatever the parser chose, and the safe-integer-boundary and trailing-zero fixtures of section
	 * 8.3 exist precisely to distinguish those.
	 */
	private static Object decodeValue(JsonValue value) {
		if (value == null || value.isNull()) return null;
		if (value.isString()) return value.asString();
		if (value.isBoolean()) return value.asBoolean();
		if (value.isNumber()) {
			String literal = value.toString();
			if (literal.matches("-?[0-9]+")) {
				BigInteger integer = new BigInteger(literal);
				if (integer.bitLength() < 32) return integer.intValue();
				if (integer.bitLength() < 64) return integer.longValue();
				return integer;
			}
			return Double.parseDouble(literal);
		}

		JsonObject object = value.asObject();
		String tag = object.getString("$lokalized", null);
		if (tag == null) throw new IllegalArgumentException("untagged object placeholder: " + object);

		switch (tag) {
			case "decimal": return new BigDecimal(object.getString("value", null));
			case "bigint": return new BigInteger(object.getString("value", null));
			case "double": return Double.valueOf(object.getString("value", null));
			case "float": return Float.valueOf(object.getString("value", null));
			case "long": return Long.valueOf(object.getString("value", null));
			case "integer": return Integer.valueOf(object.getString("value", null));
			case "plural-operands": {
				PluralOperands.Builder builder = PluralOperands.forNumber(new BigDecimal(object.getString("value", null)));
				if (object.get("visibleDecimalPlaces") != null)
					builder = builder.visibleDecimalPlaces(object.get("visibleDecimalPlaces").asInt());
				if (object.get("compactExponent") != null)
					builder = builder.compactExponent(object.get("compactExponent").asInt());
				return builder.build();
			}
			case "language-form": {
				String axis = object.getString("axis", null);
				String name = object.getString("name", null);
				Enum<?> form = LANGUAGE_FORMS.get(axis + "/" + name);
				if (form == null) throw new IllegalArgumentException("not an allowlisted language form: " + axis + "/" + name);
				String declaredRenderName = object.getString("renderName", null);
				// A forged or mismatched tuple must be rejected, not quietly accepted (section 3.7).
				if (declaredRenderName != null && !declaredRenderName.equals(form.name()))
					throw new IllegalArgumentException("renderName mismatch for " + axis + "/" + name
							+ ": case says " + declaredRenderName + ", Java says " + form.name());
				return form;
			}
			default:
				throw new IllegalArgumentException("unknown tagged value: " + tag);
		}
	}

	private static Number asNumber(Object value) {
		if (value instanceof Number) return (Number) value;
		throw new IllegalArgumentException("expected a number, got " + (value == null ? "null" : value.getClass().getName()));
	}

	private static Map<String, Object> describeResult(TranslationResult result) {
		Map<String, Object> row = new TreeMap<>();
		row.put("key", result.getKey());
		row.put("translation", result.getTranslation());
		row.put("status", result.getStatus().name());
		row.put("lookupLocale", result.getLookupLocale().toLanguageTag());
		row.put("resolvedLocale", result.getResolvedLocale().map(Locale::toLanguageTag).orElse(null));
		row.put("attemptedLocales", tags(result.getAttemptedLocales()));
		row.put("isFallback", result.isFallback());
		row.put("failureReason", result.getFailureReason().map(Enum::name).orElse(null));
		// The failure's IDENTITY, not merely its existence. Without this a RESOLUTION_FAILURE case
		// asserts only "something went wrong", which a port could satisfy by failing for an entirely
		// unrelated reason. The message is included because several required fixtures assert
		// contextualization of generated errors.
		row.put("failureCause", result.getCause().map(cause -> {
			Map<String, Object> described = new TreeMap<>();
			described.put("type", cause.getClass().getName());
			described.put("message", cause.getMessage());
			described.put("causeType", cause.getCause() == null ? null : cause.getCause().getClass().getName());
			described.put("causeMessage", cause.getCause() == null ? null : cause.getCause().getMessage());
			return described;
		}).orElse(null));
		// Recorded as a nested projection rather than a flag: several required fixtures assert that
		// the SAME match object is observable through the result path.
		row.put("localeMatchResult", result.getLocaleMatchResult().map(VectorOracle::describeMatch).orElse(null));
		return row;
	}

	private static Map<String, Object> describeMatch(LocaleMatchResult match) {
		Map<String, Object> row = new TreeMap<>();
		row.put("matchType", match.getMatchType().name());
		row.put("locale", match.getLocale().map(Locale::toLanguageTag).orElse(null));
		row.put("isMatch", match.isMatch());
		row.put("fallbackLocale", match.getFallbackLocale().toLanguageTag());
		row.put("consideredLocales", tags(match.getConsideredLocales()));
		row.put("effectiveWeight", match.getEffectiveWeight().orElse(null));
		row.put("languageRange", match.getLanguageRange().map(r -> r.getRange()).orElse(null));
		List<Object> ranges = new ArrayList<>();
		for (java.util.Locale.LanguageRange range : match.getRequestedLanguageRanges()) {
			Map<String, Object> entry = new TreeMap<>();
			entry.put("range", range.getRange());
			entry.put("weight", range.getWeight());
			ranges.add(entry);
		}
		row.put("requestedLanguageRanges", ranges);
		return row;
	}

	private static List<Object> tags(List<Locale> locales) {
		List<Object> out = new ArrayList<>();
		for (Locale locale : locales) out.add(locale.toLanguageTag());
		return out;
	}

	/** RFC 8785-style canonical JSON: sorted keys, no insignificant whitespace. */
	@SuppressWarnings("unchecked")
	private static void writeCanonical(Object value, StringBuilder sb) {
		if (value == null) {
			sb.append("null");
		} else if (value instanceof Map) {
			Map<String, Object> map = new TreeMap<>((Map<String, Object>) value);
			sb.append('{');
			boolean first = true;
			for (Map.Entry<String, Object> entry : map.entrySet()) {
				if (!first) sb.append(',');
				first = false;
				writeString(entry.getKey(), sb);
				sb.append(':');
				writeCanonical(entry.getValue(), sb);
			}
			sb.append('}');
		} else if (value instanceof List) {
			sb.append('[');
			boolean first = true;
			for (Object element : (List<Object>) value) {
				if (!first) sb.append(',');
				first = false;
				writeCanonical(element, sb);
			}
			sb.append(']');
		} else if (value instanceof String) {
			writeString((String) value, sb);
		} else if (value instanceof Boolean) {
			sb.append(value.toString());
		} else if (value instanceof Double) {
			double d = (Double) value;
			if (d == Math.floor(d) && !Double.isInfinite(d)) sb.append((long) d);
			else sb.append(d);
		} else if (value instanceof Number) {
			sb.append(value.toString());
		} else {
			throw new IllegalArgumentException("cannot serialize " + value.getClass());
		}
	}

	private static void writeString(String text, StringBuilder sb) {
		sb.append('"');
		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);
			switch (c) {
				case '"': sb.append("\\\""); break;
				case '\\': sb.append("\\\\"); break;
				case '\b': sb.append("\\b"); break;
				case '\f': sb.append("\\f"); break;
				case '\n': sb.append("\\n"); break;
				case '\r': sb.append("\\r"); break;
				case '\t': sb.append("\\t"); break;
				default:
					if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
					else sb.append(c);
			}
		}
		sb.append('"');
	}

	private VectorOracle() {}
}
