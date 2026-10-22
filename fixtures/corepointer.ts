/** Synthetic runner replies for #356; no real core gate verdict is implied. */
export const CORE_POINTER_CASES = [
  { name: 'bare', out: 'rigc compile error: probe.bones is missing', expected: 'rigc compile error: probe.bones is missing (see rigc guide §5.1)' },
  { name: 'section', out: 'rigc compile error: probe.bones is missing (see rigc guide §5.1)', expected: 'rigc compile error: probe.bones is missing (see rigc guide §5.1)' },
  { name: 'child', out: 'rigc compile error: probe.bones is missing (see rigc guide §5.1.2)', expected: 'rigc compile error: probe.bones is missing (see rigc guide §5.1.2)' },
  { name: 'named', out: 'rigc compile error: probe.duration is absent (see rigc guide CE_MOTION_FIELD_SHAPE)', expected: 'rigc compile error: probe.duration is absent (see rigc guide CE_MOTION_FIELD_SHAPE)' },
  { name: 'assertion', out: '  FAIL  A18_DETERMINISTIC_EMIT: probe differs (see rigc guide A18_DETERMINISTIC_EMIT)', expected: '  FAIL  A18_DETERMINISTIC_EMIT: probe differs (see rigc guide A18_DETERMINISTIC_EMIT)' },
  { name: 'empty', out: '', expected: '' },
] as const;
