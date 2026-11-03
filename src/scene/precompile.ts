import { Mesh, PlaneGeometry, type Camera, type Material, type Object3D, type WebGLRenderer } from 'three';
import { EffectPass, type BloomEffect, type EffectComposer } from 'postprocessing';

/** Like postprocessing's fullscreen geometry, without normals: the attributes a mesh has select its shader variant. */
const quad = new PlaneGeometry(2, 2).deleteAttribute('normal');

/**
 * Compiles every shader program the first frame uses, so drawing it does not stall. A first visit
 * otherwise spends over a second linking ten programs one after another inside that frame. With
 * KHR_parallel_shader_compile the driver links them in the background while the page stays live;
 * without it this costs what the first frame would have.
 *
 * Program variants depend on the render target, so each material compiles against the target the
 * composer draws it into: the scene and the bloom passes into the composer's half-float buffers,
 * the final effect pass to the screen.
 */
export function precompile(
  gl: WebGLRenderer,
  scene: Object3D,
  camera: Camera,
  composer: EffectComposer,
  bloom: BloomEffect,
): Promise<unknown> {
  // Not in postprocessing's public types, but the blur draws with exactly these two materials.
  const blur = bloom.mipmapBlurPass as unknown as { downsamplingMaterial: Material; upsamplingMaterial: Material };
  const offscreen = [bloom.luminancePass.fullscreenMaterial, blur.downsamplingMaterial, blur.upsamplingMaterial];
  const onScreen = composer.passes.filter((p) => p instanceof EffectPass).map((p) => p.fullscreenMaterial);
  const previous = gl.getRenderTarget();
  const jobs: Promise<unknown>[] = [];
  gl.setRenderTarget(composer.inputBuffer);
  jobs.push(gl.compileAsync(scene, camera));
  for (const material of offscreen) jobs.push(gl.compileAsync(new Mesh(quad, material), camera));
  gl.setRenderTarget(null);
  for (const material of onScreen) jobs.push(gl.compileAsync(new Mesh(quad, material), camera));
  gl.setRenderTarget(previous);
  return Promise.all(jobs);
}
