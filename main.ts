// token-radar-01: the entry point. Snapshot in; board, dashboard data and dossier out.
//
// The grader runs this file as `node main.ts` (Node 22, standard library only, no network) with the
// sealed snapshot mounted at /input and a writable /output. Run by hand it takes
// --input <snapshot.json|directory> and writes to --output <dir>, or to MAKEFUN_OUTPUT_DIR when no
// --output is given. The run is deterministic: one snapshot always produces the same bytes.
//
// The pipeline, in the order main() walks it:
//   1. locate and parse the snapshot (lib/model.ts refuses anything misshapen),
//   2. score it into a ranked board, then check that board against the gate's rules locally,
//   3. write board.json and the dashboard's data.js into the output directory,
//   4. copy dashboard/ and screenshots/ in beside them, holding the screenshots to the gate's shape,
//   5. write dossier.json last of all, from the finished directory, with the vendored library.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** This file's own directory: dashboard/ and screenshots/ live beside main.ts in the repository. */
const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** The caps the scorer rebuilds the dossier with (reference/gate.json). */
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const DOSSIER_SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };

/** A screenshot's name, as the gate allows it: letters, digits and . _ -, 1 to 128 characters. */
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** How many screenshots a hand-in carries: the board, a detail view and a filtered view. */
const MIN_SCREENSHOTS = 3;

/** Write one diagnostic line to stderr and stop with the given exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** One command-line option, in `--name value` or `--name=value` form, else the fallback. */
function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** The snapshot's path: --input names either the snapshot file itself or the directory holding it. */
function snapshotPath(): string {
  const given = option('input', '/input');
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

/** Read and parse the snapshot at `path`; a missing file stops the run with the caller's remedy. */
function loadSnapshot(path: string) {
  if (!existsSync(path)) {
    fail(`no snapshot at ${path}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  return parseSnapshot(readFileSync(path, 'utf8'));
}

/**
 * Copy every regular file of `from` into `to`, skipping names that start with a dot and anything
 * that is not a plain file, and return the names copied, in directory order.
 */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** Hold the copied screenshots to the gate's shape: at least three of them, each name allowed. */
function checkScreenshots(names: string[]): void {
  if (names.length < MIN_SCREENSHOTS) {
    fail(`screenshots/ holds ${names.length} image${names.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  for (const name of names) {
    if (!SCREENSHOT_NAME.test(name)) {
      fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }
}

/** Write the two files the model produces: the ranked board and the dashboard's data script. */
function writeBoardFiles(outDir: string, built: ReturnType<typeof buildRadar>): void {
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: built.board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(built.radar));
}

/** The run's two summary lines: what was scored, and every file the hand-in consists of. */
function reportRun(outDir: string, snapshot: ReturnType<typeof parseSnapshot>, built: ReturnType<typeof buildRadar>, shotCount: number): void {
  const { board, radar } = built;
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shotCount} images) and ${join(outDir, 'dossier.json')}\n`,
  );
}

function main(): void {
  const outDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshot = loadSnapshot(snapshotPath());

  const built = buildRadar(snapshot);
  const issue = boardIssue(built.board, snapshot);
  if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

  mkdirSync(outDir, { recursive: true });
  writeBoardFiles(outDir, built);

  copyDirectory(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
  const shots = copyDirectory(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
  checkScreenshots(shots);

  // The dossier is written last: the scorer rebuilds it from this directory and compares bytes.
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES, screenshots: DOSSIER_SCREENSHOTS, dashboard: DOSSIER_DASHBOARD }),
  );

  reportRun(outDir, snapshot, built, shots.length);
}

main();
