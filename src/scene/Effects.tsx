import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { Quality } from '../quality';

/** Screens, LEDs, rain heads and cable pulses render above 1.0, so only they bloom. */
export function Effects({ quality }: { quality: Quality }) {
  return (
    <EffectComposer multisampling={quality.msaa}>
      <Bloom
        mipmapBlur
        luminanceThreshold={0.9}
        luminanceSmoothing={0.15}
        intensity={quality.bloom.intensity}
        levels={quality.bloom.levels}
      />
      <Vignette offset={0.3} darkness={0.75} />
    </EffectComposer>
  );
}
