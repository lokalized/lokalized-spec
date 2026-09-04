import java.util.*;
import java.util.Locale.LanguageRange;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

/**
 * Extracts the JDK's language-range equivalence closure by exhaustive probe.
 *
 * The JDK's table (sun.util.locale.LocaleEquivalentMaps) is not public API, so the closure is
 * recovered empirically: probe every candidate range and record any expansion beyond the input.
 * This makes the artifact reproduce the oracle by construction rather than by later reconciliation.
 */
public class Extract {
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
        parsed = LanguageRange.parse(candidate);
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
    System.err.printf("probed=%d rejected=%d closureKeys=%d javaVersion=%s%n",
        probed, failed, closure.size(), System.getProperty("java.version"));
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
