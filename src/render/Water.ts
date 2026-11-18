import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  float,
  mix,
  normalize,
  normalMap,
  positionWorld,
  pow,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import { lightUniforms } from './lightUniforms';
import { waterNormalTexture } from './materials/textures';

/**
 * Arabian Sea surface: two scrolling normal layers, fresnel toward the horizon
 * colour as a cheap sky reflection, low roughness so the sun lays a glitter
 * path at golden hour. M2.5 adds planar/SSR reflections (CLAUDE.md §4A.3).
 */
export function createSea(width: number, depth: number): THREE.Mesh {
  const normals = waterNormalTexture();
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.07, metalness: 0.0 });
  const wuv = positionWorld.xz;
  const t = lightUniforms.time;
  const n1 = texture(normals, wuv.mul(0.045).add(vec2(t.mul(0.011), t.mul(0.004))));
  const n2 = texture(normals, wuv.mul(0.11).add(vec2(t.mul(-0.007), t.mul(0.013))));
  mat.normalNode = normalMap(n1.add(n2).mul(0.5), vec2(0.7));
  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(clamp(view.y, 0, 1)), float(5));
  const deep = vec3(0.025, 0.11, 0.13);
  mat.colorNode = mix(deep, lightUniforms.horizon.mul(0.85), clamp(fres.mul(1.1), 0, 0.9));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}
