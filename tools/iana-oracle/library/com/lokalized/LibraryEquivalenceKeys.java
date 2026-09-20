package com.lokalized;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Dump lokalized-java's OWN equivalence-table keys, so the probe space can be seeded from the
 * oracle's input data rather than from another implementation's.
 *
 * **THIS IS THE SIBLING OF `EquivalenceKeys.java` AND IT EXISTS FOR THE SAME REASON THAT ONE DOES.**
 * That file was written after four keys (`cmn-hans`, `cmn-hant`, `lv-lvs`, `lv-ltg`) shipped missing
 * from the artifact with every gate green, because the probe space had been derived from the
 * artifact under test. `candidates.mjs` has seeded from the JDK's `LocaleEquivalentMaps` ever since,
 * which was correct while the JDK was the oracle — and stopped being sufficient the moment
 * lokalized-java 3.1.0 began answering with its own 781-key table. Measured: four of ITS keys
 * (`dyl`, `sgn-dyl`, `zhk`, `sgn-zhk`) reached no closure entry, for exactly the earlier reason one
 * implementation over.
 *
 * Reflection, because the field is private; same package, so no `--add-opens`. An empty or missing
 * field is a HARD failure rather than an empty file: a probe space that silently became empty would
 * make `build.mjs`'s completeness assertion pass by asserting nothing, which is the shape this
 * whole family of checks exists to refuse.
 *
 *   java -cp <lokalized-java/target/classes>:<out> com.lokalized.LibraryEquivalenceKeys <outFile>
 */
public class LibraryEquivalenceKeys {
  public static void main(String[] args) throws Exception {
    if (args.length != 1)
      throw new IllegalArgumentException("usage: LibraryEquivalenceKeys <outFile>");

    Field handle = IanaLanguageEquivalents.class.getDeclaredField("LANGUAGE_EQUIVALENTS");
    handle.setAccessible(true);

    @SuppressWarnings("unchecked")
    Map<String, List<String>> table = (Map<String, List<String>>) handle.get(null);

    if (table == null || table.isEmpty())
      throw new IllegalStateException("IanaLanguageEquivalents.LANGUAGE_EQUIVALENTS read back "
          + (table == null ? "null" : "empty") + "; the field was renamed or reshaped. An empty "
          + "probe space would make the completeness assertion vacuous rather than failing it.");

    Files.write(Paths.get(args[0]),
        (String.join("\n", new TreeSet<>(table.keySet())) + "\n").getBytes(StandardCharsets.UTF_8));
    System.err.printf("libraryEquivalenceKeys=%d%n", table.size());
  }
}
