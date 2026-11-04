/** Generated controls for the exhaustive report; no consumer data. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureRecomposite, errorMask, type PlacedPart } from '../src/assemble.ts';
import { measureDiffComponents, readDiffComponents, serializeDiffComponents, type DiffInputs } from '../src/diffcomponents.ts';
import { PartsError } from '../src/errors.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { EXPECTED_PARTS } from '../fixtures/assemble_fixture.ts';
type Say = (name: string, pass: boolean, detail: string) => void;
const refused = (fn: () => unknown, code: string): boolean => { try { fn(); return false; } catch (e) { return e instanceof PartsError && e.problems.some(p => p.code === code); } };
export function runDiffComponentChecks(say: Say): void {
  const stack = newRaster(30, 5), painting = newRaster(30, 5);
  stack.data.fill(255); painting.data.fill(255);
  // Seven 2-pixel components, and one 1-pixel component, separated by two columns.
  for (let i = 0; i < 8; i++) for (let y = 1; y <= (i === 7 ? 1 : 2); y++) stack.data.set([0,0,0,255], (y * 30 + i * 4) * 4);
  const image = newRaster(1,1); image.data.fill(255);
  const part: PlacedPart = { record: { ...EXPECTED_PARTS.parts[0], name: 'marker', x: 0, y: 1, w: 1, h: 1 }, image };
  const input: DiffInputs = { stack: { path: 'stack.png', bytes: encodePngBytes(stack) }, painting: { path: 'painting.png', bytes: encodePngBytes(painting) }, parts: [part], inside: null };
  const r = measureDiffComponents(input, 2), text = serializeDiffComponents(r);
  say('AS833_DIFF_INVENTORY_IS_UNCAPPED_AND_THE_CAPPED_MUTANT_IS_REFUSED', r.components.length === 7 && refused(() => readDiffComponents(JSON.stringify({...r,components:r.components.slice(0,5)}), input),'DIFF_COMPONENTS_REPORT'), `${r.components.length} listed; capped at five refused`);
  say('AS834_DIFF_FLOOR_IS_INCLUSIVE_AND_RECONCILES_BOTH_COUNTS', r.error_px === 15 && r.uncovered_error_px === 14 && r.components.every(c => c.px === 2) && r.below_floor.count === 1 && r.below_floor.px === 1 && r.below_floor.uncovered_px === 1 && r.components.reduce((n,c)=>n+c.px,0)+r.below_floor.px===r.error_px && r.components.reduce((n,c)=>n+c.uncovered_px,0)+r.below_floor.uncovered_px===r.uncovered_error_px, JSON.stringify({error:r.error_px,uncovered:r.uncovered_error_px,below:r.below_floor}));
  say('AS835_DIFF_IDS_AND_BYTES_ARE_DETERMINISTIC', text === serializeDiffComponents(measureDiffComponents(input,2)) && readDiffComponents(text,input).components[0].id === 'p30-n2', r.components.map(c=>c.id).join(','));
  stack.data[0] = 254;
  const changed = {...input,stack:{...input.stack,bytes:encodePngBytes(stack)}};
  const paintChanged = {...input,painting:{...input.painting,bytes:changed.stack.bytes}};
  say('AS836_DIFF_READER_BINDS_BOTH_EXACT_PNG_BUFFERS', measureDiffComponents(changed,2).stack.sha256 !== r.stack.sha256 && refused(()=>readDiffComponents(text,changed),'DIFF_COMPONENTS_BINDING') && refused(()=>readDiffComponents(text,paintChanged),'DIFF_COMPONENTS_BINDING'), 'one changed decoded stack pixel changes SHA; stack and painting mismatch refused');
  const inside = new Uint8Array(150); inside[30] = 1;
  const scoped = measureDiffComponents({...input,inside},1);
  const f = measureRecomposite(newRasterFromBytes(),painting,[part],inside);
  function newRasterFromBytes() { const copy = newRaster(30,5); copy.data.set(stack.data); copy.data[0]=255; return copy; }
  say('AS837_DIFF_DOMAIN_AND_CUSTOM_THRESHOLD_USE_THE_SHARED_PREDICATE', scoped.error_px === 1 && scoped.uncovered_error_px === 0 && f.errorPx === scoped.error_px && measureDiffComponents(input,1,255).error_px === 0 && measureDiffComponents(changed,1,0).error_px === 16 && refused(()=>readDiffComponents(text,{...input,inside}),'DIFF_COMPONENTS_REPORT'), 'one-pixel domain: 1 covered error; >255: 0; >0 includes the changed pixel; changed domain refused');
  const first = r.components[0];
  say('AS838_DIFF_MIXED_COVERAGE_NATIVE_BOX_AND_BORDERS_ARE_MEASURED', first.coverage === 'mixed' && first.uncovered_px===1 && JSON.stringify(first.box)==='{"x":0,"y":1,"w":1,"h":2}' && first.borders[0]?.part==='marker' && first.borders[0]?.px===1 && r.components[1].coverage==='uncovered' && scoped.components[0].coverage==='covered', JSON.stringify(first));
  const invalid = [0,-1,1.5,NaN,Infinity].every(v=>refused(()=>measureDiffComponents(input,v),'DIFF_COMPONENTS_INPUT')) && [-1,256,NaN,Infinity].every(v=>refused(()=>measureDiffComponents(input,1,v),'DIFF_COMPONENTS_INPUT'));
  say('AS839_DIFF_INVALID_DEFINITIONS_SHAPES_AND_REPORTS_ARE_REFUSED', invalid && refused(()=>measureDiffComponents({...input,inside:new Uint8Array(1)},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,parts:[part,part]},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,stack:{path:'small.png',bytes:encodePngBytes(image)}},1),'DIFF_COMPONENTS_INPUT') && refused(()=>readDiffComponents('{',input),'DIFF_COMPONENTS_REPORT') && refused(()=>readDiffComponents('{}',input),'DIFF_COMPONENTS_REPORT'), 'invalid floor/threshold, domain, duplicate parts, dimensions, JSON and spec refused');
  const empty = measureDiffComponents({...input,stack:input.painting},1);
  say('AS840_DIFF_EMPTY_INVENTORY_AND_STRICT_THRESHOLD_HAVE_POSITIVE_CONTROLS', empty.error_px===0 && empty.components.length===0 && empty.below_floor.px===0 && readDiffComponents(serializeDiffComponents(empty),{...input,stack:input.painting}).error_px===0 && measureDiffComponents(input,1,254).error_px===15, 'equal bytes: zero inventory; max difference 255 is strictly above 254');
}
export function runDiffComponentCliChecks(dir: string, say: Say, cli: string): void {
  const stack = newRaster(4,4); stack.data.fill(255);
  const painting = newRaster(4,4); painting.data.fill(255); painting.data[0]=0;
  writeFileSync(join(dir,'diff-stack.png'),encodePngBytes(stack));
  writeFileSync(join(dir,'diff-painting.png'),encodePngBytes(painting));
  // Empty parts is a valid coverage inventory for this control, supplied through the real parts reader.
  const parts = {...EXPECTED_PARTS,rig_size:[4,4],parts:[],ghost_px:{}};
  writeFileSync(join(dir,'diff-parts.json'),JSON.stringify(parts));
  const out = join(dir,'diff.json');
  const base = ['diff-components','--stack',join(dir,'diff-stack.png'),'--painting',join(dir,'diff-painting.png'),'--parts',join(dir,'diff-parts.json'),'--floor','1'];
  const run = (args: string[]) => spawnSync('bun',[cli,...args],{encoding:'utf8'});
  const good = run([...base,'--out',out]);
  const verified = good.status===0 ? run([...base,'--verify',out]) : null;
  const report = good.status===0 ? JSON.parse(readFileSync(out,'utf8')) as { error_px:number } : null;
  const missing = run(['diff-components','--floor','1']);
  const unknown = run([...base,'--unknown','value','--out',out]);
  say('CL830_DIFF_COMMAND_WRITES_VERIFIES_AND_REFUSES_MISSING_OR_UNKNOWN_FLAGS',good.status===0 && verified?.status===0 && report?.error_px===1 && missing.status===1 && missing.stdout.includes('DIFF_COMPONENTS_INPUT') && unknown.status===2, `write=${good.status}, verify=${verified?.status}, errors=${report?.error_px}, missing=${missing.status}, unknown=${unknown.status}; ${good.stdout}${good.stderr}`);
}
/** Public recipe control: every mask pixel agrees with the count's own RGB predicate and domain. */
export function publicDiffControl(stack: Parameters<typeof errorMask>[0], painting: Parameters<typeof errorMask>[1], parts: PlacedPart[], inside: Uint8Array | null): { ok: boolean; detail: string } {
  const input: DiffInputs = { stack:{path:'stack.png',bytes:encodePngBytes(stack)},painting:{path:'painting.png',bytes:encodePngBytes(painting)},parts,inside };
  const r = measureDiffComponents(input,1), f = measureRecomposite(stack,painting,parts,inside), mask = errorMask(stack,painting,inside);
  let same = true, count = 0;
  for (let p=0;p<mask.length;p++) {
    const want = (inside===null || inside[p]!==0) && Math.max(...[0,1,2].map(c=>Math.abs(stack.data[p*4+c]-painting.data[p*4+c])))>40 ? 1 : 0;
    if (mask[p]!==want) same=false;
    count+=mask[p];
  }
  const total = r.components.reduce((n,c)=>n+c.px,0)+r.below_floor.px, uncovered=r.components.reduce((n,c)=>n+c.uncovered_px,0)+r.below_floor.uncovered_px;
  return {ok:same && count===f.errorPx && total===f.errorPx && uncovered===f.uncoveredErrorPx && serializeDiffComponents(r)===serializeDiffComponents(measureDiffComponents(input,1)),detail:`diff components=${r.components.length}, px=${total}/${f.errorPx}, uncovered=${uncovered}/${f.uncoveredErrorPx}, predicate pixel agreement=${same}, domain=${inside===null?'whole':'figure'}`};
}
