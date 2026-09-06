import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Map;
import java.util.TreeSet;

/**
 * Writes every key of the JDK's OWN language-equivalence tables, one per line, sorted.
 *
 * WHY THIS EXISTS. The candidate space used to be built solely from the pinned CLDR data — every
 * valid language, every alias key and value, and `<prefix>-<language>` for twelve hard-coded
 * macrolanguage prefixes. That is a GUESS at the shape of the JDK's table, and the guess was wrong
 * in four places: `cmn-hans` and `cmn-hant` are prefix-plus-SCRIPT rather than prefix-plus-language,
 * and `lv-lvs`/`lv-ltg` need an `lv` prefix the list did not carry. A key that is never probed is a
 * key that never reaches the artifact, and the generator's losslessness check cannot see the gap:
 * it verifies that every PROBED range reconstructs, so a range outside the probe space is outside
 * what it checks. The artifact was blind to its own gaps.
 *
 * WHY THIS IS NOT SELF-REFERENTIAL. The keys are read by reflection out of
 * `sun.util.locale.LocaleEquivalentMaps`, the JDK's INPUT data. The artifact under test is the
 * OUTPUT of `java.util.Locale.LanguageRange.parse` over the probe space. Those are two different
 * objects reached by two different paths, so seeding the probes from the maps cannot hide a gap in
 * the extracted closure — which is exactly what seeding them from the closure itself did.
 * Reflection into a JDK-internal class is the right tool HERE and would not be in shipped code:
 * this is a build-time oracle pinned to one JDK build, and the alternative — guessing the key shapes
 * from CLDR — is the guess that produced the gap.
 *
 * IT THROWS RATHER THAN RETURNING WHAT IT COULD FIND. A probe space that quietly shrinks when a
 * field is renamed is the failure this class was written to prevent, so an empty map or a key count
 * below the pinned table's size is a hard error, not a smaller answer.
 *
 * Run in source mode; both flags are required — `--add-exports` to name the class, `--add-opens`
 * for `setAccessible`:
 *
 *   java --add-exports java.base/sun.util.locale=ALL-UNNAMED \
 *        --add-opens   java.base/sun.util.locale=ALL-UNNAMED \
 *        EquivalenceKeys.java out.txt
 */
public class EquivalenceKeys {
  /** The pinned JDK 21 table's size. A floor, not an equality: a LARGER table is news, not a fault. */
  private static final int MINIMUM_KEYS = 769;

  public static void main(String[] args) throws Exception {
    Class<?> maps = Class.forName("sun.util.locale.LocaleEquivalentMaps");
    TreeSet<String> keys = new TreeSet<>();

    // The two LANGUAGE maps only. `regionVariantEquivMap` is deliberately excluded: its keys are
    // subtags (`-dd`, `-fx`), it is applied by substitution inside a range rather than by prefix
    // lookup, and the port carries it inline. Probing `-dd` as a range would record a rejection,
    // not a class.
    for (String field : new String[] { "singleEquivMap", "multiEquivsMap" }) {
      Field handle = maps.getDeclaredField(field);
      handle.setAccessible(true);
      Map<?, ?> map = (Map<?, ?>) handle.get(null);

      if (map.isEmpty())
        throw new IllegalStateException(field + " is empty; the probe space would silently shrink");

      for (Object key : map.keySet())
        keys.add(String.valueOf(key));
    }

    if (keys.size() < MINIMUM_KEYS)
      throw new IllegalStateException("only " + keys.size() + " equivalence keys; expected at least "
          + MINIMUM_KEYS + " on the pinned JDK 21 table");

    StringBuilder text = new StringBuilder();
    for (String key : keys)
      text.append(key).append('\n');

    Files.write(Paths.get(args[0]), text.toString().getBytes(StandardCharsets.UTF_8));
    System.err.printf("equivalenceKeys=%d javaVersion=%s%n", keys.size(), System.getProperty("java.version"));
  }
}
