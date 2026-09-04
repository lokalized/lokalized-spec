import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(directory, "..");
const assertReady = process.argv.includes("--assert-ready");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--assert-ready");

const paths = {
  plan: join(projectDirectory, "IMPLEMENTATION-PLAN-v7.md"),
  inventoryValidator: join(directory, "validate.mjs"),
  bootstrap: join(directory, "bootstrap.requirements.candidate.json"),
  profiles: join(directory, "release-profiles.draft.json"),
  selection: join(directory, "selection-record.draft.json"),
  capacity: join(directory, "capacity-record.draft.json"),
  roles: join(directory, "roles.draft.json")
};

const milestones = new Set([
  "M0",
  "M1",
  "M2",
  "M3a",
  "M3b",
  "M4",
  "M5a",
  "M5b",
  "M6",
  "M7",
  "M8",
  "M9",
  "M-D",
  "M-R",
  "M-E",
  "M-X"
]);
const registryParityClasses = new Set([
  "portable",
  "implementation-required",
  "informational-nonportable"
]);
const evidenceKinds = new Set([
  "vector",
  "generated-partition",
  "compatibility-run",
  "decision-record",
  "static-check",
  "benchmark"
]);
const bootstrapReviewStatuses = new Set([
  "unreviewed",
  "human-reviewed",
  "decision-owner-approved"
]);
const requiredRoleNames = ["productionImplementer", "humanReviewer", "humanDecisionOwner"];
const hashPattern = /^[0-9a-f]{64}$/;
const productionRequirementIdPattern = /^LJ-[A-Z][A-Z0-9-]*-[0-9]{3}$/;
const provisionalRequirementIdPattern = /^BOOT-M0-(?!0000)[0-9]{4}$/;
const milestoneDependencies = new Map([
  ["M0", []],
  ["M1", ["M0"]],
  ["M3a", ["M0"]],
  ["M2", ["M0", "M1", "M3a"]],
  ["M3b", ["M2", "M3a"]],
  ["M4", ["M1", "M2"]],
  ["M5a", ["M2", "M3a"]],
  ["M5b", ["M2", "M3a", "M4", "M5a"]],
  ["M6", ["M2", "M3a", "M4"]],
  ["M7", ["M3b", "M4", "M5b", "M6"]],
  ["M8", ["M7"]],
  ["M9", ["M7", "M8"]],
  ["M-D", ["M8", "M9"]],
  ["M-R", ["M3a", "M3b", "M4", "M5a", "M5b", "M6", "M7", "M8", "M9", "M-D"]],
  ["M-E", ["M-R"]],
  ["M-X", []]
]);
const ancestorCache = new Map();
const ancestorsOf = (milestone) => {
  if (ancestorCache.has(milestone)) return ancestorCache.get(milestone);
  const ancestors = new Set();
  for (const dependency of milestoneDependencies.get(milestone) ?? []) {
    ancestors.add(dependency);
    for (const ancestor of ancestorsOf(dependency)) ancestors.add(ancestor);
  }
  ancestorCache.set(milestone, ancestors);
  return ancestors;
};
const isAncestorOrEqual = (candidate, milestone) =>
  candidate === milestone || ancestorsOf(milestone).has(candidate);
const frontierCovers = (frontier, milestone) =>
  Array.isArray(frontier) && frontier.some((candidate) => isAncestorOrEqual(candidate, milestone));

const blockers = [];
const addBlocker = (code, artifact, message, details = undefined) => {
  const blocker = { code, artifact, message };
  if (details !== undefined) blocker.details = details;
  blockers.push(blocker);
};

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Text = (text) => sha256Bytes(Buffer.from(text, "utf8"));
const canonicalJson = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot encode a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}`);
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonemptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isNullableFiniteNumber = (value) => value === null || isFiniteNumber(value);
const isNullableHash = (value) => value === null || (typeof value === "string" && hashPattern.test(value));
const unique = (values) => new Set(values).size === values.length;
const hasCanonicalArrayPrefix = (whole, prefix) =>
  Array.isArray(whole) &&
  Array.isArray(prefix) &&
  whole.length >= prefix.length &&
  prefix.every((entry, index) => canonicalJson(whole[index]) === canonicalJson(entry));
const isSingleM0StartLog = (events) =>
  Array.isArray(events) &&
  events.length === 1 &&
  events[0]?.gate === "M0" &&
  events[0]?.kind === "start" &&
  events[0]?.outcome === "start" &&
  events[0]?.details?.type === "m0-start";
const relativePath = (path) => relative(projectDirectory, path).replaceAll("\\", "/");
const isValidCalendarDate = (value) => {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};
const isStrictIsoTimestamp = (value) => {
  const match =
    typeof value === "string" &&
    value.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
    );
  if (!match) return false;
  const [, date, hourText, minuteText, secondText] = match;
  return (
    isValidCalendarDate(date) &&
    Number(hourText) <= 23 &&
    Number(minuteText) <= 59 &&
    Number(secondText) <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
};

const exactKeys = (value, expected, artifact, location) => {
  if (!isObject(value)) {
    addBlocker("SHAPE_OBJECT_REQUIRED", artifact, `${location} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0")) {
    addBlocker("SHAPE_KEYS", artifact, `${location} has unexpected or missing fields`, {
      expected: wanted,
      actual
    });
    return false;
  }
  return true;
};

const loadJson = (artifact, path) => {
  if (!existsSync(path)) {
    addBlocker("ARTIFACT_MISSING", artifact, `Missing ${relativePath(path)}`);
    return null;
  }
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    addBlocker("ARTIFACT_UNREADABLE", artifact, `Cannot read ${relativePath(path)}`, {
      error: String(error?.message ?? error)
    });
    return null;
  }
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!isObject(value)) {
      addBlocker("SHAPE_OBJECT_REQUIRED", artifact, `${relativePath(path)} must contain a JSON object`);
    }
    return {
      path,
      bytes,
      sha256: sha256Bytes(bytes),
      value
    };
  } catch (error) {
    addBlocker("JSON_INVALID", artifact, `Invalid JSON in ${relativePath(path)}`, {
      error: String(error?.message ?? error)
    });
    return { path, bytes, sha256: sha256Bytes(bytes), value: null };
  }
};

const pathIsInside = (parent, candidate) => {
  const child = relative(parent, candidate);
  return child !== "" && child !== ".." && !child.startsWith("../") && !child.startsWith("..\\");
};

const loadBoundArtifact = (binding, artifact, location) => {
  if (binding === null) return null;
  if (!exactKeys(binding, ["path", "sha256"], artifact, location)) return null;
  if (!isNonemptyString(binding.path) || !hashPattern.test(binding.sha256 ?? "")) {
    addBlocker("BOUND_ARTIFACT_REFERENCE_INVALID", artifact, `${location} must contain a path and lowercase SHA-256`);
    return null;
  }
  if (
    isAbsolute(binding.path) ||
    binding.path.includes("\\") ||
    binding.path !== relative(directory, resolve(directory, binding.path)).replaceAll("\\", "/")
  ) {
    addBlocker(
      "BOUND_ARTIFACT_PATH_NONCANONICAL",
      artifact,
      `${location}.path must be a canonical pre-m0-relative POSIX path`,
      { path: binding.path }
    );
    return null;
  }
  const candidatePath = resolve(directory, binding.path);
  try {
    const resolvedProject = realpathSync(projectDirectory);
    const resolvedCandidate = realpathSync(candidatePath);
    if (!pathIsInside(resolvedProject, resolvedCandidate)) {
      addBlocker("BOUND_ARTIFACT_OUTSIDE_PROJECT", artifact, `${location} resolves outside the project`, {
        path: binding.path
      });
      return null;
    }
    if (resolvedCandidate !== candidatePath || lstatSync(candidatePath).isSymbolicLink()) {
      addBlocker("BOUND_ARTIFACT_SYMLINK", artifact, `${location} must not use a symlink`, {
        path: binding.path
      });
      return null;
    }
    if (!statSync(candidatePath).isFile()) {
      addBlocker("BOUND_ARTIFACT_NOT_FILE", artifact, `${location} must name a regular file`, {
        path: binding.path
      });
      return null;
    }
    const bytes = readFileSync(candidatePath);
    const actualSha256 = sha256Bytes(bytes);
    if (actualSha256 !== binding.sha256) {
      addBlocker("BOUND_ARTIFACT_HASH_MISMATCH", artifact, `${location} does not bind the current file bytes`, {
        expected: actualSha256,
        actual: binding.sha256
      });
      return null;
    }
    return { path: candidatePath, bytes, sha256: actualSha256 };
  } catch (error) {
    addBlocker("BOUND_ARTIFACT_UNREADABLE", artifact, `${location} cannot be resolved or read`, {
      path: binding.path,
      error: String(error?.message ?? error)
    });
    return null;
  }
};

const validateSelfContainedPlatformBuiltinModule = (loaded, artifact, location) => {
  if (loaded === null || loaded === undefined) return;
  const source = loaded.bytes.toString("utf8");
  const allowedBuiltinSpecifiers = new Set([
    "node:assert",
    "node:assert/strict",
    "node:buffer",
    "node:crypto",
    "node:fs",
    "node:path",
    "node:url",
    "node:util"
  ]);
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:[^"'`]*?\s+from\s+)?(["'])([^"']+)\1/g,
    /\bexport\s+[^"'`]*?\s+from\s+(["'])([^"']+)\1/g,
    /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[2]);
  }
  for (const specifier of specifiers) {
    if (!allowedBuiltinSpecifiers.has(specifier)) {
      addBlocker(
        "SELF_CONTAINED_MODULE_IMPORT",
        artifact,
        `${location} imports disallowed module ${specifier}; the frozen executable must be one self-contained file using only the audited node: assert/buffer/crypto/fs/path/url/util allowlist`
      );
    }
  }
  if (/\b(?:import|export)\s*\/(?:\*|\/)/.test(source)) {
    addBlocker(
      "SELF_CONTAINED_MODULE_COMMENTED_IMPORT",
      artifact,
      `${location} places a comment inside import/export syntax; use a plain explicit node: import so the static contract is auditable`
    );
  }
  const dynamicImports = [...source.matchAll(/\bimport\s*\(/g)].length;
  const literalDynamicImports = [...source.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g)].length;
  if (dynamicImports !== literalDynamicImports) {
    addBlocker(
      "SELF_CONTAINED_MODULE_DYNAMIC_IMPORT",
      artifact,
      `${location} contains a nonliteral dynamic import, which cannot be proven self-contained`
    );
  }
  if (/\brequire\s*\(/.test(source) || /\bcreateRequire\b/.test(source)) {
    addBlocker(
      "SELF_CONTAINED_MODULE_REQUIRE",
      artifact,
      `${location} uses require/createRequire, which is forbidden by the self-contained ESM contract`
    );
  }
  if (
    /\bfetch\b|\bWebSocket\b|\bEventSource\b|\bXMLHttpRequest\b|\bgetBuiltinModule\b|\bglobalThis\b|\bglobal\b/.test(source)
  ) {
    addBlocker(
      "SELF_CONTAINED_MODULE_NETWORK_SURFACE",
      artifact,
      `${location} references a global/dynamic network or builtin-loader surface; frozen validation must depend only on its exact allowlisted files and built-ins`
    );
  }
  const syntaxCheck = spawnSync(process.execPath, ["--check", loaded.path], {
    cwd: dirname(loaded.path),
    encoding: "utf8"
  });
  if (syntaxCheck.error || syntaxCheck.status !== 0) {
    addBlocker("SELF_CONTAINED_MODULE_SYNTAX", artifact, `${location} is not valid JavaScript`, {
      error: String(syntaxCheck.error?.message ?? syntaxCheck.stderr ?? "syntax check failed").trim().slice(0, 500)
    });
  }
};

const nodePermissionFlag = process.allowedNodeEnvironmentFlags.has("--permission")
  ? "--permission"
  : process.allowedNodeEnvironmentFlags.has("--experimental-permission")
    ? "--experimental-permission"
    : null;
if (nodePermissionFlag === null) {
  addBlocker(
    "NODE_PERMISSION_MODEL_UNAVAILABLE",
    "validator",
    "This pre-M0 validator requires Node's permission model (stable --permission or legacy --experimental-permission)"
  );
}
const permissionedNodeArguments = (entrypoint, readablePaths, positionalArguments = []) => [
  nodePermissionFlag ?? "--permission-model-unavailable",
  ...[...new Set([entrypoint, ...readablePaths])].map((path) => `--allow-fs-read=${path}`),
  entrypoint,
  ...positionalArguments
];

for (const argument of unknownArguments) {
  addBlocker("UNKNOWN_ARGUMENT", "validator", `Unknown argument: ${argument}`);
}

let planBytes = null;
let planSha256 = null;
let planLines = [];
if (!existsSync(paths.plan)) {
  addBlocker("PLAN_MISSING", "plan", `Missing ${relativePath(paths.plan)}`);
} else {
  try {
    planBytes = readFileSync(paths.plan);
    planSha256 = sha256Bytes(planBytes);
    planLines = planBytes.toString("utf8").split("\n");
    if (planLines.at(-1) === "") planLines.pop();
  } catch (error) {
    addBlocker("PLAN_UNREADABLE", "plan", `Cannot read ${relativePath(paths.plan)}`, {
      error: String(error?.message ?? error)
    });
  }
}

const rolesArtifact = loadJson("roles", paths.roles);
const capacityArtifact = loadJson("capacity", paths.capacity);
const bootstrapArtifact = loadJson("bootstrap", paths.bootstrap);
const profilesArtifact = loadJson("profiles", paths.profiles);
const selectionArtifact = loadJson("selection", paths.selection);

let roles = null;
const validateRole = (value, key) => {
  if (value === null) return null;
  if (!exactKeys(value, ["name", "kind"], "roles", key)) return null;
  if (!isNonemptyString(value.name)) {
    addBlocker("ROLE_NAME_INVALID", "roles", `${key}.name must be a nonempty string`);
  }
  if (value.kind !== "human" && value.kind !== "agent") {
    addBlocker("ROLE_KIND_INVALID", "roles", `${key}.kind must be human or agent`);
  }
  if ((key === "humanReviewer" || key === "humanDecisionOwner") && value.kind !== "human") {
    addBlocker("HUMAN_ROLE_KIND", "roles", `${key} must have kind human`);
  }
  if (key === "productionImplementer" && value.kind !== "human") {
    addBlocker(
      "IMPLEMENTER_ROLE_KIND",
      "roles",
      "productionImplementer must have kind human because the capacity artifact measures human implementer attention"
    );
  }
  return value;
};

if (rolesArtifact !== null && rolesArtifact.value !== null) {
  const value = rolesArtifact.value;
  if (
    exactKeys(
      value,
      [
        "formatVersion",
        "status",
        "preM0Coordinator",
        "productionImplementer",
        "humanReviewer",
        "humanDecisionOwner",
        "requiredBeforeM0",
        "note"
      ],
      "roles",
      "roles"
    )
  ) {
    roles = value;
    if (value.formatVersion !== 1) {
      addBlocker("FORMAT_VERSION", "roles", "roles.formatVersion must equal 1");
    }
    if (
      value.status !== "incomplete-preapproval-roles" &&
      value.status !== "approved-for-m0"
    ) {
      addBlocker("STATUS_INVALID", "roles", "roles.status is not recognized");
    }
    validateRole(value.preM0Coordinator, "preM0Coordinator");
    for (const roleName of requiredRoleNames) validateRole(value[roleName], roleName);
    if (
      !Array.isArray(value.requiredBeforeM0) ||
      !unique(value.requiredBeforeM0) ||
      value.requiredBeforeM0.length !== requiredRoleNames.length ||
      !requiredRoleNames.every((roleName) => value.requiredBeforeM0.includes(roleName))
    ) {
      addBlocker(
        "REQUIRED_ROLES_INVALID",
        "roles",
        "roles.requiredBeforeM0 must contain each required production/human role exactly once"
      );
    }
    if (typeof value.note !== "string") {
      addBlocker("NOTE_INVALID", "roles", "roles.note must be a string");
    }
    if (value.status !== "approved-for-m0") {
      addBlocker("ROLES_UNAPPROVED", "roles", `Role assignments are not approved: ${value.status}`);
    }
    for (const roleName of requiredRoleNames) {
      if (value[roleName] === null) {
        addBlocker("ROLE_UNASSIGNED", "roles", `Required role is unassigned: ${roleName}`);
      }
    }
    if (
      value.status === "approved-for-m0" &&
      requiredRoleNames.some((roleName) => !isObject(value[roleName]) || !isNonemptyString(value[roleName].name))
    ) {
      addBlocker("ROLE_APPROVAL_INCONSISTENT", "roles", "Approved role artifact lacks a named required role");
    }
  }
}

const namedRolesAvailable =
  roles !== null &&
  requiredRoleNames.every(
    (roleName) => isObject(roles[roleName]) && isNonemptyString(roles[roleName].name)
  );
const requireNamedRolesForApproval = (artifact, status, approvedStatus) => {
  if (status !== approvedStatus) return;
  if (!namedRolesAvailable) {
    addBlocker(
      "APPROVAL_WITHOUT_NAMED_ROLES",
      artifact,
      `${artifact} claims approval while one or more required roles are unnamed`
    );
  }
  if (roles?.status !== "approved-for-m0") {
    addBlocker(
      "APPROVAL_WITH_UNAPPROVED_ROLES",
      artifact,
      `${artifact} claims approval while the role artifact is not approved-for-m0`
    );
  }
};
const requireNamedRoleForReview = (artifact, roleName, context) => {
  if (!isObject(roles?.[roleName]) || !isNonemptyString(roles[roleName].name)) {
    addBlocker(
      "REVIEW_WITHOUT_NAMED_ROLE",
      artifact,
      `${context} requires a named ${roleName}`
    );
  }
};

let inventory = null;
if (!existsSync(paths.inventoryValidator)) {
  addBlocker("INVENTORY_VALIDATOR_MISSING", "inventory", `Missing ${relativePath(paths.inventoryValidator)}`);
} else {
  const result = spawnSync(process.execPath, [paths.inventoryValidator], {
    cwd: projectDirectory,
    encoding: "utf8"
  });
  if (result.error) {
    addBlocker("INVENTORY_VALIDATOR_FAILED", "inventory", "Could not execute inventory validator", {
      error: String(result.error.message ?? result.error)
    });
  } else if (result.status !== 0) {
    const combined = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    const conciseError = combined.match(/Error: ([^\n]+)/)?.[1] ?? combined.trim().slice(0, 500);
    addBlocker("INVENTORY_INVALID", "inventory", "Normative-block inventory is invalid", {
      exitCode: result.status,
      error: conciseError || "unknown inventory validation error"
    });
  } else {
    try {
      const parsed = JSON.parse(result.stdout);
      if (
        parsed.status !== "inventory-valid" ||
        parsed.planSha256 !== planSha256 ||
        !Number.isInteger(parsed.anticipatedInitialRecords) ||
        parsed.anticipatedInitialRecords < 1 ||
        !Array.isArray(parsed.inventoryFiles) ||
        parsed.inventoryFiles.length === 0 ||
        !parsed.inventoryFiles.every(
          (file) =>
            isObject(file) &&
            typeof file.sha256 === "string" &&
            hashPattern.test(file.sha256)
        )
      ) {
        addBlocker(
          "INVENTORY_RESULT_INVALID",
          "inventory",
          "Inventory validator returned an invalid status, plan hash, or initial-record count"
        );
      } else {
        inventory = parsed;
      }
    } catch (error) {
      addBlocker("INVENTORY_OUTPUT_INVALID", "inventory", "Inventory validator did not emit valid JSON", {
        error: String(error?.message ?? error)
      });
    }
  }
}

const m0InventoryBlocks = new Map();
const allInventoryBlocks = new Map();
if (inventory !== null) {
  for (const inventoryFile of inventory.inventoryFiles) {
    const inventoryPath = resolve(projectDirectory, inventoryFile.path);
    try {
      const bytes = readFileSync(inventoryPath);
      if (sha256Bytes(bytes) !== inventoryFile.sha256) {
        addBlocker(
          "INVENTORY_CHANGED_DURING_VALIDATION",
          "inventory",
          `Inventory changed after validation: ${inventoryFile.path}`
        );
        continue;
      }
      const value = JSON.parse(bytes.toString("utf8"));
      for (const block of value.blocks ?? []) {
        const sourceText = planLines.slice(block.lineStart - 1, block.lineEnd).join("\n");
        if (allInventoryBlocks.has(block.id)) {
          addBlocker("INVENTORY_ID_DUPLICATE_AFTER_VALIDATION", "inventory", `Duplicate inventory ID while reloading: ${block.id}`);
        } else {
          allInventoryBlocks.set(block.id, {
            ...block,
            sourceBlockSha256: sha256Text(sourceText)
          });
        }
        if (
          block?.disposition !== "initial-registration" ||
          !Array.isArray(block.registrationBefore) ||
          !block.registrationBefore.includes("M0")
        ) {
          continue;
        }
        if (m0InventoryBlocks.has(block.id)) {
          addBlocker("M0_INVENTORY_ID_DUPLICATE", "inventory", `Duplicate M0 inventory ID: ${block.id}`);
          continue;
        }
        m0InventoryBlocks.set(block.id, {
          ...block,
          sourceBlockSha256: sha256Text(sourceText)
        });
      }
    } catch (error) {
      addBlocker(
        "INVENTORY_RELOAD_FAILED",
        "inventory",
        `Cannot reload validated inventory: ${inventoryFile.path}`,
        { error: String(error?.message ?? error) }
      );
    }
  }
}

let bootstrap = null;
const requirementIds = new Set();
const requirementById = new Map();
const evidenceIds = new Set();
const coveredM0InventoryIds = new Set();
const requirementCountByInventoryId = new Map();
let bootstrapMarkerArtifact = null;
let bootstrapMarkerSchemaArtifact = null;
let bootstrapLinterArtifact = null;
let bootstrapLinterDependencyArtifacts = [];
let bootstrapLinterGraphSha256 = null;
if (bootstrapArtifact !== null && bootstrapArtifact.value !== null) {
  const value = bootstrapArtifact.value;
  if (
    exactKeys(
      value,
      [
        "formatVersion",
        "status",
        "sourcePlanSha256",
        "selectedProfileId",
        "markerSchema",
        "markerArtifact",
        "registryLinter",
        "requirements"
      ],
      "bootstrap",
      "bootstrap"
    )
  ) {
    bootstrap = value;
    if (value.formatVersion !== 1) {
      addBlocker("FORMAT_VERSION", "bootstrap", "bootstrap.formatVersion must equal 1");
    }
    if (value.status !== "bootstrap-candidate" && value.status !== "bootstrap-approved") {
      addBlocker("STATUS_INVALID", "bootstrap", "bootstrap.status is not recognized");
    }
    if (!hashPattern.test(value.sourcePlanSha256 ?? "")) {
      addBlocker("PLAN_HASH_FORMAT", "bootstrap", "bootstrap.sourcePlanSha256 must be lowercase SHA-256");
    } else if (value.sourcePlanSha256 !== planSha256) {
      addBlocker("PLAN_HASH_MISMATCH", "bootstrap", "Bootstrap requirements do not match the current plan", {
        expected: planSha256,
        actual: value.sourcePlanSha256
      });
    }
    if (!isNonemptyString(value.selectedProfileId)) {
      addBlocker("SELECTED_PROFILE_ID_INVALID", "bootstrap", "bootstrap.selectedProfileId must be nonempty");
    }
    bootstrapMarkerArtifact = loadBoundArtifact(
      value.markerArtifact,
      "bootstrap-marker",
      "bootstrap.markerArtifact"
    );
    bootstrapMarkerSchemaArtifact = loadBoundArtifact(
      value.markerSchema,
      "bootstrap-marker-schema",
      "bootstrap.markerSchema"
    );
    if (value.registryLinter !== null) {
      if (
        exactKeys(
          value.registryLinter,
          ["entrypoint", "dependencies"],
          "bootstrap-linter",
          "bootstrap.registryLinter"
        )
      ) {
        bootstrapLinterArtifact = loadBoundArtifact(
          value.registryLinter.entrypoint,
          "bootstrap-linter",
          "bootstrap.registryLinter.entrypoint"
        );
        if (!Array.isArray(value.registryLinter.dependencies)) {
          addBlocker("BOOTSTRAP_LINTER_DEPENDENCIES", "bootstrap-linter", "bootstrap.registryLinter.dependencies must be an array");
        } else {
          if (value.registryLinter.dependencies.length !== 0) {
            addBlocker(
              "BOOTSTRAP_LINTER_NOT_SELF_CONTAINED",
              "bootstrap-linter",
              "bootstrap.registryLinter.dependencies must be empty; the frozen linter is one self-contained ESM file with only node: built-ins"
            );
          }
          const dependencyPaths = new Set();
          value.registryLinter.dependencies.forEach((binding, index) => {
            const loaded = loadBoundArtifact(
              binding,
              "bootstrap-linter",
              `bootstrap.registryLinter.dependencies[${index}]`
            );
            if (loaded !== null) {
              const dependencyPath = relativePath(loaded.path);
              if (dependencyPaths.has(dependencyPath)) {
                addBlocker("BOOTSTRAP_LINTER_DEPENDENCY_DUPLICATE", "bootstrap-linter", `Duplicate linter dependency: ${dependencyPath}`);
              } else {
                dependencyPaths.add(dependencyPath);
                bootstrapLinterDependencyArtifacts.push(loaded);
              }
            }
          });
        }
        validateSelfContainedPlatformBuiltinModule(
          bootstrapLinterArtifact,
          "bootstrap-linter",
          "bootstrap.registryLinter.entrypoint"
        );
        try {
          bootstrapLinterGraphSha256 = sha256Text(canonicalJson(value.registryLinter));
        } catch (error) {
          addBlocker("BOOTSTRAP_LINTER_GRAPH_HASH", "bootstrap-linter", "Cannot canonicalize the bound linter graph", {
            error: String(error?.message ?? error)
          });
        }
      }
    }
    if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
      addBlocker("BOOTSTRAP_REQUIREMENTS_EMPTY", "bootstrap", "bootstrap.requirements must be a nonempty array");
    } else {
      for (let index = 0; index < value.requirements.length; index += 1) {
        const requirement = value.requirements[index];
        const location = `bootstrap.requirements[${index}]`;
        if (
          !exactKeys(
            requirement,
            [
              "requirementId",
              "inventoryId",
              "sourceBlockSha256",
              "statement",
              "statementSha256",
              "sourceAnchor",
              "sourceMarker",
              "sourceLineStart",
              "sourceLineEnd",
              "verificationClass",
              "parityClass",
              "activationMilestone",
              "ownerMilestone",
              "registrationBefore",
              "releaseProfileIds",
              "evidence",
              "evidenceExpressionSha256",
              "reviewStatus"
            ],
            "bootstrap",
            location
          )
        ) {
          continue;
        }
        const id = requirement.requirementId;
        if (
          typeof id !== "string" ||
          (!provisionalRequirementIdPattern.test(id) && !productionRequirementIdPattern.test(id))
        ) {
          addBlocker("BOOTSTRAP_ID_INVALID", "bootstrap", `${location}.requirementId is invalid`, { value: id });
        } else if (requirementIds.has(id)) {
          addBlocker("BOOTSTRAP_ID_DUPLICATE", "bootstrap", `Duplicate bootstrap requirement ID: ${id}`);
        } else {
          requirementIds.add(id);
          requirementById.set(id, requirement);
        }
        if (value.status === "bootstrap-approved" && !productionRequirementIdPattern.test(id ?? "")) {
          addBlocker(
            "BOOTSTRAP_PRODUCTION_ID_REQUIRED",
            "bootstrap",
            `${id ?? location} must use an immutable LJ-<AREA>-NNN ID before approval`
          );
        }
        if (!isNonemptyString(requirement.sourceMarker) || requirement.sourceMarker !== id) {
          addBlocker(
            "SOURCE_MARKER_MISMATCH",
            "bootstrap",
            `${id ?? location} sourceMarker must equal its exact requirementId`
          );
        }
        const inventoryBlock = m0InventoryBlocks.get(requirement.inventoryId);
        if (!/^INV-[0-9]+-[0-9]+-[0-9]{3}$/.test(requirement.inventoryId ?? "")) {
          addBlocker("INVENTORY_ID_INVALID", "bootstrap", `${id ?? location} has an invalid inventoryId`);
        } else if (!inventoryBlock) {
          addBlocker(
            "INVENTORY_ID_NOT_M0",
            "bootstrap",
            `${id ?? location} does not map to a validated M0-frontier inventory block`,
            { inventoryId: requirement.inventoryId }
          );
        } else {
          coveredM0InventoryIds.add(requirement.inventoryId);
          requirementCountByInventoryId.set(
            requirement.inventoryId,
            (requirementCountByInventoryId.get(requirement.inventoryId) ?? 0) + 1
          );
          if (requirement.sourceBlockSha256 !== inventoryBlock.sourceBlockSha256) {
            addBlocker(
              "SOURCE_BLOCK_HASH_MISMATCH",
              "bootstrap",
              `${id ?? location} does not hash its exact inventory source block`,
              {
                inventoryId: requirement.inventoryId,
                expected: inventoryBlock.sourceBlockSha256,
                actual: requirement.sourceBlockSha256
              }
            );
          }
          if (
            Number.isInteger(requirement.sourceLineStart) &&
            Number.isInteger(requirement.sourceLineEnd) &&
            (requirement.sourceLineStart < inventoryBlock.lineStart ||
              requirement.sourceLineEnd > inventoryBlock.lineEnd)
          ) {
            addBlocker(
              "SOURCE_LINES_OUTSIDE_INVENTORY_BLOCK",
              "bootstrap",
              `${id ?? location} source lines fall outside ${requirement.inventoryId}`
            );
          }
          const expectedParityClass =
            inventoryBlock.parityClass === "process-only"
              ? "implementation-required"
              : inventoryBlock.parityClass;
          if (requirement.parityClass !== expectedParityClass) {
            addBlocker(
              "INVENTORY_PARITY_MISMATCH",
              "bootstrap",
              `${id ?? location} parity class differs from the production mapping for ${requirement.inventoryId}`,
              { expected: expectedParityClass, actual: requirement.parityClass }
            );
          }
          if (requirement.ownerMilestone !== inventoryBlock.owner) {
            addBlocker(
              "INVENTORY_OWNER_MISMATCH",
              "bootstrap",
              `${id ?? location} owner differs from ${requirement.inventoryId}`
            );
          }
          if (
            !Array.isArray(requirement.registrationBefore) ||
            requirement.registrationBefore.length !== inventoryBlock.registrationBefore.length ||
            requirement.registrationBefore.some(
              (milestone, frontierIndex) =>
                milestone !== inventoryBlock.registrationBefore[frontierIndex]
            )
          ) {
            addBlocker(
              "INVENTORY_FRONTIER_MISMATCH",
              "bootstrap",
              `${id ?? location} frontier differs from ${requirement.inventoryId}`
            );
          }
        }
        if (!hashPattern.test(requirement.sourceBlockSha256 ?? "")) {
          addBlocker(
            "SOURCE_BLOCK_HASH_FORMAT",
            "bootstrap",
            `${id ?? location}.sourceBlockSha256 is invalid`
          );
        }
        if (!isNonemptyString(requirement.statement)) {
          addBlocker("STATEMENT_INVALID", "bootstrap", `${location}.statement must be nonempty`);
        }
        if (!hashPattern.test(requirement.statementSha256 ?? "")) {
          addBlocker("STATEMENT_HASH_FORMAT", "bootstrap", `${location}.statementSha256 is invalid`);
        } else if (
          typeof requirement.statement === "string" &&
          requirement.statementSha256 !== sha256Text(canonicalJson(requirement.statement))
        ) {
          addBlocker("STATEMENT_HASH_MISMATCH", "bootstrap", `${id ?? location} statement hash is incorrect`, {
            expected: sha256Text(canonicalJson(requirement.statement)),
            actual: requirement.statementSha256
          });
        }
        if (!isNonemptyString(requirement.sourceAnchor)) {
          addBlocker("SOURCE_ANCHOR_INVALID", "bootstrap", `${id ?? location} has no source anchor`);
        }
        if (
          !Number.isInteger(requirement.sourceLineStart) ||
          !Number.isInteger(requirement.sourceLineEnd) ||
          requirement.sourceLineStart < 1 ||
          requirement.sourceLineEnd < requirement.sourceLineStart ||
          requirement.sourceLineEnd > planLines.length
        ) {
          addBlocker("SOURCE_LINES_INVALID", "bootstrap", `${id ?? location} has an invalid source line range`, {
            start: requirement.sourceLineStart,
            end: requirement.sourceLineEnd,
            planLineCount: planLines.length
          });
        }
        if (!registryParityClasses.has(requirement.parityClass)) {
          addBlocker("PARITY_CLASS_INVALID", "bootstrap", `${id ?? location} has an invalid parity class`);
        }
        if (
          requirement.verificationClass !== "runtime-behavior" &&
          requirement.verificationClass !== "non-runtime"
        ) {
          addBlocker("VERIFICATION_CLASS_INVALID", "bootstrap", `${id ?? location} has an invalid verificationClass`);
        }
        if (!milestones.has(requirement.activationMilestone)) {
          addBlocker("ACTIVATION_MILESTONE_INVALID", "bootstrap", `${id ?? location} has an invalid activation milestone`);
        }
        if (!milestones.has(requirement.ownerMilestone)) {
          addBlocker("OWNER_MILESTONE_INVALID", "bootstrap", `${id ?? location} has an invalid owner milestone`);
        }
        if (
          !Array.isArray(requirement.registrationBefore) ||
          requirement.registrationBefore.length === 0 ||
          !unique(requirement.registrationBefore) ||
          !requirement.registrationBefore.every((milestone) => milestones.has(milestone)) ||
          !requirement.registrationBefore.includes("M0")
        ) {
          addBlocker(
            "M0_FRONTIER_INVALID",
            "bootstrap",
            `${id ?? location} must have a unique valid registrationBefore frontier containing M0`
          );
        } else {
          for (const frontierMilestone of requirement.registrationBefore) {
            const redundant = requirement.registrationBefore.find(
              (candidate) =>
                candidate !== frontierMilestone &&
                isAncestorOrEqual(candidate, frontierMilestone)
            );
            if (redundant !== undefined) {
              addBlocker(
                "M0_FRONTIER_NOT_REDUCED",
                "bootstrap",
                `${id ?? location} retains both ${redundant} and its descendant ${frontierMilestone}`
              );
              break;
            }
          }
        }
        if (
          !Array.isArray(requirement.releaseProfileIds) ||
          requirement.releaseProfileIds.length === 0 ||
          !unique(requirement.releaseProfileIds) ||
          !requirement.releaseProfileIds.every(isNonemptyString)
        ) {
          addBlocker("RELEASE_PROFILE_IDS_INVALID", "bootstrap", `${id ?? location} has invalid releaseProfileIds`);
        } else if (
          isNonemptyString(value.selectedProfileId) &&
          !requirement.releaseProfileIds.includes(value.selectedProfileId)
        ) {
          addBlocker(
            "SELECTED_PROFILE_NOT_APPLICABLE",
            "bootstrap",
            `${id ?? location} does not apply to the bootstrap-selected profile`
          );
        }
        if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
          addBlocker("EVIDENCE_EMPTY", "bootstrap", `${id ?? location} must declare evidence`);
        } else {
          const localEvidenceKeys = new Set();
          const producerMilestones = [];
          let nonDecisionEvidenceCount = 0;
          let decisionRecordEvidenceCount = 0;
          const validateEvidenceLeaf = (evidence, evidenceLocation) => {
            if (
              !exactKeys(
                evidence,
                ["kind", "producerMilestone", "evidenceId"],
                "bootstrap",
                evidenceLocation
              )
            ) return;
            if (!evidenceKinds.has(evidence.kind)) {
              addBlocker("EVIDENCE_KIND_INVALID", "bootstrap", `${evidenceLocation}.kind is invalid`);
            } else if (evidence.kind !== "decision-record") {
              nonDecisionEvidenceCount += 1;
            } else {
              decisionRecordEvidenceCount += 1;
            }
            if (!milestones.has(evidence.producerMilestone)) {
              addBlocker("EVIDENCE_MILESTONE_INVALID", "bootstrap", `${evidenceLocation}.producerMilestone is invalid`);
            } else {
              producerMilestones.push(evidence.producerMilestone);
            }
            if (!isNonemptyString(evidence.evidenceId)) {
              addBlocker("EVIDENCE_ID_INVALID", "bootstrap", `${evidenceLocation}.evidenceId must be nonempty`);
            } else {
              const evidenceKey = `${evidence.kind}\0${evidence.producerMilestone}\0${evidence.evidenceId}`;
              if (localEvidenceKeys.has(evidenceKey)) {
                addBlocker("EVIDENCE_TERM_DUPLICATE", "bootstrap", `${id ?? location} repeats one evidence term`);
              }
              localEvidenceKeys.add(evidenceKey);
              evidenceIds.add(evidence.evidenceId);
            }
          };
          requirement.evidence.forEach((term, evidenceIndex) => {
            const evidenceLocation = `${location}.evidence[${evidenceIndex}]`;
            if (isObject(term) && (Object.hasOwn(term, "anyOf") || Object.hasOwn(term, "rationale"))) {
              if (!exactKeys(term, ["anyOf", "rationale"], "bootstrap", evidenceLocation)) return;
              if (!isNonemptyString(term.rationale)) {
                addBlocker("EVIDENCE_ANYOF_RATIONALE", "bootstrap", `${evidenceLocation}.rationale must be nonempty`);
              }
              if (!Array.isArray(term.anyOf) || term.anyOf.length < 2) {
                addBlocker("EVIDENCE_ANYOF_BRANCHES", "bootstrap", `${evidenceLocation}.anyOf must contain at least two leaves`);
              } else {
                term.anyOf.forEach((leaf, branchIndex) => {
                  validateEvidenceLeaf(leaf, `${evidenceLocation}.anyOf[${branchIndex}]`);
                });
              }
            } else {
              validateEvidenceLeaf(term, evidenceLocation);
            }
          });
          let expectedEvidenceHash = null;
          try {
            expectedEvidenceHash = sha256Text(canonicalJson(requirement.evidence));
          } catch (error) {
            addBlocker("EVIDENCE_EXPRESSION_CANONICALIZATION", "bootstrap", `${id ?? location} evidence cannot be canonicalized`, {
              error: String(error?.message ?? error)
            });
          }
          if (!hashPattern.test(requirement.evidenceExpressionSha256 ?? "")) {
            addBlocker("EVIDENCE_EXPRESSION_HASH_FORMAT", "bootstrap", `${id ?? location} has an invalid evidence-expression hash`);
          } else if (
            expectedEvidenceHash !== null &&
            requirement.evidenceExpressionSha256 !== expectedEvidenceHash
          ) {
            addBlocker("EVIDENCE_EXPRESSION_HASH_MISMATCH", "bootstrap", `${id ?? location} evidence-expression hash is incorrect`, {
              expected: expectedEvidenceHash,
              actual: requirement.evidenceExpressionSha256
            });
          }
          if (
            requirement.verificationClass === "runtime-behavior" &&
            (nonDecisionEvidenceCount === 0 || decisionRecordEvidenceCount > 0)
          ) {
            addBlocker(
              "RUNTIME_EVIDENCE_DECISION_RECORD_ONLY",
              "bootstrap",
              `${id ?? location} is runtime behavior; this conservative bootstrap contract forbids decision-record terms and requires executable evidence`
            );
          }
          if (
            milestones.has(requirement.activationMilestone) &&
            milestones.has(requirement.ownerMilestone) &&
            !isAncestorOrEqual(requirement.activationMilestone, requirement.ownerMilestone)
          ) {
            addBlocker(
              "ACTIVATION_NOT_OWNER_ANCESTOR",
              "bootstrap",
              `${id ?? location} activation milestone is not an ancestor of or equal to its owner`
            );
          }
          if (
            milestones.has(requirement.activationMilestone) &&
            !frontierCovers(requirement.registrationBefore, requirement.activationMilestone)
          ) {
            addBlocker(
              "FRONTIER_MISSES_ACTIVATION",
              "bootstrap",
              `${id ?? location} registration frontier does not contain or precede its activation milestone`
            );
          }
          for (const producerMilestone of producerMilestones) {
            if (
              milestones.has(requirement.ownerMilestone) &&
              !isAncestorOrEqual(producerMilestone, requirement.ownerMilestone)
            ) {
              addBlocker(
                "EVIDENCE_PRODUCER_NOT_OWNER_ANCESTOR",
                "bootstrap",
                `${id ?? location} evidence producer ${producerMilestone} is not an ancestor of or equal to owner ${requirement.ownerMilestone}`
              );
            }
            if (!frontierCovers(requirement.registrationBefore, producerMilestone)) {
              addBlocker(
                "FRONTIER_MISSES_EVIDENCE_PRODUCER",
                "bootstrap",
                `${id ?? location} registration frontier does not contain or precede evidence producer ${producerMilestone}`
              );
            }
          }
        }
        if (!bootstrapReviewStatuses.has(requirement.reviewStatus)) {
          addBlocker("REVIEW_STATUS_INVALID", "bootstrap", `${id ?? location} has invalid reviewStatus`);
        } else if (requirement.reviewStatus === "human-reviewed") {
          requireNamedRoleForReview("bootstrap", "humanReviewer", `${id ?? location} human review`);
        } else if (requirement.reviewStatus === "decision-owner-approved") {
          requireNamedRoleForReview("bootstrap", "humanReviewer", `${id ?? location} approval`);
          requireNamedRoleForReview("bootstrap", "humanDecisionOwner", `${id ?? location} approval`);
        }
      }
      const allApproved = value.requirements.every(
        (requirement) => requirement?.reviewStatus === "decision-owner-approved"
      );
      if (value.status === "bootstrap-approved" && !allApproved) {
        addBlocker(
          "BOOTSTRAP_STATUS_REVIEW_MISMATCH",
          "bootstrap",
          "bootstrap-approved requires every production requirement to be decision-owner-approved"
        );
      }
      if (value.status === "bootstrap-candidate" && allApproved) {
        addBlocker(
          "BOOTSTRAP_STATUS_REVIEW_MISMATCH",
          "bootstrap",
          "All requirements are decision-owner-approved but the bootstrap artifact remains bootstrap-candidate"
        );
      }
      if (m0InventoryBlocks.size > 0) {
        const missingInventoryIds = [...m0InventoryBlocks.keys()].filter(
          (inventoryId) => !coveredM0InventoryIds.has(inventoryId)
        );
        if (missingInventoryIds.length > 0) {
          addBlocker(
            "BOOTSTRAP_INVENTORY_COVERAGE_INCOMPLETE",
            "bootstrap",
            `Bootstrap candidates do not cover ${missingInventoryIds.length} M0-frontier inventory blocks`,
            { firstMissingInventoryIds: missingInventoryIds.slice(0, 25) }
          );
        }
        const countMismatches = [...m0InventoryBlocks.values()]
          .map((block) => ({
            inventoryId: block.id,
            anticipatedAtomicRecords: block.anticipatedAtomicRecords,
            actualRequirementRecords: requirementCountByInventoryId.get(block.id) ?? 0
          }))
          .filter(
            (entry) =>
              entry.actualRequirementRecords !== entry.anticipatedAtomicRecords
          );
        if (countMismatches.length > 0) {
          addBlocker(
            "BOOTSTRAP_INVENTORY_COUNT_MISMATCH",
            "bootstrap",
            "Bootstrap requirement counts do not reconcile exactly to reviewed per-block atomic-record counts; revise and reapprove inventory/capacity if atomization changes an estimate",
            { firstMismatches: countMismatches.slice(0, 25) }
          );
        }
      }
    }
    if (value.status === "bootstrap-approved") {
      if (bootstrapMarkerSchemaArtifact === null) {
        addBlocker(
          "BOOTSTRAP_MARKER_SCHEMA_MISSING",
          "bootstrap",
          "Approved bootstrap requirements require an exact bound marker-overlay schema"
        );
      }
      if (bootstrapMarkerArtifact === null) {
        addBlocker(
          "BOOTSTRAP_MARKERS_MISSING",
          "bootstrap",
          "Approved bootstrap requirements require an exact bound clause-marker overlay"
        );
      }
      if (bootstrapLinterArtifact === null) {
        addBlocker(
          "BOOTSTRAP_LINTER_MISSING",
          "bootstrap",
          "Approved bootstrap requirements require an exact bound executable registry linter"
        );
      }
      let markerCounts = null;
      if (bootstrapMarkerArtifact !== null) {
        try {
          const overlay = JSON.parse(bootstrapMarkerArtifact.bytes.toString("utf8"));
          if (
            exactKeys(
              overlay,
              ["formatVersion", "status", "sourcePlanSha256", "selectedProfileId", "sourceInventories", "entries"],
              "bootstrap-marker",
              "markerOverlay"
            )
          ) {
            if (overlay.formatVersion !== 1 || overlay.status !== "approved") {
              addBlocker("BOOTSTRAP_MARKER_STATUS", "bootstrap-marker", "Bound marker overlay must be approved format version 1");
            }
            if (overlay.sourcePlanSha256 !== planSha256) {
              addBlocker("BOOTSTRAP_MARKER_PLAN_HASH", "bootstrap-marker", "Marker overlay does not bind the current frozen plan");
            }
            if (overlay.selectedProfileId !== value.selectedProfileId) {
              addBlocker("BOOTSTRAP_MARKER_PROFILE", "bootstrap-marker", "Marker overlay selected profile differs from bootstrap");
            }
            const expectedInventories = (inventory?.inventoryFiles ?? []).map((file) => ({
              path: file.path.replace(/^pre-m0\//, ""),
              sha256: file.sha256
            }));
            if (
              !Array.isArray(overlay.sourceInventories) ||
              canonicalJson(overlay.sourceInventories) !== canonicalJson(expectedInventories)
            ) {
              addBlocker("BOOTSTRAP_MARKER_INVENTORIES", "bootstrap-marker", "Marker overlay must bind the exact reviewed inventory set in validator order", {
                expected: expectedInventories,
                actual: overlay.sourceInventories ?? null
              });
            }
            const entries = Array.isArray(overlay.entries) ? overlay.entries : [];
            if (!Array.isArray(overlay.entries) || entries.length === 0) {
              addBlocker("BOOTSTRAP_MARKER_ENTRIES", "bootstrap-marker", "Approved marker overlay must contain disposition entries");
            }
            const registeredIds = new Set();
            const entriesByInventory = new Map();
            let registeredMarkerCount = 0;
            let deferredMarkerCount = 0;
            let nonnormativeMarkerCount = 0;
            entries.forEach((entry, index) => {
              const location = `markerOverlay.entries[${index}]`;
              if (!isObject(entry)) {
                addBlocker("BOOTSTRAP_MARKER_ENTRY_SHAPE", "bootstrap-marker", `${location} must be an object`);
                return;
              }
              const markerFields = {
                registered: [
                  "markerClass",
                  "requirementId",
                  "inventoryId",
                  "sourceBlockSha256",
                  "sourceLineStart",
                  "sourceLineEnd",
                  "sourceAnchor",
                  "statementSha256"
                ],
                deferred: [
                  "markerClass",
                  "inventoryId",
                  "sourceBlockSha256",
                  "sourceLineStart",
                  "sourceLineEnd",
                  "sourceAnchor",
                  "registrationBefore",
                  "reviewedBy",
                  "rationale"
                ],
                nonnormative: [
                  "markerClass",
                  "inventoryId",
                  "sourceBlockSha256",
                  "sourceLineStart",
                  "sourceLineEnd",
                  "sourceAnchor",
                  "reviewedBy",
                  "rationale"
                ]
              }[entry.markerClass];
              if (markerFields === undefined) {
                addBlocker("BOOTSTRAP_MARKER_CLASS", "bootstrap-marker", `${location}.markerClass is invalid`);
                return;
              }
              if (!exactKeys(entry, markerFields, "bootstrap-marker", location)) return;
              const block = allInventoryBlocks.get(entry.inventoryId);
              if (!block) {
                addBlocker("BOOTSTRAP_MARKER_INVENTORY_UNKNOWN", "bootstrap-marker", `${location} references an unknown inventory ID`);
                return;
              }
              const blockEntries = entriesByInventory.get(entry.inventoryId) ?? [];
              blockEntries.push(entry);
              entriesByInventory.set(entry.inventoryId, blockEntries);
              if (entry.sourceBlockSha256 !== block.sourceBlockSha256) {
                addBlocker("BOOTSTRAP_MARKER_SOURCE_HASH", "bootstrap-marker", `${location} source-block hash differs from inventory`);
              }
              if (
                !Number.isInteger(entry.sourceLineStart) ||
                !Number.isInteger(entry.sourceLineEnd) ||
                entry.sourceLineStart < block.lineStart ||
                entry.sourceLineEnd > block.lineEnd ||
                entry.sourceLineEnd < entry.sourceLineStart
              ) {
                addBlocker("BOOTSTRAP_MARKER_SOURCE_LINES", "bootstrap-marker", `${location} line range falls outside its inventory block`);
              }
              if (!isNonemptyString(entry.sourceAnchor)) {
                addBlocker("BOOTSTRAP_MARKER_SOURCE_ANCHOR", "bootstrap-marker", `${location}.sourceAnchor must be nonempty`);
              }
              if (entry.markerClass === "registered") {
                registeredMarkerCount += 1;
                if (!productionRequirementIdPattern.test(entry.requirementId ?? "")) {
                  addBlocker("BOOTSTRAP_MARKER_PRODUCTION_ID", "bootstrap-marker", `${location} must use a production LJ ID`);
                } else if (registeredIds.has(entry.requirementId)) {
                  addBlocker("BOOTSTRAP_MARKER_ID_DUPLICATE", "bootstrap-marker", `Duplicate registered marker ID: ${entry.requirementId}`);
                } else {
                  registeredIds.add(entry.requirementId);
                }
                const requirement = requirementById.get(entry.requirementId);
                if (!requirement) {
                  addBlocker("BOOTSTRAP_MARKER_REQUIREMENT_UNKNOWN", "bootstrap-marker", `${location} has no bootstrap requirement`);
                } else {
                  for (const field of [
                    "inventoryId",
                    "sourceBlockSha256",
                    "sourceLineStart",
                    "sourceLineEnd",
                    "sourceAnchor",
                    "statementSha256"
                  ]) {
                    if (entry[field] !== requirement[field]) {
                      addBlocker("BOOTSTRAP_MARKER_REQUIREMENT_MISMATCH", "bootstrap-marker", `${location}.${field} differs from ${entry.requirementId}`);
                    }
                  }
                }
              } else if (entry.markerClass === "deferred") {
                deferredMarkerCount += 1;
                if (
                  entry.sourceLineStart !== block.lineStart ||
                  entry.sourceLineEnd !== block.lineEnd ||
                  entry.sourceAnchor !== block.sourceAnchor
                ) {
                  addBlocker("BOOTSTRAP_MARKER_DEFERRED_SOURCE", "bootstrap-marker", `${location} must cover the exact deferred inventory block`);
                }
                if (entry.reviewedBy !== roles?.humanReviewer?.name || !isNonemptyString(entry.rationale)) {
                  addBlocker("BOOTSTRAP_MARKER_DEFERRED_REVIEW", "bootstrap-marker", `${location} requires the named human reviewer and rationale`);
                }
                if (
                  !Array.isArray(entry.registrationBefore) ||
                  canonicalJson(entry.registrationBefore) !== canonicalJson(block.registrationBefore)
                ) {
                  addBlocker("BOOTSTRAP_MARKER_DEFERRED_FRONTIER", "bootstrap-marker", `${location} frontier differs from inventory`);
                }
              } else if (entry.markerClass === "nonnormative") {
                nonnormativeMarkerCount += 1;
                if (
                  entry.sourceLineStart !== block.lineStart ||
                  entry.sourceLineEnd !== block.lineEnd ||
                  entry.sourceAnchor !== block.sourceAnchor
                ) {
                  addBlocker("BOOTSTRAP_MARKER_NONNORMATIVE_SOURCE", "bootstrap-marker", `${location} must cover the exact nonnormative inventory block`);
                }
                if (entry.reviewedBy !== roles?.humanReviewer?.name || !isNonemptyString(entry.rationale)) {
                  addBlocker("BOOTSTRAP_MARKER_NONNORMATIVE_REVIEW", "bootstrap-marker", `${location} requires the named human reviewer and rationale`);
                }
              }
            });
            const dispositionMismatches = [];
            for (const block of allInventoryBlocks.values()) {
              const blockEntries = entriesByInventory.get(block.id) ?? [];
              const registered = blockEntries.filter((entry) => entry.markerClass === "registered").length;
              const deferred = blockEntries.filter((entry) => entry.markerClass === "deferred").length;
              const nonnormative = blockEntries.filter((entry) => entry.markerClass === "nonnormative").length;
              const isM0Registration =
                block.disposition === "initial-registration" && block.registrationBefore.includes("M0");
              const valid = block.disposition === "nonnormative"
                ? registered === 0 && deferred === 0 && nonnormative === 1
                : isM0Registration
                  ? registered === block.anticipatedAtomicRecords && deferred === 0 && nonnormative === 0
                  : registered === 0 && deferred === 1 && nonnormative === 0;
              if (!valid) {
                dispositionMismatches.push({ inventoryId: block.id, registered, deferred, nonnormative });
              }
            }
            if (dispositionMismatches.length > 0) {
              addBlocker(
                "BOOTSTRAP_MARKER_WHOLE_PLAN_COVERAGE",
                "bootstrap-marker",
                "Marker overlay does not give every reviewed inventory block exactly its required registered, deferred, or nonnormative disposition",
                { firstMismatches: dispositionMismatches.slice(0, 25) }
              );
            }
            const missingRegisteredIds = [...requirementIds].filter((id) => !registeredIds.has(id));
            if (missingRegisteredIds.length > 0 || registeredIds.size !== requirementIds.size) {
              addBlocker("BOOTSTRAP_MARKER_ID_SET", "bootstrap-marker", "Marker overlay production-ID set differs from bootstrap", {
                firstMissingIds: missingRegisteredIds.slice(0, 25),
                markerCount: registeredIds.size,
                requirementCount: requirementIds.size
              });
            }
            markerCounts = {
              inventoryBlockCount: allInventoryBlocks.size,
              coveredInventoryBlockCount: entriesByInventory.size,
              registeredMarkerCount,
              deferredMarkerCount,
              nonnormativeMarkerCount,
              sourceBlockCheckCount: entries.length,
              statementHashCheckCount: registeredMarkerCount
            };
          }
        } catch (error) {
          addBlocker("BOOTSTRAP_MARKER_JSON", "bootstrap-marker", "Bound marker overlay is not valid JSON", {
            error: String(error?.message ?? error)
          });
        }
      }
      if (
        bootstrapMarkerArtifact !== null &&
        bootstrapMarkerSchemaArtifact !== null &&
        bootstrapLinterArtifact !== null
      ) {
        const linterRun = spawnSync(
          process.execPath,
          permissionedNodeArguments(
            bootstrapLinterArtifact.path,
            [
              paths.plan,
              bootstrapMarkerArtifact.path,
              bootstrapArtifact.path,
              bootstrapMarkerSchemaArtifact.path,
              ...(inventory?.inventoryFiles ?? []).map((file) =>
                join(projectDirectory, file.path)
              )
            ],
            [
              bootstrapMarkerArtifact.path,
              bootstrapArtifact.path,
              bootstrapMarkerSchemaArtifact.path
            ]
          ),
          { cwd: projectDirectory, encoding: "utf8" }
        );
        if (linterRun.error || linterRun.status !== 0) {
          addBlocker("BOOTSTRAP_LINTER_FAILED", "bootstrap", "The frozen bootstrap registry linter rejected the bound marker/registry artifacts", {
            exitCode: linterRun.status,
            error: String(linterRun.error?.message ?? linterRun.stderr ?? "linter failed").slice(0, 500)
          });
        } else {
          try {
            const receipt = JSON.parse(linterRun.stdout);
            const inventorySetSha256 = sha256Text(
              canonicalJson(inventory?.inventoryFiles ?? [])
            );
            const productionIdSetSha256 = sha256Text(
              canonicalJson([...requirementIds].sort())
            );
            const expectedReceipt = {
              formatVersion: 1,
              status: "valid",
              planSha256,
              inventorySetSha256,
              markerSchemaSha256: bootstrapMarkerSchemaArtifact.sha256,
              markerArtifactSha256: bootstrapMarkerArtifact.sha256,
              bootstrapSha256: bootstrapArtifact.sha256,
              linterGraphSha256: bootstrapLinterGraphSha256,
              selectedProfileId: value.selectedProfileId,
              requirementCount: value.requirements.length,
              productionIdSetSha256,
              ...(markerCounts ?? {})
            };
            for (const [field, expected] of Object.entries(expectedReceipt)) {
              if (receipt?.[field] !== expected) {
                addBlocker("BOOTSTRAP_LINTER_RECEIPT_MISMATCH", "bootstrap", `Bootstrap linter receipt field ${field} is incorrect`, {
                  expected,
                  actual: receipt?.[field] ?? null
                });
              }
            }
            if (!Array.isArray(receipt?.errors) || receipt.errors.length !== 0) {
              addBlocker("BOOTSTRAP_LINTER_RECEIPT_ERRORS", "bootstrap", "Passing bootstrap linter receipt must contain an empty errors array");
            }
          } catch (error) {
            addBlocker("BOOTSTRAP_LINTER_OUTPUT_INVALID", "bootstrap", "The frozen bootstrap linter did not emit a valid JSON receipt", {
              error: String(error?.message ?? error)
            });
          }
        }
      }
    }
    if (value.status !== "bootstrap-approved") {
      addBlocker("BOOTSTRAP_UNAPPROVED", "bootstrap", `Bootstrap requirements are not approved: ${value.status}`);
    }
    requireNamedRolesForApproval("bootstrap", value.status, "bootstrap-approved");
  }
}

let profiles = null;
const profileById = new Map();
if (profilesArtifact !== null && profilesArtifact.value !== null) {
  const value = profilesArtifact.value;
  if (exactKeys(value, ["formatVersion", "status", "profiles"], "profiles", "profiles")) {
    profiles = value;
    if (value.formatVersion !== 1) {
      addBlocker("FORMAT_VERSION", "profiles", "profiles.formatVersion must equal 1");
    }
    if (value.status !== "draft-unapproved" && value.status !== "approved") {
      addBlocker("STATUS_INVALID", "profiles", "profiles.status is not recognized");
    }
    if (!Array.isArray(value.profiles) || value.profiles.length === 0) {
      addBlocker("PROFILES_EMPTY", "profiles", "profiles.profiles must be a nonempty array");
    } else {
      for (let index = 0; index < value.profiles.length; index += 1) {
        const profile = value.profiles[index];
        const location = `profiles.profiles[${index}]`;
        if (
          !exactKeys(
            profile,
            ["id", "status", "sourcePlanSha256", "claims", "incompleteReasons"],
            "profiles",
            location
          )
        ) {
          continue;
        }
        if (!isNonemptyString(profile.id)) {
          addBlocker("PROFILE_ID_INVALID", "profiles", `${location}.id must be nonempty`);
        } else if (profileById.has(profile.id)) {
          addBlocker("PROFILE_ID_DUPLICATE", "profiles", `Duplicate profile ID: ${profile.id}`);
        } else {
          profileById.set(profile.id, profile);
        }
        if (profile.status !== "incomplete" && profile.status !== "approved") {
          addBlocker("PROFILE_STATUS_INVALID", "profiles", `${profile.id ?? location} has invalid status`);
        }
        if (!hashPattern.test(profile.sourcePlanSha256 ?? "")) {
          addBlocker("PLAN_HASH_FORMAT", "profiles", `${profile.id ?? location} has invalid sourcePlanSha256`);
        } else if (profile.sourcePlanSha256 !== planSha256) {
          addBlocker("PLAN_HASH_MISMATCH", "profiles", `${profile.id ?? location} does not match the current plan`, {
            expected: planSha256,
            actual: profile.sourcePlanSha256
          });
        }
        if (!Array.isArray(profile.claims) || profile.claims.length === 0) {
          addBlocker("PROFILE_CLAIMS_EMPTY", "profiles", `${profile.id ?? location} must declare claims`);
        } else {
          const claimIds = new Set();
          for (let claimIndex = 0; claimIndex < profile.claims.length; claimIndex += 1) {
            const claim = profile.claims[claimIndex];
            const claimLocation = `${location}.claims[${claimIndex}]`;
            if (!exactKeys(claim, ["id", "sourceAnchor", "statement"], "profiles", claimLocation)) continue;
            if (!isNonemptyString(claim.id)) {
              addBlocker("CLAIM_ID_INVALID", "profiles", `${claimLocation}.id must be nonempty`);
            } else if (claimIds.has(claim.id)) {
              addBlocker("CLAIM_ID_DUPLICATE", "profiles", `Duplicate claim ID in ${profile.id}: ${claim.id}`);
            } else {
              claimIds.add(claim.id);
            }
            if (!isNonemptyString(claim.sourceAnchor)) {
              addBlocker("CLAIM_ANCHOR_INVALID", "profiles", `${claimLocation}.sourceAnchor must be nonempty`);
            }
            if (!isNonemptyString(claim.statement)) {
              addBlocker("CLAIM_STATEMENT_INVALID", "profiles", `${claimLocation}.statement must be nonempty`);
            }
          }
        }
        if (
          !Array.isArray(profile.incompleteReasons) ||
          !profile.incompleteReasons.every(isNonemptyString)
        ) {
          addBlocker("INCOMPLETE_REASONS_INVALID", "profiles", `${profile.id ?? location}.incompleteReasons is invalid`);
        } else if (profile.status === "approved" && profile.incompleteReasons.length > 0) {
          addBlocker(
            "PROFILE_STATUS_REASON_MISMATCH",
            "profiles",
            `${profile.id ?? location} is approved but still has incomplete reasons`
          );
        } else if (profile.status === "incomplete" && profile.incompleteReasons.length === 0) {
          addBlocker(
            "PROFILE_STATUS_REASON_MISMATCH",
            "profiles",
            `${profile.id ?? location} is incomplete but gives no incomplete reason`
          );
        }
      }
    }
    if (value.status !== "approved") {
      addBlocker("PROFILE_REGISTRY_UNAPPROVED", "profiles", `Release profile registry is not approved: ${value.status}`);
    }
    if (
      value.status !== "approved" &&
      Array.isArray(value.profiles) &&
      value.profiles.some((profile) => profile?.status === "approved")
    ) {
      requireNamedRolesForApproval("profiles", "approved", "approved");
    }
    requireNamedRolesForApproval("profiles", value.status, "approved");
  }
}

const selectedProfileIds = new Set();
if (isNonemptyString(bootstrap?.selectedProfileId)) selectedProfileIds.add(bootstrap.selectedProfileId);

let selection = null;
if (selectionArtifact !== null && selectionArtifact.value !== null) {
  const value = selectionArtifact.value;
  if (
    exactKeys(
      value,
      [
        "formatVersion",
        "status",
        "selectedProfileId",
        "profileRegistrySha256",
        "bootstrapRequirementsSha256",
        "predecessorSelectionSha256",
        "approvals",
        "blockingReasons"
      ],
      "selection",
      "selection"
    )
  ) {
    selection = value;
    if (value.formatVersion !== 1) {
      addBlocker("FORMAT_VERSION", "selection", "selection.formatVersion must equal 1");
    }
    if (value.status !== "draft-unapproved" && value.status !== "approved") {
      addBlocker("STATUS_INVALID", "selection", "selection.status is not recognized");
    }
    if (!isNonemptyString(value.selectedProfileId)) {
      addBlocker("SELECTED_PROFILE_ID_INVALID", "selection", "selection.selectedProfileId must be nonempty");
    } else {
      selectedProfileIds.add(value.selectedProfileId);
    }
    for (const [field, fieldValue] of [
      ["profileRegistrySha256", value.profileRegistrySha256],
      ["bootstrapRequirementsSha256", value.bootstrapRequirementsSha256],
      ["predecessorSelectionSha256", value.predecessorSelectionSha256]
    ]) {
      if (!isNullableHash(fieldValue)) {
        addBlocker("SELECTION_HASH_FORMAT", "selection", `selection.${field} must be null or lowercase SHA-256`);
      }
    }
    if (value.predecessorSelectionSha256 !== null) {
      addBlocker(
        "INITIAL_SELECTION_PREDECESSOR",
        "selection",
        "The initial pre-M0 selection must have a null predecessor; successor attestations belong to the later migration workflow"
      );
    }
    if (
      value.profileRegistrySha256 !== null &&
      profilesArtifact !== null &&
      value.profileRegistrySha256 !== profilesArtifact.sha256
    ) {
      addBlocker("PROFILE_REGISTRY_HASH_MISMATCH", "selection", "Selection does not hash the exact profile registry bytes", {
        expected: profilesArtifact.sha256,
        actual: value.profileRegistrySha256
      });
    }
    if (
      value.bootstrapRequirementsSha256 !== null &&
      bootstrapArtifact !== null &&
      value.bootstrapRequirementsSha256 !== bootstrapArtifact.sha256
    ) {
      addBlocker("BOOTSTRAP_HASH_MISMATCH", "selection", "Selection does not hash the exact bootstrap bytes", {
        expected: bootstrapArtifact.sha256,
        actual: value.bootstrapRequirementsSha256
      });
    }
    if (
      exactKeys(
        value.approvals,
        [
          "humanReviewer",
          "humanDecisionOwner",
          "approvedAt",
          "reviewAttestation",
          "ownerAttestation"
        ],
        "selection",
        "selection.approvals"
      )
    ) {
      for (const field of ["humanReviewer", "humanDecisionOwner", "approvedAt"]) {
        if (value.approvals[field] !== null && !isNonemptyString(value.approvals[field])) {
          addBlocker("APPROVAL_FIELD_INVALID", "selection", `selection.approvals.${field} must be null or nonempty`);
        }
      }
      if (
        value.approvals.approvedAt !== null &&
        !isStrictIsoTimestamp(value.approvals.approvedAt)
      ) {
        addBlocker(
          "APPROVAL_TIME_INVALID",
          "selection",
          "selection.approvals.approvedAt must be a strict ISO-8601 timestamp with a timezone"
        );
      }
      if (
        value.approvals.reviewAttestation !== null &&
        value.approvals.reviewAttestation !== "exact-bootstrap-human-review-complete"
      ) {
        addBlocker(
          "SELECTION_REVIEW_ATTESTATION_INVALID",
          "selection",
          "selection.approvals.reviewAttestation is invalid"
        );
      }
      if (
        value.approvals.ownerAttestation !== null &&
        value.approvals.ownerAttestation !== "exact-bootstrap-decision-owner-approval-complete"
      ) {
        addBlocker(
          "SELECTION_OWNER_ATTESTATION_INVALID",
          "selection",
          "selection.approvals.ownerAttestation is invalid"
        );
      }
    }
    if (!Array.isArray(value.blockingReasons) || !value.blockingReasons.every(isNonemptyString)) {
      addBlocker("BLOCKING_REASONS_INVALID", "selection", "selection.blockingReasons must be an array of nonempty strings");
    }
    if (value.status === "approved") {
      if (value.profileRegistrySha256 === null || value.profileRegistrySha256 !== profilesArtifact?.sha256) {
        addBlocker(
          "APPROVED_SELECTION_PROFILE_HASH",
          "selection",
          "Approved selection must hash the exact current profile registry bytes"
        );
      }
      if (value.bootstrapRequirementsSha256 === null || value.bootstrapRequirementsSha256 !== bootstrapArtifact?.sha256) {
        addBlocker(
          "APPROVED_SELECTION_BOOTSTRAP_HASH",
          "selection",
          "Approved selection must hash the exact current bootstrap bytes"
        );
      }
      if (
        !isNonemptyString(value.approvals?.humanReviewer) ||
        !isNonemptyString(value.approvals?.humanDecisionOwner) ||
        !isNonemptyString(value.approvals?.approvedAt) ||
        value.approvals?.reviewAttestation !== "exact-bootstrap-human-review-complete" ||
        value.approvals?.ownerAttestation !== "exact-bootstrap-decision-owner-approval-complete"
      ) {
        addBlocker(
          "APPROVED_SELECTION_FIELDS",
          "selection",
          "Approved selection requires reviewer, decision owner, approval time, and both exact-bootstrap batch attestations"
        );
      }
      if (Array.isArray(value.blockingReasons) && value.blockingReasons.length > 0) {
        addBlocker("APPROVED_SELECTION_BLOCKERS", "selection", "Approved selection still lists blocking reasons");
      }
      if (
        isNonemptyString(value.approvals?.humanReviewer) &&
        value.approvals.humanReviewer !== roles?.humanReviewer?.name
      ) {
        addBlocker(
          "SELECTION_REVIEWER_ROLE_MISMATCH",
          "selection",
          "Selection reviewer does not match the named humanReviewer role"
        );
      }
      if (
        isNonemptyString(value.approvals?.humanDecisionOwner) &&
        value.approvals.humanDecisionOwner !== roles?.humanDecisionOwner?.name
      ) {
        addBlocker(
          "SELECTION_OWNER_ROLE_MISMATCH",
          "selection",
          "Selection decision owner does not match the named humanDecisionOwner role"
        );
      }
    } else {
      if (
        value.approvals?.humanReviewer !== null ||
        value.approvals?.humanDecisionOwner !== null ||
        value.approvals?.approvedAt !== null ||
        value.approvals?.reviewAttestation !== null ||
        value.approvals?.ownerAttestation !== null
      ) {
        addBlocker(
          "SELECTION_STATUS_APPROVAL_MISMATCH",
          "selection",
          "Draft selection must not carry approval fields"
        );
      }
      addBlocker("SELECTION_UNAPPROVED", "selection", `Profile selection is not approved: ${value.status}`);
    }
    requireNamedRolesForApproval("selection", value.status, "approved");
  }
}

if (
  isNonemptyString(bootstrap?.selectedProfileId) &&
  isNonemptyString(selection?.selectedProfileId) &&
  bootstrap.selectedProfileId !== selection.selectedProfileId
) {
  addBlocker(
    "SELECTED_PROFILE_MISMATCH",
    "cross-file",
    "Bootstrap and selection artifacts choose different profile IDs",
    { bootstrap: bootstrap.selectedProfileId, selection: selection.selectedProfileId }
  );
}
for (const profileId of selectedProfileIds) {
  const selectedProfile = profileById.get(profileId);
  if (!selectedProfile) {
    addBlocker("SELECTED_PROFILE_MISSING", "profiles", `Selected profile does not exist: ${profileId}`);
  } else if (selectedProfile.status !== "approved") {
    addBlocker("SELECTED_PROFILE_UNAPPROVED", "profiles", `Selected profile is not approved: ${profileId}`);
  }
}
if (bootstrap !== null) {
  const requirements = Array.isArray(bootstrap.requirements) ? bootstrap.requirements : [];
  for (const requirement of requirements) {
    const releaseProfileIds = Array.isArray(requirement?.releaseProfileIds)
      ? requirement.releaseProfileIds
      : [];
    for (const profileId of releaseProfileIds) {
      if (!profileById.has(profileId)) {
        addBlocker(
          "REQUIREMENT_PROFILE_MISSING",
          "cross-file",
          `${requirement.requirementId ?? "Bootstrap requirement"} references missing profile ${profileId}`
        );
      }
    }
  }
}

let capacity = null;
const requireNullableNonnegative = (value, artifact, location) => {
  if (!isNullableFiniteNumber(value) || (typeof value === "number" && value < 0)) {
    addBlocker("NUMBER_INVALID", artifact, `${location} must be null or a nonnegative finite number`);
    return false;
  }
  return true;
};
const approximatelyEqual = (left, right) => {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const tolerance = Math.max(1e-6, Math.abs(right) * 1e-9);
  return Math.abs(left - right) <= tolerance;
};

let calibrationArtifact = null;
let calibration = null;
const calibrationBoundArtifacts = [];
const nullableNameIsValid = (value) => value === null || isNonemptyString(value);
const nullableCountIsValid = (value) =>
  value === null || (Number.isInteger(value) && value >= 0);
const calibrationPhaseNames = ["authoring", "review", "rework", "decision-review", "final-verification"];
const calibrationAgentMinuteFields = ["authoring", "review", "rework"];
const calibrationHumanMinuteFields = [
  "implementer",
  "reviewer",
  "decisionOwnerPerRecordWork",
  "decisionOwnerFixedBatchWork"
];

const validateCalibrationTimerLog = (record, artifact) => {
  if (artifact === undefined) return;
  let timer;
  try {
    timer = JSON.parse(artifact.bytes.toString("utf8"));
  } catch (error) {
    addBlocker("CALIBRATION_TIMER_JSON", "calibration-timer", "The bound timer log is not valid JSON", {
      error: String(error?.message ?? error)
    });
    return;
  }
  if (
    !exactKeys(
      timer,
      ["formatVersion", "runId", "monotonicClock", "phases", "humanIntervals", "agentIntervals"],
      "calibration-timer",
      "timerLog"
    )
  ) return;
  if (timer.formatVersion !== 1) {
    addBlocker("CALIBRATION_TIMER_VERSION", "calibration-timer", "timerLog.formatVersion must equal 1");
  }
  if (timer.runId !== record.runId) {
    addBlocker("CALIBRATION_TIMER_RUN_ID", "calibration-timer", "Timer log runId does not match the calibration record");
  }
  const clockFields = ["source", "unit", "continuousProcessIdentity"];
  if (exactKeys(timer.monotonicClock, clockFields, "calibration-timer", "timerLog.monotonicClock")) {
    for (const field of clockFields) {
      if (timer.monotonicClock[field] !== record.monotonicClock?.[field]) {
        addBlocker("CALIBRATION_TIMER_CLOCK", "calibration-timer", `Timer log clock field ${field} differs from the calibration record`);
      }
    }
  }
  if (!Array.isArray(timer.phases) || timer.phases.length !== record.phases?.length) {
    addBlocker("CALIBRATION_TIMER_PHASES", "calibration-timer", "Timer log phases do not match the calibration phase count");
  } else {
    timer.phases.forEach((phase, index) => {
      const location = `timerLog.phases[${index}]`;
      if (!exactKeys(phase, ["name", "start", "end", "elapsedSeconds"], "calibration-timer", location)) return;
      const expected = record.phases[index];
      for (const field of ["name", "start", "end", "elapsedSeconds"]) {
        const matches =
          typeof phase[field] === "number"
            ? approximatelyEqual(phase[field], expected?.[field])
            : phase[field] === expected?.[field];
        if (!matches) {
          addBlocker("CALIBRATION_TIMER_PHASE_MISMATCH", "calibration-timer", `${location}.${field} differs from the calibration record`);
        }
      }
    });
  }
  const phaseByName = new Map(
    (Array.isArray(timer.phases) ? timer.phases : []).map((phase) => [phase?.name, phase])
  );
  const intervalGroups = new Map();
  const validateIntervalTiming = (interval, location, participantKey) => {
    const phase = phaseByName.get(interval.phase);
    if (!calibrationPhaseNames.includes(interval.phase) || !phase) {
      addBlocker("CALIBRATION_TIMER_INTERVAL_PHASE", "calibration-timer", `${location}.phase is invalid`);
    }
    if (
      !isFiniteNumber(interval.start) ||
      !isFiniteNumber(interval.end) ||
      !isFiniteNumber(interval.elapsedSeconds) ||
      interval.end < interval.start ||
      interval.elapsedSeconds < 0
    ) {
      addBlocker("CALIBRATION_TIMER_INTERVAL", "calibration-timer", `${location} has invalid monotonic timing`);
      return;
    }
    if (!approximatelyEqual(interval.elapsedSeconds, interval.end - interval.start)) {
      addBlocker("CALIBRATION_TIMER_INTERVAL_ELAPSED", "calibration-timer", `${location}.elapsedSeconds does not equal end minus start`);
    }
    if (phase && (interval.start < phase.start || interval.end > phase.end)) {
      addBlocker("CALIBRATION_TIMER_INTERVAL_OUTSIDE_PHASE", "calibration-timer", `${location} falls outside its named phase`);
    }
    const intervals = intervalGroups.get(participantKey) ?? [];
    intervals.push({ start: interval.start, end: interval.end, location });
    intervalGroups.set(participantKey, intervals);
  };

  const humanTotals = Object.fromEntries(calibrationHumanMinuteFields.map((field) => [field, 0]));
  if (!Array.isArray(timer.humanIntervals)) {
    addBlocker("CALIBRATION_TIMER_HUMAN_INTERVALS", "calibration-timer", "timerLog.humanIntervals must be an array");
  } else {
    timer.humanIntervals.forEach((interval, index) => {
      const location = `timerLog.humanIntervals[${index}]`;
      if (!exactKeys(interval, ["metric", "participant", "phase", "start", "end", "elapsedSeconds"], "calibration-timer", location)) return;
      if (!calibrationHumanMinuteFields.includes(interval.metric)) {
        addBlocker("CALIBRATION_TIMER_HUMAN_METRIC", "calibration-timer", `${location}.metric is invalid`);
      }
      if (!isNonemptyString(interval.participant)) {
        addBlocker("CALIBRATION_TIMER_PARTICIPANT", "calibration-timer", `${location}.participant must be nonempty`);
      }
      const expectedParticipant = {
        implementer: record.people?.productionImplementer,
        reviewer: record.people?.humanReviewer,
        decisionOwnerPerRecordWork: record.people?.humanDecisionOwner,
        decisionOwnerFixedBatchWork: record.people?.humanDecisionOwner
      }[interval.metric];
      if (expectedParticipant !== undefined && interval.participant !== expectedParticipant) {
        addBlocker("CALIBRATION_TIMER_ROLE_MISMATCH", "calibration-timer", `${location}.participant does not match the metric's named role`);
      }
      validateIntervalTiming(interval, location, `human:${interval.participant}`);
      if (calibrationHumanMinuteFields.includes(interval.metric) && isFiniteNumber(interval.elapsedSeconds)) {
        humanTotals[interval.metric] += interval.elapsedSeconds / 60;
      }
    });
  }

  const agentTotals = Object.fromEntries(calibrationAgentMinuteFields.map((field) => [field, 0]));
  if (!Array.isArray(timer.agentIntervals)) {
    addBlocker("CALIBRATION_TIMER_AGENT_INTERVALS", "calibration-timer", "timerLog.agentIntervals must be an array");
  } else {
    timer.agentIntervals.forEach((interval, index) => {
      const location = `timerLog.agentIntervals[${index}]`;
      if (!exactKeys(interval, ["metric", "agent", "phase", "start", "end", "elapsedSeconds"], "calibration-timer", location)) return;
      if (!calibrationAgentMinuteFields.includes(interval.metric)) {
        addBlocker("CALIBRATION_TIMER_AGENT_METRIC", "calibration-timer", `${location}.metric is invalid`);
      }
      if (!isNonemptyString(interval.agent)) {
        addBlocker("CALIBRATION_TIMER_AGENT", "calibration-timer", `${location}.agent must be nonempty`);
      }
      validateIntervalTiming(interval, location, `agent:${interval.agent}`);
      if (calibrationAgentMinuteFields.includes(interval.metric) && isFiniteNumber(interval.elapsedSeconds)) {
        agentTotals[interval.metric] += interval.elapsedSeconds / 60;
      }
    });
  }

  for (const [participant, intervals] of intervalGroups) {
    intervals.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < intervals.length; index += 1) {
      if (intervals[index].start < intervals[index - 1].end) {
        addBlocker("CALIBRATION_TIMER_PARTICIPANT_OVERLAP", "calibration-timer", `${participant} has overlapping active intervals`, {
          previous: intervals[index - 1].location,
          current: intervals[index].location
        });
      }
    }
  }
  for (const field of calibrationHumanMinuteFields) {
    if (!approximatelyEqual(humanTotals[field], record.activeHumanMinutes?.[field])) {
      addBlocker("CALIBRATION_TIMER_HUMAN_TOTAL", "calibration-timer", `Timer intervals do not reconcile activeHumanMinutes.${field}`, {
        expected: humanTotals[field],
        actual: record.activeHumanMinutes?.[field] ?? null
      });
    }
  }
  for (const field of calibrationAgentMinuteFields) {
    if (!approximatelyEqual(agentTotals[field], record.agentWallMinutes?.[field])) {
      addBlocker("CALIBRATION_TIMER_AGENT_TOTAL", "calibration-timer", `Timer intervals do not reconcile agentWallMinutes.${field}`, {
        expected: agentTotals[field],
        actual: record.agentWallMinutes?.[field] ?? null
      });
    }
  }
};

const validateCalibration = (artifact) => {
  if (artifact === null || artifact.value === null) return null;
  const value = artifact.value;
  if (
    !exactKeys(
      value,
      [
        "formatVersion",
        "status",
        "runId",
        "rolesSha256",
        "sourcePlanSha256",
        "sourceSection",
        "workflowArtifacts",
        "people",
        "monotonicClock",
        "phases",
        "sourceUnitLedger",
        "counts",
        "agentWallMinutes",
        "activeHumanMinutes",
        "zeroMinuteReasons",
        "toolingEstimate",
        "acceptedArtifacts",
        "derived",
        "approvals",
        "blockingReasons"
      ],
      "calibration",
      "calibration"
    )
  ) {
    return value;
  }
  const allowedStatuses = new Set(["not-run", "in-progress", "dry-run", "rejected", "approved"]);
  if (value.formatVersion !== 1) {
    addBlocker("FORMAT_VERSION", "calibration", "calibration.formatVersion must equal 1");
  }
  if (!allowedStatuses.has(value.status)) {
    addBlocker("STATUS_INVALID", "calibration", "calibration.status is not recognized");
  }
  if (!nullableNameIsValid(value.runId)) {
    addBlocker("CALIBRATION_RUN_ID_INVALID", "calibration", "calibration.runId must be null or nonempty");
  }
  if (!isNullableHash(value.rolesSha256)) {
    addBlocker("CALIBRATION_ROLES_HASH_INVALID", "calibration", "calibration.rolesSha256 must be null or lowercase SHA-256");
  }
  if (!hashPattern.test(value.sourcePlanSha256 ?? "")) {
    addBlocker("CALIBRATION_PLAN_HASH_FORMAT", "calibration", "Calibration plan hash must be lowercase SHA-256");
  } else if (value.sourcePlanSha256 !== planSha256) {
    addBlocker("CALIBRATION_PLAN_HASH_MISMATCH", "calibration", "Calibration does not use the current plan bytes", {
      expected: planSha256,
      actual: value.sourcePlanSha256
    });
  }

  let expectedSectionSha256 = null;
  if (planBytes !== null) {
    const planText = planBytes.toString("utf8");
    const sectionStart = planText.indexOf("### 2.2 Fallback chain and tiebreakers");
    const sectionEnd = planText.indexOf("### 2.3 Evaluation locale and catalog merging", sectionStart);
    if (sectionStart >= 0 && sectionEnd > sectionStart) {
      expectedSectionSha256 = sha256Text(planText.slice(sectionStart, sectionEnd));
    } else {
      addBlocker("CALIBRATION_SECTION_UNAVAILABLE", "calibration", "Cannot isolate current plan section 2.2");
    }
  }
  if (
    exactKeys(value.sourceSection, ["anchor", "sha256"], "calibration", "calibration.sourceSection")
  ) {
    if (value.sourceSection.anchor !== "2.2") {
      addBlocker("CALIBRATION_SECTION_ANCHOR", "calibration", "Calibration source anchor must equal 2.2");
    }
    if (!hashPattern.test(value.sourceSection.sha256 ?? "")) {
      addBlocker("CALIBRATION_SECTION_HASH_FORMAT", "calibration", "Calibration section hash must be lowercase SHA-256");
    } else if (
      expectedSectionSha256 !== null &&
      value.sourceSection.sha256 !== expectedSectionSha256
    ) {
      addBlocker("CALIBRATION_SECTION_HASH_MISMATCH", "calibration", "Calibration section hash is stale", {
        expected: expectedSectionSha256,
        actual: value.sourceSection.sha256
      });
    }
  }

  const workflowFields = ["registrySchema", "markerGrammar", "validator"];
  const loadedWorkflowArtifacts = new Map();
  if (exactKeys(value.workflowArtifacts, workflowFields, "calibration", "calibration.workflowArtifacts")) {
    for (const field of workflowFields) {
      const loaded = loadBoundArtifact(
        value.workflowArtifacts[field],
        "calibration",
        `calibration.workflowArtifacts.${field}`
      );
      if (loaded !== null) {
        loadedWorkflowArtifacts.set(field, loaded);
        calibrationBoundArtifacts.push(loaded);
      }
    }
    validateSelfContainedPlatformBuiltinModule(
      loadedWorkflowArtifacts.get("validator"),
      "calibration",
      "calibration.workflowArtifacts.validator"
    );
  }
  const peopleFields = ["productionImplementer", "humanReviewer", "humanDecisionOwner"];
  if (exactKeys(value.people, peopleFields, "calibration", "calibration.people")) {
    for (const field of peopleFields) {
      if (!nullableNameIsValid(value.people[field])) {
        addBlocker("CALIBRATION_PERSON_INVALID", "calibration", `people.${field} must be null or nonempty`);
      }
    }
  }
  const clockFields = ["source", "unit", "continuousProcessIdentity"];
  if (exactKeys(value.monotonicClock, clockFields, "calibration", "calibration.monotonicClock")) {
    for (const field of clockFields) {
      if (!nullableNameIsValid(value.monotonicClock[field])) {
        addBlocker("CALIBRATION_CLOCK_INVALID", "calibration", `monotonicClock.${field} must be null or nonempty`);
      }
    }
  }

  const phaseNames = calibrationPhaseNames;
  const seenPhaseNames = new Set();
  if (!Array.isArray(value.phases)) {
    addBlocker("CALIBRATION_PHASES_INVALID", "calibration", "calibration.phases must be an array");
  } else {
    value.phases.forEach((phase, index) => {
      if (!exactKeys(phase, ["name", "start", "end", "elapsedSeconds"], "calibration", `calibration.phases[${index}]`)) return;
      if (!phaseNames.includes(phase.name) || seenPhaseNames.has(phase.name)) {
        addBlocker("CALIBRATION_PHASE_NAME", "calibration", `Calibration phase name is invalid or duplicated: ${phase.name}`);
      }
      seenPhaseNames.add(phase.name);
      if (
        !isFiniteNumber(phase.start) ||
        !isFiniteNumber(phase.end) ||
        !isFiniteNumber(phase.elapsedSeconds) ||
        phase.end < phase.start ||
        phase.elapsedSeconds < 0
      ) {
        addBlocker("CALIBRATION_PHASE_TIMING", "calibration", `Calibration phase ${phase.name ?? index} has invalid monotonic timing`);
      }
    });
  }

  const calibrationSourceUnitAnchors = new Set();
  const calibrationInitialProvisionalIds = new Set();
  let calibrationInitiallySplitSourceUnits = 0;
  if (!Array.isArray(value.sourceUnitLedger)) {
    addBlocker("CALIBRATION_SOURCE_UNIT_LEDGER", "calibration", "calibration.sourceUnitLedger must be an array");
  } else {
    value.sourceUnitLedger.forEach((unit, index) => {
      const location = `calibration.sourceUnitLedger[${index}]`;
      if (!exactKeys(unit, ["sourceAnchor", "initialProvisionalRecordIds"], "calibration", location)) return;
      if (!isNonemptyString(unit.sourceAnchor) || calibrationSourceUnitAnchors.has(unit.sourceAnchor)) {
        addBlocker("CALIBRATION_SOURCE_UNIT_ANCHOR", "calibration", `${location}.sourceAnchor must be nonempty and unique`);
      } else {
        calibrationSourceUnitAnchors.add(unit.sourceAnchor);
      }
      if (
        !Array.isArray(unit.initialProvisionalRecordIds) ||
        !unique(unit.initialProvisionalRecordIds)
      ) {
        addBlocker("CALIBRATION_SOURCE_UNIT_IDS", "calibration", `${location}.initialProvisionalRecordIds must be a unique array`);
        return;
      }
      if (unit.initialProvisionalRecordIds.length > 1) calibrationInitiallySplitSourceUnits += 1;
      for (const id of unit.initialProvisionalRecordIds) {
        if (!/^CAL-[A-Z][A-Z0-9-]*-[0-9]{3}$/.test(id ?? "")) {
          addBlocker("CALIBRATION_SOURCE_UNIT_ID", "calibration", `${location} contains an invalid provisional CAL ID`);
        } else if (calibrationInitialProvisionalIds.has(id)) {
          addBlocker("CALIBRATION_SOURCE_UNIT_ID_DUPLICATE", "calibration", `Initial provisional ID appears in more than one source unit: ${id}`);
        } else {
          calibrationInitialProvisionalIds.add(id);
        }
      }
    });
  }

  const countFields = [
    "initialProvisionalRecords",
    "acceptedRecords",
    "sourceUnitsInitiallySplit",
    "reviewRequestedSplits",
    "netRecordsAddedByReviewSplits",
    "reviewMergeGroups",
    "netRecordsRemovedByMerges",
    "netRecordsRemovedByRejectionOrReclassification",
    "acceptedRecordsReworked"
  ];
  if (exactKeys(value.counts, countFields, "calibration", "calibration.counts")) {
    for (const field of countFields) {
      if (!nullableCountIsValid(value.counts[field])) {
        addBlocker("CALIBRATION_COUNT_INVALID", "calibration", `counts.${field} must be null or a nonnegative integer`);
      }
    }
  }
  const agentMinuteFields = calibrationAgentMinuteFields;
  if (exactKeys(value.agentWallMinutes, agentMinuteFields, "calibration", "calibration.agentWallMinutes")) {
    for (const field of agentMinuteFields) {
      requireNullableNonnegative(value.agentWallMinutes[field], "calibration", `agentWallMinutes.${field}`);
    }
  }
  const humanMinuteFields = calibrationHumanMinuteFields;
  if (exactKeys(value.activeHumanMinutes, humanMinuteFields, "calibration", "calibration.activeHumanMinutes")) {
    for (const field of humanMinuteFields) {
      requireNullableNonnegative(value.activeHumanMinutes[field], "calibration", `activeHumanMinutes.${field}`);
    }
  }
  if (exactKeys(value.zeroMinuteReasons, humanMinuteFields, "calibration", "calibration.zeroMinuteReasons")) {
    for (const field of humanMinuteFields) {
      if (!nullableNameIsValid(value.zeroMinuteReasons[field])) {
        addBlocker("CALIBRATION_ZERO_REASON_INVALID", "calibration", `zeroMinuteReasons.${field} must be null or nonempty`);
      }
    }
  }
  let toolingEstimateArtifact = null;
  if (
    exactKeys(
      value.toolingEstimate,
      ["minutes", "responsibleRole", "basis", "evidence"],
      "calibration",
      "calibration.toolingEstimate"
    )
  ) {
    requireNullableNonnegative(value.toolingEstimate.minutes, "calibration", "toolingEstimate.minutes");
    if (
      value.toolingEstimate.responsibleRole !== null &&
      !requiredRoleNames.includes(value.toolingEstimate.responsibleRole)
    ) {
      addBlocker("CALIBRATION_TOOLING_ROLE_INVALID", "calibration", "toolingEstimate.responsibleRole must name a production role key");
    }
    if (!nullableNameIsValid(value.toolingEstimate.basis)) {
      addBlocker("CALIBRATION_TOOLING_BASIS_INVALID", "calibration", "toolingEstimate.basis must be null or nonempty");
    }
    toolingEstimateArtifact = loadBoundArtifact(
      value.toolingEstimate.evidence,
      "calibration-tooling-estimate",
      "calibration.toolingEstimate.evidence"
    );
    if (toolingEstimateArtifact !== null) {
      calibrationBoundArtifacts.push(toolingEstimateArtifact);
      try {
        const estimateEvidence = JSON.parse(toolingEstimateArtifact.bytes.toString("utf8"));
        const evidenceFields = [
          "formatVersion",
          "classification",
          "responsibleRole",
          "estimatedHumanMinutes",
          "basis",
          "includedHumanWork",
          "excludedWork",
          "preparedBy",
          "humanReviewer",
          "humanDecisionOwner",
          "approvedAt"
        ];
        if (exactKeys(estimateEvidence, evidenceFields, "calibration-tooling-estimate", "toolingEstimateEvidence")) {
          if (estimateEvidence.formatVersion !== 1 || estimateEvidence.classification !== "human-attention-estimate") {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_CLASS", "calibration-tooling-estimate", "Tooling evidence must be format 1 and explicitly classified as a human-attention estimate");
          }
          if (estimateEvidence.responsibleRole !== value.toolingEstimate.responsibleRole) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_ROLE", "calibration-tooling-estimate", "Tooling evidence role differs from the calibration record");
          }
          if (!approximatelyEqual(estimateEvidence.estimatedHumanMinutes, value.toolingEstimate.minutes)) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_MINUTES", "calibration-tooling-estimate", "Tooling evidence human minutes differ from the calibration record");
          }
          if (estimateEvidence.basis !== value.toolingEstimate.basis) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_BASIS", "calibration-tooling-estimate", "Tooling evidence basis differs from the calibration record");
          }
          if (
            !Array.isArray(estimateEvidence.includedHumanWork) ||
            estimateEvidence.includedHumanWork.length === 0 ||
            !unique(estimateEvidence.includedHumanWork) ||
            !estimateEvidence.includedHumanWork.every(isNonemptyString)
          ) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_WORK", "calibration-tooling-estimate", "Tooling evidence must itemize unique included human work");
          } else if (
            estimateEvidence.includedHumanWork.some((item) =>
              /\bagent(?:[- ]runtime)?\b|\bunattended\b|\bmachine[- ]runtime\b/i.test(item)
            )
          ) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_NONHUMAN_WORK", "calibration-tooling-estimate", "Included tooling work cannot be agent runtime or unattended machine runtime");
          }
          if (
            !Array.isArray(estimateEvidence.excludedWork) ||
            !unique(estimateEvidence.excludedWork) ||
            !estimateEvidence.excludedWork.every(isNonemptyString) ||
            !estimateEvidence.excludedWork.includes("agent-runtime") ||
            !estimateEvidence.excludedWork.includes("unattended-machine-runtime")
          ) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_EXCLUSIONS", "calibration-tooling-estimate", "Tooling evidence must explicitly exclude agent runtime and unattended machine runtime");
          }
          const responsiblePerson = roles?.[value.toolingEstimate.responsibleRole]?.name;
          if (estimateEvidence.preparedBy !== responsiblePerson) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_PREPARER", "calibration-tooling-estimate", "Tooling evidence preparer does not match its named responsible human role");
          }
          if (estimateEvidence.humanReviewer !== roles?.humanReviewer?.name) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_REVIEWER", "calibration-tooling-estimate", "Tooling evidence reviewer does not match the named human reviewer");
          }
          if (estimateEvidence.humanDecisionOwner !== roles?.humanDecisionOwner?.name) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_OWNER", "calibration-tooling-estimate", "Tooling evidence decision owner does not match the named human decision owner");
          }
          if (!isStrictIsoTimestamp(estimateEvidence.approvedAt)) {
            addBlocker("CALIBRATION_TOOLING_EVIDENCE_TIME", "calibration-tooling-estimate", "Tooling evidence approvedAt must be a strict timestamp");
          }
        }
      } catch (error) {
        addBlocker("CALIBRATION_TOOLING_EVIDENCE_JSON", "calibration-tooling-estimate", "Tooling estimate evidence must be the structured JSON evidence record", {
          error: String(error?.message ?? error).slice(0, 500)
        });
      }
    }
  }
  const acceptedArtifactFields = ["annotatedSection", "scratchRegistry", "timerLog"];
  const loadedAcceptedArtifacts = new Map();
  if (exactKeys(value.acceptedArtifacts, acceptedArtifactFields, "calibration", "calibration.acceptedArtifacts")) {
    for (const field of acceptedArtifactFields) {
      const loaded = loadBoundArtifact(
        value.acceptedArtifacts[field],
        "calibration",
        `calibration.acceptedArtifacts.${field}`
      );
      if (loaded !== null) {
        loadedAcceptedArtifacts.set(field, loaded);
        calibrationBoundArtifacts.push(loaded);
      }
    }
  }
  if (
    exactKeys(
      value.derived,
      ["humanMinutesPerAcceptedRecord", "reviewedInitialSliceRecordCount", "contingencyFactor", "initialSliceHumanAllowanceMinutes"],
      "calibration",
      "calibration.derived"
    )
  ) {
    requireNullableNonnegative(value.derived.humanMinutesPerAcceptedRecord, "calibration", "derived.humanMinutesPerAcceptedRecord");
    if (!nullableCountIsValid(value.derived.reviewedInitialSliceRecordCount)) {
      addBlocker("CALIBRATION_DERIVED_COUNT", "calibration", "derived.reviewedInitialSliceRecordCount must be null or a nonnegative integer");
    }
    if (!isFiniteNumber(value.derived.contingencyFactor) || value.derived.contingencyFactor < 1.5) {
      addBlocker("CALIBRATION_CONTINGENCY", "calibration", "derived.contingencyFactor must be at least 1.5");
    }
    requireNullableNonnegative(value.derived.initialSliceHumanAllowanceMinutes, "calibration", "derived.initialSliceHumanAllowanceMinutes");
  }
  if (exactKeys(value.approvals, ["productionImplementer", "humanReviewer", "humanDecisionOwner", "approvedAt"], "calibration", "calibration.approvals")) {
    if (
      !nullableNameIsValid(value.approvals.productionImplementer) ||
      !nullableNameIsValid(value.approvals.humanReviewer) ||
      !nullableNameIsValid(value.approvals.humanDecisionOwner)
    ) {
      addBlocker("CALIBRATION_APPROVER_INVALID", "calibration", "Calibration approver names must be null or nonempty");
    }
    if (value.approvals.approvedAt !== null && !isStrictIsoTimestamp(value.approvals.approvedAt)) {
      addBlocker("CALIBRATION_APPROVAL_TIME", "calibration", "Calibration approvedAt must be a strict ISO-8601 timestamp with a timezone");
    }
  }
  if (!Array.isArray(value.blockingReasons) || !value.blockingReasons.every(isNonemptyString)) {
    addBlocker("CALIBRATION_BLOCKERS_INVALID", "calibration", "Calibration blockingReasons must be an array of nonempty strings");
  }

  if (value.status === "approved") {
    if (!isNonemptyString(value.runId)) {
      addBlocker("CALIBRATION_APPROVED_RUN_ID", "calibration", "Approved calibration requires a production runId");
    }
    if (value.rolesSha256 !== rolesArtifact?.sha256) {
      addBlocker("CALIBRATION_ROLES_HASH_MISMATCH", "calibration", "Approved calibration must bind the exact current role-assignment bytes", {
        expected: rolesArtifact?.sha256 ?? null,
        actual: value.rolesSha256
      });
    }
    for (const field of workflowFields) {
      if (!loadedWorkflowArtifacts.has(field)) {
        addBlocker("CALIBRATION_APPROVED_WORKFLOW_ARTIFACT", "calibration", `Approved calibration requires a valid workflowArtifacts.${field} binding`);
      }
    }
    for (const field of peopleFields) {
      if (!isNonemptyString(value.people?.[field])) {
        addBlocker("CALIBRATION_APPROVED_PERSON", "calibration", `Approved calibration requires people.${field}`);
      } else if (value.people[field] !== roles?.[field]?.name) {
        addBlocker("CALIBRATION_ROLE_MISMATCH", "calibration", `Calibration people.${field} does not match the approved role assignment`);
      }
    }
    for (const field of clockFields) {
      if (!isNonemptyString(value.monotonicClock?.[field])) {
        addBlocker("CALIBRATION_APPROVED_CLOCK", "calibration", `Approved calibration requires monotonicClock.${field}`);
      }
    }
    if (value.monotonicClock?.unit !== "seconds") {
      addBlocker("CALIBRATION_CLOCK_UNIT", "calibration", "Approved calibration monotonicClock.unit must equal seconds");
    }
    if (
      !Array.isArray(value.phases) ||
      value.phases.length !== phaseNames.length ||
      value.phases.some((phase, index) => phase?.name !== phaseNames[index])
    ) {
      addBlocker("CALIBRATION_APPROVED_PHASES", "calibration", "Approved calibration requires each timed phase exactly once in procedure order");
    } else {
      value.phases.forEach((phase, index) => {
        const expectedElapsed = phase.end - phase.start;
        if (!approximatelyEqual(phase.elapsedSeconds, expectedElapsed)) {
          addBlocker("CALIBRATION_PHASE_ELAPSED_MISMATCH", "calibration", `Phase ${phase.name} elapsedSeconds does not equal end minus start`, {
            expected: expectedElapsed,
            actual: phase.elapsedSeconds
          });
        }
        if (index > 0 && phase.start < value.phases[index - 1].end) {
          addBlocker("CALIBRATION_PHASE_OVERLAP", "calibration", `Phase ${phase.name} overlaps the preceding phase`);
        }
      });
    }
    if (!Number.isInteger(value.counts?.acceptedRecords) || value.counts.acceptedRecords < 1) {
      addBlocker("CALIBRATION_APPROVED_ACCEPTED_COUNT", "calibration", "Approved calibration requires a positive accepted-record count");
    }
    for (const field of countFields) {
      if (!Number.isInteger(value.counts?.[field]) || value.counts[field] < 0) {
        addBlocker("CALIBRATION_APPROVED_COUNT", "calibration", `Approved calibration requires counts.${field}`);
      }
    }
    if (value.sourceUnitLedger?.length < 1) {
      addBlocker("CALIBRATION_APPROVED_SOURCE_UNIT_LEDGER", "calibration", "Approved calibration requires a nonempty checked source-unit ledger");
    }
    if (value.counts?.initialProvisionalRecords !== calibrationInitialProvisionalIds.size) {
      addBlocker("CALIBRATION_INITIAL_RECORD_LEDGER_MISMATCH", "calibration", "Initial provisional-record count does not equal the unique CAL IDs in sourceUnitLedger", {
        expected: calibrationInitialProvisionalIds.size,
        actual: value.counts?.initialProvisionalRecords ?? null
      });
    }
    if (value.counts?.sourceUnitsInitiallySplit !== calibrationInitiallySplitSourceUnits) {
      addBlocker("CALIBRATION_SPLIT_UNIT_LEDGER_MISMATCH", "calibration", "sourceUnitsInitiallySplit does not equal source-unit ledger entries that produced multiple initial records", {
        expected: calibrationInitiallySplitSourceUnits,
        actual: value.counts?.sourceUnitsInitiallySplit ?? null
      });
    }
    for (const field of agentMinuteFields) {
      if (!isFiniteNumber(value.agentWallMinutes?.[field]) || value.agentWallMinutes[field] < 0) {
        addBlocker("CALIBRATION_APPROVED_AGENT_MINUTES", "calibration", `Approved calibration requires agentWallMinutes.${field}`);
      }
    }
    for (const field of humanMinuteFields) {
      const minutes = value.activeHumanMinutes?.[field];
      if (!isFiniteNumber(minutes) || minutes < 0) {
        addBlocker("CALIBRATION_APPROVED_HUMAN_MINUTES", "calibration", `Approved calibration requires activeHumanMinutes.${field}`);
      } else if (minutes === 0 && !isNonemptyString(value.zeroMinuteReasons?.[field])) {
        addBlocker("CALIBRATION_ZERO_MINUTES_UNEXPLAINED", "calibration", `Zero activeHumanMinutes.${field} requires a written reason`);
      }
    }
    if (!(value.activeHumanMinutes?.implementer > 0)) {
      addBlocker(
        "CALIBRATION_IMPLEMENTER_TIME_REQUIRED",
        "calibration",
        "Approved production calibration requires positive active implementer time"
      );
    }
    if (!(value.activeHumanMinutes?.reviewer > 0)) {
      addBlocker(
        "CALIBRATION_REVIEWER_TIME_REQUIRED",
        "calibration",
        "Approved production calibration requires positive active reviewer time"
      );
    }
    if (
      !(
        value.activeHumanMinutes?.decisionOwnerPerRecordWork +
          value.activeHumanMinutes?.decisionOwnerFixedBatchWork >
        0
      )
    ) {
      addBlocker(
        "CALIBRATION_DECISION_OWNER_TIME_REQUIRED",
        "calibration",
        "Approved production calibration requires positive combined decision-owner time"
      );
    }
    if (!isFiniteNumber(value.toolingEstimate?.minutes) || value.toolingEstimate.minutes < 0) {
      addBlocker(
        "CALIBRATION_TOOLING_ESTIMATE_REQUIRED",
        "calibration",
        "Approved production calibration requires an explicit nonnegative tooling estimate"
      );
    }
    if (!requiredRoleNames.includes(value.toolingEstimate?.responsibleRole)) {
      addBlocker(
        "CALIBRATION_TOOLING_ROLE_REQUIRED",
        "calibration",
        "Approved production calibration requires a responsible role for tooling effort"
      );
    }
    if (!isNonemptyString(value.toolingEstimate?.basis)) {
      addBlocker(
        "CALIBRATION_TOOLING_BASIS_REQUIRED",
        "calibration",
        "Approved production calibration requires the tooling estimate basis"
      );
    }
    if (toolingEstimateArtifact === null) {
      addBlocker(
        "CALIBRATION_TOOLING_EVIDENCE_REQUIRED",
        "calibration",
        "Approved production calibration requires exact bound evidence for the tooling estimate"
      );
    }
    for (const field of acceptedArtifactFields) {
      if (!loadedAcceptedArtifacts.has(field)) {
        addBlocker("CALIBRATION_APPROVED_ACCEPTED_ARTIFACT", "calibration", `Approved calibration requires a valid acceptedArtifacts.${field} binding`);
      }
    }
    if (
      Number.isInteger(value.counts?.acceptedRecordsReworked) &&
      Number.isInteger(value.counts?.acceptedRecords) &&
      value.counts.acceptedRecordsReworked > value.counts.acceptedRecords
    ) {
      addBlocker("CALIBRATION_REWORK_COUNT", "calibration", "acceptedRecordsReworked cannot exceed acceptedRecords");
    }
    if (
      Number.isInteger(value.counts?.netRecordsRemovedByMerges) &&
      Number.isInteger(value.counts?.reviewMergeGroups) &&
      value.counts.netRecordsRemovedByMerges < value.counts.reviewMergeGroups
    ) {
      addBlocker("CALIBRATION_MERGE_COUNT", "calibration", "netRecordsRemovedByMerges cannot be less than reviewMergeGroups");
    }
    if (
      Number.isInteger(value.counts?.netRecordsAddedByReviewSplits) &&
      Number.isInteger(value.counts?.reviewRequestedSplits) &&
      value.counts.netRecordsAddedByReviewSplits < value.counts.reviewRequestedSplits
    ) {
      addBlocker("CALIBRATION_SPLIT_COUNT", "calibration", "netRecordsAddedByReviewSplits cannot be less than reviewRequestedSplits");
    }
    if (
      [
        value.counts?.initialProvisionalRecords,
        value.counts?.netRecordsAddedByReviewSplits,
        value.counts?.netRecordsRemovedByMerges,
        value.counts?.netRecordsRemovedByRejectionOrReclassification,
        value.counts?.acceptedRecords
      ].every(Number.isInteger)
    ) {
      const expectedAccepted =
        value.counts.initialProvisionalRecords +
        value.counts.netRecordsAddedByReviewSplits -
        value.counts.netRecordsRemovedByMerges -
        value.counts.netRecordsRemovedByRejectionOrReclassification;
      if (value.counts.acceptedRecords !== expectedAccepted) {
        addBlocker("CALIBRATION_ACCEPTED_COUNT_MISMATCH", "calibration", "Accepted-record count does not reconcile with split, merge, and rejection counts", {
          expected: expectedAccepted,
          actual: value.counts.acceptedRecords
        });
      }
    }
    const acceptedRecords = value.counts?.acceptedRecords;
    const perRecordHumanMinutes =
      value.activeHumanMinutes?.implementer +
      value.activeHumanMinutes?.reviewer +
      value.activeHumanMinutes?.decisionOwnerPerRecordWork;
    if (Number.isInteger(acceptedRecords) && acceptedRecords > 0 && Number.isFinite(perRecordHumanMinutes)) {
      const expectedRate = perRecordHumanMinutes / acceptedRecords;
      if (!approximatelyEqual(value.derived?.humanMinutesPerAcceptedRecord, expectedRate)) {
        addBlocker("CALIBRATION_RATE_MISMATCH", "calibration", "Derived human rate does not match measured active human minutes", {
          expected: expectedRate,
          actual: value.derived?.humanMinutesPerAcceptedRecord
        });
      }
    }
    if (inventory === null) {
      addBlocker("CALIBRATION_INVENTORY_UNAVAILABLE", "calibration", "Approved calibration requires a valid reviewed inventory count");
    } else if (value.derived?.reviewedInitialSliceRecordCount !== inventory.anticipatedInitialRecords) {
      addBlocker("CALIBRATION_INVENTORY_COUNT_MISMATCH", "calibration", "Calibration initial-slice count does not match the validated inventory", {
        expected: inventory.anticipatedInitialRecords,
        actual: value.derived?.reviewedInitialSliceRecordCount
      });
    }
    const expectedAllowance =
      value.derived?.humanMinutesPerAcceptedRecord *
        value.derived?.reviewedInitialSliceRecordCount *
        value.derived?.contingencyFactor +
      value.activeHumanMinutes?.decisionOwnerFixedBatchWork +
      value.toolingEstimate?.minutes;
    if (!Number.isFinite(expectedAllowance) || !approximatelyEqual(value.derived?.initialSliceHumanAllowanceMinutes, expectedAllowance)) {
      addBlocker("CALIBRATION_ALLOWANCE_MISMATCH", "calibration", "Derived human allowance does not match the calibration formula", {
        expected: Number.isFinite(expectedAllowance) ? expectedAllowance : null,
        actual: value.derived?.initialSliceHumanAllowanceMinutes
      });
    }
    validateCalibrationTimerLog(value, loadedAcceptedArtifacts.get("timerLog"));
    const frozenValidator = loadedWorkflowArtifacts.get("validator");
    if (frozenValidator !== undefined) {
      const validationRun = spawnSync(process.execPath, permissionedNodeArguments(
        frozenValidator.path,
        [
          paths.plan,
          rolesArtifact?.path,
          artifact.path,
          ...calibrationBoundArtifacts.map((boundArtifact) => boundArtifact.path)
        ].filter(isNonemptyString)
      ), {
        cwd: dirname(frozenValidator.path),
        encoding: "utf8"
      });
      if (validationRun.error || validationRun.status !== 0) {
        addBlocker("CALIBRATION_FROZEN_VALIDATOR_FAILED", "calibration", "The frozen calibration validator did not accept the bound artifacts", {
          exitCode: validationRun.status,
          error: String(validationRun.error?.message ?? validationRun.stderr ?? "validation failed").slice(0, 500)
        });
      } else {
        try {
          const receipt = JSON.parse(validationRun.stdout);
          const expectedReceipt = {
            formatVersion: 1,
            status: "valid",
            planSha256,
            sectionSha256: value.sourceSection?.sha256,
            schemaSha256: loadedWorkflowArtifacts.get("registrySchema")?.sha256,
            markerGrammarSha256: loadedWorkflowArtifacts.get("markerGrammar")?.sha256,
            validatorSha256: frozenValidator.sha256,
            registrySha256: loadedAcceptedArtifacts.get("scratchRegistry")?.sha256,
            annotatedSectionSha256: loadedAcceptedArtifacts.get("annotatedSection")?.sha256
          };
          for (const [field, expected] of Object.entries(expectedReceipt)) {
            if (receipt?.[field] !== expected) {
              addBlocker("CALIBRATION_VALIDATION_RECEIPT_MISMATCH", "calibration", `Frozen validator receipt field ${field} does not match the bound artifacts`, {
                expected: expected ?? null,
                actual: receipt?.[field] ?? null
              });
            }
          }
          if (receipt?.records !== value.counts?.acceptedRecords) {
            addBlocker("CALIBRATION_VALIDATION_RECORD_COUNT", "calibration", "Frozen validator receipt record count does not match counts.acceptedRecords", {
              expected: value.counts?.acceptedRecords ?? null,
              actual: receipt?.records ?? null
            });
          }
          if (receipt?.sourceUnitCount !== value.sourceUnitLedger?.length) {
            addBlocker("CALIBRATION_VALIDATION_SOURCE_UNIT_COUNT", "calibration", "Frozen validator receipt source-unit count does not match sourceUnitLedger", {
              expected: value.sourceUnitLedger?.length ?? null,
              actual: receipt?.sourceUnitCount ?? null
            });
          }
          if (receipt?.sourceUnitsInitiallySplit !== value.counts?.sourceUnitsInitiallySplit) {
            addBlocker("CALIBRATION_VALIDATION_SPLIT_UNIT_COUNT", "calibration", "Frozen validator receipt split-unit count does not match the calibration record", {
              expected: value.counts?.sourceUnitsInitiallySplit ?? null,
              actual: receipt?.sourceUnitsInitiallySplit ?? null
            });
          }
          if (!Array.isArray(receipt?.errors) || receipt.errors.length !== 0) {
            addBlocker("CALIBRATION_VALIDATION_RECEIPT_ERRORS", "calibration", "A passing frozen-validator receipt must contain an empty errors array");
          }
        } catch (error) {
          addBlocker("CALIBRATION_VALIDATOR_OUTPUT_INVALID", "calibration", "Frozen calibration validator did not emit a JSON receipt", {
            error: String(error?.message ?? error)
          });
        }
      }
    }
    if (value.approvals?.productionImplementer !== value.people?.productionImplementer) {
      addBlocker("CALIBRATION_IMPLEMENTER_APPROVAL_MISMATCH", "calibration", "Calibration implementer attestation does not match the participating implementer");
    }
    if (value.approvals?.humanReviewer !== value.people?.humanReviewer) {
      addBlocker("CALIBRATION_REVIEW_APPROVAL_MISMATCH", "calibration", "Calibration reviewer approval does not match the participating reviewer");
    }
    if (value.approvals?.humanDecisionOwner !== value.people?.humanDecisionOwner) {
      addBlocker("CALIBRATION_OWNER_APPROVAL_MISMATCH", "calibration", "Calibration decision-owner approval does not match the participating decision owner");
    }
    if (!isStrictIsoTimestamp(value.approvals?.approvedAt)) {
      addBlocker("CALIBRATION_APPROVED_AT_MISSING", "calibration", "Approved calibration requires a strict approvedAt timestamp");
    }
    if (Array.isArray(value.blockingReasons) && value.blockingReasons.length > 0) {
      addBlocker("CALIBRATION_APPROVED_WITH_BLOCKERS", "calibration", "Approved calibration still lists blocking reasons");
    }
  }
  return value;
};

let inventoryReviewArtifact = null;
let inventoryReview = null;
const validateInventoryReview = (artifact) => {
  if (artifact === null || artifact.value === null) return null;
  const value = artifact.value;
  if (
    !exactKeys(
      value,
      ["formatVersion", "status", "sourcePlanSha256", "inventoryFiles", "counts", "agentReviews", "approvals", "blockingReasons"],
      "inventory-review",
      "inventoryReview"
    )
  ) return value;
  if (value.formatVersion !== 1) {
    addBlocker("FORMAT_VERSION", "inventory-review", "inventoryReview.formatVersion must equal 1");
  }
  const statuses = new Set(["agent-review-in-progress", "agent-reviewed-awaiting-human", "human-approved"]);
  if (!statuses.has(value.status)) {
    addBlocker("STATUS_INVALID", "inventory-review", "Inventory review status is not recognized");
  }
  if (value.sourcePlanSha256 !== planSha256) {
    addBlocker("INVENTORY_REVIEW_PLAN_HASH", "inventory-review", "Inventory review does not bind the current plan bytes");
  }
  const expectedFiles = inventory?.inventoryFiles ?? [];
  if (!Array.isArray(value.inventoryFiles) || value.inventoryFiles.length !== expectedFiles.length) {
    addBlocker("INVENTORY_REVIEW_FILES", "inventory-review", "Inventory review must bind every validated inventory file exactly once");
  } else {
    value.inventoryFiles.forEach((file, index) => {
      if (!exactKeys(file, ["path", "sha256"], "inventory-review", `inventoryReview.inventoryFiles[${index}]`)) return;
      const expected = expectedFiles[index];
      const expectedPath = expected?.path?.replace(/^pre-m0\//, "");
      if (file.path !== expectedPath || file.sha256 !== expected?.sha256) {
        addBlocker("INVENTORY_REVIEW_FILE_MISMATCH", "inventory-review", "Inventory review file binding differs from the validated inventory", {
          index,
          expected: expected ? { path: expectedPath, sha256: expected.sha256 } : null,
          actual: file
        });
      }
    });
  }
  const countFields = ["totalBlocks", "anticipatedInitialRecords", "m0FrontierRecords", "m1FrontierRecords", "m2FrontierRecords", "m3aFrontierRecords"];
  if (exactKeys(value.counts, countFields, "inventory-review", "inventoryReview.counts")) {
    const expectedCounts = {
      totalBlocks: inventory?.totalBlocks,
      anticipatedInitialRecords: inventory?.anticipatedInitialRecords,
      m0FrontierRecords: inventory?.initialRecordFrontierMemberships?.M0 ?? 0,
      m1FrontierRecords: inventory?.initialRecordFrontierMemberships?.M1 ?? 0,
      m2FrontierRecords: inventory?.initialRecordFrontierMemberships?.M2 ?? 0,
      m3aFrontierRecords: inventory?.initialRecordFrontierMemberships?.M3a ?? 0
    };
    for (const field of countFields) {
      if (!Number.isInteger(value.counts[field]) || value.counts[field] < 0 || value.counts[field] !== expectedCounts[field]) {
        addBlocker("INVENTORY_REVIEW_COUNT_MISMATCH", "inventory-review", `inventoryReview.counts.${field} differs from the validator result`, {
          expected: expectedCounts[field] ?? null,
          actual: value.counts[field]
        });
      }
    }
  }
  if (!Array.isArray(value.agentReviews)) {
    addBlocker("INVENTORY_AGENT_REVIEWS", "inventory-review", "inventoryReview.agentReviews must be an array");
  } else {
    value.agentReviews.forEach((review, index) => {
      if (!exactKeys(review, ["reviewer", "scope", "status"], "inventory-review", `inventoryReview.agentReviews[${index}]`)) return;
      if (![review.reviewer, review.scope, review.status].every(isNonemptyString)) {
        addBlocker("INVENTORY_AGENT_REVIEW_FIELD", "inventory-review", `inventoryReview.agentReviews[${index}] contains an empty field`);
      }
    });
  }
  if (exactKeys(value.approvals, ["humanReviewer", "humanDecisionOwner", "approvedAt"], "inventory-review", "inventoryReview.approvals")) {
    for (const field of ["humanReviewer", "humanDecisionOwner"]) {
      if (!nullableNameIsValid(value.approvals[field])) {
        addBlocker("INVENTORY_REVIEW_APPROVER", "inventory-review", `inventoryReview.approvals.${field} must be null or nonempty`);
      }
    }
    if (value.approvals.approvedAt !== null && !isStrictIsoTimestamp(value.approvals.approvedAt)) {
      addBlocker("INVENTORY_REVIEW_APPROVED_AT", "inventory-review", "Inventory review approvedAt must be a strict ISO timestamp");
    }
  }
  if (!Array.isArray(value.blockingReasons) || !value.blockingReasons.every(isNonemptyString)) {
    addBlocker("INVENTORY_REVIEW_BLOCKERS", "inventory-review", "Inventory review blockingReasons must contain nonempty strings");
  }
  if (value.status === "human-approved") {
    if (value.approvals?.humanReviewer !== roles?.humanReviewer?.name) {
      addBlocker("INVENTORY_REVIEWER_ROLE_MISMATCH", "inventory-review", "Inventory review approval does not match the named human reviewer");
    }
    if (value.approvals?.humanDecisionOwner !== roles?.humanDecisionOwner?.name) {
      addBlocker("INVENTORY_OWNER_ROLE_MISMATCH", "inventory-review", "Inventory review approval does not match the named human decision owner");
    }
    if (!isStrictIsoTimestamp(value.approvals?.approvedAt)) {
      addBlocker("INVENTORY_REVIEW_APPROVAL_MISSING", "inventory-review", "Human-approved inventory review requires approvedAt");
    }
    if (value.agentReviews?.some((review) => !review.status.startsWith("complete"))) {
      addBlocker("INVENTORY_REVIEW_AGENT_PENDING", "inventory-review", "Human approval requires all recorded independent agent reviews to be complete");
    }
    if (value.blockingReasons?.length > 0) {
      addBlocker("INVENTORY_REVIEW_APPROVED_WITH_BLOCKERS", "inventory-review", "Human-approved inventory review still lists blocking reasons");
    }
  }
  return value;
};

if (capacityArtifact !== null && capacityArtifact.value !== null) {
  const value = capacityArtifact.value;
  if (
    exactKeys(
      value,
      [
        "formatVersion",
        "status",
        "sourceCalibration",
        "inventoryBasis",
        "agentThroughput",
        "humanAttention",
        "m0Envelope",
        "m2Envelope",
        "tripwirePolicy",
        "eventLog",
        "approval",
        "predecessorCapacitySha256",
        "history",
        "blockingReasons"
      ],
      "capacity",
      "capacity"
    )
  ) {
    capacity = value;
    if (value.formatVersion !== 1) {
      addBlocker("FORMAT_VERSION", "capacity", "capacity.formatVersion must equal 1");
    }
    if (
      value.status !== "blocked-pending-human-calibration-and-capacity" &&
      value.status !== "blocked-pending-human-calibration-and-inventory" &&
      value.status !== "approved-and-started-m0"
    ) {
      addBlocker("STATUS_INVALID", "capacity", "capacity.status is not recognized");
    }
    if (
      exactKeys(
        value.sourceCalibration,
        ["path", "sha256", "requiredStatus"],
        "capacity",
        "capacity.sourceCalibration"
      )
    ) {
      const source = value.sourceCalibration;
      if (!isNonemptyString(source.path) || !source.path.endsWith(".json")) {
        addBlocker("CALIBRATION_SOURCE_INVALID", "capacity", "Calibration path must name a JSON file under pre-m0");
      } else if (
        isAbsolute(source.path) ||
        source.path.includes("\\") ||
        source.path !== relative(directory, resolve(directory, source.path)).replaceAll("\\", "/")
      ) {
        addBlocker("CALIBRATION_SOURCE_NONCANONICAL", "capacity", "Calibration path must be a canonical pre-m0-relative POSIX path");
      } else {
        const calibrationPath = resolve(directory, source.path);
        try {
          const resolvedDirectory = realpathSync(directory);
          const resolvedCalibration = realpathSync(calibrationPath);
          if (!pathIsInside(resolvedDirectory, resolvedCalibration)) {
            addBlocker("CALIBRATION_SOURCE_OUTSIDE_PRE_M0", "capacity", "Calibration path must remain under pre-m0", {
              path: source.path
            });
          } else if (resolvedCalibration !== calibrationPath || lstatSync(calibrationPath).isSymbolicLink()) {
            addBlocker("CALIBRATION_SOURCE_SYMLINK", "capacity", "Calibration path must not use a symlink", {
              path: source.path
            });
          } else if (!statSync(calibrationPath).isFile()) {
            addBlocker("CALIBRATION_SOURCE_NOT_FILE", "capacity", "Capacity source calibration must be a regular file", {
              path: relativePath(calibrationPath)
            });
          } else {
            calibrationArtifact = loadJson("calibration", calibrationPath);
            if (!hashPattern.test(source.sha256 ?? "")) {
              addBlocker("CALIBRATION_SOURCE_HASH_FORMAT", "capacity", "Calibration binding must contain lowercase SHA-256");
            } else if (source.sha256 !== calibrationArtifact?.sha256) {
              addBlocker("CALIBRATION_SOURCE_HASH_MISMATCH", "capacity", "Capacity does not bind the exact current calibration bytes", {
                expected: calibrationArtifact?.sha256 ?? null,
                actual: source.sha256
              });
            }
            calibration = validateCalibration(calibrationArtifact);
          }
        } catch (error) {
          addBlocker("CALIBRATION_SOURCE_UNREADABLE", "capacity", "Capacity source calibration cannot be resolved or read", {
            path: source.path,
            error: String(error?.message ?? error)
          });
        }
      }
      if (source.requiredStatus !== "approved") {
        addBlocker("CALIBRATION_REQUIRED_STATUS", "capacity", "Capacity must require an approved production calibration");
      }
      if (calibration !== null && calibration.status !== source.requiredStatus) {
        addBlocker("CALIBRATION_UNAPPROVED", "calibration", `Production calibration is not approved: ${calibration.status}`);
      }
    }
    const inventoryBasis = value.inventoryBasis;
    if (
      exactKeys(
        inventoryBasis,
        [
          "status",
          "sourcePlanSha256",
          "anticipatedInitialSliceRecords",
          "sourceInventorySha256",
          "reviewAttestation"
        ],
        "capacity",
        "capacity.inventoryBasis"
      )
    ) {
      if (!isNonemptyString(inventoryBasis.status)) {
        addBlocker("INVENTORY_BASIS_STATUS_INVALID", "capacity", "inventoryBasis.status must be nonempty");
      }
      if (!hashPattern.test(inventoryBasis.sourcePlanSha256 ?? "")) {
        addBlocker(
          "INVENTORY_BASIS_PLAN_HASH_FORMAT",
          "capacity",
          "inventoryBasis.sourcePlanSha256 must be lowercase SHA-256"
        );
      } else if (inventoryBasis.sourcePlanSha256 !== planSha256) {
        addBlocker(
          "INVENTORY_BASIS_PLAN_HASH_MISMATCH",
          "capacity",
          "Capacity inventory basis does not match the current plan",
          { expected: planSha256, actual: inventoryBasis.sourcePlanSha256 }
        );
      }
      if (
        !Number.isInteger(inventoryBasis.anticipatedInitialSliceRecords) ||
        inventoryBasis.anticipatedInitialSliceRecords < 1
      ) {
        addBlocker(
          "INVENTORY_BASIS_COUNT_INVALID",
          "capacity",
          "inventoryBasis.anticipatedInitialSliceRecords must be a positive integer"
        );
      } else if (
        inventory !== null &&
        inventoryBasis.anticipatedInitialSliceRecords !== inventory.anticipatedInitialRecords
      ) {
        addBlocker(
          "INVENTORY_BASIS_COUNT_MISMATCH",
          "capacity",
          "Capacity inventory-basis count does not equal the validated inventory count",
          {
            expected: inventory.anticipatedInitialRecords,
            actual: inventoryBasis.anticipatedInitialSliceRecords
          }
        );
      } else if (inventory === null) {
        addBlocker(
          "INVENTORY_BASIS_COUNT_UNVERIFIABLE",
          "capacity",
          "Capacity inventory-basis count is set but the inventory is not valid"
        );
      }
      if (
        !Array.isArray(inventoryBasis.sourceInventorySha256) ||
        inventoryBasis.sourceInventorySha256.length === 0 ||
        !unique(inventoryBasis.sourceInventorySha256) ||
        !inventoryBasis.sourceInventorySha256.every(
          (candidate) => typeof candidate === "string" && hashPattern.test(candidate)
        )
      ) {
        addBlocker(
          "INVENTORY_BASIS_HASHES_INVALID",
          "capacity",
          "inventoryBasis.sourceInventorySha256 must contain unique lowercase SHA-256 values"
        );
      } else if (inventory !== null) {
        const expectedHashes = inventory.inventoryFiles.map((file) => file.sha256);
        if (
          inventoryBasis.sourceInventorySha256.length !== expectedHashes.length ||
          inventoryBasis.sourceInventorySha256.some((hash, index) => hash !== expectedHashes[index])
        ) {
          addBlocker(
            "INVENTORY_BASIS_HASH_MISMATCH",
            "capacity",
            "Capacity inventory basis does not hash the exact validated inventory files in validator order",
            { expected: expectedHashes, actual: inventoryBasis.sourceInventorySha256 }
          );
        }
      }
      if (
        value.status === "approved-and-started-m0" &&
        inventoryBasis.status !== "human-reviewed"
      ) {
        addBlocker(
          "CAPACITY_APPROVED_WITH_PENDING_INVENTORY",
          "capacity",
          "Approved capacity artifact requires inventoryBasis.status to equal human-reviewed"
        );
      }
      if (
        exactKeys(
          inventoryBasis.reviewAttestation,
          ["path", "sha256", "requiredStatus"],
          "capacity",
          "capacity.inventoryBasis.reviewAttestation"
        )
      ) {
        const binding = inventoryBasis.reviewAttestation;
        const loaded = loadBoundArtifact(
          { path: binding.path, sha256: binding.sha256 },
          "inventory-review",
          "capacity.inventoryBasis.reviewAttestation"
        );
        if (loaded !== null) {
          try {
            if (!pathIsInside(realpathSync(directory), loaded.path)) {
              addBlocker("INVENTORY_REVIEW_OUTSIDE_PRE_M0", "capacity", "Inventory review attestation must remain under pre-m0");
            } else {
              inventoryReviewArtifact = {
                path: loaded.path,
                bytes: loaded.bytes,
                sha256: loaded.sha256,
                value: JSON.parse(loaded.bytes.toString("utf8"))
              };
              inventoryReview = validateInventoryReview(inventoryReviewArtifact);
            }
          } catch (error) {
            addBlocker("INVENTORY_REVIEW_UNREADABLE", "inventory-review", "Inventory review attestation is not valid JSON", {
              error: String(error?.message ?? error)
            });
          }
        }
        if (binding.requiredStatus !== "human-approved") {
          addBlocker("INVENTORY_REVIEW_REQUIRED_STATUS", "capacity", "Capacity must require a human-approved inventory review");
        }
        if (inventoryReview !== null && inventoryReview.status !== binding.requiredStatus) {
          addBlocker("INVENTORY_REVIEW_UNAPPROVED", "inventory-review", `Inventory review is not human-approved: ${inventoryReview.status}`);
        }
      }
    }
    const agent = value.agentThroughput;
    if (
      exactKeys(
        agent,
        [
          "minutesPerAcceptedRecord",
          "contingencyFactor",
          "initialSliceRecordCount",
          "allowanceMinutes",
          "classification"
        ],
        "capacity",
        "capacity.agentThroughput"
      )
    ) {
      requireNullableNonnegative(agent.minutesPerAcceptedRecord, "capacity", "agentThroughput.minutesPerAcceptedRecord");
      if (!isFiniteNumber(agent.contingencyFactor) || agent.contingencyFactor < 1.5) {
        addBlocker(
          "CONTINGENCY_INVALID",
          "capacity",
          "agentThroughput.contingencyFactor must be at least 1.5"
        );
      }
      if (
        agent.initialSliceRecordCount !== null &&
        (!Number.isInteger(agent.initialSliceRecordCount) || agent.initialSliceRecordCount < 1)
      ) {
        addBlocker(
          "CAPACITY_COUNT_INVALID",
          "capacity",
          "agentThroughput.initialSliceRecordCount must be null or a positive integer"
        );
      }
      requireNullableNonnegative(agent.allowanceMinutes, "capacity", "agentThroughput.allowanceMinutes");
      if (agent.classification !== "planning-only") {
        addBlocker("AGENT_CLASSIFICATION_INVALID", "capacity", "Agent throughput must remain planning-only");
      }
      if (inventory !== null && agent.initialSliceRecordCount !== null) {
        if (agent.initialSliceRecordCount !== inventory.anticipatedInitialRecords) {
          addBlocker(
            "AGENT_COUNT_MISMATCH",
            "capacity",
            "Agent capacity count does not equal the validated initial-slice inventory count",
            { expected: inventory.anticipatedInitialRecords, actual: agent.initialSliceRecordCount }
          );
        }
      } else if (agent.initialSliceRecordCount !== null && inventory === null) {
        addBlocker(
          "AGENT_COUNT_UNVERIFIABLE",
          "capacity",
          "Agent capacity count is set but the inventory count is not valid"
        );
      }
      if (agent.allowanceMinutes !== null) {
        if (
          !isFiniteNumber(agent.minutesPerAcceptedRecord) ||
          !Number.isInteger(agent.initialSliceRecordCount) ||
          !isFiniteNumber(agent.contingencyFactor)
        ) {
          addBlocker(
            "AGENT_ALLOWANCE_UNVERIFIABLE",
            "capacity",
            "Agent allowance is set without all formula inputs"
          );
        } else {
          const expected =
            agent.minutesPerAcceptedRecord * agent.initialSliceRecordCount * agent.contingencyFactor;
          if (!Number.isFinite(expected)) {
            addBlocker(
              "AGENT_ALLOWANCE_NONFINITE",
              "capacity",
              "Agent allowance formula overflowed or produced a non-finite result"
            );
          } else if (!approximatelyEqual(agent.allowanceMinutes, expected)) {
            addBlocker("AGENT_ALLOWANCE_MISMATCH", "capacity", "Agent allowance does not match its formula", {
              expected,
              actual: agent.allowanceMinutes
            });
          }
        }
      }
    }
    const human = value.humanAttention;
    if (
      exactKeys(
        human,
        [
          "implementerMinutesPerAcceptedRecord",
          "reviewerMinutesPerAcceptedRecord",
          "decisionOwnerMinutesPerAcceptedRecord",
          "fixedDecisionOwnerMinutes",
          "schemaLinterToolingMinutes",
          "schemaLinterToolingRole",
          "contingencyFactor",
          "initialSliceRecordCount",
          "allowanceMinutes"
        ],
        "capacity",
        "capacity.humanAttention"
      )
    ) {
      const rateFields = [
        "implementerMinutesPerAcceptedRecord",
        "reviewerMinutesPerAcceptedRecord",
        "decisionOwnerMinutesPerAcceptedRecord"
      ];
      const fixedFields = ["fixedDecisionOwnerMinutes", "schemaLinterToolingMinutes"];
      for (const field of [...rateFields, ...fixedFields]) {
        requireNullableNonnegative(human[field], "capacity", `humanAttention.${field}`);
      }
      if (
        human.schemaLinterToolingRole !== null &&
        !requiredRoleNames.includes(human.schemaLinterToolingRole)
      ) {
        addBlocker("CAPACITY_TOOLING_ROLE_INVALID", "capacity", "humanAttention.schemaLinterToolingRole must name a production role key");
      }
      if (!isFiniteNumber(human.contingencyFactor) || human.contingencyFactor < 1.5) {
        addBlocker(
          "CONTINGENCY_INVALID",
          "capacity",
          "humanAttention.contingencyFactor must be at least 1.5"
        );
      }
      if (
        human.initialSliceRecordCount !== null &&
        (!Number.isInteger(human.initialSliceRecordCount) || human.initialSliceRecordCount < 1)
      ) {
        addBlocker(
          "CAPACITY_COUNT_INVALID",
          "capacity",
          "humanAttention.initialSliceRecordCount must be null or a positive integer"
        );
      }
      requireNullableNonnegative(human.allowanceMinutes, "capacity", "humanAttention.allowanceMinutes");
      if (inventory !== null && human.initialSliceRecordCount !== null) {
        if (human.initialSliceRecordCount !== inventory.anticipatedInitialRecords) {
          addBlocker(
            "HUMAN_COUNT_MISMATCH",
            "capacity",
            "Human capacity count does not equal the validated initial-slice inventory count",
            { expected: inventory.anticipatedInitialRecords, actual: human.initialSliceRecordCount }
          );
        }
      } else if (human.initialSliceRecordCount !== null && inventory === null) {
        addBlocker(
          "HUMAN_COUNT_UNVERIFIABLE",
          "capacity",
          "Human capacity count is set but the inventory count is not valid"
        );
      }
      if (human.allowanceMinutes !== null) {
        const missingInputs = [...rateFields, ...fixedFields].filter(
          (field) => !isFiniteNumber(human[field])
        );
        if (
          missingInputs.length > 0 ||
          !Number.isInteger(human.initialSliceRecordCount) ||
          !isFiniteNumber(human.contingencyFactor)
        ) {
          addBlocker(
            "HUMAN_ALLOWANCE_UNVERIFIABLE",
            "capacity",
            "Human allowance is set without all formula inputs",
            { missingInputs }
          );
        } else {
          const perRecord = rateFields.reduce((sum, field) => sum + human[field], 0);
          const expected =
            perRecord * human.initialSliceRecordCount * human.contingencyFactor +
            human.fixedDecisionOwnerMinutes +
            human.schemaLinterToolingMinutes;
          if (!Number.isFinite(expected)) {
            addBlocker(
              "HUMAN_ALLOWANCE_NONFINITE",
              "capacity",
              "Human allowance formula overflowed or produced a non-finite result"
            );
          } else if (!approximatelyEqual(human.allowanceMinutes, expected)) {
            addBlocker("HUMAN_ALLOWANCE_MISMATCH", "capacity", "Human allowance does not match its formula", {
              expected,
              actual: human.allowanceMinutes
            });
          }
        }
      }
    }
    const m0 = value.m0Envelope;
    if (
      exactKeys(
        m0,
        [
          "targetDate",
          "combinedHumanEffortCapHours",
          "committedImplementerHoursPerWeek",
          "committedReviewerHoursPerWeek",
          "committedDecisionOwnerHoursPerWeek"
        ],
        "capacity",
        "capacity.m0Envelope"
      )
    ) {
      if (
        m0.targetDate !== null &&
        !isValidCalendarDate(m0.targetDate)
      ) {
        addBlocker("M0_DATE_INVALID", "capacity", "m0Envelope.targetDate must be null or a valid YYYY-MM-DD date");
      }
      for (const field of [
        "combinedHumanEffortCapHours",
        "committedImplementerHoursPerWeek",
        "committedReviewerHoursPerWeek",
        "committedDecisionOwnerHoursPerWeek"
      ]) {
        requireNullableNonnegative(m0[field], "capacity", `m0Envelope.${field}`);
      }
    }
    const m2 = value.m2Envelope;
    if (
      exactKeys(
        m2,
        ["elapsedDurationDays", "combinedHumanEffortCapHours"],
        "capacity",
        "capacity.m2Envelope"
      )
    ) {
      if (
        m2.elapsedDurationDays !== null &&
        (!Number.isInteger(m2.elapsedDurationDays) || m2.elapsedDurationDays < 1)
      ) {
        addBlocker("M2_DURATION_INVALID", "capacity", "m2Envelope.elapsedDurationDays must be null or a positive integer");
      }
      requireNullableNonnegative(m2.combinedHumanEffortCapHours, "capacity", "m2Envelope.combinedHumanEffortCapHours");
    }
    const expectedTripwirePolicy = {
      checkpoint: {
        triggerRule: "earlier-of-elapsed-or-effort",
        elapsedFraction: 0.5,
        effortFraction: 0.5,
        requiredApprovers: ["humanReviewer", "humanDecisionOwner"],
        allowedPauseOutcomes: [
          "stop",
          "claim-cut-migration",
          "in-cap-remediation",
          "new-envelope"
        ]
      },
      stop: {
        triggerRule: "either-date-or-effort-cap",
        elapsedFraction: 1,
        effortFraction: 1,
        continuationRequires: ["new-envelope", "claim-cuts-or-funded-capacity"]
      },
      m0RequiredArtifacts: [
        "corrected-direct-locale-contract",
        "executable-registry-linter-result",
        "reproducible-lossless-candidate-results"
      ],
      m2RequiredArtifacts: [
        "node-root-core-result",
        "exact-floor-browser-result",
        "m1-m3a-evidence-closure"
      ]
    };
    if (
      canonicalJson(value.tripwirePolicy) !== canonicalJson(expectedTripwirePolicy)
    ) {
      addBlocker(
        "CAPACITY_TRIPWIRE_POLICY_MISMATCH",
        "capacity",
        "capacity.tripwirePolicy must equal the frozen M0/M2 checkpoint, stop, and required-artifact policy"
      );
    }
    const capacityEventIds = new Set();
    const capacityEvents = [];
    if (!Array.isArray(value.eventLog)) {
      addBlocker("CAPACITY_EVENT_LOG_INVALID", "capacity", "capacity.eventLog must be an array");
    } else {
      const eventFields = [
        "id",
        "gate",
        "kind",
        "recordedAt",
        "cumulativeEffortHours",
        "artifacts",
        "humanReviewer",
        "humanDecisionOwner",
        "outcome",
        "details",
        "recordSha256"
      ];
      const eventKinds = new Set(["start", "checkpoint", "pause", "stop", "rebaseline", "toll", "exit"]);
      const eventOutcomes = new Set([
        "start",
        "pass",
        "stop",
        "claim-cut-migration",
        "in-cap-remediation",
        "new-envelope",
        "approved-toll",
        "complete"
      ]);
      const eventArtifactLabels = new Set([
        "plan",
        "roles",
        "inventory-review",
        "calibration",
        "profile-registry",
        "bootstrap-requirements",
        "selection-record",
        ...expectedTripwirePolicy.m0RequiredArtifacts,
        ...expectedTripwirePolicy.m2RequiredArtifacts,
        "external-block-evidence",
        "m2-envelope-decision",
        "gate-closure"
      ]);
      const kindOutcomes = new Map([
        ["start", new Set(["start"])],
        ["checkpoint", new Set(["pass"])],
        ["pause", new Set(expectedTripwirePolicy.checkpoint.allowedPauseOutcomes)],
        ["stop", new Set(["stop"])],
        ["rebaseline", new Set(["claim-cut-migration", "new-envelope"])],
        ["toll", new Set(["approved-toll"])],
        ["exit", new Set(["complete"])]
      ]);
      const outcomeDetailTypes = {
        pass: "checkpoint-pass",
        stop: "stop",
        "claim-cut-migration": "claim-cut-migration",
        "in-cap-remediation": "in-cap-remediation",
        "new-envelope": "new-envelope",
        "approved-toll": "external-block-toll",
        complete: "gate-exit"
      };
      value.eventLog.forEach((event, index) => {
        const location = `capacity.eventLog[${index}]`;
        if (!exactKeys(event, eventFields, "capacity", location)) return;
        capacityEvents.push(event);
        if (!isNonemptyString(event.id)) {
          addBlocker("CAPACITY_EVENT_ID_INVALID", "capacity", `${location}.id must be nonempty`);
        } else if (capacityEventIds.has(event.id)) {
          addBlocker("CAPACITY_EVENT_ID_DUPLICATE", "capacity", `Duplicate capacity event ID: ${event.id}`);
        } else {
          capacityEventIds.add(event.id);
        }
        if (event.gate !== "M0" && event.gate !== "M2") {
          addBlocker("CAPACITY_EVENT_GATE_INVALID", "capacity", `${location}.gate must be M0 or M2`);
        }
        if (!eventKinds.has(event.kind)) {
          addBlocker("CAPACITY_EVENT_KIND_INVALID", "capacity", `${location}.kind is invalid`);
        }
        if (!isStrictIsoTimestamp(event.recordedAt)) {
          addBlocker("CAPACITY_EVENT_TIME_INVALID", "capacity", `${location}.recordedAt must be a strict ISO timestamp`);
        }
        if (!isFiniteNumber(event.cumulativeEffortHours) || event.cumulativeEffortHours < 0) {
          addBlocker("CAPACITY_EVENT_EFFORT_INVALID", "capacity", `${location}.cumulativeEffortHours must be nonnegative`);
        }
        const artifactByLabel = new Map();
        if (!Array.isArray(event.artifacts)) {
          addBlocker("CAPACITY_EVENT_ARTIFACTS_INVALID", "capacity", `${location}.artifacts must be an array`);
        } else {
          event.artifacts.forEach((artifact, artifactIndex) => {
            const artifactLocation = `${location}.artifacts[${artifactIndex}]`;
            if (!exactKeys(artifact, ["label", "sha256"], "capacity", artifactLocation)) return;
            if (!eventArtifactLabels.has(artifact.label)) {
              addBlocker("CAPACITY_EVENT_ARTIFACT_LABEL", "capacity", `${artifactLocation}.label is invalid`);
            } else if (artifactByLabel.has(artifact.label)) {
              addBlocker("CAPACITY_EVENT_ARTIFACT_DUPLICATE", "capacity", `${location} repeats artifact label ${artifact.label}`);
            } else {
              artifactByLabel.set(artifact.label, artifact.sha256);
            }
            if (!hashPattern.test(artifact.sha256 ?? "")) {
              addBlocker("CAPACITY_EVENT_ARTIFACT_HASH", "capacity", `${artifactLocation}.sha256 is invalid`);
            }
          });
        }
        if (event.humanReviewer !== roles?.humanReviewer?.name) {
          addBlocker("CAPACITY_EVENT_REVIEWER_MISMATCH", "capacity", `${location}.humanReviewer does not match the named role`);
        }
        if (event.humanDecisionOwner !== roles?.humanDecisionOwner?.name) {
          addBlocker("CAPACITY_EVENT_OWNER_MISMATCH", "capacity", `${location}.humanDecisionOwner does not match the named role`);
        }
        if (!eventOutcomes.has(event.outcome)) {
          addBlocker("CAPACITY_EVENT_OUTCOME_INVALID", "capacity", `${location}.outcome is invalid`);
        }
        if (eventKinds.has(event.kind) && !kindOutcomes.get(event.kind)?.has(event.outcome)) {
          addBlocker("CAPACITY_EVENT_KIND_OUTCOME_MISMATCH", "capacity", `${location}.kind cannot produce outcome ${event.outcome}`);
        }
        const expectedDetailType = event.outcome === "start"
          ? event.gate === "M0" ? "m0-start" : "m2-start"
          : outcomeDetailTypes[event.outcome];
        if (!isObject(event.details) || event.details.type !== expectedDetailType) {
          addBlocker("CAPACITY_EVENT_DETAILS_TYPE", "capacity", `${location}.details.type does not match outcome ${event.outcome}`);
        } else if (event.outcome === "start" && event.gate === "M0") {
          if (!exactKeys(event.details, ["type"], "capacity", `${location}.details`)) return;
          if (event.cumulativeEffortHours !== 0) {
            addBlocker("CAPACITY_EVENT_START_INVALID", "capacity", `${location} M0 start must begin at zero gate-local cumulative effort`);
          }
        } else if (event.outcome === "start" && event.gate === "M2") {
          const fields = [
            "type",
            "m0ExitedAt",
            "confirmedElapsedDurationDays",
            "confirmedCombinedHumanEffortCapHours",
            "absoluteDeadline",
            "envelopeDecisionSha256"
          ];
          if (exactKeys(event.details, fields, "capacity", `${location}.details`)) {
            if (event.cumulativeEffortHours !== 0) {
              addBlocker("CAPACITY_EVENT_M2_START_EFFORT", "capacity", `${location} M2 start must begin at zero M2 gate-local effort`);
            }
            if (!isStrictIsoTimestamp(event.details.m0ExitedAt) || event.recordedAt !== event.details.m0ExitedAt) {
              addBlocker("CAPACITY_EVENT_M2_START_TIME", "capacity", `${location} must start exactly at strict m0ExitedAt`);
            }
            if (event.details.confirmedElapsedDurationDays !== value.m2Envelope?.elapsedDurationDays) {
              addBlocker("CAPACITY_EVENT_M2_DURATION", "capacity", `${location} confirmed duration differs from the current M2 envelope`);
            }
            if (!approximatelyEqual(event.details.confirmedCombinedHumanEffortCapHours, value.m2Envelope?.combinedHumanEffortCapHours)) {
              addBlocker("CAPACITY_EVENT_M2_EFFORT_CAP", "capacity", `${location} confirmed effort cap differs from the current M2 envelope`);
            }
            if (!isStrictIsoTimestamp(event.details.absoluteDeadline)) {
              addBlocker("CAPACITY_EVENT_M2_DEADLINE", "capacity", `${location}.details.absoluteDeadline must be a strict timestamp`);
            } else if (
              isStrictIsoTimestamp(event.details.m0ExitedAt) &&
              Number.isInteger(event.details.confirmedElapsedDurationDays)
            ) {
              const expectedDeadline =
                Date.parse(event.details.m0ExitedAt) +
                event.details.confirmedElapsedDurationDays * 24 * 60 * 60 * 1000;
              if (Date.parse(event.details.absoluteDeadline) !== expectedDeadline) {
                addBlocker("CAPACITY_EVENT_M2_DEADLINE_CALCULATION", "capacity", `${location} absolute deadline does not equal M0ExitedAt plus confirmed duration`);
              }
            }
            if (!hashPattern.test(event.details.envelopeDecisionSha256 ?? "") || artifactByLabel.get("m2-envelope-decision") !== event.details.envelopeDecisionSha256) {
              addBlocker("CAPACITY_EVENT_M2_ENVELOPE_DECISION", "capacity", `${location} must attach its exact labeled M2 envelope decision`);
            }
          }
        } else if (event.outcome === "pass") {
          if (!exactKeys(event.details, ["type"], "capacity", `${location}.details`)) return;
        } else if (event.outcome === "stop") {
          if (exactKeys(event.details, ["type", "reason"], "capacity", `${location}.details`) && !isNonemptyString(event.details.reason)) {
            addBlocker("CAPACITY_EVENT_STOP_REASON", "capacity", `${location}.details.reason must be nonempty`);
          }
        } else if (event.outcome === "claim-cut-migration") {
          const fields = ["type", "reason", "profileRegistrySha256", "requirementsSha256", "selectionRecordSha256"];
          if (exactKeys(event.details, fields, "capacity", `${location}.details`)) {
            if (!isNonemptyString(event.details.reason)) {
              addBlocker("CAPACITY_EVENT_CLAIM_CUT_REASON", "capacity", `${location}.details.reason must be nonempty`);
            }
            for (const field of fields.slice(2)) {
              if (!hashPattern.test(event.details[field] ?? "")) {
                addBlocker("CAPACITY_EVENT_CLAIM_CUT_HASH", "capacity", `${location}.details.${field} is invalid`);
              }
            }
            for (const [label, field] of [
              ["profile-registry", "profileRegistrySha256"],
              ["bootstrap-requirements", "requirementsSha256"],
              ["selection-record", "selectionRecordSha256"]
            ]) {
              if (artifactByLabel.get(label) !== event.details[field]) {
                addBlocker("CAPACITY_EVENT_CLAIM_CUT_ARTIFACT", "capacity", `${location} must attach labeled ${label} bytes`);
              }
            }
          }
        } else if (event.outcome === "in-cap-remediation") {
          const fields = ["type", "remainingWork", "owner", "deadline", "reviewerApprovalSha256"];
          if (exactKeys(event.details, fields, "capacity", `${location}.details`)) {
            if (
              !Array.isArray(event.details.remainingWork) ||
              event.details.remainingWork.length === 0 ||
              !unique(event.details.remainingWork) ||
              !event.details.remainingWork.every(isNonemptyString)
            ) {
              addBlocker("CAPACITY_EVENT_REMEDIATION_WORK", "capacity", `${location}.details.remainingWork must be a nonempty unique list`);
            }
            if (!isNonemptyString(event.details.owner)) {
              addBlocker("CAPACITY_EVENT_REMEDIATION_OWNER", "capacity", `${location}.details.owner must be nonempty`);
            }
            if (!isValidCalendarDate(event.details.deadline)) {
              addBlocker("CAPACITY_EVENT_REMEDIATION_DEADLINE", "capacity", `${location}.details.deadline must be a valid date`);
            } else if (isStrictIsoTimestamp(event.recordedAt) && event.details.deadline < event.recordedAt.slice(0, 10)) {
              addBlocker("CAPACITY_EVENT_REMEDIATION_DEADLINE_PAST", "capacity", `${location}.details.deadline precedes the event`);
            }
            if (!hashPattern.test(event.details.reviewerApprovalSha256 ?? "")) {
              addBlocker("CAPACITY_EVENT_REMEDIATION_APPROVAL", "capacity", `${location}.details.reviewerApprovalSha256 is invalid`);
            }
          }
        } else if (event.outcome === "new-envelope") {
          const fields = [
            "type",
            "predecessorCapacitySha256",
            "continuationBasis",
            "identifiedAdditionalCapacity",
            "selectionRecordSha256",
            "fundedCapacityEvidenceSha256"
          ];
          if (exactKeys(event.details, fields, "capacity", `${location}.details`)) {
            if (!hashPattern.test(event.details.predecessorCapacitySha256 ?? "")) {
              addBlocker("CAPACITY_EVENT_ENVELOPE_PREDECESSOR", "capacity", `${location}.details.predecessorCapacitySha256 is invalid`);
            }
            if (!isNonemptyString(event.details.identifiedAdditionalCapacity)) {
              addBlocker("CAPACITY_EVENT_ADDITIONAL_CAPACITY", "capacity", `${location}.details.identifiedAdditionalCapacity must be nonempty`);
            }
            if (event.details.continuationBasis === "claim-cuts") {
              if (!hashPattern.test(event.details.selectionRecordSha256 ?? "") || event.details.fundedCapacityEvidenceSha256 !== null) {
                addBlocker("CAPACITY_EVENT_ENVELOPE_CLAIM_CUT", "capacity", `${location} claim-cut continuation requires a selection hash and no funding hash`);
              }
            } else if (event.details.continuationBasis === "funded-additional-capacity") {
              if (!hashPattern.test(event.details.fundedCapacityEvidenceSha256 ?? "") || event.details.selectionRecordSha256 !== null) {
                addBlocker("CAPACITY_EVENT_ENVELOPE_FUNDING", "capacity", `${location} funded continuation requires a funding-evidence hash and no selection hash`);
              }
            } else {
              addBlocker("CAPACITY_EVENT_ENVELOPE_BASIS", "capacity", `${location}.details.continuationBasis is invalid`);
            }
          }
        } else if (event.outcome === "approved-toll") {
          const fields = ["type", "reason", "start", "end", "elapsedSeconds"];
          if (exactKeys(event.details, fields, "capacity", `${location}.details`)) {
            if (!isNonemptyString(event.details.reason)) {
              addBlocker("CAPACITY_EVENT_TOLL_REASON", "capacity", `${location}.details.reason must be nonempty`);
            }
            if (!isStrictIsoTimestamp(event.details.start) || !isStrictIsoTimestamp(event.details.end)) {
              addBlocker("CAPACITY_EVENT_TOLL_TIME", "capacity", `${location} toll boundaries must be strict timestamps`);
            } else {
              const elapsedSeconds = (Date.parse(event.details.end) - Date.parse(event.details.start)) / 1000;
              if (!(elapsedSeconds > 0) || !approximatelyEqual(event.details.elapsedSeconds, elapsedSeconds)) {
                addBlocker("CAPACITY_EVENT_TOLL_ELAPSED", "capacity", `${location}.details.elapsedSeconds does not match its positive interval`);
              }
              if (isStrictIsoTimestamp(event.recordedAt) && Date.parse(event.recordedAt) < Date.parse(event.details.end)) {
                addBlocker("CAPACITY_EVENT_TOLL_RECORDED_EARLY", "capacity", `${location} was recorded before the external block ended`);
              }
            }
            if (!artifactByLabel.has("external-block-evidence")) {
              addBlocker("CAPACITY_EVENT_TOLL_EVIDENCE", "capacity", `${location} must attach labeled external-block evidence`);
            }
          }
        } else if (event.outcome === "complete") {
          if (exactKeys(event.details, ["type", "closureSha256"], "capacity", `${location}.details`)) {
            if (!hashPattern.test(event.details.closureSha256 ?? "") || artifactByLabel.get("gate-closure") !== event.details.closureSha256) {
              addBlocker("CAPACITY_EVENT_GATE_CLOSURE", "capacity", `${location} must attach its exact labeled gate closure`);
            }
          }
        }
        if (event.outcome === "pass") {
          const requiredLabels = event.gate === "M0"
            ? expectedTripwirePolicy.m0RequiredArtifacts
            : expectedTripwirePolicy.m2RequiredArtifacts;
          for (const label of requiredLabels) {
            if (!artifactByLabel.has(label)) {
              addBlocker("CAPACITY_EVENT_CHECKPOINT_ARTIFACT_MISSING", "capacity", `${location} is missing required ${event.gate} artifact ${label}`);
            }
          }
        }
        const eventBody = Object.fromEntries(
          Object.entries(event).filter(([field]) => field !== "recordSha256")
        );
        const expectedRecordSha256 = sha256Text(canonicalJson(eventBody));
        if (event.recordSha256 !== expectedRecordSha256) {
          addBlocker("CAPACITY_EVENT_HASH_MISMATCH", "capacity", `${location}.recordSha256 does not hash the JCS event body`, {
            expected: expectedRecordSha256,
            actual: event.recordSha256 ?? null
          });
        }
      });
      const previousEventByGate = new Map();
      for (let index = 0; index < capacityEvents.length; index += 1) {
        const current = capacityEvents[index];
        const previousGlobal = index > 0 ? capacityEvents[index - 1] : null;
        if (
          previousGlobal !== null &&
          isStrictIsoTimestamp(previousGlobal.recordedAt) &&
          isStrictIsoTimestamp(current.recordedAt) &&
          (
            Date.parse(current.recordedAt) < Date.parse(previousGlobal.recordedAt) ||
            (
              Date.parse(current.recordedAt) === Date.parse(previousGlobal.recordedAt) &&
              !(
                previousGlobal.gate === "M0" &&
                previousGlobal.kind === "exit" &&
                current.gate === "M2" &&
                current.kind === "start" &&
                current.details?.m0ExitedAt === current.recordedAt
              )
            )
          )
        ) {
          addBlocker("CAPACITY_EVENT_ORDER", "capacity", "capacity.eventLog must be chronological; equal timestamps are reserved for the atomic M0-exit/M2-start pair");
        }
        const previous = previousEventByGate.get(current.gate);
        if (previous !== undefined) {
          if (
            isFiniteNumber(previous.cumulativeEffortHours) &&
            isFiniteNumber(current.cumulativeEffortHours) &&
            current.cumulativeEffortHours < previous.cumulativeEffortHours
          ) {
            addBlocker("CAPACITY_EVENT_EFFORT_DECREASE", "capacity", "capacity.eventLog gate-local cumulative effort must never decrease");
          }
          if (
            current.kind === "toll" &&
            isFiniteNumber(previous.cumulativeEffortHours) &&
            current.cumulativeEffortHours !== previous.cumulativeEffortHours
          ) {
            addBlocker("CAPACITY_EVENT_TOLL_EFFORT", "capacity", "Elapsed-time tolls cannot toll or change gate-local cumulative effort");
          }
        }
        previousEventByGate.set(current.gate, current);
      }
      const m2StartIndexes = capacityEvents
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => event?.gate === "M2" && event?.kind === "start");
      if (m2StartIndexes.length > 1) {
        addBlocker("CAPACITY_EVENT_M2_START_COUNT", "capacity", "capacity.eventLog may contain only one M2 start event per envelope version");
      }
      for (const { event, index } of m2StartIndexes) {
        const previous = capacityEvents[index - 1];
        if (
          previous?.gate !== "M0" ||
          previous?.kind !== "exit" ||
          previous?.outcome !== "complete" ||
          previous.recordedAt !== event.recordedAt
        ) {
          addBlocker("CAPACITY_EVENT_M2_START_TRANSITION", "capacity", "M2 start must be the atomic successor of a completed M0 exit at the same timestamp");
        }
      }
    }
    const approvalFields = [
      "planSha256",
      "rolesSha256",
      "inventoryReviewSha256",
      "calibrationSha256",
      "profileRegistrySha256",
      "bootstrapRequirementsSha256",
      "selectionRecordSha256",
      "approvalCommit",
      "approvedAt",
      "startEvent",
      "ledgerSource",
      "countedWorkCategories",
      "otherM0WorkItems",
      "registryHumanAllowanceHours",
      "otherM0WorkAllowanceHours",
      "thresholdCalculationHours",
      "humanReviewer",
      "humanDecisionOwner"
    ];
    let otherM0WorkItemHours = null;
    const otherM0WorkHoursByRole = Object.fromEntries(
      requiredRoleNames.map((roleName) => [roleName, 0])
    );
    const otherM0WorkEvidenceArtifacts = [];
    if (exactKeys(value.approval, approvalFields, "capacity", "capacity.approval")) {
      for (const field of [
        "planSha256",
        "rolesSha256",
        "inventoryReviewSha256",
        "calibrationSha256",
        "profileRegistrySha256",
        "bootstrapRequirementsSha256",
        "selectionRecordSha256"
      ]) {
        if (!isNullableHash(value.approval[field])) {
          addBlocker("CAPACITY_APPROVAL_HASH", "capacity", `capacity.approval.${field} must be null or lowercase SHA-256`);
        }
      }
      if (
        value.approval.approvalCommit !== null &&
        (typeof value.approval.approvalCommit !== "string" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value.approval.approvalCommit))
      ) {
        addBlocker("CAPACITY_APPROVAL_COMMIT", "capacity", "capacity.approval.approvalCommit must be null or a 40/64-character lowercase commit hash");
      }
      for (const field of ["approvedAt", "startEvent", "ledgerSource", "humanReviewer", "humanDecisionOwner"]) {
        if (!nullableNameIsValid(value.approval[field])) {
          addBlocker("CAPACITY_APPROVAL_FIELD", "capacity", `capacity.approval.${field} must be null or nonempty`);
        }
      }
      if (value.approval.approvedAt !== null && !isStrictIsoTimestamp(value.approval.approvedAt)) {
        addBlocker("CAPACITY_APPROVAL_TIME", "capacity", "capacity.approval.approvedAt must be a strict ISO timestamp");
      }
      if (
        !Array.isArray(value.approval.countedWorkCategories) ||
        !value.approval.countedWorkCategories.every(isNonemptyString) ||
        !unique(value.approval.countedWorkCategories)
      ) {
        addBlocker("CAPACITY_WORK_CATEGORIES", "capacity", "capacity.approval.countedWorkCategories must contain unique nonempty strings");
      }
      if (!Array.isArray(value.approval.otherM0WorkItems)) {
        addBlocker("CAPACITY_OTHER_M0_ITEMS", "capacity", "capacity.approval.otherM0WorkItems must be an array");
      } else {
        const itemCategories = new Set();
        otherM0WorkItemHours = 0;
        value.approval.otherM0WorkItems.forEach((item, index) => {
          const location = `capacity.approval.otherM0WorkItems[${index}]`;
          if (!exactKeys(item, ["category", "responsibleRole", "estimatedHours", "basis", "evidence"], "capacity", location)) {
            otherM0WorkItemHours = null;
            return;
          }
          if (!isNonemptyString(item.category) || itemCategories.has(item.category)) {
            addBlocker("CAPACITY_OTHER_M0_CATEGORY", "capacity", `${location}.category must be nonempty and unique`);
          } else {
            itemCategories.add(item.category);
          }
          if (!isFiniteNumber(item.estimatedHours) || item.estimatedHours <= 0) {
            addBlocker("CAPACITY_OTHER_M0_HOURS", "capacity", `${location}.estimatedHours must be positive`);
            otherM0WorkItemHours = null;
          } else if (otherM0WorkItemHours !== null) {
            otherM0WorkItemHours += item.estimatedHours;
            if (requiredRoleNames.includes(item.responsibleRole)) {
              otherM0WorkHoursByRole[item.responsibleRole] += item.estimatedHours;
            }
          }
          if (!requiredRoleNames.includes(item.responsibleRole)) {
            addBlocker("CAPACITY_OTHER_M0_ROLE", "capacity", `${location}.responsibleRole must name a production role key`);
          }
          if (!isNonemptyString(item.basis)) {
            addBlocker("CAPACITY_OTHER_M0_BASIS", "capacity", `${location}.basis must be nonempty`);
          }
          const loadedEvidence = loadBoundArtifact(
            item.evidence,
            "capacity-other-m0-estimate",
            `${location}.evidence`
          );
          if (loadedEvidence !== null) otherM0WorkEvidenceArtifacts.push(loadedEvidence);
        });
        if (
          Array.isArray(value.approval.countedWorkCategories) &&
          (value.approval.countedWorkCategories.length > 0 || itemCategories.size > 0) &&
          (value.approval.countedWorkCategories.length !== itemCategories.size + 1 ||
            !value.approval.countedWorkCategories.includes("requirements-registry") ||
            [...itemCategories].some(
              (category) => !value.approval.countedWorkCategories.includes(category)
            ))
        ) {
          addBlocker("CAPACITY_OTHER_M0_CATEGORY_MISMATCH", "capacity", "countedWorkCategories must equal requirements-registry plus the otherM0WorkItems category set");
        }
      }
      for (const field of ["registryHumanAllowanceHours", "otherM0WorkAllowanceHours", "thresholdCalculationHours"]) {
        requireNullableNonnegative(value.approval[field], "capacity", `capacity.approval.${field}`);
      }
    }
    if (!isNullableHash(value.predecessorCapacitySha256)) {
      addBlocker("CAPACITY_PREDECESSOR_HASH", "capacity", "predecessorCapacitySha256 must be null or lowercase SHA-256");
    }
    const capacityHistoryHashes = new Set();
    const capacityHistoryRecords = [];
    const capacityRootFields = [
      "formatVersion",
      "status",
      "sourceCalibration",
      "inventoryBasis",
      "agentThroughput",
      "humanAttention",
      "m0Envelope",
      "m2Envelope",
      "tripwirePolicy",
      "eventLog",
      "approval",
      "predecessorCapacitySha256",
      "history",
      "blockingReasons"
    ];
    const recognizedCapacityStatuses = new Set([
      "blocked-pending-human-calibration-and-capacity",
      "blocked-pending-human-calibration-and-inventory",
      "approved-and-started-m0"
    ]);
    const capacityApprovalCaps = (record) => ({
      registryHumanAllowanceHours: record?.approval?.registryHumanAllowanceHours ?? null,
      otherM0WorkAllowanceHours: record?.approval?.otherM0WorkAllowanceHours ?? null,
      thresholdCalculationHours: record?.approval?.thresholdCalculationHours ?? null
    });
    const capacityApprovalScope = (record) => ({
      countedWorkCategories: record?.approval?.countedWorkCategories ?? [],
      otherM0WorkItems: record?.approval?.otherM0WorkItems ?? []
    });
    const validateCapacityEnvelopeTransition = (
      previousRecord,
      nextRecord,
      immediatePredecessorSha256,
      location
    ) => {
      if (!isObject(previousRecord) || !isObject(nextRecord)) return;
      const previousEvents = previousRecord.eventLog;
      const nextEvents = nextRecord.eventLog;
      if (!Array.isArray(previousEvents) || !Array.isArray(nextEvents)) return;
      const appendedEvents = nextEvents.slice(previousEvents.length);
      for (const event of appendedEvents) {
        if (
          event?.outcome === "new-envelope" &&
          event.details?.predecessorCapacitySha256 !== immediatePredecessorSha256
        ) {
          addBlocker(
            "CAPACITY_NEW_ENVELOPE_IMMEDIATE_PREDECESSOR",
            "capacity",
            `${location} appends a new-envelope event that does not name the immediate predecessor capacity hash`
          );
        }
      }
      const changesByGate = [
        [
          "M0",
          canonicalJson(nextRecord.m0Envelope ?? null) !== canonicalJson(previousRecord.m0Envelope ?? null) ||
            canonicalJson(capacityApprovalCaps(nextRecord)) !== canonicalJson(capacityApprovalCaps(previousRecord))
        ],
        [
          "M2",
          canonicalJson(nextRecord.m2Envelope ?? null) !== canonicalJson(previousRecord.m2Envelope ?? null)
        ]
      ];
      for (const [gate, changed] of changesByGate) {
        if (
          changed &&
          !appendedEvents.some(
            (event) =>
              event?.gate === gate &&
              event?.outcome === "new-envelope" &&
              event.details?.predecessorCapacitySha256 === immediatePredecessorSha256
          )
        ) {
          addBlocker(
            "CAPACITY_ENVELOPE_CHANGED_WITHOUT_REBASELINE",
            "capacity",
            `${location} changes ${gate} envelope/cap fields without a newly appended gate-local new-envelope event tied to the immediate predecessor`
          );
        }
      }
      if ((nextRecord.approval?.ledgerSource ?? null) !== (previousRecord.approval?.ledgerSource ?? null)) {
        addBlocker(
          "CAPACITY_LEDGER_SOURCE_CHANGED",
          "capacity",
          `${location} changes the append-only usage ledger source; no usage-preserving ledger-migration event is defined`
        );
      }
      if (
        canonicalJson(capacityApprovalScope(nextRecord)) !== canonicalJson(capacityApprovalScope(previousRecord)) &&
        !appendedEvents.some(
          (event) =>
            event?.gate === "M0" &&
            (
              (
                event?.outcome === "new-envelope" &&
                event.details?.predecessorCapacitySha256 === immediatePredecessorSha256
              ) ||
              event?.outcome === "claim-cut-migration"
            )
        )
      ) {
        addBlocker(
          "CAPACITY_APPROVAL_SCOPE_CHANGED_WITHOUT_MIGRATION",
          "capacity",
          `${location} changes counted work categories or itemized other-M0 scope without a reviewed M0 claim-cut/new-envelope event`
        );
      }
    };
    if (!Array.isArray(value.history)) {
      addBlocker("CAPACITY_HISTORY", "capacity", "capacity.history must be an array of versioned prior capacity records");
    } else {
      const historyCommits = new Set();
      value.history.forEach((entry, index) => {
        const location = `capacity.history[${index}]`;
        if (!exactKeys(entry, ["capacitySha256", "commit"], "capacity", location)) return;
        if (!hashPattern.test(entry.capacitySha256 ?? "")) {
          addBlocker("CAPACITY_HISTORY_HASH", "capacity", `${location}.capacitySha256 must be a lowercase SHA-256`);
        } else if (capacityHistoryHashes.has(entry.capacitySha256)) {
          addBlocker("CAPACITY_HISTORY_HASH_DUPLICATE", "capacity", `${location}.capacitySha256 repeats an earlier revision`);
        } else {
          capacityHistoryHashes.add(entry.capacitySha256);
        }
        if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(entry.commit ?? "")) {
          addBlocker("CAPACITY_HISTORY_COMMIT", "capacity", `${location}.commit must be a lowercase 40/64-character commit hash`);
          return;
        }
        if (historyCommits.has(entry.commit)) {
          addBlocker("CAPACITY_HISTORY_COMMIT_DUPLICATE", "capacity", `${location}.commit repeats an earlier revision commit`);
          return;
        }
        historyCommits.add(entry.commit);
        const priorBytes = spawnSync(
          "git",
          ["show", `${entry.commit}:${relativePath(paths.capacity)}`],
          { cwd: projectDirectory, encoding: null, maxBuffer: 64 * 1024 * 1024 }
        );
        if (priorBytes.error || priorBytes.status !== 0 || !Buffer.isBuffer(priorBytes.stdout)) {
          addBlocker("CAPACITY_HISTORY_UNRESOLVED", "capacity", `${location} does not resolve to committed capacity-record bytes`, {
            commit: entry.commit,
            error: String(priorBytes.error?.message ?? priorBytes.stderr ?? "artifact missing").trim().slice(0, 500)
          });
          return;
        }
        const actualPriorSha256 = sha256Bytes(priorBytes.stdout);
        if (actualPriorSha256 !== entry.capacitySha256) {
          addBlocker("CAPACITY_HISTORY_HASH_MISMATCH", "capacity", `${location} does not hash the capacity record at its commit`, {
            expected: entry.capacitySha256,
            actual: actualPriorSha256
          });
        }
        const ancestorOfHead = spawnSync(
          "git",
          ["merge-base", "--is-ancestor", entry.commit, "HEAD"],
          { cwd: projectDirectory, encoding: "utf8" }
        );
        if (ancestorOfHead.error || ancestorOfHead.status !== 0) {
          addBlocker("CAPACITY_HISTORY_NOT_ANCESTOR", "capacity", `${location}.commit is not an ancestor of HEAD`);
        }
        if (index > 0) {
          const priorCommit = value.history[index - 1]?.commit;
          if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(priorCommit ?? "")) {
            const chronological = spawnSync(
              "git",
              ["merge-base", "--is-ancestor", priorCommit, entry.commit],
              { cwd: projectDirectory, encoding: "utf8" }
            );
            if (chronological.error || chronological.status !== 0) {
              addBlocker("CAPACITY_HISTORY_COMMIT_ORDER", "capacity", `${location}.commit does not descend from the preceding history commit`);
            }
          }
        }
        try {
          const priorCapacity = JSON.parse(priorBytes.stdout.toString("utf8"));
          capacityHistoryRecords[index] = priorCapacity;
          if (!exactKeys(priorCapacity, capacityRootFields, "capacity", `${location}.record`)) return;
          if (priorCapacity.formatVersion !== 1) {
            addBlocker("CAPACITY_HISTORY_FORMAT", "capacity", `${location} committed capacity record has an invalid formatVersion`);
          }
          if (!recognizedCapacityStatuses.has(priorCapacity.status)) {
            addBlocker("CAPACITY_HISTORY_STATUS", "capacity", `${location} committed capacity record has an unrecognized status`);
          }
          const expectedPrefix = value.history.slice(0, index);
          if (canonicalJson(priorCapacity.history) !== canonicalJson(expectedPrefix)) {
            addBlocker("CAPACITY_HISTORY_PREFIX", "capacity", `${location} prior record does not preserve the exact earlier history prefix`);
          }
          const expectedPredecessor = index === 0 ? null : value.history[index - 1].capacitySha256;
          if (priorCapacity.predecessorCapacitySha256 !== expectedPredecessor) {
            addBlocker("CAPACITY_HISTORY_PRIOR_PREDECESSOR", "capacity", `${location} prior record does not point to the immediately preceding capacity revision`);
          }
        } catch (error) {
          addBlocker("CAPACITY_HISTORY_JSON", "capacity", `${location} committed capacity record is not valid JSON`, {
            error: String(error?.message ?? error).slice(0, 500)
          });
        }
      });
      let firstApprovedHistoryIndex = -1;
      for (let index = 0; index < capacityHistoryRecords.length; index += 1) {
        const priorCapacity = capacityHistoryRecords[index];
        if (!isObject(priorCapacity)) continue;
        const location = `capacity.history[${index}]`;
        const priorEvents = priorCapacity.eventLog;
        if (!Array.isArray(priorEvents)) {
          addBlocker("CAPACITY_HISTORY_EVENT_LOG", "capacity", `${location} committed capacity record has no eventLog array`);
          continue;
        }
        if (index > 0) {
          const previousEvents = capacityHistoryRecords[index - 1]?.eventLog;
          if (Array.isArray(previousEvents) && !hasCanonicalArrayPrefix(priorEvents, previousEvents)) {
            addBlocker("CAPACITY_HISTORY_EVENT_PREFIX", "capacity", `${location} does not preserve the preceding committed event-log prefix`);
          }
        }
        if (firstApprovedHistoryIndex < 0) {
          if (priorCapacity.status === "approved-and-started-m0") {
            firstApprovedHistoryIndex = index;
            if (!isSingleM0StartLog(priorEvents)) {
              addBlocker("CAPACITY_HISTORY_INITIAL_START", "capacity", `${location} is the first approved record but does not contain exactly one M0 start event`);
            } else {
              const startEvent = priorEvents[0];
              const historicalEventFields = [
                "id",
                "gate",
                "kind",
                "recordedAt",
                "cumulativeEffortHours",
                "artifacts",
                "humanReviewer",
                "humanDecisionOwner",
                "outcome",
                "details",
                "recordSha256"
              ];
              if (exactKeys(startEvent, historicalEventFields, "capacity", `${location}.record.eventLog[0]`)) {
                if (startEvent.cumulativeEffortHours !== 0) {
                  addBlocker("CAPACITY_HISTORY_START_EFFORT", "capacity", `${location} first approved start does not begin at zero effort`);
                }
                if (!exactKeys(startEvent.details, ["type"], "capacity", `${location}.record.eventLog[0].details`)) {
                  addBlocker("CAPACITY_HISTORY_START_DETAILS", "capacity", `${location} first approved start has invalid details`);
                }
                const historicalEventBody = Object.fromEntries(
                  Object.entries(startEvent).filter(([field]) => field !== "recordSha256")
                );
                if (startEvent.recordSha256 !== sha256Text(canonicalJson(historicalEventBody))) {
                  addBlocker("CAPACITY_HISTORY_START_HASH", "capacity", `${location} first approved start has an invalid event hash`);
                }
              }
              const historicalApprovalFields = [
                "planSha256",
                "rolesSha256",
                "inventoryReviewSha256",
                "calibrationSha256",
                "profileRegistrySha256",
                "bootstrapRequirementsSha256",
                "selectionRecordSha256",
                "approvalCommit",
                "approvedAt",
                "startEvent",
                "ledgerSource",
                "countedWorkCategories",
                "otherM0WorkItems",
                "registryHumanAllowanceHours",
                "otherM0WorkAllowanceHours",
                "thresholdCalculationHours",
                "humanReviewer",
                "humanDecisionOwner"
              ];
              if (exactKeys(priorCapacity.approval, historicalApprovalFields, "capacity", `${location}.record.approval`)) {
                for (const field of [
                  "planSha256",
                  "rolesSha256",
                  "inventoryReviewSha256",
                  "calibrationSha256",
                  "profileRegistrySha256",
                  "bootstrapRequirementsSha256",
                  "selectionRecordSha256"
                ]) {
                  if (!hashPattern.test(priorCapacity.approval[field] ?? "")) {
                    addBlocker("CAPACITY_HISTORY_APPROVAL_HASH", "capacity", `${location}.record.approval.${field} is invalid`);
                  }
                }
                if (priorCapacity.approval.planSha256 !== planSha256) {
                  addBlocker("CAPACITY_HISTORY_PLAN_HASH", "capacity", `${location} first approved record does not bind the frozen v7 plan`);
                }
                if (
                  priorCapacity.approval.startEvent !== startEvent.id ||
                  priorCapacity.approval.approvedAt !== startEvent.recordedAt ||
                  !isStrictIsoTimestamp(priorCapacity.approval.approvedAt)
                ) {
                  addBlocker("CAPACITY_HISTORY_START_APPROVAL", "capacity", `${location} first approved record does not bind its exact start ID/time`);
                }
                if (
                  !isNonemptyString(priorCapacity.approval.humanReviewer) ||
                  !isNonemptyString(priorCapacity.approval.humanDecisionOwner) ||
                  startEvent.humanReviewer !== priorCapacity.approval.humanReviewer ||
                  startEvent.humanDecisionOwner !== priorCapacity.approval.humanDecisionOwner
                ) {
                  addBlocker("CAPACITY_HISTORY_START_APPROVERS", "capacity", `${location} first approved record has inconsistent start approvers`);
                }
                const historicalStartArtifacts = new Map(
                  (Array.isArray(startEvent.artifacts) ? startEvent.artifacts : []).map(
                    (artifact) => [artifact?.label, artifact?.sha256]
                  )
                );
                for (const [label, field] of [
                  ["plan", "planSha256"],
                  ["roles", "rolesSha256"],
                  ["inventory-review", "inventoryReviewSha256"],
                  ["calibration", "calibrationSha256"],
                  ["profile-registry", "profileRegistrySha256"],
                  ["bootstrap-requirements", "bootstrapRequirementsSha256"],
                  ["selection-record", "selectionRecordSha256"]
                ]) {
                  if (historicalStartArtifacts.get(label) !== priorCapacity.approval[field]) {
                    addBlocker("CAPACITY_HISTORY_START_ARTIFACT", "capacity", `${location} first approved start does not attach approval.${field}`);
                  }
                }
                const approvalCommit = priorCapacity.approval.approvalCommit;
                if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(approvalCommit ?? "")) {
                  addBlocker("CAPACITY_HISTORY_APPROVAL_COMMIT", "capacity", `${location} first approved record has no valid approval commit`);
                } else {
                  const approvalAncestry = spawnSync(
                    "git",
                    ["merge-base", "--is-ancestor", approvalCommit, value.history[index].commit],
                    { cwd: projectDirectory, encoding: "utf8" }
                  );
                  if (approvalAncestry.error || approvalAncestry.status !== 0) {
                    addBlocker("CAPACITY_HISTORY_APPROVAL_ANCESTRY", "capacity", `${location} first approved record commit does not descend from its approval commit`);
                  }
                }
              }
              if (!Array.isArray(priorCapacity.blockingReasons) || priorCapacity.blockingReasons.length !== 0) {
                addBlocker("CAPACITY_HISTORY_APPROVED_BLOCKERS", "capacity", `${location} first approved record still carries blockers`);
              }
            }
          } else if (priorEvents.length !== 0) {
            addBlocker("CAPACITY_HISTORY_PRESTART_EVENTS", "capacity", `${location} pre-start draft preloads lifecycle events`);
          }
        } else if (priorCapacity.status !== "approved-and-started-m0") {
          addBlocker("CAPACITY_HISTORY_STATUS_REGRESSION", "capacity", `${location} regresses to a pre-start status after formal M0 start`);
        }
      }
      for (let index = 1; index < capacityHistoryRecords.length; index += 1) {
        const previousRecord = capacityHistoryRecords[index - 1];
        const nextRecord = capacityHistoryRecords[index];
        if (previousRecord?.status === "approved-and-started-m0") {
          validateCapacityEnvelopeTransition(
            previousRecord,
            nextRecord,
            value.history[index - 1]?.capacitySha256,
            `capacity.history transition ${index - 1}->${index}`
          );
        }
      }
      if (firstApprovedHistoryIndex >= 0) {
        addBlocker(
          "CAPACITY_POST_START_SUCCESSOR_OUT_OF_SCOPE",
          "capacity",
          "The pre-M0 readiness validator certifies only the first approved M0 start; an approved start already exists in history, so a successor must be checked by the M0 lifecycle validator"
        );
      }
      const lastHistoryRecord = capacityHistoryRecords[value.history.length - 1];
      if (
        isObject(lastHistoryRecord) &&
        Array.isArray(lastHistoryRecord.eventLog) &&
        !hasCanonicalArrayPrefix(value.eventLog, lastHistoryRecord.eventLog)
      ) {
        addBlocker("CAPACITY_CURRENT_EVENT_PREFIX", "capacity", "The current capacity record does not preserve the last committed event-log prefix");
      }
      if (firstApprovedHistoryIndex >= 0 && isObject(lastHistoryRecord)) {
        validateCapacityEnvelopeTransition(
          lastHistoryRecord,
          value,
          value.predecessorCapacitySha256,
          "capacity current transition"
        );
      }
      if (firstApprovedHistoryIndex < 0) {
        if (value.status === "approved-and-started-m0") {
          if (!isSingleM0StartLog(value.eventLog)) {
            addBlocker(
              "CAPACITY_INITIAL_EVENT_LOG",
              "capacity",
              "The first approved capacity/start record must contain exactly its single bound M0 start event; later lifecycle events belong to versioned successor records and the M0 lifecycle checker"
            );
          }
        } else if (Array.isArray(value.eventLog) && value.eventLog.length !== 0) {
          addBlocker("CAPACITY_PRESTART_EVENTS", "capacity", "A pre-start capacity draft cannot preload lifecycle events");
        }
      } else if (value.status !== "approved-and-started-m0") {
        addBlocker("CAPACITY_CURRENT_STATUS_REGRESSION", "capacity", "The current capacity record regresses to a pre-start status after formal M0 start");
      }
      const expectedCurrentPredecessor =
        value.history.length === 0
          ? null
          : value.history[value.history.length - 1]?.capacitySha256 ?? null;
      if (value.predecessorCapacitySha256 !== expectedCurrentPredecessor) {
        addBlocker(
          "CAPACITY_HISTORY_PREDECESSOR",
          "capacity",
          "predecessorCapacitySha256 must equal the last versioned history entry, or null when history is empty"
        );
      }
      for (const [index, event] of capacityEvents.entries()) {
        if (
          event?.outcome === "new-envelope" &&
          hashPattern.test(event.details?.predecessorCapacitySha256 ?? "") &&
          !capacityHistoryHashes.has(event.details.predecessorCapacitySha256)
        ) {
          addBlocker(
            "CAPACITY_EVENT_ENVELOPE_HISTORY",
            "capacity",
            `capacity.eventLog[${index}] new-envelope predecessor is not present in versioned capacity history`
          );
        }
      }
    }
    if (!Array.isArray(value.blockingReasons) || !value.blockingReasons.every(isNonemptyString)) {
      addBlocker("BLOCKING_REASONS_INVALID", "capacity", "capacity.blockingReasons must contain strings");
    }
    if (value.status === "approved-and-started-m0") {
      if (inventoryReview === null || inventoryReview.status !== "human-approved") {
        addBlocker(
          "CAPACITY_APPROVED_WITHOUT_INVENTORY_REVIEW",
          "capacity",
          "Approved capacity requires the exact bound inventory review to be human-approved"
        );
      }
      if (calibration === null || calibration.status !== "approved") {
        addBlocker(
          "CAPACITY_APPROVED_WITHOUT_CALIBRATION",
          "capacity",
          "Approved capacity requires the exact bound production calibration to be approved"
        );
      } else {
        const acceptedRecords = calibration.counts?.acceptedRecords;
        const expectedRates = {
          implementerMinutesPerAcceptedRecord:
            calibration.activeHumanMinutes?.implementer / acceptedRecords,
          reviewerMinutesPerAcceptedRecord:
            calibration.activeHumanMinutes?.reviewer / acceptedRecords,
          decisionOwnerMinutesPerAcceptedRecord:
            calibration.activeHumanMinutes?.decisionOwnerPerRecordWork / acceptedRecords
        };
        for (const [field, expected] of Object.entries(expectedRates)) {
          if (!approximatelyEqual(value.humanAttention?.[field], expected)) {
            addBlocker(
              "CAPACITY_CALIBRATION_RATE_MISMATCH",
              "capacity",
              `humanAttention.${field} does not derive from the bound calibration`,
              { expected: Number.isFinite(expected) ? expected : null, actual: value.humanAttention?.[field] }
            );
          }
        }
        for (const [capacityField, calibrationField] of [
          ["fixedDecisionOwnerMinutes", "decisionOwnerFixedBatchWork"]
        ]) {
          if (
            !approximatelyEqual(
              value.humanAttention?.[capacityField],
              calibration.activeHumanMinutes?.[calibrationField]
            )
          ) {
            addBlocker(
              "CAPACITY_CALIBRATION_FIXED_MISMATCH",
              "capacity",
              `humanAttention.${capacityField} does not derive from the bound calibration`
            );
          }
        }
        if (
          !approximatelyEqual(
            value.humanAttention?.schemaLinterToolingMinutes,
            calibration.toolingEstimate?.minutes
          )
        ) {
          addBlocker(
            "CAPACITY_CALIBRATION_TOOLING_MISMATCH",
            "capacity",
            "humanAttention.schemaLinterToolingMinutes does not derive from the bound tooling estimate"
          );
        }
        if (
          value.humanAttention?.schemaLinterToolingRole !==
          calibration.toolingEstimate?.responsibleRole
        ) {
          addBlocker(
            "CAPACITY_CALIBRATION_TOOLING_ROLE_MISMATCH",
            "capacity",
            "humanAttention.schemaLinterToolingRole does not derive from the bound tooling estimate"
          );
        }
        if (
          value.humanAttention?.initialSliceRecordCount !==
          calibration.derived?.reviewedInitialSliceRecordCount
        ) {
          addBlocker(
            "CAPACITY_CALIBRATION_COUNT_MISMATCH",
            "capacity",
            "Human-attention record count does not match the bound calibration"
          );
        }
        if (
          !approximatelyEqual(
            value.humanAttention?.contingencyFactor,
            calibration.derived?.contingencyFactor
          )
        ) {
          addBlocker(
            "CAPACITY_CALIBRATION_CONTINGENCY_MISMATCH",
            "capacity",
            "Human-attention contingency factor does not match the bound calibration"
          );
        }
        if (
          !approximatelyEqual(
            value.humanAttention?.allowanceMinutes,
            calibration.derived?.initialSliceHumanAllowanceMinutes
          )
        ) {
          addBlocker(
            "CAPACITY_CALIBRATION_ALLOWANCE_MISMATCH",
            "capacity",
            "Human-attention allowance does not match the bound calibration"
          );
        }
      }
      const requiredValues = [
        value.agentThroughput?.initialSliceRecordCount,
        value.agentThroughput?.allowanceMinutes,
        value.humanAttention?.implementerMinutesPerAcceptedRecord,
        value.humanAttention?.reviewerMinutesPerAcceptedRecord,
        value.humanAttention?.decisionOwnerMinutesPerAcceptedRecord,
        value.humanAttention?.fixedDecisionOwnerMinutes,
        value.humanAttention?.schemaLinterToolingMinutes,
        value.humanAttention?.schemaLinterToolingRole,
        value.humanAttention?.initialSliceRecordCount,
        value.humanAttention?.allowanceMinutes,
        value.m0Envelope?.targetDate,
        value.m0Envelope?.combinedHumanEffortCapHours,
        value.m0Envelope?.committedImplementerHoursPerWeek,
        value.m0Envelope?.committedReviewerHoursPerWeek,
        value.m0Envelope?.committedDecisionOwnerHoursPerWeek,
        value.m2Envelope?.elapsedDurationDays,
        value.m2Envelope?.combinedHumanEffortCapHours,
        value.approval?.registryHumanAllowanceHours,
        value.approval?.otherM0WorkAllowanceHours,
        value.approval?.thresholdCalculationHours
      ];
      if (requiredValues.some((candidate) => candidate === null || candidate === undefined)) {
        addBlocker("CAPACITY_APPROVAL_INCOMPLETE", "capacity", "Approved capacity artifact has unset required values");
      }
      if (Array.isArray(value.blockingReasons) && value.blockingReasons.length > 0) {
        addBlocker("CAPACITY_APPROVAL_BLOCKERS", "capacity", "Approved capacity artifact still lists blocking reasons");
      }
      for (const [location, candidate] of [
        ["m0Envelope.combinedHumanEffortCapHours", value.m0Envelope?.combinedHumanEffortCapHours],
        ["m0Envelope.committedImplementerHoursPerWeek", value.m0Envelope?.committedImplementerHoursPerWeek],
        ["m0Envelope.committedReviewerHoursPerWeek", value.m0Envelope?.committedReviewerHoursPerWeek],
        ["m0Envelope.committedDecisionOwnerHoursPerWeek", value.m0Envelope?.committedDecisionOwnerHoursPerWeek],
        ["m2Envelope.elapsedDurationDays", value.m2Envelope?.elapsedDurationDays],
        ["m2Envelope.combinedHumanEffortCapHours", value.m2Envelope?.combinedHumanEffortCapHours]
      ]) {
        if (!isFiniteNumber(candidate) || candidate <= 0) {
          addBlocker("CAPACITY_APPROVAL_NONPOSITIVE", "capacity", `${location} must be positive when approved`);
        }
      }
      const approval = value.approval;
      if (approval?.planSha256 !== planSha256) {
        addBlocker("CAPACITY_PLAN_HASH_MISMATCH", "capacity", "Capacity approval must bind the exact current plan bytes");
      }
      if (approval?.rolesSha256 !== rolesArtifact?.sha256) {
        addBlocker("CAPACITY_ROLES_HASH_MISMATCH", "capacity", "Capacity approval must bind the exact current role-assignment bytes");
      }
      if (approval?.inventoryReviewSha256 !== inventoryReviewArtifact?.sha256) {
        addBlocker("CAPACITY_INVENTORY_REVIEW_HASH_MISMATCH", "capacity", "Capacity approval must bind the exact approved inventory-review bytes");
      }
      if (approval?.calibrationSha256 !== calibrationArtifact?.sha256) {
        addBlocker("CAPACITY_CALIBRATION_HASH_MISMATCH", "capacity", "Capacity approval must bind the exact approved calibration bytes");
      }
      if (approval?.profileRegistrySha256 !== profilesArtifact?.sha256) {
        addBlocker("CAPACITY_PROFILE_HASH_MISMATCH", "capacity", "Capacity approval must bind the exact approved profile-registry bytes");
      }
      if (approval?.bootstrapRequirementsSha256 !== bootstrapArtifact?.sha256) {
        addBlocker("CAPACITY_BOOTSTRAP_HASH_MISMATCH", "capacity", "Capacity approval must bind the exact approved bootstrap-requirements bytes");
      }
      if (approval?.selectionRecordSha256 !== selectionArtifact?.sha256) {
        addBlocker("CAPACITY_SELECTION_HASH_MISMATCH", "capacity", "Capacity approval must bind the exact approved profile-selection bytes");
      }
      if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(approval?.approvalCommit ?? "")) {
        addBlocker("CAPACITY_APPROVAL_COMMIT_MISSING", "capacity", "Approved capacity requires an approval commit hash");
      } else {
        const commit = approval.approvalCommit;
        const commitCheck = spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
          cwd: projectDirectory,
          encoding: "utf8"
        });
        if (commitCheck.error || commitCheck.status !== 0) {
          addBlocker("CAPACITY_APPROVAL_COMMIT_UNRESOLVED", "capacity", "approvalCommit does not resolve to a local commit", {
            commit,
            error: String(commitCheck.error?.message ?? commitCheck.stderr ?? "commit not found").trim().slice(0, 500)
          });
        } else {
          const shallowCheck = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
            cwd: projectDirectory,
            encoding: "utf8"
          });
          if (
            shallowCheck.error ||
            shallowCheck.status !== 0 ||
            shallowCheck.stdout.trim() !== "false"
          ) {
            addBlocker(
              "CAPACITY_GIT_HISTORY_INCOMPLETE",
              "capacity",
              "Formal M0 start certification requires a non-shallow repository with complete local ancestry"
            );
          }
          const ancestryCheck = spawnSync(
            "git",
            ["merge-base", "--is-ancestor", commit, "HEAD"],
            { cwd: projectDirectory, encoding: "utf8" }
          );
          if (ancestryCheck.error || ancestryCheck.status !== 0) {
            addBlocker(
              "CAPACITY_APPROVAL_COMMIT_NOT_ANCESTOR",
              "capacity",
              "The checked-out start-record commit must descend from approvalCommit"
            );
          }
          const capacityPathAtCommit = relativePath(paths.capacity);
          const readCapacityAtCommit = (revision) => {
            const result = spawnSync("git", ["show", `${revision}:${capacityPathAtCommit}`], {
              cwd: projectDirectory,
              encoding: null,
              maxBuffer: 64 * 1024 * 1024
            });
            if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
            try {
              return {
                bytes: result.stdout,
                sha256: sha256Bytes(result.stdout),
                value: JSON.parse(result.stdout.toString("utf8"))
              };
            } catch {
              return { bytes: result.stdout, sha256: sha256Bytes(result.stdout), value: null };
            }
          };
          const approvalCapacity = readCapacityAtCommit(commit);
          if (approvalCapacity === null || !isObject(approvalCapacity.value)) {
            addBlocker(
              "CAPACITY_APPROVAL_COMMIT_PRESTART_MISSING",
              "capacity",
              "approvalCommit must contain a readable pre-start capacity record"
            );
          } else if (exactKeys(approvalCapacity.value, capacityRootFields, "capacity", "approvalCommit.capacity")) {
            if (
              approvalCapacity.value.status === "approved-and-started-m0" ||
              !Array.isArray(approvalCapacity.value.eventLog) ||
              approvalCapacity.value.eventLog.length !== 0
            ) {
              addBlocker(
                "CAPACITY_APPROVAL_COMMIT_ALREADY_STARTED",
                "capacity",
                "approvalCommit capacity snapshot must be genuinely pre-start with an empty event log"
              );
            } else if (![
              "blocked-pending-human-calibration-and-capacity",
              "blocked-pending-human-calibration-and-inventory"
            ].includes(approvalCapacity.value.status)) {
              addBlocker(
                "CAPACITY_APPROVAL_COMMIT_PRESTART_STATUS",
                "capacity",
                "approvalCommit capacity snapshot has an unrecognized pre-start status"
              );
            }
            if (approvalCapacity.value.approval?.approvalCommit !== null) {
              addBlocker(
                "CAPACITY_APPROVAL_COMMIT_SELF_BINDING",
                "capacity",
                "The pre-start approvalCommit snapshot must leave approval.approvalCommit null until the atomic start commit binds it"
              );
            }
            const startProjection = (record) => {
              const {
                status: ignoredStatus,
                eventLog: ignoredEvents,
                blockingReasons: ignoredBlockers,
                predecessorCapacitySha256: ignoredPredecessor,
                history: ignoredHistory,
                ...rest
              } = record;
              return {
                ...rest,
                approval: {
                  ...rest.approval,
                  approvalCommit: null
                }
              };
            };
            if (
              canonicalJson(startProjection(approvalCapacity.value)) !==
              canonicalJson(startProjection(value))
            ) {
              addBlocker(
                "CAPACITY_START_DIFFERS_FROM_APPROVED_SNAPSHOT",
                "capacity",
                "The atomic first-start record changes fields beyond status, approvalCommit binding, the single start event, and cleared blocking reasons"
              );
            }
          }

          const earlierCapacityCommits = spawnSync(
            "git",
            ["log", "--format=%H", commit, "--", capacityPathAtCommit],
            { cwd: projectDirectory, encoding: "utf8" }
          );
          if (earlierCapacityCommits.error || earlierCapacityCommits.status !== 0) {
            addBlocker("CAPACITY_PRESTART_HISTORY_UNREADABLE", "capacity", "Cannot inspect capacity history at or before approvalCommit");
          } else {
            for (const revision of earlierCapacityCommits.stdout.split(/\r?\n/).filter(Boolean)) {
              const snapshot = readCapacityAtCommit(revision);
              if (snapshot?.value?.status === "approved-and-started-m0") {
                addBlocker(
                  "CAPACITY_START_PREDATES_APPROVAL_COMMIT",
                  "capacity",
                  "A committed approved M0 start already exists at or before approvalCommit; this is not the first formal start",
                  { revision }
                );
                break;
              }
            }
          }

          const descendantCapacityCommits = spawnSync(
            "git",
            ["rev-list", "--ancestry-path", "--reverse", `${commit}..HEAD`, "--", capacityPathAtCommit],
            { cwd: projectDirectory, encoding: "utf8" }
          );
          if (descendantCapacityCommits.error || descendantCapacityCommits.status !== 0) {
            addBlocker("CAPACITY_START_ANCESTRY_UNREADABLE", "capacity", "Cannot inspect capacity commits from approvalCommit through HEAD");
          } else {
            let sawApprovedCapacity = false;
            const descendantRevisions = descendantCapacityCommits.stdout.split(/\r?\n/).filter(Boolean);
            if (descendantRevisions.length !== 1) {
              addBlocker(
                "CAPACITY_START_NOT_ATOMIC_IN_GIT",
                "capacity",
                "Exactly one capacity-changing commit may occur after approvalCommit: the atomic first-start record",
                { capacityChangingCommits: descendantRevisions }
              );
            }
            for (const revision of descendantRevisions) {
              const snapshot = readCapacityAtCommit(revision);
              if (snapshot === null || !isObject(snapshot.value)) {
                addBlocker("CAPACITY_START_ANCESTRY_SNAPSHOT", "capacity", "A capacity-changing descendant commit has unreadable capacity bytes", { revision });
                continue;
              }
              if (snapshot.value.status === "approved-and-started-m0") {
                sawApprovedCapacity = true;
                if (snapshot.sha256 !== capacityArtifact?.sha256) {
                  addBlocker(
                    "CAPACITY_APPROVED_BLOB_CHANGED_AFTER_START",
                    "capacity",
                    "The first committed approved capacity/start blob after approvalCommit differs from the exact blob at HEAD",
                    { revision, expected: capacityArtifact?.sha256 ?? null, actual: snapshot.sha256 }
                  );
                }
              } else {
                if (sawApprovedCapacity) {
                  addBlocker(
                    "CAPACITY_GIT_STATUS_REGRESSION",
                    "capacity",
                    "Git history regresses to a pre-start capacity record after the first approved start",
                    { revision }
                  );
                } else if (
                  ![
                    "blocked-pending-human-calibration-and-capacity",
                    "blocked-pending-human-calibration-and-inventory"
                  ].includes(snapshot.value.status) ||
                  !Array.isArray(snapshot.value.eventLog) ||
                  snapshot.value.eventLog.length !== 0
                ) {
                  addBlocker(
                    "CAPACITY_INTERMEDIATE_PRESTART_INVALID",
                    "capacity",
                    "Every capacity-changing commit before the first approved start must remain a recognized pre-start record with an empty event log",
                    { revision }
                  );
                }
              }
            }
            if (!sawApprovedCapacity) {
              addBlocker(
                "CAPACITY_FIRST_START_COMMIT_MISSING",
                "capacity",
                "No committed first approved capacity/start blob exists after approvalCommit"
              );
            }
          }
          const committedInputs = [
            [relativePath(paths.plan), approval.planSha256],
            [relativePath(paths.roles), approval.rolesSha256],
            [inventoryReviewArtifact?.path ? relativePath(inventoryReviewArtifact.path) : null, approval.inventoryReviewSha256],
            [calibrationArtifact?.path ? relativePath(calibrationArtifact.path) : null, approval.calibrationSha256],
            [relativePath(paths.profiles), approval.profileRegistrySha256],
            [relativePath(paths.bootstrap), approval.bootstrapRequirementsSha256],
            [relativePath(paths.selection), approval.selectionRecordSha256],
            ...otherM0WorkEvidenceArtifacts.map((artifact) => [
              relativePath(artifact.path),
              artifact.sha256
            ]),
            ...calibrationBoundArtifacts.map((artifact) => [
              relativePath(artifact.path),
              artifact.sha256
            ]),
            ...[
              bootstrapMarkerSchemaArtifact,
              bootstrapMarkerArtifact,
              bootstrapLinterArtifact,
              ...bootstrapLinterDependencyArtifacts
            ]
              .filter((artifact) => artifact !== null)
              .map((artifact) => [relativePath(artifact.path), artifact.sha256]),
            ...(inventory?.inventoryFiles ?? []).map((file) => [file.path, file.sha256])
          ];
          if (isObject(calibration?.toolingEstimate?.evidence)) {
            committedInputs.push([
              relativePath(resolve(directory, calibration.toolingEstimate.evidence.path)),
              calibration.toolingEstimate.evidence.sha256
            ]);
          }
          for (const artifactPath of [
            "pre-m0/validate-artifacts.mjs",
            "pre-m0/readiness.mjs",
            "pre-m0/validate.mjs",
            "pre-m0/inventory.schema.json",
            "pre-m0/inventory-review.schema.json",
            "pre-m0/bootstrap.requirements.schema.json",
            "pre-m0/requirement-markers.schema.json",
            "pre-m0/production-calibration-record.schema.json",
            "pre-m0/production-calibration-timer-log.schema.json",
            "pre-m0/tooling-estimate-evidence.schema.json",
            "pre-m0/capacity-record.schema.json",
            "pre-m0/roles.schema.json",
            "pre-m0/release-profiles.schema.json",
            "pre-m0/selection-record.schema.json"
          ]) {
            const absolutePath = join(projectDirectory, artifactPath);
            if (!existsSync(absolutePath)) {
              addBlocker("CAPACITY_APPROVAL_STATIC_INPUT_MISSING", "capacity", `Missing frozen approval input ${artifactPath}`);
            } else {
              committedInputs.push([artifactPath, sha256Bytes(readFileSync(absolutePath))]);
            }
          }
          const uniqueCommittedInputs = new Map();
          for (const [artifactPath, expectedSha256] of committedInputs) {
            if (!isNonemptyString(artifactPath) || !hashPattern.test(expectedSha256 ?? "")) continue;
            if (
              uniqueCommittedInputs.has(artifactPath) &&
              uniqueCommittedInputs.get(artifactPath) !== expectedSha256
            ) {
              addBlocker("CAPACITY_APPROVAL_INPUT_CONFLICT", "capacity", `Conflicting hashes for frozen input ${artifactPath}`);
            } else {
              uniqueCommittedInputs.set(artifactPath, expectedSha256);
            }
          }
          for (const [artifactPath, expectedSha256] of uniqueCommittedInputs) {
            const committedBytes = spawnSync("git", ["show", `${commit}:${artifactPath}`], {
              cwd: projectDirectory,
              encoding: null,
              maxBuffer: 64 * 1024 * 1024
            });
            if (committedBytes.error || committedBytes.status !== 0 || !Buffer.isBuffer(committedBytes.stdout)) {
              addBlocker("CAPACITY_APPROVAL_COMMIT_ARTIFACT_MISSING", "capacity", `approvalCommit does not contain ${artifactPath}`, {
                commit,
                error: String(committedBytes.error?.message ?? committedBytes.stderr ?? "artifact missing").trim().slice(0, 500)
              });
              continue;
            }
            const committedSha256 = sha256Bytes(committedBytes.stdout);
            if (committedSha256 !== expectedSha256) {
              addBlocker("CAPACITY_APPROVAL_COMMIT_HASH_MISMATCH", "capacity", `approvalCommit contains different bytes for ${artifactPath}`, {
                commit,
                expected: expectedSha256,
                actual: committedSha256
              });
            }
          }
        }
      }
      const committedCapacity = spawnSync(
        "git",
        ["show", `HEAD:${relativePath(paths.capacity)}`],
        { cwd: projectDirectory, encoding: null, maxBuffer: 64 * 1024 * 1024 }
      );
      if (
        committedCapacity.error ||
        committedCapacity.status !== 0 ||
        !Buffer.isBuffer(committedCapacity.stdout) ||
        sha256Bytes(committedCapacity.stdout) !== capacityArtifact?.sha256
      ) {
        addBlocker(
          "CAPACITY_START_RECORD_UNCOMMITTED",
          "capacity",
          "Approved-and-started M0 requires the exact current capacity/start record to be committed at HEAD"
        );
      }
      if (!isStrictIsoTimestamp(approval?.approvedAt)) {
        addBlocker("CAPACITY_APPROVAL_TIME_MISSING", "capacity", "Approved capacity requires a strict approval timestamp");
      }
      for (const field of ["startEvent", "ledgerSource"]) {
        if (!isNonemptyString(approval?.[field])) {
          addBlocker("CAPACITY_APPROVAL_METADATA_MISSING", "capacity", `Approved capacity requires approval.${field}`);
        }
      }
      if (!Array.isArray(approval?.countedWorkCategories) || approval.countedWorkCategories.length === 0) {
        addBlocker("CAPACITY_WORK_CATEGORIES_EMPTY", "capacity", "Approved capacity requires counted work categories");
      }
      if (!Array.isArray(approval?.otherM0WorkItems) || approval.otherM0WorkItems.length === 0) {
        addBlocker("CAPACITY_OTHER_M0_ITEMS_EMPTY", "capacity", "Approved capacity requires a nonempty itemized estimate for all other M0 work");
      } else if (otherM0WorkEvidenceArtifacts.length !== approval.otherM0WorkItems.length) {
        addBlocker("CAPACITY_OTHER_M0_EVIDENCE_INCOMPLETE", "capacity", "Every other-M0 work item requires an exact readable evidence binding");
      }
      if (approval?.humanReviewer !== roles?.humanReviewer?.name) {
        addBlocker("CAPACITY_REVIEWER_ROLE_MISMATCH", "capacity", "Capacity reviewer approval does not match the named human reviewer");
      }
      if (approval?.humanDecisionOwner !== roles?.humanDecisionOwner?.name) {
        addBlocker("CAPACITY_OWNER_ROLE_MISMATCH", "capacity", "Capacity decision-owner approval does not match the named human decision owner");
      }
      const startEvents = capacityEvents.filter(
        (event) => event?.kind === "start" && event?.gate === "M0"
      );
      if (startEvents.length !== 1) {
        addBlocker("CAPACITY_START_EVENT_COUNT", "capacity", "Approved-and-started M0 capacity requires exactly one M0 start event");
      } else {
        const startEvent = startEvents[0];
        if (approval?.startEvent !== startEvent.id) {
          addBlocker("CAPACITY_START_EVENT_ID", "capacity", "approval.startEvent must name the exact M0 start event");
        }
        if (approval?.approvedAt !== startEvent.recordedAt) {
          addBlocker("CAPACITY_START_EVENT_TIME", "capacity", "M0 start event time must equal capacity approval time");
        }
        if (capacityEvents[0] !== startEvent) {
          addBlocker("CAPACITY_START_EVENT_ORDER", "capacity", "The M0 start event must be the first capacity event");
        }
        const startArtifacts = new Map(
          (Array.isArray(startEvent.artifacts) ? startEvent.artifacts : []).map(
            (artifact) => [artifact?.label, artifact?.sha256]
          )
        );
        for (const [label, expectedSha256] of [
          ["plan", approval?.planSha256],
          ["roles", approval?.rolesSha256],
          ["inventory-review", approval?.inventoryReviewSha256],
          ["calibration", approval?.calibrationSha256],
          ["profile-registry", approval?.profileRegistrySha256],
          ["bootstrap-requirements", approval?.bootstrapRequirementsSha256],
          ["selection-record", approval?.selectionRecordSha256]
        ]) {
          if (startArtifacts.get(label) !== expectedSha256) {
            addBlocker("CAPACITY_START_EVENT_ARTIFACT", "capacity", `M0 start event must attach the approved ${label} hash`);
          }
        }
      }
      const registryAllowanceHours = value.humanAttention?.allowanceMinutes / 60;
      if (!approximatelyEqual(approval?.registryHumanAllowanceHours, registryAllowanceHours)) {
        addBlocker("CAPACITY_REGISTRY_ALLOWANCE_MISMATCH", "capacity", "Capacity approval registry allowance does not match the calibrated human allowance");
      }
      if (
        !isFiniteNumber(approval?.otherM0WorkAllowanceHours) ||
        approval.otherM0WorkAllowanceHours <= 0 ||
        !isFiniteNumber(otherM0WorkItemHours) ||
        !approximatelyEqual(approval.otherM0WorkAllowanceHours, otherM0WorkItemHours)
      ) {
        addBlocker("CAPACITY_OTHER_M0_ALLOWANCE_MISMATCH", "capacity", "Other-M0 allowance must be positive and equal the itemized estimate total", {
          expected: Number.isFinite(otherM0WorkItemHours) ? otherM0WorkItemHours : null,
          actual: approval?.otherM0WorkAllowanceHours ?? null
        });
      }
      const thresholdHours = approval?.registryHumanAllowanceHours + approval?.otherM0WorkAllowanceHours;
      if (!Number.isFinite(thresholdHours) || !approximatelyEqual(approval?.thresholdCalculationHours, thresholdHours)) {
        addBlocker("CAPACITY_THRESHOLD_MISMATCH", "capacity", "Capacity threshold does not equal registry plus other-M0 allowances");
      }
      if (
        Number.isFinite(value.m0Envelope?.combinedHumanEffortCapHours) &&
        Number.isFinite(thresholdHours) &&
        value.m0Envelope.combinedHumanEffortCapHours < thresholdHours
      ) {
        addBlocker("M0_CAP_BELOW_THRESHOLD", "capacity", "M0 combined-human-effort cap is below the checked threshold calculation");
      }
      if (isStrictIsoTimestamp(approval?.approvedAt) && isValidCalendarDate(value.m0Envelope?.targetDate)) {
        const approvedDate = new Date(approval.approvedAt);
        const targetDate = new Date(`${value.m0Envelope.targetDate}T23:59:59Z`);
        const availableWeeks = (targetDate.getTime() - approvedDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
        if (!(availableWeeks > 0)) {
          addBlocker("M0_TARGET_NOT_AFTER_APPROVAL", "capacity", "M0 target date must be after capacity approval");
        } else if (calibration?.status === "approved") {
          const count = value.humanAttention.initialSliceRecordCount;
          const contingency = value.humanAttention.contingencyFactor;
          const requiredHours = {
            committedImplementerHoursPerWeek:
              (value.humanAttention.implementerMinutesPerAcceptedRecord * count * contingency) /
                60 +
              otherM0WorkHoursByRole.productionImplementer,
            committedReviewerHoursPerWeek:
              (value.humanAttention.reviewerMinutesPerAcceptedRecord * count * contingency) /
                60 +
              otherM0WorkHoursByRole.humanReviewer,
            committedDecisionOwnerHoursPerWeek:
              (value.humanAttention.decisionOwnerMinutesPerAcceptedRecord * count * contingency +
                value.humanAttention.fixedDecisionOwnerMinutes) /
                60 +
              otherM0WorkHoursByRole.humanDecisionOwner
          };
          const toolingCommitmentField = {
            productionImplementer: "committedImplementerHoursPerWeek",
            humanReviewer: "committedReviewerHoursPerWeek",
            humanDecisionOwner: "committedDecisionOwnerHoursPerWeek"
          }[value.humanAttention.schemaLinterToolingRole];
          if (toolingCommitmentField !== undefined) {
            requiredHours[toolingCommitmentField] +=
              value.humanAttention.schemaLinterToolingMinutes / 60;
          }
          for (const [commitmentField, required] of Object.entries(requiredHours)) {
            const available = value.m0Envelope?.[commitmentField] * availableWeeks;
            if (!Number.isFinite(available) || available < required) {
              addBlocker("M0_ROLE_CAPACITY_INSUFFICIENT", "capacity", `${commitmentField} cannot cover its calibrated registry allowance before the target date`, {
                requiredHours: required,
                availableHours: Number.isFinite(available) ? available : null
              });
            }
          }
        }
      }
    } else {
      addBlocker("CAPACITY_UNAPPROVED", "capacity", `Capacity record is not approved: ${value.status}`);
    }
    if (value.agentThroughput?.initialSliceRecordCount === null) {
      addBlocker("AGENT_COUNT_UNSET", "capacity", "Agent initial-slice inventory count is unset");
    }
    if (value.agentThroughput?.allowanceMinutes === null) {
      addBlocker("AGENT_ALLOWANCE_UNSET", "capacity", "Agent throughput allowance is unset");
    }
    if (value.humanAttention?.initialSliceRecordCount === null) {
      addBlocker("HUMAN_COUNT_UNSET", "capacity", "Human initial-slice inventory count is unset");
    }
    if (value.humanAttention?.allowanceMinutes === null) {
      addBlocker("HUMAN_ALLOWANCE_UNSET", "capacity", "Human-attention allowance is unset");
    }
    if (value.m0Envelope?.combinedHumanEffortCapHours === null) {
      addBlocker("M0_CAP_UNSET", "capacity", "M0 combined-human-effort cap is unset");
    }
    for (const [code, candidate, message] of [
      ["M0_TARGET_DATE_UNSET", value.m0Envelope?.targetDate, "M0 target date is unset"],
      ["M0_IMPLEMENTER_COMMITMENT_UNSET", value.m0Envelope?.committedImplementerHoursPerWeek, "M0 implementer weekly commitment is unset"],
      ["M0_REVIEWER_COMMITMENT_UNSET", value.m0Envelope?.committedReviewerHoursPerWeek, "M0 reviewer weekly commitment is unset"],
      ["M0_DECISION_OWNER_COMMITMENT_UNSET", value.m0Envelope?.committedDecisionOwnerHoursPerWeek, "M0 decision-owner weekly commitment is unset"],
      ["M2_DURATION_UNSET", value.m2Envelope?.elapsedDurationDays, "M2 elapsed-duration cap is unset"],
      ["M2_CAP_UNSET", value.m2Envelope?.combinedHumanEffortCapHours, "M2 combined-human-effort cap is unset"]
    ]) {
      if (candidate === null || candidate === undefined) addBlocker(code, "capacity", message);
    }
    for (const field of [
      "planSha256",
      "rolesSha256",
      "inventoryReviewSha256",
      "calibrationSha256",
      "profileRegistrySha256",
      "bootstrapRequirementsSha256",
      "selectionRecordSha256"
    ]) {
      if (value.approval?.[field] === null || value.approval?.[field] === undefined) {
        addBlocker(
          "CAPACITY_APPROVAL_HASH_UNSET",
          "capacity",
          `Capacity approval binding is unset: approval.${field}`
        );
      }
    }
    for (const field of [
      "approvalCommit",
      "approvedAt",
      "startEvent",
      "ledgerSource",
      "humanReviewer",
      "humanDecisionOwner"
    ]) {
      if (!isNonemptyString(value.approval?.[field])) {
        addBlocker(
          "CAPACITY_APPROVAL_METADATA_UNSET",
          "capacity",
          `Capacity approval metadata is unset: approval.${field}`
        );
      }
    }
    if (!Array.isArray(value.approval?.countedWorkCategories) || value.approval.countedWorkCategories.length === 0) {
      addBlocker("CAPACITY_WORK_CATEGORIES_UNSET", "capacity", "Capacity counted-work categories are unset");
    }
    if (!Array.isArray(value.approval?.otherM0WorkItems) || value.approval.otherM0WorkItems.length === 0) {
      addBlocker("CAPACITY_OTHER_M0_ITEMS_UNSET", "capacity", "Itemized estimates for all other M0 work are unset");
    }
    for (const field of [
      "registryHumanAllowanceHours",
      "otherM0WorkAllowanceHours",
      "thresholdCalculationHours"
    ]) {
      if (value.approval?.[field] === null || value.approval?.[field] === undefined) {
        addBlocker(
          "CAPACITY_APPROVAL_ALLOWANCE_UNSET",
          "capacity",
          `Capacity approval allowance is unset: approval.${field}`
        );
      }
    }
    if (
      isFiniteNumber(value.humanAttention?.allowanceMinutes) &&
      isFiniteNumber(value.m0Envelope?.combinedHumanEffortCapHours) &&
      value.m0Envelope.combinedHumanEffortCapHours * 60 < value.humanAttention.allowanceMinutes
    ) {
      addBlocker(
        "M0_CAP_BELOW_HUMAN_ALLOWANCE",
        "capacity",
        "M0 combined-human-effort cap does not contain the computed human registry allowance",
        {
          capMinutes: value.m0Envelope.combinedHumanEffortCapHours * 60,
          allowanceMinutes: value.humanAttention.allowanceMinutes
        }
      );
    }
    requireNamedRolesForApproval("capacity", value.status, "approved-and-started-m0");
  }
}

if (bootstrap?.status === "bootstrap-approved" && profiles?.status !== "approved") {
  addBlocker(
    "BOOTSTRAP_APPROVED_WITHOUT_PROFILE_REGISTRY",
    "cross-file",
    "Approved bootstrap requirements require an approved profile registry"
  );
}
if (selection?.status === "approved") {
  if (bootstrap?.status !== "bootstrap-approved") {
    addBlocker(
      "SELECTION_APPROVED_WITHOUT_BOOTSTRAP",
      "cross-file",
      "Approved selection requires approved bootstrap requirements"
    );
  }
  if (profiles?.status !== "approved") {
    addBlocker(
      "SELECTION_APPROVED_WITHOUT_PROFILES",
      "cross-file",
      "Approved selection requires an approved profile registry"
    );
  }
}

const artifactSummary = (artifact, status = undefined) => ({
  path: artifact?.path ? relativePath(artifact.path) : null,
  present: artifact !== null,
  sha256: artifact?.sha256 ?? null,
  status: status ?? null
});

const formalM0Started =
  blockers.length === 0 && capacity?.status === "approved-and-started-m0";
const output = {
  formatVersion: 1,
  status: formalM0Started ? "formal-m0-started-and-valid" : "pre-m0-blocked",
  formalM0Started,
  assertionMode: assertReady,
  plan: {
    path: relativePath(paths.plan),
    sha256: planSha256,
    lineCount: planLines.length
  },
  artifacts: {
    roles: artifactSummary(rolesArtifact, roles?.status),
    capacity: artifactSummary(capacityArtifact, capacity?.status),
    calibration: artifactSummary(calibrationArtifact, calibration?.status),
    inventoryReview: artifactSummary(inventoryReviewArtifact, inventoryReview?.status),
    bootstrap: artifactSummary(bootstrapArtifact, bootstrap?.status),
    profiles: artifactSummary(profilesArtifact, profiles?.status),
    selection: artifactSummary(selectionArtifact, selection?.status),
    inventory: inventory === null
      ? { status: "invalid-or-unavailable", anticipatedInitialRecords: null }
      : {
          status: inventory.status,
          planSha256: inventory.planSha256,
          anticipatedInitialRecords: inventory.anticipatedInitialRecords,
          totalBlocks: inventory.totalBlocks
        }
  },
  checks: {
    bootstrapRequirementCount: bootstrap?.requirements?.length ?? null,
    uniqueBootstrapRequirementIds: requirementIds.size,
    uniqueCandidateEvidenceIds: evidenceIds.size,
    selectedProfileIds: [...selectedProfileIds].sort(),
    validatedInventoryInitialRecordCount: inventory?.anticipatedInitialRecords ?? null,
    validatedInventoryM0FrontierRecordCount:
      inventory?.initialRecordFrontierMemberships?.M0 ?? null,
    blockerCount: blockers.length
  },
  blockers
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (assertReady && blockers.length > 0) process.exitCode = 2;
