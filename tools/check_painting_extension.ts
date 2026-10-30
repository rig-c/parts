/** Assembly controls for #848; expectations are derived from public rectangles. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paintingExtensionConfig, paintingExtensionFixture, faintPaintingExtensionFixture, interleavingPaintingExtensionFixture, PAINTING_EXTENSION } from '../fixtures/painting_extension.ts';
import { assemble, stageFields, type AssembleResult } from '../src/assemble.ts';
import { assembleStage } from '../src/build.ts';
import { parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { paintingExtensionMasks } from '../src/paintingextension.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { provenanceAddsUp } from '../src/provenance.ts';
import { writePng, readPng, encodePngBytes } from '../src/raster/png.ts';
import { alphaComposite } from '../src/raster/composite.ts';
import { newRaster } from '../src/raster/types.ts';
import { GUIDE_DOC, guideRule } from '../src/guide.ts';

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

  // #854: normal/defect/edge controls are public flat pixels, not art-derived.
  const faint = faintPaintingExtensionFixture();
  const withoutFloor = assemble({ ...faint, paintingExtension: [{ ...PAINTING_EXTENSION, max_distance: 7 }] });
  const floorDeclaration = { ...PAINTING_EXTENSION, max_distance: 7, min_held_alpha: 250 };
  const withFloor = assemble({ ...faint, paintingExtension: [floorDeclaration] });
  const residual = (r: AssembleResult): { total: number; largest: number } => {
    const pixels = new Set<number>();
    for (let y = 18; y < 25; y++) for (let x = 10; x < 18; x++) {
      let remaining = 1;
      for (const p of r.images) remaining *= 1 - sampleExtensionPart(r, p.record.name, x, y)[3] / 255;
      if (255 * (1 - remaining) < 250) pixels.add(y * 64 + x);
    }
    const total = pixels.size; let largest = 0;
    while (pixels.size > 0) {
      const queue = [pixels.values().next().value!]; pixels.delete(queue[0]);
      for (let at = 0; at < queue.length; at++) for (const d of [-65,-64,-63,-1,1,63,64,65]) {
        const p = queue[at] + d;
        if (pixels.delete(p)) queue.push(p);
      }
      largest = Math.max(largest, queue.length);
    }
    return { total, largest };
  };
  const redFaint = residual(withoutFloor), greenFaint = residual(withFloor);
  say('PE21_FAINT_EDGE_RESIDUAL_IS_ZERO_ONLY_WITH_EXPLICIT_FLOOR', redFaint.total === 16 && redFaint.largest === 8 && greenFaint.total === 0,
    `without floor ${JSON.stringify(redFaint)}; floor 250 ${JSON.stringify(greenFaint)}; by hand two separated 8-pixel rows`);
  const faintBase = assemble(faint); let floorGains = 0, floorRGB = true, floorPreserved = true, ownFaint = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const before = sampleExtensionPart(faintBase, 'upper', x, y), after = sampleExtensionPart(withFloor, 'upper', x, y);
    if (after[3] > before[3]) {
      floorGains++; if (before[3] > 0) ownFaint++;
      floorRGB &&= after.join(',') === Array.from(faint.source.data.subarray((y*64+x)*4,(y*64+x)*4+4)).join(',');
    } else floorPreserved &&= before.join(',') === after.join(',');
    floorPreserved &&= sampleExtensionPart(faintBase, 'lower', x, y).join(',') === sampleExtensionPart(withFloor, 'lower', x, y).join(',');
  }
  say('PE22_TARGET_OWN_FAINT_REPLACEMENT_AND_OTHER_HOLDERS_PRESERVATION', floorGains === 56 && ownFaint === 8 && floorRGB && floorPreserved &&
    withFloor.parts.parts.every(p => provenanceAddsUp(p.provenance!,p.opaque_px)) && withFloor.parts.parts.find(p => p.name==='upper')?.painting_extension_px===56,
    `gains ${floorGains}, target own faint ${ownFaint}, exact painting RGBA ${floorRGB}, all other samples preserved ${floorPreserved}; provenance sums checked`);

  const tinySource = newRaster(3,1), tinyTarget = newRaster(3,1);
  for(let x=0;x<3;x++) tinySource.data.set([40,80,120,255],x*4);
  tinyTarget.data.set([10,20,30,255],0);
  const tinyDeclaration = {part:'upper',band:[1,0,2,1] as [number,number,number,number],max_distance:1};
  const unionGain = (alphas: number[], floor: number, reverse = false): number => {
    const holders = alphas.map((a,i) => { const image = newRaster(1,1); image.data.set([200-i,40+i,90,a]); return {name:'holder'+i,image,x:1,y:0}; });
    const stack = [{name:'upper',image:tinyTarget},...holders];
    return paintingExtensionMasks([{...tinyDeclaration,min_held_alpha:floor}],reverse?stack.reverse():stack,tinySource).get('upper')!.data[1];
  };
  // 128 over 128 = 191 + 191/255, below 192 (sum would block),
  // but above 191 (max would allow). 51 over 85 = exactly 119.
  const unionCases: Array<[number[],number,number]> = [[[128,128],192,1],[[128,128],191,0],[[51,85],119,0],[[51,85],120,1],[[35],35,0],[[34],35,1],[[1,1],2,1],[[1,1],1,0],[[254,254,254,254,254,254,254],255,1],[[255],255,0],[[249],250,1],[[250],250,0],[[251],250,0],[[239,170],250,1],[[240,170],250,0],[[241,170],250,0]];
  say('PE23_EXACT_ALPHA_OVER_UNION_BOUNDARY_NOT_MAX_SUM_OR_ROUNDED', unionCases.every(([a,f,w])=>unionGain(a,f)===w && unionGain(a,f,true)===w),
    'hand-derived union controls: 128/128 below 192 and above 191; 51/85 exactly 119; single 34/35; 1/1 below 2; seven 254s below 255; opaque 255 blocks; 240/170 exactly 250, 239/170 below and 241/170 above; single 249/250/251, both stack orders');
  let floorShapes=0;
  for(const value of [0,256,-1,1.5,'128',null,true]) {
    for(const door of ['layers','assemble','full'] as const) {
      const cfg=paintingExtensionConfig([{...PAINTING_EXTENSION,min_held_alpha:value}]);
      if(refused(()=>door==='full'?parseConfig(cfg):door==='layers'?parseEarlyConfig(cfg,'layers'):parseEarlyConfig(cfg,'assemble'),'CONFIG_FIELD_TYPE')) floorShapes++;
    }
    if(refused(()=>paintingExtensionMasks([{...tinyDeclaration,min_held_alpha:value} as unknown as typeof floorDeclaration],[{name:'upper',image:tinyTarget}],tinySource),'CONFIG_FIELD_TYPE'))floorShapes++;
  }
  const fullFloor=parseConfig(paintingExtensionConfig([floorDeclaration]));
  say('PE24_FLOOR_VALIDATION_AT_EVERY_DOOR_AND_DIRECT_API', floorShapes===28 && fullFloor.assemble.extend_painting?.[0].min_held_alpha===250 &&
    stageFields(parseEarlyConfig(paintingExtensionConfig([floorDeclaration]),'assemble')).paintingExtension?.[0].min_held_alpha===250,
    `${floorShapes}/28 malformed-floor plants refused; valid 250 reaches stageFields through actual readers`);
  const one=assemble({...faint,paintingExtension:[{...PAINTING_EXTENSION,max_distance:7,min_held_alpha:1}]});
  say('PE25_FLOOR_ONE_RETAINS_LEGACY_BYTES',serializeParts(one.parts)===serializeParts(withoutFloor.parts) &&
    one.images.every((p,i)=>p.image.data.every((v,j)=>v===withoutFloor.images[i].image.data[j])), 'absent and explicit 1 preserve records and all part image bytes on the faint fixture');

  // Different RGB holders stay untouched both above and below the gain.
  const colourHolder=newRaster(3,1);colourHolder.data.set([220,20,60,64],4);
  const drawResults: number[][]=[];
  for(const front of [false,true]) {
    const parts=[{name:'upper',image:tinyTarget},{name:'held',image:colourHolder}];
    if(!front)parts.reverse();
    const gain=paintingExtensionMasks([{...tinyDeclaration,min_held_alpha:128}],parts,tinySource).get('upper')!;
    const repaired={...tinyTarget,data:new Uint8ClampedArray(tinyTarget.data)};
    if(gain.data[1]===1)repaired.data.set(tinySource.data.subarray(4,8),4);
    const can=front?alphaComposite(repaired,colourHolder):alphaComposite(colourHolder,repaired);
    drawResults.push(Array.from(can.data.subarray(4,8)));
  }
  say('PE26_GAIN_RGB_IS_PAINTING_AND_COMPOSITE_RESPECTS_DRAW_ORDER',
    drawResults[0].join(',')==='40,80,120,255' && drawResults[1].join(',')==='85,65,105,255' && Array.from(colourHolder.data.subarray(4,8)).join(',')==='220,20,60,64',
    `holder behind ${drawResults[0]}; holder above ${drawResults[1]}; manual alpha-over of 64/255 red holder onto painting; holder RGBA unchanged`);
  const frozenParts=[{name:'upper',image:faint.full.layers[0].pixels},{name:'lower',image:faint.full.layers[1].pixels}];
  const frozenBefore=frozenParts.map(p=>Array.from(p.image.data).join(','));
  const competing=[floorDeclaration,{...floorDeclaration,part:'lower',min_held_alpha:128}];
  const disjoint=[{...floorDeclaration,band:[10,18,14,25] as [number,number,number,number]}, {...floorDeclaration,part:'lower',band:[14,18,18,25] as [number,number,number,number]}];
  const forward=paintingExtensionMasks(disjoint,frozenParts,faint.source), backward=paintingExtensionMasks([...disjoint].reverse(),frozenParts,faint.source);
  say('PE27_FROZEN_STACK_CONFLICTS_AND_DISJOINT_ORDER_INVARIANCE',
    refused(()=>paintingExtensionMasks(competing,frozenParts,faint.source),'ASSEMBLE_PAINTING_EXTENSION_CONFLICT') &&
    refused(()=>paintingExtensionMasks([...competing].reverse(),frozenParts,faint.source),'ASSEMBLE_PAINTING_EXTENSION_CONFLICT') &&
    [...forward].every(([name,m])=>m.data.every((v,i)=>v===backward.get(name)!.data[i])) &&
    frozenParts.every((p,i)=>Array.from(p.image.data).join(',')===frozenBefore[i]),
    'different per-declaration floors conflict in both orders; disjoint gain masks identical by name in reversed declarations; original rasters untouched');
  const softSource={...tinySource,data:new Uint8ClampedArray(tinySource.data)}, strongerTarget={...tinyTarget,data:new Uint8ClampedArray(tinyTarget.data)};
  softSource.data[7]=250;strongerTarget.data.set([10,20,30,254],4);
  const noLoss=paintingExtensionMasks([{...tinyDeclaration,min_held_alpha:255}],[{name:'upper',image:strongerTarget}],softSource).get('upper')!;
  say('PE28_FLOOR_NEVER_WEAKENS_MORE_OPAQUE_TARGET',noLoss.data[1]===0 && strongerTarget.data[7]===254,
    'painting alpha 250 cannot replace target alpha 254 even below declared floor 255');

  // The floor authorizes replacement only of the target's BELOW-floor samples.
  // Actual gate assertions hold every other holder byte and the target's
  // at/above-floor RGBA; counts alone cannot certify preservation.
  const protectedFixture = faintPaintingExtensionFixture();
  for (const [x,a] of [[10,249],[11,250],[12,251],[13,255]]) protectedFixture.full.layers[0].pixels.data.set([190,30,50,a],(18*64+x)*4);
  const protectedBase = assemble(protectedFixture), protectedFloor = assemble({...protectedFixture,paintingExtension:[floorDeclaration]});
  let protectedTarget = true, protectedTargetCount = 0;
  for(let y=0;y<64;y++)for(let x=0;x<64;x++) {
    const before=sampleExtensionPart(protectedBase,'upper',x,y),after=sampleExtensionPart(protectedFloor,'upper',x,y);
    if(before[3]>=250){protectedTargetCount++;protectedTarget &&= before.join(',')===after.join(',');}
  }
  const exactOtherHolders = protectedBase.images.filter(p=>p.record.name!=='upper').every(p=>{
    const after=protectedFloor.images.find(q=>q.record.name===p.record.name)!;
    return p.record.x===after.record.x && p.record.y===after.record.y &&
      Buffer.from(encodePngBytes(p.image)).equals(Buffer.from(encodePngBytes(after.image)));
  });
  say('PE29_TARGET_AT_OR_ABOVE_FLOOR_AND_ALL_OTHER_HOLDERS_ARE_EXACT_GATES',
    protectedTargetCount===67 && protectedTarget && exactOtherHolders &&
    sampleExtensionPart(protectedBase,'upper',11,18)[3]===250 && sampleExtensionPart(protectedFloor,'upper',11,18)[3]===250 &&
    sampleExtensionPart(protectedBase,'upper',10,18)[3]===249 && sampleExtensionPart(protectedFloor,'upper',10,18)[3]===255,
    `target at/above 250: ${protectedTargetCount}, exact RGBA ${protectedTarget}; every other holder PNG byte/placement exact ${exactOtherHolders}; own 249 raised, own 250 retained`);

  // #855: explicit precedence is measured against independently hand-counted
  // columns, not against another invocation of the production algorithm.
  const shared = interleavingPaintingExtensionFixture();
  const ordered = shared.declarations.map((e, order) => ({ ...e, order }));
  const snapshot = shared.parts.map(p => Buffer.from(encodePngBytes(p.image)));
  say('PE30_INTERLEAVING_TARGETS_REFUSE_WITHOUT_PRECEDENCE',
    refused(() => paintingExtensionMasks(shared.declarations, shared.parts, shared.painting), 'ASSEMBLE_PAINTING_EXTENSION_CONFLICT') &&
    refused(() => paintingExtensionMasks([...shared.declarations].reverse(), shared.parts, shared.painting), 'ASSEMBLE_PAINTING_EXTENSION_CONFLICT'),
    'two targets reach columns 1 and 2 in one band; no order declaration, both array orders refuse');
  const claims = paintingExtensionMasks(ordered, shared.parts, shared.painting);
  const reverseClaims = paintingExtensionMasks([...ordered].reverse(), [...shared.parts].reverse(), shared.painting);
  let mapExact = true, sharedResidual = 0, protectedExact = true;
  const assigned = shared.parts.map(p => ({ ...p, image: { ...p.image, data: new Uint8ClampedArray(p.image.data) } }));
  for (let y = 0; y < 3; y++) for (let x = 0; x < 7; x++) {
    const q = y * 7 + x;
    for (const name of ['first', 'second']) {
      const expected = name === 'first' ? x >= 1 && x <= 2 : x >= 3 && x <= 5;
      mapExact &&= claims.get(name)!.data[q] === Number(expected) && reverseClaims.get(name)!.data[q] === Number(expected);
      const before = shared.parts.find(p => p.name === name)!, after = assigned.find(p => p.name === name)!;
      if (claims.get(name)!.data[q]) after.image.data.set(shared.painting.data.subarray(q*4,q*4+4),q*4);
      if (before.image.data[q*4+3] >= 250) protectedExact &&= before.image.data.subarray(q*4,q*4+4).every((v,i) => v === after.image.data[q*4+i]);
    }
    if (assigned.filter(p => p.name !== 'holder').every(p => p.image.data[q*4+3] < 250)) sharedResidual++;
  }
  say('PE31_EXPLICIT_ORDER_HAS_EXACT_DETERMINISTIC_CLAIMS_AND_ZERO_RESIDUAL', mapExact && sharedResidual === 0 &&
    claims.get('first')!.data.reduce((n,v)=>n+v,0) === 6 && claims.get('second')!.data.reduce((n,v)=>n+v,0) === 9,
    `hand-derived first columns 1..2 = 6, second columns 3..5 = 9; residual ${sharedResidual}; declaration/stack reversal exact ${mapExact}`);
  say('PE32_ORDER_PRESERVES_FROZEN_INPUTS_NON_TARGET_BYTES_AND_FLOOR_SAMPLES', protectedExact &&
    shared.parts.every((p,i)=>snapshot[i].equals(Buffer.from(encodePngBytes(p.image)))) &&
    snapshot[2].equals(Buffer.from(encodePngBytes(assigned[2].image))),
    `both targets' alpha >=250 exact ${protectedExact}; cropped alpha-1 non-target PNG exact; every input PNG unchanged`);

  // A restriction to the second target's own faint alpha is NOT disjoint:
  // first's general candidate already reaches those original alpha-8 holders.
  const individual = shared.declarations.map(e=>paintingExtensionMasks([e],shared.parts,shared.painting).get(e.part)!);
  // Re-run reachability after restricting candidates, rather than merely
  // filtering an unrestricted final mask (which could retain a broken path).
  const restrictOwn = (entry: typeof shared.declarations[number], image: typeof shared.painting, unrestricted: Uint8Array): Uint8Array => {
    const distance=new Int32Array(21).fill(-1), queue:number[]=[], result=new Uint8Array(21);
    const adjacent=(q:number)=>[q%7>0?q-1:-1,q%7<6?q+1:-1,q>=7?q-7:-1,q<14?q+7:-1].filter(n=>n>=0);
    const allowed=(q:number)=>unrestricted[q]===1 && image.data[q*4+3]>0;
    for(let q=0;q<21;q++)if(allowed(q)&&adjacent(q).some(n=>image.data[n*4+3]>8)){distance[q]=1;queue.push(q);}
    for(let i=0;i<queue.length;i++){const q=queue[i];result[q]=1;if(distance[q]>=entry.max_distance)continue;
      for(const n of adjacent(q))if(allowed(n)&&distance[n]<0){distance[n]=distance[q]+1;queue.push(n);}}
    return result;
  };
  const ownSecond=restrictOwn(shared.declarations[1],shared.parts[1].image,individual[1].data);
  let ownOnlyOverlap = 0;
  for(let q=0;q<21;q++) if(individual[0].data[q] && ownSecond[q]) ownOnlyOverlap++;
  const coheld = interleavingPaintingExtensionFixture();
  coheld.parts[0].image.data.set([20,30,40,200],2*4);
  coheld.parts[0].image.data.set([20,30,40,8],(1*7+2)*4);
  coheld.parts[1].image.data.set([50,60,70,1],(1*7+2)*4);
  coheld.parts[1].image.data.set([50,60,70,80],(1*7+3)*4);
  const coheldClaims=coheld.declarations.map(e=>paintingExtensionMasks([e],coheld.parts,coheld.painting).get(e.part)!);
  const coheldOwn=coheldClaims.map((m,i)=>restrictOwn(coheld.declarations[i],coheld.parts[i].image,m.data));
  say('PE33_OWN_FAINT_RESTRICTION_ALONE_IS_AMBIGUOUS_INCLUDING_ALPHA_EIGHT', ownOnlyOverlap===2 &&
    coheldOwn.every(m=>m[1*7+2]===1) &&
    refused(()=>paintingExtensionMasks(coheld.declarations,coheld.parts,coheld.painting),'ASSEMBLE_PAINTING_EXTENSION_CONFLICT'),
    `own-faint candidate restriction plus new BFS still overlaps ${ownOnlyOverlap} alpha-8 samples; co-held alpha 8/1 reachable under both own restrictions and still refuses without explicit order`);
  let orderPlants=0;
  const badOrders: Array<[unknown,string]> = [
    [[{...PAINTING_EXTENSION,order:-1}],'CONFIG_FIELD_TYPE'],
    ...[0.5, '0', null, true, Number.MAX_SAFE_INTEGER+1].map(v=>[[{...PAINTING_EXTENSION,order:v}],'CONFIG_FIELD_TYPE'] as [unknown,string]),
    [[{...PAINTING_EXTENSION,order:0},{...PAINTING_EXTENSION,part:'lower',order:0}],'CONFIG_ORDER_UNIQUE'],
    [[{...PAINTING_EXTENSION,order:0},{...PAINTING_EXTENSION,part:'lower'}],'CONFIG_FIELD_PRESENT'],
  ];
  for(const [entries,code] of badOrders) {
    for(const door of ['layers','assemble','full'] as const) {
      const cfg=paintingExtensionConfig(entries);
      if(refused(()=>door==='full'?parseConfig(cfg):door==='layers'?parseEarlyConfig(cfg,'layers'):parseEarlyConfig(cfg,'assemble'),code)) orderPlants++;
    }
    if(refused(()=>paintingExtensionMasks(entries as typeof ordered,shared.parts,shared.painting),code)) orderPlants++;
  }
  const validOrder=stageFields(parseEarlyConfig(paintingExtensionConfig([{...PAINTING_EXTENSION,order:0}]),'assemble')).paintingExtension?.[0].order;
  say('PE34_ORDER_VALIDATION_IS_SHARED_BY_ALL_READERS_AND_DIRECT_API',orderPlants===badOrders.length*4 && validOrder===0,
    `${orderPlants}/${badOrders.length*4} malformed, duplicate and mixed-order plants refused; valid zero preserved through stageFields`);

  // Earlier gains are barriers, not traversal bridges or new seeds. A later
  // target outside the band cannot tunnel across the earlier vertical claim.
  const corridor=newRaster(5,2), left=newRaster(5,2), right=newRaster(5,2);
  for(let x=0;x<5;x++)corridor.data.set([40,60,80,255],(5+x)*4);
  left.data.set([1,2,3,255],2*4);right.data.set([4,5,6,255],9*4);
  const barrierEntries=[{part:'left',band:[2,1,3,2] as [number,number,number,number],max_distance:1,order:1},
    {part:'right',band:[0,1,4,2] as [number,number,number,number],max_distance:4,order:2}];
  const barrier=paintingExtensionMasks(barrierEntries,[{name:'left',image:left},{name:'right',image:right}],corridor);
  say('PE35_PRECEDENCE_GAINS_BLOCK_LATER_PATHS_WITH_ORIGINAL_SEEDS_ONLY',
    Array.from(barrier.get('left')!.data).join(',')==='0,0,0,0,0,0,0,1,0,0' &&
    Array.from(barrier.get('right')!.data).join(',')==='0,0,0,0,0,0,0,0,1,0',
    'earlier x2,y1 blocks later path from original x4,y1; unclaimed x0..1 stay unreachable at distance4; no gain becomes a new seed');
  const asmEntries=[{...floorDeclaration,order:0},{...floorDeclaration,part:'lower',order:1}];
  const orderedAssembly=assemble({...faint,paintingExtension:asmEntries});
  const reversedAssembly=assemble({...faint,paintingExtension:[...asmEntries].reverse()});
  say('PE36_REAL_ASSEMBLY_ORDER_IS_ARRAY_INVARIANT_WITH_EXACT_NON_TARGET_OUTPUT',residual(orderedAssembly).total===0 &&
    serializeParts(orderedAssembly.parts)===serializeParts(reversedAssembly.parts) &&
    orderedAssembly.images.every((p,i)=>Buffer.from(encodePngBytes(p.image)).equals(Buffer.from(encodePngBytes(reversedAssembly.images[i].image)))),
    'two floor declarations run through actual assembly and provenance; residual zero; records and every PNG exact after array reversal');

  const guideText = readFileSync(GUIDE_DOC, 'utf8');
  say('PE37_ORDER_REFUSALS_HAVE_GUIDE_ROWS_AND_MISSING_ROW_CONTROL',
    ['CONFIG_ORDER_UNIQUE', 'CONFIG_FIELD_PRESENT', 'CONFIG_FIELD_TYPE', 'ASSEMBLE_PAINTING_EXTENSION_CONFLICT'].every(code =>
      'lines' in guideRule(guideText, code) && !('lines' in guideRule(guideText.split('\n').filter(l=>!l.includes(`<a id="${code}"></a>`)).join('\n'),code))),
    'all order and conflict refusals have exact guide rows; deleting each anchor row refuses the lookup');

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
