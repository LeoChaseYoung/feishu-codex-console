import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = await mkdtemp(path.join(tmpdir(), "feishu-codex-bridge-package-"));
let archive;

try {
  archive = pack();
  const archivePath = path.join(packageRoot, archive);
  const installDir = path.join(sandbox, "consumer");
  const configFile = path.join(sandbox, "config", "smoke.env");
  const dataDir = path.join(sandbox, "data");

  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    installDir,
    archivePath,
  ]);

  const cli = path.join(installDir, "node_modules", ".bin", "feishu-codex-console");
  const compatibilityCli = path.join(installDir, "node_modules", ".bin", "feishu-codex-bridge");
  await access(cli);
  await access(compatibilityCli);
  run(cli, ["help"], installDir);
  run(compatibilityCli, ["help"], installDir);
  const helpAlias = run(cli, ["--help"], installDir);
  if (!helpAlias.includes("用法：")) {
    throw new Error("Installed CLI did not expose help through --help.");
  }
  run(compatibilityCli, ["-h"], installDir);
  const versionInfo = JSON.parse(run(cli, ["version", "--json"], installDir));
  if (versionInfo.product !== "feishu-codex-console" || !versionInfo.version) {
    throw new Error("Installed CLI did not expose version and compatibility metadata.");
  }
  const versionAlias = run(cli, ["--version"], installDir);
  if (!versionAlias.includes(`feishu-codex-console ${versionInfo.version}`)) {
    throw new Error("Installed CLI did not expose its version through --version.");
  }
  run(compatibilityCli, ["-v"], installDir);
  runExpectFailure(
    cli,
    [
      "init",
      "--yes",
      "--no-service",
      "--skip-feishu-check",
      "--preset",
      "personal",
      "--open-id",
      "ou_package_smoke",
      "--workdir",
      path.join(sandbox, "missing-workdir"),
      "--config",
      configFile,
      "--data-dir",
      dataDir,
    ],
    installDir,
  );
  const interruptedStateFile = configFile.replace(/\.env$/, ".install-state.json");
  const interruptedState = JSON.parse(await readFile(interruptedStateFile, "utf8"));
  if (interruptedState.status !== "environment_ready" || !interruptedState.lastError) {
    throw new Error("Interrupted installation did not persist a resumable safe checkpoint.");
  }
  run(
    cli,
    [
      "init",
      "--yes",
      "--no-service",
      "--skip-feishu-check",
      "--preset",
      "personal",
      "--open-id",
      "ou_package_smoke",
      "--workdir",
      packageRoot,
      "--config",
      configFile,
      "--data-dir",
      dataDir,
    ],
    installDir,
  );

  const config = await readFile(configFile, "utf8");
  if (!config.includes("ALLOWED_FEISHU_OPEN_IDS=ou_package_smoke")) {
    throw new Error("Installed CLI did not generate the expected configuration.");
  }
  const resumedState = JSON.parse(await readFile(interruptedStateFile, "utf8"));
  if (!resumedState.completedSteps?.includes("config_written")) {
    throw new Error("Second initialization did not resume through configuration write.");
  }
  const runbookProject = path.join(sandbox, "runbook-project");
  await mkdir(runbookProject);
  run(cli, ["init-runbooks", "--project", runbookProject], installDir);
  const runbookFile = path.join(runbookProject, ".feishu-codex-runbooks.json");
  const runbookCatalog = JSON.parse(await readFile(runbookFile, "utf8"));
  if (runbookCatalog.version !== 1 || !Array.isArray(runbookCatalog.runbooks)) {
    throw new Error("Installed package did not create a valid runbook template.");
  }
  await writeFile(runbookFile, '{"teamOwned":true}\n');
  run(cli, ["init-runbooks", "--project", runbookProject], installDir);
  if ((await readFile(runbookFile, "utf8")) !== '{"teamOwned":true}\n') {
    throw new Error("Runbook initialization overwrote an existing team catalog.");
  }
  const upgradePreview = run(cli, ["upgrade", "--config", configFile], installDir);
  if (!upgradePreview.includes("未做任何修改")) {
    throw new Error("Safe upgrade preview did not remain read-only without --yes.");
  }
  const backupList = run(cli, ["backups", "--config", configFile], installDir);
  if (!backupList.includes("可用运行数据备份（0）")) {
    throw new Error("Installed CLI could not inspect runtime backups.");
  }
  if (process.platform !== "win32") {
    const configMode = (await stat(configFile)).mode & 0o777;
    const dataMode = (await stat(dataDir)).mode & 0o777;
    if (configMode !== 0o600) throw new Error(`Config mode is ${configMode.toString(8)}, expected 600.`);
    if (dataMode !== 0o700) throw new Error(`Data mode is ${dataMode.toString(8)}, expected 700.`);
  }
  console.log("Package smoke test passed: packed, installed, verified CLI aliases, resumed, initialized runbooks, and previewed a safe upgrade.");
} finally {
  await rm(sandbox, { recursive: true, force: true });
  if (archive) await rm(path.join(packageRoot, archive), { force: true });
}

function pack() {
  const result = spawnSync("npm", ["pack", "--silent"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error("npm pack failed.");
  const filename = result.stdout.trim().split("\n").at(-1);
  if (!filename?.endsWith(".tgz")) throw new Error(`Unexpected npm pack output: ${result.stdout}`);
  return filename;
}

function run(command, args, cwd = packageRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed.\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

function runExpectFailure(command, args, cwd = packageRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0) {
    throw new Error(`${command} ${args.join(" ")} unexpectedly succeeded.`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
