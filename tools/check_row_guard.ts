/** Selftest-only preload. Consumer commands do not import this module. */
import { mock } from 'bun:test';
import { CHECK_ROW_DOCUMENT, withoutCheckRows } from '../src/checkrow.ts';
import * as children from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkRowSchemaFaults, noArtCheckRowCorrections } from './check_row_scope.ts';

const originalChildren = { ...children }, originalStringify = JSON.stringify;
const faults: string[] = [];
const remember = (found: string[]): void => {
  if (found.length === 0) return;
  const message = 'check row schema: ' + found.slice(0, 3).join('; ').slice(0, 2000);
  faults.push(message);
  throw new Error(message);
};
JSON.stringify = new Proxy(originalStringify, { apply(target, receiver, args) {
  const value: unknown = args[0];
  if (value !== null && typeof value === 'object' && Reflect.get(value, CHECK_ROW_DOCUMENT) === true) {
    remember(checkRowSchemaFaults(value));
    const census = process.env.RIG_PARTS_CHECK_ROW_CENSUS;
    if (census !== undefined && 'gate_spine_html_green' in value) {
      const rows = noArtCheckRowCorrections(value);
      if (rows.length > 0) appendFileSync(census, originalStringify({ argv: process.argv, config: Reflect.get(value, 'config'), document_sha256_without_row_labels: createHash('sha256').update(originalStringify(withoutCheckRows(value))).digest('hex'), rows }) + '\n');
    }
  }
  return Reflect.apply(target, receiver, args);
} });

// Every Bun descendant inherits the same preload, including build's stage children.
// Node and custom executables keep their argv, environment and launch contract.
const preload = fileURLToPath(import.meta.url);
const forward = (args: unknown[]): unknown[] => {
  const [command, argv] = args;
  if (typeof command !== 'string' || !Array.isArray(argv) || !(/^bun(?:\.exe)?$/.test(basename(command)) || command === process.execPath) || argv.includes(preload)) return args;
  return [command, ['--preload', preload, ...argv], ...args.slice(2)];
};
const sync = new Proxy(originalChildren.spawnSync, { apply(target, receiver, args) {
  const result = Reflect.apply(target, receiver, forward(args));
  const output = String(result.stderr ?? '') + String(result.stdout ?? '');
  const childFaults = output.split(/\r?\n/).flatMap(line => {
    const found = /^(?:error: |Error: )?check row schema: (.+)$/.exec(line.trim());
    return found === null ? [] : [found[1]];
  });
  if (childFaults.length > 0) remember([...new Set(childFaults)]);
  return result;
} });
const asyncSpawn = new Proxy(originalChildren.spawn, { apply(target, receiver, args) {
  return Reflect.apply(target, receiver, forward(args));
} });
mock.module('node:child_process', () => ({ ...originalChildren, spawnSync: sync, spawn: asyncSpawn }));
// A caller swallowing the denial still cannot finish green.
process.on('exit', () => {
  if (faults.length === 0) return;
  console.error(faults[0]);
  process.exitCode = 1;
});
