/**
 * The optional ComfyUI adapter: the painting and the See-through run, driven
 * on a GPU box the user names at run time (`--host` or `COMFY_HOST`).
 *
 * `src/` is pure — no clock, no randomness, no network — and this directory is
 * the one exception it has, because driving a GPU box IS a network call with a
 * wall-clock wait. Keeping the exception to one named directory is what keeps
 * the rule checkable: the selftest's purity control (`TY06`) scans every file
 * in `src/` except this directory, and a network call that appears anywhere
 * else is refused by name. What can be pure is kept out of here — the words
 * and the graphs are `src/graphs.ts`, the control skeleton `src/skeleton.ts`,
 * the two See-through inputs `src/inputs.ts` — so the purity scan covers them.
 *
 * ComfyUI is optional: See-through can be run by any route in the README, and
 * everything after it reads files.
 */
export { ComfyClient, type ClientTiming, resolveHost } from './client.ts';
export { runPainting, type PaintRun, type Painted } from './painting.ts';
export { runBackground, type BackgroundRun } from './plate.ts';
export { runSeeThrough, type SeeThroughResult, type SeeThroughRun } from './seethrough.ts';

export { runMatte, type MatteRun } from './matte.ts';
