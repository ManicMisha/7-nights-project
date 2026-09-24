// Off-screen passes feeding the water shader:
//   • refraction — the scene without water, plus its depth buffer (for
//     depth-based absorption and shore foam);
//   • reflection — the scene rendered from a camera mirrored about the
//     water plane, with an oblique near plane clipping everything below it.

import { WATER_SURFACE_Y } from './config.js';
import { sharedUniforms } from './shaders.js';

const THREE = window.THREE;

export class WaterRenderer {
  constructor(renderer, scene, camera, world, material) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.material = material;
    this.reflections = true;
    this.scale = 0.5;

    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
    this.reflectionTarget = new THREE.WebGLRenderTarget(1, 1, opts);
    this.refractionTarget = new THREE.WebGLRenderTarget(1, 1, opts);
    this.refractionTarget.depthTexture = new THREE.DepthTexture(1, 1);
    this.refractionTarget.depthTexture.type = THREE.UnsignedIntType;

    this.virtualCamera = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();

    const u = material.uniforms;
    u.uReflection.value = this.reflectionTarget.texture;
    u.uRefraction.value = this.refractionTarget.texture;
    u.uDepth.value = this.refractionTarget.depthTexture;
    u.uReflMatrix.value = this.textureMatrix;

    // Scratch objects.
    this._normal = new THREE.Vector3(0, 1, 0);
    this._planePoint = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._rotation = new THREE.Matrix4();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width * this.scale));
    const h = Math.max(1, Math.floor(height * this.scale));
    this.reflectionTarget.setSize(w, h);
    this.refractionTarget.setSize(w, h);
  }

  render() {
    const { renderer, scene, camera, world, material } = this;
    material.uniforms.uCameraNear.value = camera.near;
    material.uniforms.uCameraFar.value = camera.far;
    material.uniforms.uUseReflection.value = this.reflections ? 1 : 0;

    const underwater = sharedUniforms.uUnderwater.value;
    sharedUniforms.uUnderwater.value = 0;
    world.setWaterVisible(false);
    renderer.setRenderTarget(this.refractionTarget);
    renderer.clear();
    renderer.render(scene, camera);

    if (this.reflections && this.updateVirtualCamera()) {
      renderer.setRenderTarget(this.reflectionTarget);
      renderer.clear();
      renderer.render(scene, this.virtualCamera);
    }
    world.setWaterVisible(true);
    sharedUniforms.uUnderwater.value = underwater;
    renderer.setRenderTarget(null);
  }

  /** Mirrors the main camera about the water plane (after three.js' Reflector). */
  updateVirtualCamera() {
    const camera = this.camera;
    const normal = this._normal;
    const vc = this.virtualCamera;
    this._camPos.setFromMatrixPosition(camera.matrixWorld);
    const planePoint = this._planePoint.set(this._camPos.x, WATER_SURFACE_Y, this._camPos.z);

    const view = this._view.subVectors(planePoint, this._camPos);
    if (view.dot(normal) > 0) return false; // camera is under the water plane
    view.reflect(normal).negate().add(planePoint);

    this._rotation.extractRotation(camera.matrixWorld);
    this._lookAt.set(0, 0, -1).applyMatrix4(this._rotation).add(this._camPos);
    const target = this._target.subVectors(planePoint, this._lookAt).reflect(normal).negate().add(planePoint);

    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(this._rotation).reflect(normal);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Oblique near plane = water plane, so nothing underwater is reflected.
    this._plane.setFromNormalAndCoplanarPoint(normal, planePoint).applyMatrix4(vc.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const e = vc.projectionMatrix.elements;
    const q = this._q.set(
      (Math.sign(clip.x) + e[8]) / e[0],
      (Math.sign(clip.y) + e[9]) / e[5],
      -1.0,
      (1.0 + e[10]) / e[14],
    );
    clip.multiplyScalar(2.0 / clip.dot(q));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1.0 - 0.003;
    e[14] = clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    return true;
  }
}
