/** Assembly controls for #848; expectations are derived from public rectangles. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paintingExtensionConfig, paintingExtensionFixture, PAINTING_EXTENSION } from '../fixtures/painting_extension.ts';
import { assemble, stageFields, type AssembleResult } from '../src/assemble.ts';
import { assembleStage } from '../src/build.ts';
import { parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { paintingExtensionMasks } from '../src/paintingextension.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { provenanceAddsUp } from '../src/provenance.ts';
import { writePng, readPng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

export function sampleExtensionPart(result: AssembleResult, name: string, x: number, y: number): number[] {
  const part = result.images.find(p => p.record.name === name);
  if (part === undefined) throw new Error('Missing synthetic part ' + name);
  const { record: r, image } = part;
  if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return [0, 0, 0, 0];
  return Array.from(image.data.subarray(((y - r.y) * r.w + x - r.x) * 4, ((y - r.y) * r.w + x - r.x) * 4 + 4));
}

export function paintingGapCount(result: AssembleResult): number {
  let count = 0;
  for (let y = 18; y < 25; y++) for (let x = 10; x < 18; x++) {
    if (result.images.every(p => sampleExtensionPart(result, p.record.name, x, y)[3] === 0)) count++;
  }
  return count;
}

/** The packet dry-run uses these exact files through the real readers. */
export function writePaintingExtensionFixture(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const f = paintingExtensionFixture();
  writePng(join(dir, 'painting.png'), f.source);
  writeFileSync(join(dir, 'config.json'), JSON.stringify(paintingExtensionConfig()));
  // A valid unused head run keeps this fixture on the ordinary two-run door.
  for (const [name, layers] of [['full', f.full.layers], ['head', [f.full.layers[0]]]] as const) {
    mkdirSync(join(dir, name, 'parts'), { recursive: true });
    for (const l of layers) writePng(join(dir, name, 'parts', l.name + '.png'), l.pixels);
    writeFileSync(join(dir, name, 'layers.json'), JSON.stringify({ width: 64, height: 64,
      layers: layers.map(l => ({ name: l.name, filename: 'block_' + l.name + '.png', left: 0, top: 0, right: 64, bottom: 64, depth_median: l.depth })) }));
  }
}

function refused(fn: () => unknown, code: string): boolean {
  try { fn(); return false; } catch (e) { return e instanceof PartsError && e.problems.some(p => p.code === code); }
}

export function runPaintingExtensionChecks(dir: string, say: (name: string, ok: boolean, detail: string) => void): void {
  const f = paintingExtensionFixture(), base = assemble(f);
  const fields = stageFields(parseEarlyConfig(paintingExtensionConfig(), 'assemble'));
  const r = assemble({ ...f, ...fields });
  say('PE01_PUBLIC_TWO_LAYER_GAP_IS_RED_WITHOUT_DECLARATION', paintingGapCount(base) === 56,
    `unheld gap ${paintingGapCount(base)}; hand-derived 8 x 7 = 56`);
  let gained = 0, exact = true, preserved = true;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const before = sampleExtensionPart(base, 'upper', x, y), after = sampleExtensionPart(r, 'upper', x, y);
    if (before[3] > 0) preserved &&= before.join(',') === after.join(',');
    if (before[3] === 0 && after[3] > 0) {
      gained++;
      exact &&= x >= 10 && x < 18 && y >= 18 && y <= 20 &&
        after.join(',') === Array.from(f.source.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)).join(',');
    }
    preserved &&= sampleExtensionPart(base, 'lower', x, y).join(',') === sampleExtensionPart(r, 'lower', x, y).join(',');
  }
  say('PE02_DECLARED_PART_GAINS_EXACT_PAINTING_RGBA_WITHIN_PATH_BOUND', gained === 24 && exact && preserved && paintingGapCount(r) === 32,
    `gained ${gained}, exact RGBA ${exact}, all original/other-part samples preserved ${preserved}, gap ${paintingGapCount(r)}`);
  say('PE03_DISCONNECTED_BEYOND_BAND_DISTANCE_AND_NONOPAQUE_STAY_UNHELD',
    [[19,16],[9,18],[10,21],[10,24],[18,17],[20,17]].every(([x,y]) => r.images.every(p => sampleExtensionPart(r,p.record.name,x,y)[3] === 0)),
    'disconnected (19,16), outside band (9,18), distance 4/7 (10,21)/(10,24), alpha 249 (18,17), transparent (20,17)');
  const far = assemble({ ...f, paintingExtension: [{ ...PAINTING_EXTENSION, max_distance: 7 }] });
  say('PE04_BOUND_IS_EFFECTIVE_AND_LONGER_DECLARED_PATH_REACHES_THE_REST', paintingGapCount(far) === 0 && paintingGapCount(r) === 32,
    `distance 7 gap ${paintingGapCount(far)}, distance 3 gap ${paintingGapCount(r)}; no implicit whole-component fill`);
  const prov = r.parts.parts.find(p => p.name === 'upper')!.provenance!;
  say('PE05_GAINED_PIXEL_PROVENANCE_COUNTS_EXACT_LAST_WRITER', prov.automatic.find(e => e.stage === 'paintingExtension')?.px === 24 &&
    r.parts.parts.every(p => provenanceAddsUp(p.provenance!, p.opaque_px)), JSON.stringify(prov));
  say('PE06_EMPTY_DECLARATION_AND_REPEAT_PRESERVE_BYTES', serializeParts(assemble({ ...f, paintingExtension: [] }).parts) === serializeParts(base.parts) &&
    serializeParts(assemble({ ...f, ...fields }).parts) === serializeParts(r.parts), 'absent versus empty and two identical declared runs');

  const bad: Array<[unknown, string]> = [
    [true, 'CONFIG_FIELD_TYPE'], [[null], 'CONFIG_FIELD_TYPE'], [[{...PAINTING_EXTENSION, part: ''}], 'CONFIG_FIELD_TYPE'],
    [[{part: 'upper', band: [10,15,22,25]}], 'CONFIG_FIELD_PRESENT'],
    [[{...PAINTING_EXTENSION, max_distance: 0}], 'CONFIG_FIELD_TYPE'], [[{...PAINTING_EXTENSION, max_distance: 1.5}], 'CONFIG_FIELD_TYPE'],
    [[{...PAINTING_EXTENSION, band: [10,15,10,25]}], 'CONFIG_FIELD_TYPE'], [[{...PAINTING_EXTENSION, band: [-1,15,22,25]}], 'CONFIG_FIELD_TYPE'],
    [[{...PAINTING_EXTENSION, band: [10,15,22,25.1]}], 'CONFIG_FIELD_TYPE'], [[{...PAINTING_EXTENSION, global: true}], 'CONFIG_KEY_KNOWN'],
    [[PAINTING_EXTENSION, PAINTING_EXTENSION], 'CONFIG_PART_UNIQUE'],
  ];
  let shapePasses = 0;
  for (const [v, code] of bad) for (const door of ['layers', 'assemble', 'full'] as const) {
    const cfg = paintingExtensionConfig(v);
    if (refused(() => door === 'full' ? parseConfig(cfg) : door === 'layers' ? parseEarlyConfig(cfg, 'layers') : parseEarlyConfig(cfg, 'assemble'), code)) shapePasses++;
  }
  say('PE07_EVERY_CONFIG_DOOR_REFUSES_MALFORMED_EXPLICIT_DECLARATIONS', shapePasses === bad.length * 3,
    `${shapePasses}/${bad.length * 3} shape plants refused at layers, assemble and full doors; valid full config ${parseConfig(paintingExtensionConfig()).key}`);
  say('PE08_UNKNOWN_NAMES_AND_OFF_CANVAS_BANDS_ARE_NAMED_REFUSALS',
    refused(() => parseConfig(paintingExtensionConfig([{...PAINTING_EXTENSION, part:'missing'}])), 'CONFIG_NAME_RESOLVES') &&
    refused(() => parseEarlyConfig(paintingExtensionConfig([{...PAINTING_EXTENSION, part:'missing'}]), 'assemble'), 'CONFIG_NAME_RESOLVES') &&
    refused(() => assemble({...f,paintingExtension:[{...PAINTING_EXTENSION,band:[10,15,65,25]}]}), 'ASSEMBLE_PAINTING_BAND_INSIDE') &&
    refused(() => assemble({...f,paintingExtension:[{...PAINTING_EXTENSION,part:'missing'}]}), 'CONFIG_NAME_RESOLVES'),
    'unknown final names refused by both complete readers and direct API; x1=65 refused against 64-wide rig, not clipped');
  const beforeConflict = Array.from(f.source.data).join(',');
  say('PE09_COMPETING_DECLARATIONS_REFUSE_WITHOUT_ORDER_BASED_ASSIGNMENT',
    refused(() => assemble({...f,paintingExtension:[{...PAINTING_EXTENSION,max_distance:7},{...PAINTING_EXTENSION,part:'lower',max_distance:7}]}), 'ASSEMBLE_PAINTING_EXTENSION_CONFLICT') &&
    beforeConflict === Array.from(f.source.data).join(','), 'upper and lower both reach the gap; painting input unchanged');

  // One cropped alpha-1 holder and one alpha-8 holder block exact coordinates,
  // although neither meets the existing reporting threshold alpha >8.
  const holder = newRaster(1,1); holder.data.set([1,2,3,1]);
  const target = f.full.layers[0].pixels;
  const held = paintingExtensionMasks([PAINTING_EXTENSION], [{name:'upper',image:target}, {name:'held',image:holder,x:11,y:18}], f.source).get('upper')!;
  holder.data[3] = 8;
  const held8 = paintingExtensionMasks([PAINTING_EXTENSION], [{name:'upper',image:target}, {name:'held',image:holder,x:11,y:18}], f.source).get('upper')!;
  say('PE10_EVEN_FAINT_CROPPED_HOLDERS_BLOCK_GAINS', held.data[18*64+11] === 0 && held8.data[18*64+11] === 0 && held.data[18*64+12] === 1,
    'alpha 1 and alpha 8 held coordinates excluded; adjacent unheld coordinate included');
  const weak = newRaster(64,64); weak.data[(17*64+10)*4+3]=8;
  const weakGain = paintingExtensionMasks([PAINTING_EXTENSION], [{name:'upper',image:weak}], f.source).get('upper')!;
  say('PE11_ALPHA_EIGHT_IS_NO_TARGET_SILHOUETTE_AND_DIAGONAL_IS_NO_PATH', !weakGain.data.some(v=>v===1) && held.data[16*64+19]===0,
    'seed threshold is alpha >8; isolated opaque sample behind transparent column stays disconnected');
  say('PE12_INTERNAL_CANVAS_MISMATCH_REFUSES', refused(() => paintingExtensionMasks([PAINTING_EXTENSION], [{name:'upper',image:newRaster(65,64)}], f.source), 'ASSEMBLE_PAINTING_CANVAS'), '65x64 holder does not fit the 64x64 painting');

  const cutCfg = paintingExtensionConfig([{...PAINTING_EXTENSION,part:'piece'}]);
  const cutAsm = cutCfg.assemble as Record<string,unknown>;
  cutAsm.cuts = [{from:'upper',into:'piece',polygon:[[10,14],[18,14],[18,18],[10,18]],draw:'front',overlap:0}];
  (cutCfg.regions as Record<string,unknown>).piece = 'upper';
  const cutFields = stageFields(parseConfig(cutCfg)), cutRun = assemble({...f,...cutFields});
  say('PE13_FINAL_CUT_PART_NAME_RESOLVES_AND_OWNS_THE_GAIN', paintingGapCount(cutRun)===32 &&
    cutRun.parts.parts.find(p=>p.name==='piece')?.provenance?.automatic.find(e=>e.stage==='paintingExtension')?.px===24,
    'piece takes the lower half of upper; extension belongs to piece after cut, not its source');

  const disk = join(dir,'painting-extension'); writePaintingExtensionFixture(disk);
  const run = (name: string): string => {
    const out = join(disk,name);
    assembleStage({source:join(disk,'painting.png'),full:join(disk,'full'),head:join(disk,'head'),config:join(disk,'config.json'),seam:'near-white',project:'core'},
      {partsJson:join(out,'parts.json'),partsDir:join(out,'parts'),recomposite:join(out,'recomposite_rig.png'),errorMap:join(out,'recomposite_error_rig.png')},()=>{});
    return out;
  };
  const diskA=run('a'), diskB=run('b'), parsed=readParts(join(diskA,'parts.json'));
  const record=parsed.parts.find(p=>p.name==='upper')!, image=readPng(join(diskA,'parts/upper.png'));
  say('PE14_REAL_STAGE_WRITES_READER_VALID_PARTS_AND_REPEATS_EXACTLY', record.provenance?.automatic.find(e=>e.stage==='paintingExtension')?.px===24 &&
    record.opaque_px===88 && image.width===8 && image.height===11 &&
    ['parts.json','parts/upper.png','parts/lower.png','recomposite_rig.png','recomposite_error_rig.png'].every(p=>readFileSync(join(diskA,p)).equals(readFileSync(join(diskB,p)))),
    `disk upper ${record.opaque_px} px, ${image.width}x${image.height}, provenance ${JSON.stringify(record.provenance)}; repeated outputs identical`);

  const limbCfg = paintingExtensionConfig([{...PAINTING_EXTENSION,part:'sleeve_end'}]);
  (limbCfg.bones as unknown[]).push({chain:'span',parent:'root',points:[[14,10],[14,14]],tip:[14,18]});
  limbCfg.limbs = {sleeve:{segments:[{part:'sleeve_start',from:'upper',bone:'span0'}, {part:'sleeve_end',from:'upper',bone:'span1',joint:'fold',cap_shape:'disc'}]}};
  limbCfg.regions = {sleeve_start:'span0',sleeve_end:'span1',lower:'lower'};
  const limbFields=stageFields(parseConfig(limbCfg));
  const limbRun=assemble({...f,...limbFields});
  const consumed=structuredClone(limbCfg); (consumed.assemble as Record<string,unknown>).extend_painting=[PAINTING_EXTENSION];
  say('PE15_FINAL_LIMB_NAME_RESOLVES_AND_CONSUMED_PLAN_NAME_REFUSES',
    limbRun.parts.parts.some(p=>p.name==='sleeve_end' && (p.provenance?.automatic.find(e=>e.stage==='paintingExtension')?.px ?? 0)>0) &&
    refused(()=>parseEarlyConfig(consumed,'assemble'),'CONFIG_NAME_RESOLVES') && refused(()=>parseConfig(consumed),'CONFIG_NAME_RESOLVES'),
    'sleeve_end is produced after joint splitting; consumed upper is refused by both complete config readers');

  const df=paintingExtensionFixture(), sheet=newRaster(64,64);
  for(let p=0;p<64*64;p++)sheet.data.set([127,127,127,255],p*4);
  const reading={orderingMedian:0.5,sheetMedian:127,relation:'same' as const};
  df.full.layers[0].depthSheet={file:'synthetic-depth.png',sha256:'0'.repeat(64),pixels:sheet,reading,near:'black',zScale:1,
    sources:[{from:'full:topwear',image:'synthetic-depth.png',sha256:'0'.repeat(64),crop:[0,0,64,64],reading}]};
  const depthBase=assemble({...df,depth:{}});
  say('PE16_PAINTING_GAIN_NEVER_INVENTS_LAYER_DEPTH',depthBase.parts.parts.find(p=>p.name==='upper')?.depth!==undefined &&
    refused(()=>assemble({...df,depth:{},paintingExtension:[PAINTING_EXTENSION]}),'DEPTH_PART_SUPPORT'),
    'declared source layer sheet transports without extension; painting gain refuses undeclared painting depth');
  const diagonal=newRaster(4,4), seedImage=newRaster(4,4);
  seedImage.data.set([10,20,30,255],(1*4+1)*4); diagonal.data.set([20,30,40,255],(2*4+2)*4);
  const small={part:'upper',band:[0,0,4,4] as [number,number,number,number],max_distance:3};
  const diag=paintingExtensionMasks([small],[{name:'upper',image:seedImage}],diagonal).get('upper')!;
  diagonal.data.set([20,30,40,250],(1*4+2)*4);
  const edge=paintingExtensionMasks([small],[{name:'upper',image:seedImage}],diagonal).get('upper')!;
  say('PE17_DIAGONAL_ONLY_REFUSES_AND_ALPHA_250_CONNECTS',!diag.data.some(v=>v===1) && edge.data[1*4+2]===1 && edge.data[2*4+2]===1,
    'diagonal-only sample disconnected; adding one alpha-250 horizontal sample connects it in two steps');

  // Alternate drawings must never inherit the base painting's band coordinates.
  const altCfg=paintingExtensionConfig();
  (altCfg.assemble as Record<string,unknown>).alternates=[{name:'other',source:'painting.png',full:'full',head:'head',parts:['lower']}];
  writeFileSync(join(disk,'config.json'),JSON.stringify(altCfg));
  const altOut=run('alternate'), altParts=readParts(join(altOut,'parts.json'));
  say('PE18_BASE_DECLARATION_IS_NOT_INHERITED_BY_AN_ALTERNATE',
    altParts.parts.find(p=>p.name==='upper')?.provenance?.automatic.find(e=>e.stage==='paintingExtension')?.px===24 &&
    altParts.alternates?.[0]?.records.every(p=>!p.provenance?.automatic.some(e=>e.stage==='paintingExtension'))===true,
    'subset alternate carries only lower; base upper extension is neither guessed onto it nor an unresolved-name failure');

  // A raw one-pixel speck was removed by cleanup; the declared painting path
  // reaches it. Its restored value equals raw, but ownership still came here.
  const speck=paintingExtensionFixture(), q=(20*64+10)*4;
  speck.full.layers[0].pixels.data.set(speck.source.data.subarray(q,q+4),q);
  const restored=assemble({...speck,paintingExtension:[PAINTING_EXTENSION]});
  const restoredPart=restored.parts.parts.find(p=>p.name==='upper')!;
  say('PE19_PAINTING_OWNERSHIP_AND_RAW_VALUE_EQUALITY_ARE_INDEPENDENT', restoredPart.painting_extension_px===24 &&
    restoredPart.provenance?.unchanged_layer_px===65 && restoredPart.provenance?.automatic.find(e=>e.stage==='paintingExtension')?.px===23,
    `gained ${restoredPart.painting_extension_px}, raw-equal ${restoredPart.provenance?.unchanged_layer_px}, automatic painting ${restoredPart.provenance?.automatic.find(e=>e.stage==='paintingExtension')?.px}; one restored speck equals raw`);
  let refusedCounts=0;
  for(const value of [-1,0.5,89]) {
    const planted=structuredClone(r.parts); planted.parts.find(p=>p.name==='upper')!.painting_extension_px=value;
    writeFileSync(join(disk,'invalid-parts.json'),serializeParts(planted));
    if(refused(()=>readParts(join(disk,'invalid-parts.json')),value===89?'PARTS_COUNTS_ADD_UP':'PARTS_FIELD_TYPE'))refusedCounts++;
    const plantedAlt=structuredClone(altParts); plantedAlt.alternates![0].records[0].painting_extension_px=value===89?9999:value;
    writeFileSync(join(disk,'invalid-alt.json'),serializeParts(plantedAlt));
    if(refused(()=>readParts(join(disk,'invalid-alt.json')),value===89?'PARTS_COUNTS_ADD_UP':'PARTS_FIELD_TYPE'))refusedCounts++;
  }
  const emptyReach=assemble({...f,paintingExtension:[{...PAINTING_EXTENSION,band:[0,0,1,1]}]});
  say('PE20_PAINTING_OWNERSHIP_COUNT_IS_READER_CHECKED_AND_ZERO_IS_EXPLICIT',refusedCounts===6 &&
    record.painting_extension_px===24 && emptyReach.parts.parts.find(p=>p.name==='upper')?.painting_extension_px===0,
    `${refusedCounts}/6 invalid count plants refused on base and alternate records; writer records 24 gained or explicit zero`);

  // Native public-fixture panels: painting, default, declared bound, |change|.
  // A separate nearest-neighbour enlargement preserves every boundary sample.
  const panels=newRaster(256,64), zoom=newRaster(1024,256);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)for(let c=0;c<4;c++) {
    const p=(y*64+x)*4+c, d=(y*256+x)*4+c;
    panels.data[d]=c===3?255:Math.round(f.source.data[p]*f.source.data[(y*64+x)*4+3]/255+255*(1-f.source.data[(y*64+x)*4+3]/255));
    panels.data[d+64*4]=base.recomposite.data[p];
    panels.data[d+128*4]=r.recomposite.data[p];
    panels.data[d+192*4]=c===3?255:Math.abs(r.recomposite.data[p]-base.recomposite.data[p]);
  }
  for(let y=0;y<zoom.height;y++)for(let x=0;x<zoom.width;x++) {
    const q=(Math.floor(y/4)*256+Math.floor(x/4))*4;
    zoom.data.set(panels.data.subarray(q,q+4),(y*zoom.width+x)*4);
  }
  writePng(join(disk,'synthetic-native.png'),panels);
  writePng(join(disk,'synthetic-4x.png'),zoom);
}

if (import.meta.main) {
  if (process.argv[2] === '--checks') {
    let failed=0;
    runPaintingExtensionChecks(process.argv[3], (name,ok,detail)=>{console.log(`${ok?'PASS':'FAIL'} ${name}: ${detail}`);if(!ok)failed++;});
    process.exit(failed===0?0:1);
  }
  const input = paintingExtensionFixture();
  const base = assemble(input);
  console.log('BASELINE: two layers; painted gap = ' + paintingGapCount(base) + ' pixels (8 x 7)');
  const declared = assemble({ ...input, paintingExtension: [PAINTING_EXTENSION] });
  const unheld = paintingGapCount(declared), ok = unheld === 32;
  console.log((ok ? 'PASS' : 'FAIL') + ': declared band with distance 3 must gain 24 exact painting pixels; unheld = ' + unheld + ', required 32');
  process.exit(ok ? 0 : 1);
}
