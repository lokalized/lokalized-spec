package com.lokalized;

import java.util.*;
import java.util.Locale.LanguageRange;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

/**
 * Extracts LOKALIZED-JAVA's language-range equivalence closure by exhaustive probe.
 *
 * Identical to Extract.java in every respect but the one call it makes. Extract probes
 * `java.util.Locale.LanguageRange.parse`, which is the right oracle for a library that calls it;
 * as of lokalized-java 3.1.0 the library carries its own registry-sourced table instead, so the
 * oracle moved and this probes the library.
 *
 * Deriving from the oracle rather than reconciling against it is the property IANA-PROVENANCE.md
 * argues for, and it is preserved here rather than abandoned: the artifact still reproduces the
 * implementation by construction, just a different implementation.
 *
 * It lives in `com.lokalized` because `IanaLanguageEquivalents` is package-private. Making it
 * public to suit a build tool would widen the library's API surface for the convenience of a probe.
 */
public class ExtractLibrary {
  public static void main(String[] args) throws Exception {
    Set<String> candidates = new LinkedHashSet<>();
    for (String line : Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8)) {
      String c = line.trim();
      if (!c.isEmpty()) candidates.add(c);
    }

    TreeMap<String, List<String>> closure = new TreeMap<>();
    int probed = 0, failed = 0;
    for (String candidate : candidates) {
      probed++;
      List<LanguageRange> parsed;
      try {
        parsed = IanaLanguageEquivalents.parse(candidate);
      } catch (RuntimeException e) {
        failed++;
        continue;
      }
      if (parsed.size() <= 1) continue;              // no equivalents
      List<String> ranges = new ArrayList<>();
      for (LanguageRange r : parsed) ranges.add(r.getRange());
      closure.put(ranges.get(0), ranges);            // key on the JDK's own normalized first range
    }

    StringBuilder json = new StringBuilder("{");
    boolean first = true;
    for (Map.Entry<String, List<String>> e : closure.entrySet()) {
      if (!first) json.append(",");
      first = false;
      json.append(quote(e.getKey())).append(":[");
      for (int i = 0; i < e.getValue().size(); i++) {
        if (i > 0) json.append(",");
        json.append(quote(e.getValue().get(i)));
      }
      json.append("]");
    }
    json.append("}");

    Files.write(Paths.get(args[1]), json.toString().getBytes(StandardCharsets.UTF_8));

    // The key COUNT travels beside the probe stats as a cross-check on the separate dump that
    // LibraryEquivalenceKeys wrote before the candidate space was built: two independent reads of
    // the same field, so a stale keys file cannot quietly seed a narrower probe space than the
    // table the extraction is actually questioning.
    java.lang.reflect.Field handle = IanaLanguageEquivalents.class.getDeclaredField("LANGUAGE_EQUIVALENTS");
    handle.setAccessible(true);
    @SuppressWarnings("unchecked")
    Map<String, List<String>> table = (Map<String, List<String>>) handle.get(null);

    // **THE SNAPSHOT'S DIGEST TRAVELS WITH ITS DATE.** A File-Date names a registry RELEASE and
    // does not identify bytes: two fetches stamped alike, or a snapshot edited after fetching, are
    // indistinguishable by date. The library records both beside its generated table, so the
    // closure derived from it can record which snapshot it actually came from.
    System.err.printf("probed=%d rejected=%d closureKeys=%d libraryKeys=%d javaVersion=%s registryFileDate=%s registrySha256=%s%n",
        probed, failed, closure.size(), table.size(), System.getProperty("java.version"),
        IanaLanguageEquivalents.REGISTRY_FILE_DATE, IanaLanguageEquivalents.REGISTRY_SHA256);
  }

  private static String quote(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }
}
