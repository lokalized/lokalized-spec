import org.jacoco.core.analysis.Analyzer;
import org.jacoco.core.analysis.CoverageBuilder;
import org.jacoco.core.analysis.IClassCoverage;
import org.jacoco.core.analysis.IMethodCoverage;
import org.jacoco.core.analysis.ICounter;
import org.jacoco.core.tools.ExecFileLoader;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Turns a JaCoCo exec file into a machine-readable BRANCH report.
 *
 * M3b's gate is not a coverage percentage — it is that "every reachable portable branch in the named
 * semantic classes has a reviewed required/excluded/nonportable disposition". A percentage cannot be
 * dispositioned; an individual branch can. So this emits one record per partially- or un-covered
 * branch point, keyed stably by class/method/line, which is what a disposition file can refer to.
 *
 * Written against the JaCoCo API rather than shelling out to a CLI because the HTML report cannot be
 * diffed, gated, or pointed at by a disposition entry.
 */
public final class CoverageReport {
  public static void main(String[] args) throws Exception {
    ExecFileLoader loader = new ExecFileLoader();
    loader.load(new File(args[0]));

    CoverageBuilder builder = new CoverageBuilder();
    Analyzer analyzer = new Analyzer(loader.getExecutionDataStore(), builder);
    analyzer.analyzeAll(new File(args[1]));

    List<String> classes = new ArrayList<>();
    int totalBranches = 0, coveredBranches = 0, uncoveredPoints = 0;

    for (IClassCoverage cc : builder.getClasses()) {
      String name = cc.getName().replace('/', '.');
      // Nested classes report separately; keep them, they carry real branches.
      StringBuilder methods = new StringBuilder();
      boolean firstMethod = true;
      int classTotal = 0, classCovered = 0;

      for (IMethodCoverage mc : cc.getMethods()) {
        ICounter branches = mc.getBranchCounter();
        classTotal += branches.getTotalCount();
        classCovered += branches.getCoveredCount();

        StringBuilder lines = new StringBuilder();
        boolean firstLine = true;
        for (int line = mc.getFirstLine(); line <= mc.getLastLine() && line > 0; line++) {
          ICounter lineBranches = cc.getLine(line).getBranchCounter();
          int total = lineBranches.getTotalCount();
          if (total == 0) continue;
          int covered = lineBranches.getCoveredCount();
          if (covered == total) continue; // fully covered: nothing to disposition

          if (!firstLine) lines.append(',');
          firstLine = false;
          lines.append(String.format("{\"line\":%d,\"branches\":%d,\"covered\":%d}", line, total, covered));
          uncoveredPoints++;
        }
        if (lines.length() == 0) continue;

        if (!firstMethod) methods.append(',');
        firstMethod = false;
        methods.append(String.format("{\"method\":%s,\"signature\":%s,\"uncovered\":[%s]}",
            quote(mc.getName()), quote(mc.getDesc()), lines));
      }

      totalBranches += classTotal;
      coveredBranches += classCovered;
      if (methods.length() == 0) continue;
      classes.add(String.format("{\"class\":%s,\"branches\":%d,\"covered\":%d,\"methods\":[%s]}",
          quote(name), classTotal, classCovered, methods));
    }

    classes.sort(String::compareTo);
    StringBuilder out = new StringBuilder();
    out.append("{\n  \"formatVersion\": 1,\n");
    out.append(String.format("  \"totalBranches\": %d,%n", totalBranches));
    out.append(String.format("  \"coveredBranches\": %d,%n", coveredBranches));
    out.append(String.format("  \"uncoveredBranchPoints\": %d,%n", uncoveredPoints));
    out.append("  \"classes\": [\n    ");
    out.append(String.join(",\n    ", classes));
    out.append("\n  ]\n}\n");

    Path target = Paths.get(args[2]);
    Files.writeString(target, out.toString(), StandardCharsets.UTF_8);
    System.err.printf("branches %d/%d covered; %d partially-covered points across %d classes%n",
        coveredBranches, totalBranches, uncoveredPoints, classes.size());
  }

  private static String quote(String text) {
    StringBuilder sb = new StringBuilder("\"");
    for (char c : text.toCharArray()) {
      if (c == '"' || c == '\\') sb.append('\\').append(c);
      else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
      else sb.append(c);
    }
    return sb.append('"').toString();
  }

  private CoverageReport() {}
}
