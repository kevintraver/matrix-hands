import { BoxGeometry, BufferAttribute, Color, Matrix4, type BufferGeometry, type ColorRepresentation } from 'three';

export type Vec3 = readonly [number, number, number];

/** Collects vertex-coloured boxes so a whole cluster merges into one solid and one glowing mesh. */
export type PartBuilder = {
  box(size: Vec3, center: Vec3, color: ColorRepresentation): void;
  /** A box whose back face (-z) is shrunk to `backScale`: the tube of a CRT. */
  taper(size: Vec3, center: Vec3, backScale: readonly [number, number], color: ColorRepresentation): void;
  /** Emissive detail (LEDs). Colour components above 1 feed the bloom. */
  glow(size: Vec3, center: Vec3, color: readonly [number, number, number]): void;
  /** Applies `matrix` to every part created inside `draw`. */
  group(matrix: Matrix4, draw: () => void): void;
  readonly solid: BufferGeometry[];
  readonly glowing: BufferGeometry[];
};

function colored(geometry: BufferGeometry, rgb: readonly [number, number, number]): BufferGeometry {
  geometry.deleteAttribute('uv');
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(rgb, i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

export function createPartBuilder(): PartBuilder {
  const solid: BufferGeometry[] = [];
  const glowing: BufferGeometry[] = [];
  let current = new Matrix4();
  const tmp = new Color();

  const place = (geometry: BufferGeometry, center: Vec3) =>
    geometry.translate(center[0], center[1], center[2]).applyMatrix4(current);

  return {
    solid,
    glowing,
    box(size, center, color) {
      tmp.set(color);
      solid.push(place(colored(new BoxGeometry(...size), [tmp.r, tmp.g, tmp.b]), center));
    },
    taper(size, center, [sx, sy], color) {
      const geometry = new BoxGeometry(...size);
      const pos = geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) < 0) pos.setXY(i, pos.getX(i) * sx, pos.getY(i) * sy);
      }
      geometry.computeVertexNormals();
      tmp.set(color);
      solid.push(place(colored(geometry, [tmp.r, tmp.g, tmp.b]), center));
    },
    glow(size, center, rgb) {
      glowing.push(place(colored(new BoxGeometry(...size), rgb), center));
    },
    group(matrix, draw) {
      const outer = current;
      current = outer.clone().multiply(matrix);
      draw();
      current = outer;
    },
  };
}
