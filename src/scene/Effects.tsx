import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { EffectPass, type BloomEffect, type EffectComposer as Composer } from 'postprocessing';
import type { Quality } from '../quality';
import { precompile } from './precompile';

type Props = {
  quality: Quality;
  /** Called once every shader the first frame needs has compiled. */
  onCompiled: () => void;
};

/** Screens, LEDs, rain heads and cable pulses render above 1.0, so only they bloom. */
export function Effects({ quality, onCompiled }: Props) {
  const composer = useRef<Composer>(null);
  const bloom = useRef<BloomEffect>(null);
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let live = true;
    // The composer adds its passes a few commits after mounting; compile once the effect pass exists.
    const attempt = () => {
      if (!live) return;
      const c = composer.current;
      if (!c || !bloom.current || !c.passes.some((p) => p instanceof EffectPass)) {
        setTimeout(attempt, 16);
        return;
      }
      void precompile(gl, scene, camera, c, bloom.current).then(() => live && onCompiled());
    };
    attempt();
    return () => {
      live = false;
    };
  }, [gl, scene, camera, onCompiled]);
  return (
    <EffectComposer ref={composer} multisampling={quality.msaa}>
      <Bloom
        ref={bloom}
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
