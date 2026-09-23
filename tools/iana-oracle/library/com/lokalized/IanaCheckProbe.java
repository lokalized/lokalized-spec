/*
 * The JDK half of `npm run check:iana` (tools/iana-oracle/build.mjs). It checks the IANA artifact;
 * it does not produce it. `tools/iana-oracle/generate.mjs` produces the artifact from the pinned
 * registry with no JDK, and every observation below is compared against what that file says.
 *
 * It lives in package com.lokalized because IanaLanguageEquivalents is package-private and its
 * tables are private: they are read by reflection rather than widened for a probe. It is compiled
 * with the pinned JDK 21 against lokalized-java's target/classes and run with
 * `--add-opens java.base/sun.util.locale=ALL-UNNAMED`, which the JDK's own table needs.
 *
 *   IanaCheckProbe dump <out.json>
 *     lokalized-java's IanaLanguageEquivalents: LANGUAGE_EQUIVALENTS (keys sorted; the map is a
 *     HashMap and its iteration order means nothing), REGION_VARIANT_EQUIVALENTS in list order,
 *     REGISTRY_FILE_DATE and REGISTRY_SHA256; and the JDK's sun.util.locale.LocaleEquivalentMaps:
 *     the singleEquivMap and multiEquivsMap keys, and regionVariantEquivMap in ITERATION order,
 *     which is the order the JDK tries its substitutions in. A missing field exits 2 naming it.
 *
 *   IanaCheckProbe parse <probes.json> <out.jsonl>
 *     one line per probe: [index, default, jdkSetting, jdkParse], where
 *       default    = Strings#parseLanguageRanges on an instance built with no languageRangeEquivalents
 *                    call (the IANA_REGISTRY default, through the PUBLIC method);
 *       jdkSetting = the same builder with .languageRangeEquivalents(LanguageRangeEquivalents.JDK);
 *       jdkParse   = java.util.Locale.LanguageRange#parse.
 *     Each is {"ok":[[range, Double#toString(weight)], ...]} or {"refused":class, "message":text}.
 */
package com.lokalized;

import com.lokalized.MinimalJson.Json;
import com.lokalized.MinimalJson.JsonValue;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Function;

public final class IanaCheckProbe {
	private IanaCheckProbe() {}

	public static void main(String[] args) throws Exception {
		if (args.length >= 2 && "dump".equals(args[0])) {
			dump(args[1]);
			return;
		}
		if (args.length >= 3 && "parse".equals(args[0])) {
			parse(args[1], args[2]);
			return;
		}
		System.err.println("usage: IanaCheckProbe dump <out.json> | parse <probes.json> <out.jsonl>");
		System.exit(2);
	}

	/** A static field by reflection, or exit 2 naming it: a harness that silently reads nothing is not a check. */
	private static Object field(Class<?> owner, String name) {
		try {
			Field field = owner.getDeclaredField(name);
			field.setAccessible(true);
			Object value = field.get(null);
			if (value == null) throw new IllegalStateException("is null");
			return value;
		} catch (Exception exception) {
			System.err.println("IanaCheckProbe: cannot read " + owner.getName() + "." + name + ": " + exception);
			System.exit(2);
			return null;
		}
	}

	private static void dump(String out) throws Exception {
		Class<?> library = Class.forName("com.lokalized.IanaLanguageEquivalents");
		Map<?, ?> languageEquivalents = (Map<?, ?>) field(library, "LANGUAGE_EQUIVALENTS");
		List<?> regionVariantEquivalents = (List<?>) field(library, "REGION_VARIANT_EQUIVALENTS");
		String registryFileDate = (String) field(library, "REGISTRY_FILE_DATE");
		String registrySha256 = (String) field(library, "REGISTRY_SHA256");

		Class<?> jdk = Class.forName("sun.util.locale.LocaleEquivalentMaps");
		Map<?, ?> singleEquivMap = (Map<?, ?>) field(jdk, "singleEquivMap");
		Map<?, ?> multiEquivsMap = (Map<?, ?>) field(jdk, "multiEquivsMap");
		Map<?, ?> regionVariantEquivMap = (Map<?, ?>) field(jdk, "regionVariantEquivMap");

		StringBuilder json = new StringBuilder("{");
		json.append("\"javaVersion\":").append(string(System.getProperty("java.version")));
		json.append(",\"javaVendor\":").append(string(System.getProperty("java.vendor")));
		json.append(",\"javaRuntimeVersion\":").append(string(System.getProperty("java.runtime.version")));

		json.append(",\"library\":{\"registryFileDate\":").append(string(registryFileDate));
		json.append(",\"registrySha256\":").append(string(registrySha256));
		json.append(",\"languageEquivalents\":{");
		TreeMap<String, Object> sorted = new TreeMap<>();
		for (Map.Entry<?, ?> entry : languageEquivalents.entrySet()) sorted.put((String) entry.getKey(), entry.getValue());
		boolean first = true;
		for (Map.Entry<String, Object> entry : sorted.entrySet()) {
			if (!first) json.append(',');
			first = false;
			json.append(string(entry.getKey())).append(":[");
			boolean firstMember = true;
			for (Object member : (List<?>) entry.getValue()) {
				if (!firstMember) json.append(',');
				firstMember = false;
				json.append(string((String) member));
			}
			json.append(']');
		}
		json.append("},\"regionVariantEquivalents\":[");
		first = true;
		for (Object pair : regionVariantEquivalents) {
			String[] fromTo = (String[]) pair;
			if (!first) json.append(',');
			first = false;
			json.append('[').append(string(fromTo[0])).append(',').append(string(fromTo[1])).append(']');
		}
		json.append("]}");

		json.append(",\"jdk\":{\"singleEquivKeys\":").append(sortedKeys(singleEquivMap));
		json.append(",\"multiEquivsKeys\":").append(sortedKeys(multiEquivsMap));
		json.append(",\"regionVariantOrder\":[");
		first = true;
		for (Map.Entry<?, ?> entry : regionVariantEquivMap.entrySet()) {
			if (!first) json.append(',');
			first = false;
			json.append('[').append(string(String.valueOf(entry.getKey()))).append(',')
					.append(string(String.valueOf(entry.getValue()))).append(']');
		}
		json.append("]}}\n");
		Files.write(Paths.get(out), json.toString().getBytes(StandardCharsets.UTF_8));
	}

	private static String sortedKeys(Map<?, ?> map) {
		StringBuilder json = new StringBuilder("[");
		boolean first = true;
		for (Object key : new TreeSet<>(map.keySet())) {
			if (!first) json.append(',');
			first = false;
			json.append(string(String.valueOf(key)));
		}
		return json.append(']').toString();
	}

	private static Strings instance(LanguageRangeEquivalents setting) {
		Strings.Builder builder = Strings.withFallbackLocale(Locale.ENGLISH)
				.localizedStringSupplier(() -> Map.of(Locale.ENGLISH,
						Set.of(new LocalizedString.Builder("k").translation("v").build())))
				.localeSupplier(matcher -> Locale.ENGLISH);
		// The default column never calls the setter, so it observes the DEFAULT rather than an explicit
		// IANA_REGISTRY argument; a default that silently changed would otherwise go unseen.
		if (setting != null) builder.languageRangeEquivalents(setting);
		return builder.build();
	}

	private static void parse(String probesPath, String out) throws Exception {
		JsonValue probes = Json.parse(new String(Files.readAllBytes(Paths.get(probesPath)), StandardCharsets.UTF_8));
		Strings registry = instance(null);
		Strings jdk = instance(LanguageRangeEquivalents.JDK);

		StringBuilder lines = new StringBuilder();
		int index = 0;
		for (JsonValue probe : probes.asArray()) {
			String header = probe.asString();
			lines.append('[').append(index++)
					.append(',').append(outcome(header, registry::parseLanguageRanges))
					.append(',').append(outcome(header, jdk::parseLanguageRanges))
					.append(',').append(outcome(header, Locale.LanguageRange::parse))
					.append("]\n");
		}
		Files.write(Paths.get(out), lines.toString().getBytes(StandardCharsets.UTF_8));
	}

	private static String outcome(String header, Function<String, List<Locale.LanguageRange>> parser) {
		List<Locale.LanguageRange> parsed;
		try {
			parsed = new ArrayList<>(parser.apply(header));
		} catch (RuntimeException exception) {
			return "{\"refused\":" + string(exception.getClass().getName()) + ",\"message\":"
					+ string(String.valueOf(exception.getMessage())) + "}";
		}
		StringBuilder json = new StringBuilder("{\"ok\":[");
		boolean first = true;
		for (Locale.LanguageRange range : parsed) {
			if (!first) json.append(',');
			first = false;
			json.append('[').append(string(range.getRange())).append(',')
					.append(string(Double.toString(range.getWeight()))).append(']');
		}
		return json.append("]}").toString();
	}

	/** A JSON string literal. */
	private static String string(String value) {
		StringBuilder json = new StringBuilder("\"");
		for (int i = 0; i < value.length(); i++) {
			char c = value.charAt(i);
			if (c == '"' || c == '\\') json.append('\\').append(c);
			else if (c < 0x20 || (c >= 0xd800 && c <= 0xdfff)) json.append(String.format("\\u%04x", (int) c));
			else json.append(c);
		}
		return json.append('"').toString();
	}
}
