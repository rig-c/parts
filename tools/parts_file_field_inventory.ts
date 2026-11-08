/** A type-derived census catches newly introduced string/file fields before fixtures omit them. */
import ts from 'typescript';
import { join } from 'node:path';

// Every string-bearing leaf is classified, including identity/provenance strings.
// Image membership itself is checked against the fully populated fixture.
const PART_STRING_FIELDS = [
  'cut_from',
  'depth.image',
  'depth.near',
  'depth.sources[].from',
  'depth.sources[].image',
  'depth.sources[].reading.relation',
  'depth.sources[].sha256',
  'fringe_pushed_back[].part',
  'from',
  'limb.band.upper',
  'limb.bone',
  'limb.cap.edge',
  'limb.cap.image_layer',
  'limb.cap.shape',
  'limb.hybrid.part',
  'limb.hybrid.upper',
  'limb.joint',
  'limb.name',
  'limb.of',
  'name',
  'provenance.automatic[].stage',
  'provenance.depth.kind',
  'provenance.depth.values[].bone',
  'provenance.depth.values[].group',
  'provenance.edits[].edit',
  'taken_layers[].prompt_id',
  'taken_layers[].run',
  'taken_layers[].run_dir',
  'taken_layers[].split.image',
  'taken_layers[].split.sha256',
  'taken_layers[].st_input',
  'taken_layers[].tag',
  'taken_layers[].transport.after_rgba_sha256',
  'taken_layers[].transport.before_rgba_sha256',
  'taken_layers[].transport.filter',
  'taken_layers[].transport.input_rgba_sha256',
];
const OTHER_STRING_FIELDS = [
  'alternates[].base_anchor.*.axes[]',
  'alternates[].base_anchor.*.paired[]',
  'alternates[].cut_ownership[].edit',
  'alternates[].cut_ownership[].from',
  'alternates[].cut_ownership[].into',
  'alternates[].front[]',
  'alternates[].hides[]',
  'alternates[].name',
  'alternates[].parts[]',
  'alternates[].recomposite.holes[].borders[].part',
  'alternates[].scene.figure_mask',
  'alternates[].slots.*',
  'cut_ownership[].edit',
  'cut_ownership[].from',
  'cut_ownership[].into',
  'motion_seams[].neighbour',
  'motion_seams[].part',
  'occluder_grow[].image',
  'occluder_plates[].mask_sha256',
  'occluder_plates[].occluder_sha256',
  'occluder_plates[].output_sha256',
  'occluder_plates[].painting_sha256',
  'occluder_plates[].receipt',
  'occluder_plates[].receipt_sha256',
  'painting_in_rig.path',
  'painting_in_rig.resample',
  'painting_in_rig.sha256',
  'recomposite.holes[].borders[].part',
  'scene.figure_mask',
];

export function partsStringFieldFaults(root: string): string[] {
  const file = join(root, 'src/parts.ts');
  const program = ts.createProgram([file], { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, strict: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const declaration = source?.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'PartsFile');
  if (declaration === undefined) throw new Error('PartsFile declaration is absent');
  const leaves = new Set<string>();
  const walk = (type: ts.Type, path: string, parents: ReadonlySet<ts.Type>): void => {
    if (type.isUnion() || type.isIntersection()) {
      for (const member of type.types) walk(member, path, parents);
      return;
    }
    if (type.flags & ts.TypeFlags.StringLike) { leaves.add(path); return; }
    if (!(type.flags & ts.TypeFlags.Object) || parents.has(type)) return;
    const seen = new Set(parents).add(type);
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      for (const member of checker.getTypeArguments(type as ts.TypeReference)) walk(member, `${path}[]`, seen);
      return;
    }
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    if (index !== undefined) walk(index, `${path}.*`, seen);
    for (const property of type.getProperties()) {
      const at = property.valueDeclaration ?? property.declarations?.[0];
      if (at !== undefined) walk(checker.getTypeOfSymbolAtLocation(property, at), path === '' ? property.name : `${path}.${property.name}`, seen);
    }
  };
  walk(checker.getTypeAtLocation(declaration), '', new Set());
  const classified = new Set([
    ...OTHER_STRING_FIELDS,
    ...PART_STRING_FIELDS.flatMap(field => [`parts[].${field}`, `alternates[].records[].${field}`]),
  ]);
  return [...[...leaves].filter(field => !classified.has(field)).map(field => `unclassified string/file field ${field}`),
    ...[...classified].filter(field => !leaves.has(field)).map(field => `classified field disappeared ${field}`)].sort();
}
