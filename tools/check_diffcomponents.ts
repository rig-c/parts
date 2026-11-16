import { createHash } from 'node:crypto';
/** Generated controls for the exhaustive report; no consumer data. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, recomposite, stageFields, sourceInRig, measureRecomposite, errorMask, ERROR_LIMIT, type PlacedPart } from '../src/assemble.ts';
import { DIFF_COMPONENTS_SPEC, DIFF_COMPONENTS_OWNERS_SPEC, measureDiffComponents, readDiffComponents, serializeDiffComponents, type DiffInputs, type DiffComponentsReport } from '../src/diffcomponents.ts';
import { PartsError } from '../src/errors.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { DEFAULT_PROJECT_RULE } from '../src/projectrule.ts';
import { loadConfig } from '../src/config.ts';
import { readWrapperLayers } from '../src/layers.ts';
import { writeParts } from '../src/parts.ts';
import { EXPECTED_PARTS, writeAssembleFixture } from '../fixtures/assemble_fixture.ts';
type Say = (name: string, pass: boolean, detail: string) => void;
const refused = (fn: () => unknown, code: string): boolean => { try { fn(); return false; } catch (e) { return e instanceof PartsError && e.problems.some(p => p.code === code); } };
const caught = (fn: () => unknown): PartsError | null => { try { fn(); return null; } catch (e) { return e instanceof PartsError ? e : null; } };
export function runDiffComponentChecks(say: Say): void {
  const painting = newRaster(30, 5);
  painting.data.fill(255);
  // Seven 2-pixel components and one 1-pixel component, with three empty columns between them.
  for (let i = 0; i < 8; i++) for (let y = 1; y <= (i === 7 ? 1 : 2); y++) painting.data.set([0,0,0,255], (y * 30 + i * 4) * 4);
  const image = newRaster(1,1); image.data.fill(255);
  const part: PlacedPart = { record: { ...EXPECTED_PARTS.parts[0], name: 'marker', x: 0, y: 1, w: 1, h: 1 }, image };
  const stack = recomposite([part],30,5);
  const input: DiffInputs = { stack: { path: 'stack.png', bytes: encodePngBytes(stack) }, painting: { path: 'painting.png', bytes: encodePngBytes(painting) }, parts: [part], inside: null };
  const r = measureDiffComponents(input, 2), text = serializeDiffComponents(r);
  say('AS842_DIFF_INVENTORY_IS_UNCAPPED_AND_THE_CAPPED_MUTANT_IS_REFUSED', r.components.length === 7 && refused(() => readDiffComponents(JSON.stringify({...r,components:r.components.slice(0,5)}), input),'DIFF_COMPONENTS_REPORT'), `${r.components.length} listed; capped at five refused`);
  say('AS843_DIFF_FLOOR_IS_INCLUSIVE_AND_RECONCILES_BOTH_COUNTS', r.error_px === 15 && r.uncovered_error_px === 14 && r.components.every(c => c.px === 2) && r.below_floor.count === 1 && r.below_floor.px === 1 && r.below_floor.uncovered_px === 1 && r.components.reduce((n,c)=>n+c.px,0)+r.below_floor.px===r.error_px && r.components.reduce((n,c)=>n+c.uncovered_px,0)+r.below_floor.uncovered_px===r.uncovered_error_px, JSON.stringify({error:r.error_px,uncovered:r.uncovered_error_px,below:r.below_floor}));
  say('AS844_DIFF_IDS_AND_BYTES_ARE_DETERMINISTIC', text === serializeDiffComponents(measureDiffComponents(input,2)) && readDiffComponents(text,input).components[0].id === 'p30-n2', r.components.map(c=>c.id).join(','));
  stack.data[0] = 254;
  const changed = {...input,stack:{...input.stack,bytes:encodePngBytes(stack)}};
  const paintChanged = {...input,painting:{...input.painting,bytes:changed.stack.bytes}};
  say('AS845_DIFF_READER_BINDS_BOTH_EXACT_PNG_BUFFERS', measureDiffComponents(changed,2).stack.sha256 !== r.stack.sha256 && refused(()=>readDiffComponents(text,changed),'DIFF_COMPONENTS_BINDING') && refused(()=>readDiffComponents(text,paintChanged),'DIFF_COMPONENTS_BINDING'), 'one changed decoded stack pixel changes SHA; stack and painting mismatch refused');
  const inside = new Uint8Array(150); inside[30] = 1;
  const scoped = measureDiffComponents({...input,inside},1);
  const f = measureRecomposite(newRasterFromBytes(),painting,[part],inside);
  function newRasterFromBytes() { const copy = newRaster(30,5); copy.data.set(stack.data); copy.data[0]=255; return copy; }
  say('AS846_DIFF_DOMAIN_AND_CUSTOM_THRESHOLD_USE_THE_SHARED_PREDICATE', scoped.error_px === 1 && scoped.uncovered_error_px === 0 && f.errorPx === scoped.error_px && measureDiffComponents(input,1,255).error_px === 0 && measureDiffComponents(changed,1,0).error_px === 16 && refused(()=>readDiffComponents(text,{...input,inside}),'DIFF_COMPONENTS_REPORT'), 'one-pixel domain: 1 covered error; >255: 0; >0 includes the changed pixel; changed domain refused');
  const first = r.components[0];
  say('AS847_DIFF_MIXED_COVERAGE_NATIVE_BOX_AND_BORDERS_ARE_MEASURED', first.coverage === 'mixed' && first.uncovered_px===1 && JSON.stringify(first.box)==='{"x":0,"y":1,"w":1,"h":2}' && first.borders[0]?.part==='marker' && first.borders[0]?.px===1 && r.components[1].coverage==='uncovered' && scoped.components[0].coverage==='covered', JSON.stringify(first));
  const invalidDefinitions = caught(()=>measureDiffComponents(input,0,256));
  const invalid = [0,-1,1.5,NaN,Infinity].every(v=>refused(()=>measureDiffComponents(input,v),'DIFF_COMPONENTS_INPUT')) && [-1,256,NaN,Infinity].every(v=>refused(()=>measureDiffComponents(input,1,v),'DIFF_COMPONENTS_INPUT'));
  say('AS848_DIFF_INVALID_DEFINITIONS_SHAPES_AND_REPORTS_ARE_REFUSED', invalidDefinitions?.problems.length===2 && invalidDefinitions.problems.map(p=>p.object).join(',')==='floor_px,threshold' && invalid && refused(()=>measureDiffComponents({...input,parts:[{...part,image:{...image,data:new Uint8ClampedArray(0)}}]},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,stack:{path:'not-png',bytes:new Uint8Array([0])}},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,painting:{path:'not-png',bytes:new Uint8Array([0])}},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,inside:new Uint8Array(150).fill(2)},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,inside:new Uint8Array(1)},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,parts:[part,part]},1),'DIFF_COMPONENTS_INPUT') && refused(()=>measureDiffComponents({...input,stack:{path:'small.png',bytes:encodePngBytes(image)}},1),'DIFF_COMPONENTS_INPUT') && refused(()=>readDiffComponents('{',input),'DIFF_COMPONENTS_REPORT') && refused(()=>readDiffComponents('{}',input),'DIFF_COMPONENTS_REPORT'), 'invalid floor/threshold, PNG bytes, domain, duplicate parts, dimensions, JSON and spec refused');
  const both = caught(() => readDiffComponents(text, {...changed,painting:paintChanged.painting}));
  const malformedBindings = caught(()=>readDiffComponents(JSON.stringify({...r,stack:{...r.stack,sha256:{toString:0}},painting:{...r.painting,sha256:{toString:0,valueOf:0}}}),input));
  say('AS850_DIFF_READER_COLLECTS_BOTH_SOURCE_BINDING_MISMATCHES', malformedBindings?.problems.length===2 && malformedBindings.problems.every(p=>p.code==='DIFF_COMPONENTS_BINDING') && both?.problems.length===2 && both.problems.every(p=>p.code==='DIFF_COMPONENTS_BINDING') && both.problems.map(p=>p.object).join(',')==='stack,painting' && both.problems.every(p=>p.detail.includes('sha256 is ') && p.detail.includes('is required')), JSON.stringify({both:both?.problems,malformed:malformedBindings?.problems}));
  const edited = {...r,components:r.components.map((c,i)=>i===0?{...c,px:c.px+1}:c),below_floor:{...r.below_floor,px:r.below_floor.px+1}};
  const fields = caught(()=>readDiffComponents(JSON.stringify(edited),input));
  const extraMissing = {...r,components:[{...r.components[0],unexpected:7},...r.components.slice(1)]};
  const missing = extraMissing.components[0] as Partial<typeof extraMissing.components[number]>;
  delete missing.box;
  const missingFields = caught(()=>readDiffComponents(JSON.stringify(extraMissing),input));
  const escapedKey = 'line\nbreak';
  const escaped = caught(()=>readDiffComponents(JSON.stringify({...r,[escapedKey]:{[escapedKey]:1}}),input));
  const overflow = caught(()=>readDiffComponents(text.replace('"px": 2','"px": 1e400'),input));
  const overflowNamed = overflow !== null && overflow.problems.every(p=>p.code==='DIFF_COMPONENTS_REPORT') && overflow.problems.some(p=>p.object==='report.components[0].px' ? p.detail.includes('found Infinity; required 2') : p.detail.includes('cannot parse JSON'));
  say('AS851_DIFF_READER_NAMES_ALL_CHANGED_MISSING_AND_EXTRA_FIELDS',overflowNamed && escaped?.problems.length===1 && escaped.problems[0].object==='report['+JSON.stringify(escapedKey)+']' && !escaped.problems[0].object.includes('\n') && !escaped.problems[0].detail.includes('\n') && fields?.problems.length===2 && fields.problems.map(p=>p.object).join(',')==='report.components[0].px,report.below_floor.px' && fields.problems[0].detail.includes('found 3; required 2') && fields.problems[1].detail.includes('found 2; required 1') && missingFields?.problems.length===2 && missingFields.problems.some(p=>p.object==='report.components[0].box' && p.detail.includes('found missing; required {')) && missingFields.problems.some(p=>p.object==='report.components[0].unexpected' && p.detail.includes('found 7; required missing')), JSON.stringify({changed:fields?.problems,missingExtra:missingFields?.problems,escaped:escaped?.problems,overflow:overflow?.problems}));
  const empty = measureDiffComponents({...input,painting:input.stack},1);
  say('AS849_DIFF_EMPTY_INVENTORY_AND_STRICT_THRESHOLD_HAVE_POSITIVE_CONTROLS', empty.error_px===0 && empty.components.length===0 && empty.below_floor.px===0 && readDiffComponents(serializeDiffComponents(empty),{...input,painting:input.stack}).error_px===0 && measureDiffComponents(input,1,254).error_px===15, 'equal bytes: zero inventory; max difference 255 is strictly above 254');
  const overlapPaint = newRaster(20, 5); overlapPaint.data.fill(255);
  for (const [x, y] of [[1, 1], [1, 2], [5, 1], [6, 1], [5, 2], [16, 1], [17, 1], [8, 3], [9, 3], [10, 3]]) overlapPaint.data.set([0, 0, 0, 255], (y * 20 + x) * 4);
  const backImg = newRaster(10, 5); backImg.data.fill(255);
  const frontImg = newRaster(10, 5); frontImg.data.fill(255); frontImg.data[(3 * 10 + 4) * 4 + 3] = 128;
  const backPart: PlacedPart = { record: { ...EXPECTED_PARTS.parts[0], name: 'back', x: 0, y: 0, w: 10, h: 5 }, image: backImg };
  const frontPart: PlacedPart = { record: { ...EXPECTED_PARTS.parts[0], name: 'front', x: 4, y: 0, w: 10, h: 5 }, image: frontImg };
  const overlapStack = recomposite([backPart, frontPart], 20, 5);
  const overlapOut = measureDiffComponents({ stack: { path: 's.png', bytes: encodePngBytes(overlapStack) }, painting: { path: 'p.png', bytes: encodePngBytes(overlapPaint) }, parts: [backPart, frontPart], inside: null }, 1, ERROR_LIMIT, true);
  const rOwners = measureDiffComponents(input, 2, ERROR_LIMIT, true), v2Text = serializeDiffComponents(rOwners);
  say('AS852_DIFF_OWNERS_NAME_TOPMOST_PARTS_BACK_TO_FRONT_AND_UNCOVERED_NAMES_NONE',
    overlapOut.spec === DIFF_COMPONENTS_OWNERS_SPEC &&
    overlapOut.components.length === 4 &&
    overlapOut.components[0].id === 'p21-n2' && JSON.stringify(overlapOut.components[0].owners) === JSON.stringify([{ part: 'back', px: 2 }]) &&
    overlapOut.components[1].id === 'p25-n3' && JSON.stringify(overlapOut.components[1].owners) === JSON.stringify([{ part: 'front', px: 3 }]) &&
    overlapOut.components[2].id === 'p36-n2' && overlapOut.components[2].coverage === 'uncovered' && JSON.stringify(overlapOut.components[2].owners) === '[]' &&
    overlapOut.components[3].id === 'p68-n3' && JSON.stringify(overlapOut.components[3].owners) === JSON.stringify([{ part: 'back', px: 1 }, { part: 'front', px: 2 }]) &&
    JSON.stringify(rOwners.components[0].owners) === JSON.stringify([{ part: 'marker', px: 1 }]) &&
    rOwners.components.slice(1).every(c => c.owners?.length === 0),
    JSON.stringify(overlapOut.components.map(c => ({ id: c.id, coverage: c.coverage, owners: c.owners }))));
  const strippedV2 = serializeDiffComponents({ ...rOwners, spec: DIFF_COMPONENTS_SPEC, components: rOwners.components.map(({ owners: _, ...rest }) => rest) });
  const v1OnlyCaught = caught(() => readDiffComponents(v2Text, input, [DIFF_COMPONENTS_SPEC]));
  const mainLine2381 = (rawSpec: unknown): string | null => rawSpec !== DIFF_COMPONENTS_SPEC ? `spec is ${JSON.stringify(rawSpec)}; ${DIFF_COMPONENTS_SPEC} is required` : null;
  const ownerMutant = caught(() => readDiffComponents(JSON.stringify({ ...rOwners, components: rOwners.components.map((c, i) => i === 0 ? { ...c, owners: [{ part: 'marker', px: 2 }] } : c) }), input));
  say('AS853_DIFF_DEFAULT_V1_BYTES_HOLD_BOTH_VERSIONS_VERIFY_AND_V1_ONLY_READER_REFUSES_V2',
    r.spec === DIFF_COMPONENTS_SPEC &&
    r.components.every(c => !('owners' in c)) &&
    text === strippedV2 &&
    readDiffComponents(text, input).spec === DIFF_COMPONENTS_SPEC &&
    readDiffComponents(v2Text, input).spec === DIFF_COMPONENTS_OWNERS_SPEC &&
    v1OnlyCaught?.problems.length === 1 && v1OnlyCaught.problems[0].code === 'DIFF_COMPONENTS_REPORT' &&
    v1OnlyCaught.problems[0].detail === 'spec is "rig-parts-diff-components/2"; rig-parts-diff-components/1 is required' &&
    mainLine2381((JSON.parse(v2Text) as { spec: unknown }).spec) === v1OnlyCaught.problems[0].detail &&
    ownerMutant?.problems.some(p => p.code === 'DIFF_COMPONENTS_REPORT' && p.object === 'report.components[0].owners[0].px') === true,
    JSON.stringify({ defaultSpec: r.spec, v2Spec: rOwners.spec, v1Only: v1OnlyCaught?.problems, ownerMutant: ownerMutant?.problems }));
}
export function runDiffComponentCliChecks(dir: string, say: Say, cli: string): void {
  const fixture = join(dir,'diff-fixture');
  writeAssembleFixture(fixture);
  const source = readPng(join(fixture,'painting.png'));
  const assembled = assemble({source,full:readWrapperLayers(join(fixture,'full')),head:readWrapperLayers(join(fixture,'head')),
    ...stageFields(loadConfig(join(fixture,'config.json'))),seamRule:'near-white',projectRule:DEFAULT_PROJECT_RULE});
  writeFileSync(join(dir,'diff-stack.png'),encodePngBytes(assembled.recomposite));
  writeFileSync(join(dir,'diff-painting.png'),encodePngBytes(sourceInRig(source,...assembled.parts.rig_size)));
  mkdirSync(join(dir,'parts'),{recursive:true});
  for (const {record,image} of assembled.images) writeFileSync(join(dir,'parts',`${record.name}.png`),encodePngBytes(image));
  writeParts(join(dir,'diff-parts.json'),assembled.parts);
  const out = join(dir,'diff.json');
  const base = ['diff-components','--stack',join(dir,'diff-stack.png'),'--painting',join(dir,'diff-painting.png'),'--parts',join(dir,'diff-parts.json'),'--floor','1'];
  const run = (args: string[]) => spawnSync('bun',[cli,...args],{encoding:'utf8'});
  const good = run([...base,'--out',out]);
  const verified = good.status===0 ? run([...base,'--verify',out]) : null;
  const report = good.status===0 ? JSON.parse(readFileSync(out,'utf8')) as { error_px:number } : null;
  const emitted = good.status===0 ? readFileSync(out,'utf8') : null;
  const halfSize = assembled.parts.rig_size;
  const fullSize = halfSize.map(size => size * 2);
  const fullImage = newRaster(fullSize[0],fullSize[1]);
  fullImage.data.fill(255);
  const fullImagePath = join(dir,'full-size.png');
  writeFileSync(fullImagePath,encodePngBytes(fullImage));
  const halfBase = base.map(value => value === join(dir,'diff-stack.png') || value === join(dir,'diff-painting.png') ? fullImagePath : value);
  const halfWrite = run([...halfBase,'--out',out]);
  const halfVerify = run([...halfBase,'--verify',out]);
  const repeated = run([...base,'--out',out]);
  const nativeReport = serializeDiffComponents(measureDiffComponents({
    stack:{path:join(dir,'diff-stack.png'),bytes:readFileSync(join(dir,'diff-stack.png'))},
    painting:{path:join(dir,'diff-painting.png'),bytes:readFileSync(join(dir,'diff-painting.png'))},
    parts:assembled.images,inside:null,
  },1));
  const sizeRefused = [halfWrite,halfVerify].every(result => result.status === 1 && result.stdout.includes('DIFF_COMPONENTS_INPUT') && result.stdout.includes('parts.rig_size') && result.stdout.includes(`is ${halfSize.join('x')}; painting ${fullSize.join('x')} is required, with no resampling`));
  const sameBytes = emitted !== null && repeated.status === 0 && readFileSync(out,'utf8') === emitted && emitted === nativeReport;
  say('CL831_DIFF_COMMAND_REFUSES_OTHER_RIG_SIZE_AND_PRESERVES_NATIVE_BYTES', sizeRefused && sameBytes && verified?.status === 0, `half-size write=${halfWrite.status}, verify=${halfVerify.status}, native verify=${verified?.status}, native bytes identical=${sameBytes}; ${halfWrite.stdout.replace(/\s+/g,' ').trim()}`);
  const figure = newRaster(...assembled.parts.rig_size);
  for (let p=0;p<figure.width*figure.height;p++) figure.data[p*4+3]=255;
  figure.data.set([255,255,255,255],figure.data.length-4);
  const figurePath=join(dir,'native-figure.png'),figureOut=join(dir,'native-diff.json');
  writeFileSync(figurePath,encodePngBytes(figure));
  const figureWrite=run([...base,'--figure',figurePath,'--out',figureOut]);
  const figureVerify=figureWrite.status===0?run([...base,'--figure',figurePath,'--verify',figureOut]):null;
  const figureReport=figureWrite.status===0?JSON.parse(readFileSync(figureOut,'utf8')) as DiffComponentsReport:null;
  const expectedDomain=new Uint8Array(EXPECTED_PARTS.rig_size[0]*EXPECTED_PARTS.rig_size[1]);
  expectedDomain[expectedDomain.length-1]=1;
  const figureOk=figureWrite.status===0 && figureVerify?.status===0 && figureReport?.error_px===1 && figureReport.uncovered_error_px===1 && figureReport.components.length===1 && figureReport.components[0].id===`p${expectedDomain.length-1}-n1` && JSON.stringify(figureReport.components[0].box)===JSON.stringify({x:EXPECTED_PARTS.rig_size[0]-1,y:EXPECTED_PARTS.rig_size[1]-1,w:1,h:1}) && figureReport.definition.inside_sha256===createHash('sha256').update(expectedDomain).digest('hex');
  const wrongDomain=figureWrite.status===0?run([...base,'--verify',figureOut]):null;
  const badSize=newRaster(1,1);badSize.data.fill(255);
  const badSizePath=join(dir,'wrong-size-figure.png');writeFileSync(badSizePath,encodePngBytes(badSize));
  const wrongSize=run([...base,'--figure',badSizePath,'--out',out]);
  const badPixels=[[127,127,127,255],[255,255,255,0],[255,0,0,255]].map((rgba,i)=>{
    const image={...figure,data:new Uint8ClampedArray(figure.data)};image.data.set(rgba,0);
    const path=join(dir,`wrong-pixel-figure-${i}.png`);writeFileSync(path,encodePngBytes(image));
    return run([...base,'--figure',path,'--out',out]);
  });
  const blank = run([...base,'--threshold','','--out',out]);
  const whitespace = run([...base,'--threshold',' ','--out',out]);
  const emptyOut = run([...base,'--out','']);
  const missingParent = run([...base,'--out',join(dir,'missing-parent','diff.json')]);
  const badPolicy = run([...base,'--threshold','Infinity','--verify',out]);
  const retained = good.status===0 && readFileSync(out,'utf8')===emitted;
  const missing = run(['diff-components','--floor','1']);
  const unknown = run([...base,'--unknown','value','--out',out]);
  const ownersOut = join(dir, 'owners-diff.json');
  const ownersWrite = run([...base, '--owners', '--out', ownersOut]);
  const ownersVerify = ownersWrite.status === 0 ? run([...base, '--verify', ownersOut]) : null;
  const ownersFlagVerify = ownersWrite.status === 0 ? run([...base, '--owners', '--verify', ownersOut]) : null;
  const v1WithOwnersFlag = good.status === 0 ? run([...base, '--owners', '--verify', out]) : null;
  const dupOwners = run([...base, '--owners', '--owners', '--out', ownersOut]);
  const expectedOwnersBytes = serializeDiffComponents(measureDiffComponents({
    stack:{path:join(dir,'diff-stack.png'),bytes:readFileSync(join(dir,'diff-stack.png'))},
    painting:{path:join(dir,'diff-painting.png'),bytes:readFileSync(join(dir,'diff-painting.png'))},
    parts:assembled.images,inside:null,
  }, 1, ERROR_LIMIT, true));
  const ownersOk = ownersWrite.status === 0 && readFileSync(ownersOut, 'utf8') === expectedOwnersBytes && ownersVerify?.status === 0 && ownersFlagVerify?.status === 0 && v1WithOwnersFlag?.status === 1 && v1WithOwnersFlag.stdout.includes('DIFF_COMPONENTS_REPORT') && v1WithOwnersFlag.stdout.includes('spec is "rig-parts-diff-components/1"; rig-parts-diff-components/2 is required') && dupOwners.status === 2;
  say('CL830_DIFF_COMMAND_WRITES_VERIFIES_AND_REFUSES_MISSING_UNKNOWN_OR_EMPTY_FLAGS',figureOk && ownersOk && wrongDomain?.status===1 && wrongDomain.stdout.includes('DIFF_COMPONENTS_REPORT') && wrongSize.status===1 && wrongSize.stdout.includes('is 1x1') && wrongSize.stdout.includes(`painting ${EXPECTED_PARTS.rig_size[0]}x${EXPECTED_PARTS.rig_size[1]} is required`) && badPixels.every(r=>r.status===1 && r.stdout.includes('DIFF_COMPONENTS_INPUT') && r.stdout.includes('pixel 0,0')) && good.status===0 && verified?.status===0 && report?.error_px===assembled.figures.errorPx && report?.error_px===EXPECTED_PARTS.recomposite.error_px && missing.status===1 && missing.stdout.includes('DIFF_COMPONENTS_INPUT') && unknown.status===2 && blank.status===1 && blank.stdout.includes('DIFF_COMPONENTS_INPUT') && whitespace.status===1 && whitespace.stdout.includes('DIFF_COMPONENTS_INPUT') && emptyOut.status===1 && emptyOut.stdout.includes('DIFF_COMPONENTS_INPUT') && missingParent.status===1 && missingParent.stdout.includes('DIFF_COMPONENTS_INPUT') && badPolicy.status===1 && badPolicy.stdout.includes('a finite channel threshold') && retained, `write=${good.status}, verify=${verified?.status}, ownersOk=${ownersOk}, errors=${report?.error_px}, missing=${missing.status}, unknown=${unknown.status}, blank=${blank.status}, whitespace=${whitespace.status}, native figure=${figureOk}, wrong domain=${wrongDomain?.status}, wrong size=${wrongSize.status}, bad pixels=${badPixels.map(r=>r.status).join(",")}, empty output=${emptyOut.status}, missing parent=${missingParent.status}, invalid verify policy=${badPolicy.status}, emitted bytes retained=${retained}; ${[good.stdout,good.stderr].join(' ').replace(/\s+/g,' ').trim()}`);
}
/** Public recipe control: every mask pixel agrees with the count's own RGB predicate and domain. */
export function publicDiffControl(stack: Parameters<typeof errorMask>[0], painting: Parameters<typeof errorMask>[1], parts: PlacedPart[], inside: Uint8Array | null): { ok: boolean; detail: string } {
  const input: DiffInputs = { stack:{path:'stack.png',bytes:encodePngBytes(stack)},painting:{path:'painting.png',bytes:encodePngBytes(painting)},parts,inside };
  const r = measureDiffComponents(input,1), r2 = measureDiffComponents(input,1,ERROR_LIMIT,true), f = measureRecomposite(stack,painting,parts,inside), mask = errorMask(stack,painting,inside);
  let same = true, count = 0;
  for (let p=0;p<mask.length;p++) {
    const want = (inside===null || inside[p]!==0) && Math.max(...[0,1,2].map(c=>Math.abs(stack.data[p*4+c]-painting.data[p*4+c])))>40 ? 1 : 0;
    if (mask[p]!==want) same=false;
    count+=mask[p];
  }
  const total = r.components.reduce((n,c)=>n+c.px,0)+r.below_floor.px, uncovered=r.components.reduce((n,c)=>n+c.uncovered_px,0)+r.below_floor.uncovered_px;
  const ownersAddUp = r.spec === DIFF_COMPONENTS_SPEC && r.components.every(c => !('owners' in c)) && r2.spec === DIFF_COMPONENTS_OWNERS_SPEC && r2.components.every(c => (c.owners?.reduce((n, o) => n + o.px, 0) ?? -1) === c.px - c.uncovered_px);
  return {ok:same && ownersAddUp && count===f.errorPx && total===f.errorPx && uncovered===f.uncoveredErrorPx && serializeDiffComponents(r)===serializeDiffComponents(measureDiffComponents(input,1)),detail:`diff components=${r.components.length}, px=${total}/${f.errorPx}, uncovered=${uncovered}/${f.uncoveredErrorPx}, ownersAddUp=${ownersAddUp}, predicate pixel agreement=${same}, domain=${inside===null?'whole':'figure'}`};
}
