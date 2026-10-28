/** Public flat-block surface fixture with declared stop draw aliases. */
import { weightedSurfaceFixture } from './turn_surface.ts';

export function stoppedSurfaceFixture(mode: 'all' | 'first' | 'tip' = 'all', surface = true) {
  const f = weightedSurfaceFixture(surface);
  f.config.stops = ['back_l', 'back_r', 'bang', 'cloth'].map(chain => ({
    chain,
    ...(mode === 'all' ? { lower: { inward: -30, outward: 30 } } : { links: [`${chain}${mode === 'first' ? 0 : 1}`] }),
    against: 'hip', at: [4, 0], inward: -30, outward: 30,
  }));
  return f;
}
