import { existsSync } from "node:fs";
import path from "node:path";
import {
  getSourceControlState,
  historicalEvidenceFingerprint,
  loadOperationalSource,
  logicalFingerprint,
  sanitizeError,
  writeMigrationReport,
} from "./operational-data.mjs";
import {
  buildRelationalRows,
  importOperationalRows,
  loadOwnerMapping,
  validateImportedRows,
} from "./operational-database.mjs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const startedAt = new Date().toISOString();
const options = parseArguments(process.argv.slice(2));
let report = {
  migrationVersion: 6,
  mode: options.mode,
  result: "fail",
  startedAt,
  completedAt: startedAt,
  sourceControl: null,
  sourceFiles: [],
  rawCounts: {},
  projectedCounts: {},
  importedCounts: null,
  preservedIdentifiers: {},
  projection: null,
  historicalEvidence: null,
  ownerMapping: null,
  validations: [],
  logicalFingerprint: null,
  error: null,
};

try {
  if (options.requireOwnerMap && !options.ownerMapPath) {
    throw new Error("Production-safe import requires --owner-map. Use --allow-missing-owner-map only for isolated test imports.");
  }

  const [source, sourceControl] = await Promise.all([
    loadOperationalSource({
      sourceDirectory: options.sourceDirectory,
      projectionManifestPath: options.projectionManifestPath,
      allowRuntimeProjection: options.allowRuntimeProjection,
    }),
    getSourceControlState(),
  ]);
  const ownerMapping = await loadOwnerMapping(options.ownerMapPath, source.data.projects);
  const rows = buildRelationalRows(source.data, ownerMapping.rows);
  const sourceHistoryFingerprint = historicalEvidenceFingerprint(source.raw);
  const projectedHistoryFingerprint = historicalEvidenceFingerprint(source.data);
  if (sourceHistoryFingerprint !== projectedHistoryFingerprint) {
    throw new Error("Runtime projection changed historical Gate Review evidence.");
  }

  const expectedFingerprint = logicalFingerprint(rows);
  report = {
    ...report,
    sourceControl,
    sourceFiles: source.inventory,
    rawCounts: source.rawCounts,
    projectedCounts: {
      ...source.projectedCounts,
      projectMemberships: ownerMapping.rows.length,
    },
    preservedIdentifiers: collectIdentifiers(source.data),
    projection: source.projection,
    historicalEvidence: {
      sourceSha256: sourceHistoryFingerprint,
      projectedSha256: projectedHistoryFingerprint,
      exactMatch: true,
    },
    ownerMapping: {
      required: options.requireOwnerMap,
      supplied: ownerMapping.rows.length > 0,
      projectIds: ownerMapping.source?.projectIds ?? [],
      userIds: ownerMapping.source?.userIds ?? [],
    },
    validations: [
      ...source.validations,
      {
        name: "historical-gate-review-evidence",
        status: "pass",
        details: "Historical snapshots, responses and invitation attempts were not normalized.",
      },
      {
        name: "runtime-projection-allowlist",
        status: "pass",
        details: `${source.projection.summary.addedCriteria} Criteria, ${source.projection.summary.templateVersionUpdates} template versions and ${source.projection.summary.legacyNameUpdates} legacy names matched the approved projection.`,
      },
    ],
    logicalFingerprint: expectedFingerprint,
  };

  if (options.mode === "import" || options.mode === "validate") {
    const connectionString = process.env.OPERATIONAL_DATABASE_URL?.trim();
    const expectedDatabase = process.env.OPERATIONAL_EXPECTED_DATABASE?.trim();
    const databaseRole = process.env.OPERATIONAL_DATABASE_ROLE?.trim();
    if (!connectionString) {
      throw new Error("OPERATIONAL_DATABASE_URL is required for import and validation.");
    }
    if (!expectedDatabase) {
      throw new Error("OPERATIONAL_EXPECTED_DATABASE is required for import and validation.");
    }

    if (options.mode === "import") {
      const completedAt = new Date().toISOString();
      await importOperationalRows({
        connectionString,
        expectedDatabase,
        databaseRole,
        rows,
        importRecord: {
          sourceCommit: sourceControl.commit,
          sourceWorktreeDirty: sourceControl.worktreeDirty,
          sourceManifest: {
            files: source.inventory,
            rawCounts: source.rawCounts,
            projectedCounts: source.projectedCounts,
            historicalEvidenceSha256: sourceHistoryFingerprint,
            worktreeFingerprint: sourceControl.worktreeFingerprint,
          },
          projectionManifest: source.projection,
          logicalFingerprint: expectedFingerprint,
          startedAt,
          completedAt,
        },
      });
      report.validations.push({
        name: "transactional-import",
        status: "pass",
        details: "All operational rows committed in one transaction.",
      });
    }

    const databaseValidation = await validateImportedRows({
      connectionString,
      expectedDatabase,
      databaseRole,
      expectedRows: rows,
    });
    if (databaseValidation.logicalFingerprint !== expectedFingerprint) {
      throw new Error("Imported database logical fingerprint does not match the source projection.");
    }
    report.importedCounts = {
      ...databaseValidation.counts,
      frozenCriteria: report.projectedCounts.frozenCriteria,
      frozenDeliverables: report.projectedCounts.frozenDeliverables,
      frozenAcceptedActions: report.projectedCounts.frozenAcceptedActions,
      frozenDocuments: report.projectedCounts.frozenDocuments,
      frozenBaselines: report.projectedCounts.frozenBaselines,
    };
    report.validations.push({
      name: "database-domain-projection",
      status: "pass",
      details: "PostgreSQL rows reproduce the approved effective operational domain state.",
    });
  } else {
    report.importedCounts = null;
    report.validations.push({
      name: "dry-run",
      status: "pass",
      details: "No database writes were attempted.",
    });
  }

  report.result = "pass";
  report.completedAt = new Date().toISOString();
  report.error = null;
  const paths = await writeMigrationReport(report, options.reportDirectory);
  console.log(`${options.mode} passed`);
  console.log(`logical fingerprint ${report.logicalFingerprint}`);
  console.log(`JSON report ${paths.jsonPath}`);
  console.log(`Markdown report ${paths.markdownPath}`);
} catch (error) {
  report.result = "fail";
  report.completedAt = new Date().toISOString();
  report.error = sanitizeError(error);
  try {
    const paths = await writeMigrationReport(report, options.reportDirectory);
    console.error(`${options.mode} failed: ${report.error}`);
    console.error(`JSON report ${paths.jsonPath}`);
    console.error(`Markdown report ${paths.markdownPath}`);
  } catch (reportError) {
    console.error(`${options.mode} failed: ${report.error}`);
    console.error(`The failure report could not be written: ${sanitizeError(reportError)}`);
  }
  process.exitCode = 1;
}

function parseArguments(args) {
  const modes = ["dry-run", "import", "validate"].filter((mode) => args.includes(`--${mode}`));
  if (modes.length !== 1) {
    throw new Error("Choose exactly one mode: --dry-run, --import, or --validate.");
  }

  const value = (name, fallback) => {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    const result = args[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
    return path.resolve(result);
  };
  const allowed = new Set([
    "--dry-run",
    "--import",
    "--validate",
    "--allow-runtime-projection",
    "--allow-missing-owner-map",
    "--owner-map",
    "--source-dir",
    "--report-dir",
    "--projection-manifest",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!allowed.has(argument)) throw new Error(`Unknown argument ${argument}.`);
    if (["--owner-map", "--source-dir", "--report-dir", "--projection-manifest"].includes(argument)) {
      index += 1;
    }
  }

  const allowMissingOwnerMap = args.includes("--allow-missing-owner-map");
  return {
    mode: modes[0],
    allowRuntimeProjection: args.includes("--allow-runtime-projection"),
    sourceDirectory: value("--source-dir", path.join(process.cwd(), ".data")),
    reportDirectory: value("--report-dir", path.join(process.cwd(), ".migration-reports")),
    projectionManifestPath: value(
      "--projection-manifest",
      path.join(process.cwd(), "database", "operational-runtime-projection-v1.json"),
    ),
    ownerMapPath: value("--owner-map", null),
    requireOwnerMap: !allowMissingOwnerMap,
  };
}

function collectIdentifiers(source) {
  const gates = [
    ...source.projects.flatMap((project) => project.gates),
    ...source.packages.flatMap((projectPackage) => projectPackage.gates),
  ];
  const cycles = gates.flatMap((gate) => gate.reviewCycles);
  return {
    projects: source.projects.map((item) => item.id).sort(),
    packages: source.packages.map((item) => item.id).sort(),
    gates: gates.map((item) => item.id).sort(),
    criteria: gates.flatMap((gate) => gate.criteria.map((item) => item.id)).sort(),
    configuredApprovers: gates.flatMap((gate) => gate.approvers.map((item) => item.id)).sort(),
    reviewCycles: cycles.map((item) => item.id).sort(),
    invitationAttempts: cycles
      .flatMap((cycle) => cycle.approvers)
      .flatMap((approver) => approver.invitation?.attempts ?? [])
      .map((item) => item.id)
      .sort(),
    deliverables: source.deliverables.map((item) => item.id).sort(),
    actions: source.actionStore.actions.map((item) => item.id).sort(),
    actionUpdates: source.actionStore.actions.flatMap((action) => action.updates.map((item) => item.id)).sort(),
    gateDecisionReferences: source.actionStore.actions
      .flatMap((action) => action.gateDecisionReferences.map((item) => item.id))
      .sort(),
  };
}
