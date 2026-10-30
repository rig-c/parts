/** Hand-computable generated controls for fixed-skeleton art joints (#880). */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeCheckRig } from '../fixtures/checkrig.ts';
import { checkStage } from '../src/build.ts';
import { barsNotMet, checkStatuses, readFrameSet, GEOMETRY_FILE, type RigcRunner } from '../src/check.ts';
import { artJointLine, fixedSkeletonProblems, type FixedSkeleton } from '../src/artjoints.ts';
import { PartsError } from '../src/errors.ts';
import { readRequirements, resolveRequirements } from '../src/requirements.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const LINE = 'ART_JOINT_DISTANCE';
const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(e => e.isDirectory() ? files(join(dir,e.name),prefix+e.name+'/') : [prefix+e.name+':'+createHash('sha256').update(readFileSync(join(dir,e.name))).digest('hex')]);
}

export function runArtJointChecks(dir: string, say: Say, rigc: RigcRunner): void {
  const input = join(dir, 'input');
  writeCheckRig(input);
  const rig = json(join(input, 'rig.json'));
  (rig.bones as unknown[]).push(
    { name: 'shoulder_ctl', parent: 'root', x: 5, y: 11, rotation: 90, scaleX: 2, scaleY: 3 },
    { name: 'shoulder', parent: 'shoulder_ctl', x: 4, y: 2 },
  );
  writeFileSync(join(input, 'rig.json'), JSON.stringify(rig));
  // The setup is world (-1,19): (5,11) + R90 * (2*4,3*2).
  // Stage (-24,0,48,80) makes that art point (23,61), independently by hand.
  const normal: FixedSkeleton = { source: 'hand-computed flat-block fixture measurements', within_px: 4,
    joints: [{ name: 'shoulder', bone: 'shoulder', at: [23,61] }, { name: 'hip', bone: 'root', at: [24,80] }] };
  const off = { ...normal, joints: [{ ...normal.joints[0], at: [26,57] }, normal.joints[1]] };
  const motionPath = join(input, 'motion.json');
  const motion = json(motionPath) as { animations: {idle: {tracks: Array<{property:string;keys:Array<{v:number[]}>}>}} };
  for (const track of motion.animations.idle.tracks) if (track.property === 'translatex') for (const key of track.keys) key.v[0] += 10;
  writeFileSync(motionPath, JSON.stringify(motion));
  const before = files(input).join('\n');
  const req = (name: string, fixed?: unknown): string => {
    const path = join(dir, name+'.json');
    writeFileSync(path, JSON.stringify({spec:'spine-parts-requirements/1',fps:12,requirements:[],...(fixed === undefined ? {} : {fixed_skeleton:fixed})}));
    return path;
  };
  const run = (name: string, requirement?: string, runner = rigc, home = input) => {
    const lines: string[] = [], calls: string[][] = [];
    const report = checkStage({rig:home,out:join(dir,name),requirements:requirement,noExtremes:true}, args => { calls.push([...args]); return runner(args); }, 'fixture-rigc', line => lines.push(line));
    const block = (report.figures as unknown as Record<string, unknown>)[LINE] as {status?:string;reason?:string;joints?:Array<{name:string;distance_px:number;status:string;bone_at:number[]}>} | undefined;
    return {report,block,lines,calls};
  };
  const original = run('original');
  say('FJ01_EXISTING_GATE_ACCEPTS_SYNTHETIC_OFF_JOINT', original.report.figures.PASS && original.block === undefined, JSON.stringify({pass:original.report.figures.PASS,art:[26,57],bone:[23,61],distance_px:5,limit_px:4,problems:original.report.problems}));
  // RED first: the real file reader accepts the declaration, but old check
  // does not measure it. This case must fail until the distance is enforced.
  const defect = run('off', req('off-req', off));
  const failure = defect.report.problems.filter(p => p.code === 'CHECK_ART_JOINT_DISTANCE');
  say('FJ02_OFF_JOINT_FAILS_BY_NAME_DISTANCE_AND_LIMIT', !defect.report.figures.PASS && defect.block?.status === 'FAIL' && failure.length === 1 && failure[0].object.includes('shoulder') && failure[0].detail.includes('5') && failure[0].detail.includes('4') && defect.lines.some(l => l.includes(LINE) && l.includes('shoulder') && l.includes('FAIL')), JSON.stringify({pass:defect.report.figures.PASS,block:defect.block,failure}));
  const green = run('green',req('green-req',normal));
  say('FJ03_ALIGNED_JOINTS_PASS_AND_PRINT_EVERY_DISTANCE', green.report.figures.PASS && green.block?.status === 'PASS' && green.block.joints?.length === 2 && green.block.joints.every(j => j.distance_px < 0.00001 && j.status === 'PASS') && ['shoulder','hip'].every(n => green.lines.some(l => l.includes(LINE) && l.includes(`"${n}"`) && l.includes('px'))), JSON.stringify(green.block));
  const {within_px: omitted, ...noLimit} = off;
  void omitted;
  const skipped = run('no-limit',req('no-limit-req',noLimit));
  say('FJ04_ABSENT_LIMIT_REPORTS_DISTANCES_AS_SKIP_NEVER_A_PASS', skipped.report.figures.PASS && skipped.block?.status === 'SKIP' && skipped.block.joints?.length === 2 && skipped.block.joints.every(j => j.status === 'SKIP') && skipped.block.joints[0].distance_px > 4.99 && !skipped.report.bars.measured.includes(LINE) && skipped.report.bars.skipped.some(b => b.bar === LINE) && skipped.lines.some(l => l.includes(LINE) && l.includes('SKIP') && l.includes('shoulder')), JSON.stringify({block:skipped.block,bars:skipped.report.bars}));
  const absent = run('nonfixed',req('absent-req'));
  const outside = (f: unknown): string => JSON.stringify(Object.fromEntries(Object.entries(f as Record<string,unknown>).filter(([k]) => k !== LINE && k !== 'requirements' && k !== 'PASS')));
  say('FJ05_NONFIXED_RESULTS_AND_CALLS_UNCHANGED', absent.block === undefined && absent.report.figures.PASS === original.report.figures.PASS && !absent.lines.some(l => l.includes(LINE)) && outside(absent.report.figures) === outside(original.report.figures) && absent.calls.length === original.calls.length && files(input).join('\n') === before, JSON.stringify({absent:absent.block ?? null,pass:absent.report.figures.PASS,calls:absent.calls.length,originalCalls:original.calls.length,inputUnchanged:files(input).join('\n') === before}));
  say('FJ06_STATUS_AND_BAR_READERS_KEEP_FAIL_AND_SKIP', barsNotMet(defect.report.figures as unknown as Record<string,unknown>).includes(LINE) && !barsNotMet(skipped.report.figures as unknown as Record<string,unknown>).includes(LINE) && checkStatuses(defect.report.figures)[LINE] === 'FAIL' && checkStatuses(skipped.report.figures)[LINE] === 'SKIP' && defect.report.bars.measured.includes(LINE), JSON.stringify({defect:checkStatuses(defect.report.figures),skipped:checkStatuses(skipped.report.figures)}));
  const missingPath = req('unknown-bone',{...normal,joints:[{...normal.joints[0],bone:'absent'}]});
  const missingOut = join(dir,'unknown-output');
  let refused = '';
  try { checkStage({rig:input,out:missingOut,requirements:missingPath,noExtremes:true},rigc,'fixture-rigc',()=>{}); }
  catch(e) { if (!(e instanceof PartsError)) throw e; refused=e.problems.map(p=>`${p.code} ${p.object} ${p.detail}`).join('\n'); }
  say('FJ07_UNKNOWN_BONE_REFUSED_BEFORE_OUTPUT', refused.includes('REQUIREMENTS_RESOLVES') && refused.includes('shoulder') && refused.includes('absent') && !existsSync(missingOut),refused);
  for (const [name,value] of [ ['negative',{...normal,within_px:-1}], ['null',{...normal,within_px:null}], ['infinite',{...normal,within_px:Infinity}], ['empty',{...normal,joints:[]}], ['duplicate',{...normal,joints:[normal.joints[0],normal.joints[0]]}], ['no-source',{...normal,source:''}], ['bad-point',{...normal,joints:[{...normal.joints[0],at:[0,NaN]}]}], ['typo',{...normal,within:4}] ] as const) {
    const problems=fixedSkeletonProblems(value,'fixed_skeleton');
    let readerRefusal = '';
    try { readRequirements(req('invalid-'+name,value)); }
    catch(e) { if (!(e instanceof PartsError)) throw e; readerRefusal=e.problems.map(p=>p.code).join(','); }
    say('FJ08_INVALID_'+name.toUpperCase().replaceAll('-','_'),problems.length>0 && readerRefusal.includes('REQUIREMENTS_FIELD'),JSON.stringify({problems,readerRefusal}));
  }
  const handSetup = (bone: string) => bone === 'shoulder' ? {worldX:-1,worldY:19} : {worldX:0,worldY:0};
  for (const [name, limit, at, want, distance] of [
    ['EXACT_LIMIT',5,[26,57],'PASS',5], ['ZERO_ALIGNED',0,[23,61],'PASS',0],
    ['ZERO_OFFSET',0,[23.001,61],'FAIL',0.001],
  ] as const) {
    const problems: import('../src/errors.ts').Problem[] = [];
    const line = artJointLine({...normal,within_px:limit,joints:[{...normal.joints[0],at:[at[0],at[1]]}]},{x:-24,y:0,height:80},handSetup,problems);
    say('FJ10_'+name,line.status===want && Math.abs(line.joints[0].distance_px-distance)<1e-12 && problems.length===(want==='FAIL'?1:0),JSON.stringify({line,problems}));
  }
  let unread='';
  try { artJointLine(normal,{x:-24,y:0,height:80},()=>({worldX:NaN,worldY:0}),[]); }
  catch(e) { if (!(e instanceof PartsError)) throw e; unread=e.problems.map(p=>p.code).join(','); }
  say('FJ11_UNAVAILABLE_ORIGIN_NEVER_READ_AS_ZERO',unread==='CHECK_ART_JOINT_MEASURED',unread);
  const cli=spawnSync(process.execPath,[resolve(import.meta.dir,'../cli.ts'),'check','--rig',input,'--out',join(dir,'cli-off'),'--requirements',req('cli-off-req',off),'--no-extremes'],{encoding:'utf8'});
  const cliText=cli.stdout+cli.stderr;
  say('FJ12_REAL_CLI_OFF_JOINT_EXITS_ONE',cli.status===1 && cliText.includes('CHECK_ART_JOINT_DISTANCE') && cliText.includes('joint "shoulder"') && cliText.includes('check: FAIL'),JSON.stringify({exit:cli.status,lines:cliText.split('\n').filter(l=>l.includes(LINE)||l.includes('check:'))}));
  const external = join(dir,'external');
  mkdirSync(external,{recursive:true});
  cpSync(join(input,'images'),join(external,'images'),{recursive:true});
  writeFileSync(join(external,'rig.json'),JSON.stringify(rig));
  writeFileSync(join(external,'motion.json'),JSON.stringify({...json(motionPath),animations:{wave:motion.animations.idle}}));
  const externalRead=run('external-result',req('external-req',normal),rigc,external);
  say('FJ13_EXTERNAL_NO_PARTS_OR_IDLE_READS_SETUP',externalRead.report.figures.PASS && externalRead.block?.status==='PASS' && externalRead.report.figures.loop_max_diff===null && externalRead.report.figures.seam_mean===null,JSON.stringify(externalRead.block));
  let missingGeometry='';
  const badSetup: RigcRunner=args=>{
    const result=rigc(args);
    if (result.status===0 && args[0]==='render' && args.includes('--geometry') && args[args.indexOf('--animation')+1]==='still') {
      const path=join(readFrameSet(args[args.indexOf('--out')+1]).dir,GEOMETRY_FILE);
      const geo=json(path); geo.setup={bones:[]}; writeFileSync(path,JSON.stringify(geo));
    }
    return result;
  };
  try { run('unread-geometry',req('unread-req',normal),badSetup,external); }
  catch(e) { if (!(e instanceof PartsError)) throw e; missingGeometry=e.problems.map(p=>`${p.code} ${p.detail}`).join('\n'); }
  say('FJ14_MISSING_SETUP_GEOMETRY_REFUSES_INSTEAD_OF_PASS',missingGeometry.includes('CHECK_GEOMETRY_FILE') && missingGeometry.includes('setup has no bone') && !existsSync(join(dir,'unread-geometry','check.json')),missingGeometry);
  const read = readRequirements(req('zero',{...normal,within_px:0}));
  resolveRequirements(read,rig,json(join(input,'motion.json')),'root');
  say('FJ09_ZERO_IS_EXPLICIT_AND_ABSENT_STAYS_ABSENT',read.fixed_skeleton?.within_px===0 && readRequirements(req('no-limit-read',noLimit)).fixed_skeleton?.within_px===undefined,'zero is a valid authored limit; no default is inserted');
}
