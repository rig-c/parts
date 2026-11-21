/**
 * Hold the tracked data-only cloth targets export (`src/cloth-targets.json`,
 * exported at `./cloth-targets.json`) to `CLOTH_TARGETS` in `src/cloth.ts`
 * (issue #1433).
 *
 *     bun tools/check_cloth_targets.ts           check the tracked file and exports entry
 *     bun tools/check_cloth_targets.ts --write   regenerate src/cloth-targets.json from CLOTH_TARGETS
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOTH_TARGETS } from '../src/cloth.ts';

export const CLOTH_TARGETS_SCHEMA = 'rig-parts/cloth-targets@1';
export const CLOTH_TARGETS_FILE = 'src/cloth-targets.json';
export const CLOTH_TARGETS_EXPORT_KEY = './cloth-targets.json';
export const CLOTH_TARGETS_EXPORT_TARGET = `./${CLOTH_TARGETS_FILE}`;
export const CLOTH_TARGETS_WRITE_COMMAND = 'bun tools/check_cloth_targets.ts --write';

export function renderClothTargetsJson(
  targets: readonly string[] = CLOTH_TARGETS,
  schema: string = CLOTH_TARGETS_SCHEMA,
): string {
  return `${JSON.stringify({ schema, targets: [...targets] }, null, 2)}\n`;
}

function firstTextDifference(actual: string, expected: string): string {
  const limit = Math.min(actual.length, expected.length);
  let byte = 0;
  while (byte < limit && actual.charCodeAt(byte) === expected.charCodeAt(byte)) byte++;
  const line = actual.slice(0, byte).split('\n').length;
  const actualLine = actual.split('\n')[line - 1] ?? '(end of file)';
  const expectedLine = expected.split('\n')[line - 1] ?? '(end of file)';
  return `line ${line} (byte ${byte}): found ${JSON.stringify(actualLine)}, required ${JSON.stringify(expectedLine)}`;
}

export function clothTargetsJsonFaults(
  actualText: string | null,
  targets: readonly string[] = CLOTH_TARGETS,
  file: string = CLOTH_TARGETS_FILE,
): string[] {
  const expectedText = renderClothTargetsJson(targets, CLOTH_TARGETS_SCHEMA);
  if (actualText === null) {
    return [
      `${file}: file is missing (first difference: absent vs ${expectedText.length} rendered bytes); run \`${CLOTH_TARGETS_WRITE_COMMAND}\` to regenerate it`,
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(actualText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
      `${file}: invalid JSON (${reason}; first difference at ${firstTextDifference(actualText, expectedText)}); run \`${CLOTH_TARGETS_WRITE_COMMAND}\` to regenerate it`,
    ];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [
      `${file}: root value is not a JSON object (first difference at ${firstTextDifference(actualText, expectedText)}); run \`${CLOTH_TARGETS_WRITE_COMMAND}\` to regenerate it`,
    ];
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== CLOTH_TARGETS_SCHEMA) {
    return [
      `${file}: differs from CLOTH_TARGETS (first difference: schema is ${JSON.stringify(record.schema)}; required ${JSON.stringify(CLOTH_TARGETS_SCHEMA)}); run \`${CLOTH_TARGETS_WRITE_COMMAND}\` to regenerate it`,
    ];
  }
  if (!Array.isArray(record.targets) || !record.targets.every((t): t is string => typeof t === 'string')) {
    return [
      `${file}: differs from CLOTH_TARGETS (first difference: targets is ${JSON.stringify(record.targets)}; a string array is required); run \`${CLOTH_TARGETS_WRITE_COMMAND}\` to regenerate it`,
    ];
  }
  const fileTargets = record.targets;
  const onlyInConstant = targets.filter((t) => !fileTargets.includes(t));
  const onlyInFile = fileTargets.filter((t) => !targets.includes(t));
  const maxLen = Math.max(fileTargets.length, targets.length);
  for (let i = 0; i < maxLen; i++) {
    const found = fileTargets[i];
    const required = targets[i];
    if (found !== required) {
      const where =
        found === undefined
          ? `targets[${i}] is missing from ${file}; CLOTH_TARGETS has ${JSON.stringify(required)}`
          : required === undefined
            ? `targets[${i}] in ${file} has extra tag ${JSON.stringify(found)} not in CLOTH_TARGETS`
            : `targets[${i}] is ${JSON.stringify(found)} in ${file} vs ${JSON.stringify(required)} in CLOTH_TARGETS`;
      const extras = [
        ...(onlyInConstant.length > 0 ? [`only in CLOTH_TARGETS: ${onlyInConstant.map((t) => JSON.stringify(t)).join(', ')}`] : []),
        ...(onlyInFile.length > 0 ? [`only in ${file}: ${onlyInFile.map((t) => JSON.stringify(t)).join(', ')}`] : []),
      ];
      const suffix = extras.length > 0 ? `; ${extras.join('; ')}` : '';
      return [
        `${file}: differs from CLOTH_TARGETS (first difference: ${where}${suffix}); run \`${CLOTH_TARGETS_WRITE_COMMAND}\` to regenerate it`,
      ];
    }
  }
  if (actualText !== expectedText) {
    return [
      `${file}: differs from CLOTH_TARGETS (first difference: ${firstTextDifference(actualText, expectedText)}); run \`${CLOTH_TARGETS_WRITE_COMMAND}\` to regenerate it`,
    ];
  }
  return [];
}

export interface ClothTargetsExportOptions {
  pkg?: { name?: unknown; exports?: unknown; files?: unknown };
  packedPaths?: readonly string[];
  resolvedPath?: string | null;
}

export function packedFilesFromNpm(root: string): { paths: string[]; fault: string | null } {
  const ran = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (ran.status !== 0) {
    return {
      paths: [],
      fault: `npm pack --dry-run exited ${ran.status}: ${(ran.stderr || ran.stdout || '').trim().slice(0, 400)}`,
    };
  }
  try {
    const parsed = JSON.parse(ran.stdout) as Array<{ files?: Array<{ path?: unknown }> }>;
    const files = parsed[0]?.files;
    if (!Array.isArray(files)) return { paths: [], fault: 'npm pack --dry-run --json returned no files array' };
    return {
      paths: files.flatMap((entry) => (typeof entry.path === 'string' ? [entry.path] : [])),
      fault: null,
    };
  } catch (error) {
    return {
      paths: [],
      fault: `npm pack --dry-run --json output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function clothTargetsExportFaults(root: string, options?: ClothTargetsExportOptions): string[] {
  const faults: string[] = [];
  const pkgPath = join(root, 'package.json');
  const pkg =
    options?.pkg ??
    (existsSync(pkgPath)
      ? (JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown; exports?: unknown; files?: unknown })
      : {});
  const pkgName = typeof pkg.name === 'string' ? pkg.name : '@rig-c/parts';
  const exportsMap =
    typeof pkg.exports === 'object' && pkg.exports !== null && !Array.isArray(pkg.exports)
      ? (pkg.exports as Record<string, unknown>)
      : null;
  if (exportsMap === null) {
    faults.push('package.json: exports map is missing');
  } else {
    const target = exportsMap[CLOTH_TARGETS_EXPORT_KEY];
    if (target !== CLOTH_TARGETS_EXPORT_TARGET) {
      faults.push(
        `package.json: exports[${JSON.stringify(CLOTH_TARGETS_EXPORT_KEY)}] is ${JSON.stringify(target)}; required ${JSON.stringify(CLOTH_TARGETS_EXPORT_TARGET)}`,
      );
    }
    const keys = Object.keys(exportsMap);
    const keyIdx = keys.indexOf(CLOTH_TARGETS_EXPORT_KEY);
    const wildcardIdx = keys.indexOf('./*');
    if (keyIdx !== -1 && wildcardIdx !== -1 && keyIdx > wildcardIdx) {
      faults.push(
        `package.json: exports[${JSON.stringify(CLOTH_TARGETS_EXPORT_KEY)}] (index ${keyIdx}) must precede "./*" (index ${wildcardIdx})`,
      );
    }
  }

  const filesList = Array.isArray(pkg.files)
    ? pkg.files.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const coveredByFiles = filesList.some((entry) => {
    const clean = entry.replace(/\/+$/, '');
    return CLOTH_TARGETS_FILE === clean || CLOTH_TARGETS_FILE.startsWith(`${clean}/`);
  });
  if (!coveredByFiles) {
    faults.push(`package.json: files does not cover ${CLOTH_TARGETS_FILE}`);
  }

  const expectedAbs = join(root, CLOTH_TARGETS_FILE);
  if (!existsSync(expectedAbs)) {
    faults.push(`${CLOTH_TARGETS_FILE}: tracked file does not exist on disk`);
  } else {
    const specifier = `${pkgName}/cloth-targets.json`;
    let resolvedAbs: string | null = null;
    if (options?.resolvedPath !== undefined) {
      resolvedAbs = options.resolvedPath;
    } else {
      try {
        const req = createRequire(pkgPath);
        const cjsResolved = req.resolve(specifier);
        const esmUrl = import.meta.resolve(specifier);
        const esmResolved = esmUrl.startsWith('file://') ? fileURLToPath(esmUrl) : esmUrl;
        if (realpathSync(cjsResolved) !== realpathSync(esmResolved)) {
          faults.push(
            `${specifier}: CJS resolution (${cjsResolved}) and ESM resolution (${esmResolved}) disagree`,
          );
        }
        resolvedAbs = cjsResolved;
      } catch (error) {
        faults.push(`${specifier}: failed to resolve (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    if (resolvedAbs === null) {
      if (options?.resolvedPath === null) faults.push(`${specifier}: resolved to null`);
    } else if (!existsSync(resolvedAbs) || relative(realpathSync(expectedAbs), realpathSync(resolvedAbs)) !== '') {
      faults.push(`${specifier}: resolved to ${resolvedAbs}; required ${expectedAbs}`);
    }
  }

  if (options?.packedPaths !== undefined) {
    if (!options.packedPaths.includes(CLOTH_TARGETS_FILE)) {
      faults.push(`npm pack --dry-run: ${CLOTH_TARGETS_FILE} is not in the packed file list`);
    }
  } else {
    const packed = packedFilesFromNpm(root);
    if (packed.fault !== null) faults.push(packed.fault);
    else if (!packed.paths.includes(CLOTH_TARGETS_FILE)) {
      faults.push(`npm pack --dry-run: ${CLOTH_TARGETS_FILE} is not in the packed file list`);
    }
  }

  return faults;
}

type Say = (name: string, ok: boolean, detail: string, why: string) => void;

export function runClothTargetsChecks(root: string, say: Say): void {
  const filePath = join(root, CLOTH_TARGETS_FILE);
  const actualText = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  const renderedText = renderClothTargetsJson(CLOTH_TARGETS);
  const positiveFaults = clothTargetsJsonFaults(actualText, CLOTH_TARGETS);
  const parsed = actualText !== null ? (JSON.parse(actualText) as { schema?: unknown; targets?: unknown }) : null;
  say(
    'CTJ01_CLOTH_TARGETS_JSON_EQUALS_THE_CONSTANT_RENDER',
    actualText === renderedText &&
      positiveFaults.length === 0 &&
      parsed !== null &&
      Object.keys(parsed).join(',') === 'schema,targets' &&
      parsed.schema === CLOTH_TARGETS_SCHEMA &&
      JSON.stringify(parsed.targets) === JSON.stringify(CLOTH_TARGETS),
    `${CLOTH_TARGETS_FILE}: ${positiveFaults.length === 0 ? `matches CLOTH_TARGETS (${CLOTH_TARGETS.length} tags: ${CLOTH_TARGETS.join(', ')}, ${renderedText.length} bytes)` : positiveFaults.join('; ')}`,
    'issue #1433: src/cloth-targets.json is held byte-for-byte to CLOTH_TARGETS in src/cloth.ts with fixed key order, two-space indentation and one trailing newline',
  );

  const constantOnlyTag = 'planted-constant-tag';
  const fileOnlyTag = 'planted-file-tag';
  const constantOnlyFaults = clothTargetsJsonFaults(renderedText, [...CLOTH_TARGETS, constantOnlyTag]);
  const fileOnlyFaults = clothTargetsJsonFaults(
    renderClothTargetsJson([...CLOTH_TARGETS, fileOnlyTag]),
    CLOTH_TARGETS,
  );
  const namesBoth = (faults: readonly string[], tag: string): boolean =>
    faults.length === 1 &&
    faults[0].includes(CLOTH_TARGETS_FILE) &&
    faults[0].includes('first difference:') &&
    faults[0].includes(JSON.stringify(tag)) &&
    faults[0].includes(CLOTH_TARGETS_WRITE_COMMAND);
  say(
    'CTJ02_EXTRA_TAG_IN_CONSTANT_OR_FILE_IS_REFUSED_BY_NAME',
    namesBoth(constantOnlyFaults, constantOnlyTag) && namesBoth(fileOnlyFaults, fileOnlyTag),
    `constant-only tag -> ${constantOnlyFaults.join('; ') || 'MISSED'} | file-only tag -> ${fileOnlyFaults.join('; ') || 'MISSED'}`,
    'issue #1433: a tag added to CLOTH_TARGETS without regenerating the file, or added to the file without CLOTH_TARGETS, is refused by name with the regeneration command',
  );

  const badSchemaText = renderClothTargetsJson(CLOTH_TARGETS, 'rig-parts/cloth-targets@2');
  const reorderedTargets = [CLOTH_TARGETS[1], CLOTH_TARGETS[0], ...CLOTH_TARGETS.slice(2)];
  const reorderedText = renderClothTargetsJson(reorderedTargets);
  const unformattedText = `${JSON.stringify({ schema: CLOTH_TARGETS_SCHEMA, targets: [...CLOTH_TARGETS] })}\n`;
  const schemaFaults = clothTargetsJsonFaults(badSchemaText, CLOTH_TARGETS);
  const reorderedFaults = clothTargetsJsonFaults(reorderedText, CLOTH_TARGETS);
  const formatFaults = clothTargetsJsonFaults(unformattedText, CLOTH_TARGETS);
  const schemaRefused =
    schemaFaults.length === 1 &&
    schemaFaults[0].includes(CLOTH_TARGETS_FILE) &&
    schemaFaults[0].includes('schema is "rig-parts/cloth-targets@2"') &&
    schemaFaults[0].includes(CLOTH_TARGETS_WRITE_COMMAND);
  const reorderRefused =
    reorderedFaults.length === 1 &&
    reorderedFaults[0].includes(CLOTH_TARGETS_FILE) &&
    reorderedFaults[0].includes(`targets[0] is ${JSON.stringify(CLOTH_TARGETS[1])} in ${CLOTH_TARGETS_FILE} vs ${JSON.stringify(CLOTH_TARGETS[0])} in CLOTH_TARGETS`) &&
    reorderedFaults[0].includes(CLOTH_TARGETS_WRITE_COMMAND);
  const formatRefused =
    formatFaults.length === 1 &&
    formatFaults[0].includes(CLOTH_TARGETS_FILE) &&
    formatFaults[0].includes('first difference: line 1') &&
    formatFaults[0].includes(CLOTH_TARGETS_WRITE_COMMAND);
  say(
    'CTJ03_DIFFERENT_SCHEMA_AND_REORDERED_TARGETS_ARE_REFUSED',
    schemaRefused && reorderRefused && formatRefused,
    `wrong schema -> ${schemaFaults.join('; ') || 'MISSED'} | reordered list -> ${reorderedFaults.join('; ') || 'MISSED'} | compact formatting -> ${formatFaults.join('; ') || 'MISSED'}`,
    'issue #1433: schema drift, target reordering and non-canonical formatting are each refused with the file name, first difference and --write remedy',
  );

  const packed = packedFilesFromNpm(root);
  const exportFaults =
    packed.fault !== null ? [packed.fault] : clothTargetsExportFaults(root, { packedPaths: packed.paths });
  const rawPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name?: string;
    exports?: Record<string, string>;
    files?: string[];
  };
  const missingExportFaults = clothTargetsExportFaults(root, {
    pkg: { ...rawPkg, exports: { './assembly-reading': './src/assembly-reading.ts', './*': './*' } },
    packedPaths: packed.paths,
  });
  const afterWildcardFaults = clothTargetsExportFaults(root, {
    pkg: {
      ...rawPkg,
      exports: {
        './assembly-reading': './src/assembly-reading.ts',
        './*': './*',
        [CLOTH_TARGETS_EXPORT_KEY]: CLOTH_TARGETS_EXPORT_TARGET,
      },
    },
    packedPaths: packed.paths,
  });
  const missingFilesFaults = clothTargetsExportFaults(root, {
    pkg: { ...rawPkg, files: (rawPkg.files ?? []).filter((f) => f !== 'src') },
    packedPaths: packed.paths.filter((p) => p !== CLOTH_TARGETS_FILE),
  });
  say(
    'CTJ04_EXPORTS_KEY_RESOLVES_AND_FILE_IS_IN_THE_PACK_LIST',
    exportFaults.length === 0 &&
      packed.paths.includes(CLOTH_TARGETS_FILE) &&
      missingExportFaults.some((f) => f.includes(`exports[${JSON.stringify(CLOTH_TARGETS_EXPORT_KEY)}] is undefined`)) &&
      afterWildcardFaults.some((f) => f.includes('must precede "./*"')) &&
      missingFilesFaults.some((f) => f.includes(`files does not cover ${CLOTH_TARGETS_FILE}`)) &&
      missingFilesFaults.some((f) => f.includes(`npm pack --dry-run: ${CLOTH_TARGETS_FILE} is not in the packed file list`)),
    `exports[${JSON.stringify(CLOTH_TARGETS_EXPORT_KEY)}] -> ${CLOTH_TARGETS_EXPORT_TARGET}; npm pack --dry-run lists ${CLOTH_TARGETS_FILE} among ${packed.paths.length} files; faults: ${exportFaults.join('; ') || 'none'}; planted missing export / after wildcard / dropped from files & pack -> ${[missingExportFaults[0], afterWildcardFaults[0], missingFilesFaults.join(' & ')].join(' | ')}`,
    'issue #1433: package.json maps ./cloth-targets.json ahead of ./*, resolves to src/cloth-targets.json, and ships it in the packed file list',
  );
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--write') {
    writeFileSync(join(root, CLOTH_TARGETS_FILE), renderClothTargetsJson(CLOTH_TARGETS));
    process.exit(0);
  }
  if (args.length > 0 && !(args.length === 1 && args[0] === '--check')) {
    console.error(`usage: ${CLOTH_TARGETS_WRITE_COMMAND} (or run with no flags to check)`);
    process.exit(2);
  }
  const filePath = join(root, CLOTH_TARGETS_FILE);
  const actual = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  const faults = [...clothTargetsJsonFaults(actual, CLOTH_TARGETS), ...clothTargetsExportFaults(root)];
  if (faults.length > 0) {
    for (const fault of faults) console.error(fault);
    process.exit(1);
  }
}
