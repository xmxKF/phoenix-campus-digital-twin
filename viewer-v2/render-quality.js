import * as THREE from 'three';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {FXAAShader} from './vendor/FXAAShader.js';

/** Keep camera depth precision and off-screen antialiasing explicit. */
export function createRenderQuality({renderer, composer, occlusion, camera, controls, getPlants, getModel}) {
  const samples = Math.min(4, renderer.capabilities.maxSamples);
  composer.renderTarget1.samples = samples;
  composer.renderTarget2.samples = samples;
  // OutputPass has already converted the linear HDR image to display colors.
  // FXAA belongs after it, and cleans AO/leaf edges as well as building edges.
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  const bufferSize = new THREE.Vector2();

  const originalVisibility = occlusion.overrideVisibility.bind(occlusion);
  occlusion.overrideVisibility = function () {
    originalVisibility();
    // Tiny leaves should not become unstable screen-space AO occluders. Their
    // complete geometry stays in the color and light-shadow passes. SSAOPass'
    // existing visibility cache restores every original flag after this pass.
    for (const plant of getPlants()) plant.visible = false;
  };

  function syncDepth() {
    const distance = camera.position.distanceTo(controls.target);
    // At a 1.4 km overview, near=.6 wastes depth precision (~20 cm bins).
    // Near follows inspection scale; ground-level and close inspection retain
    // a short clip distance instead of inheriting the aerial setting.
    const heightLimit = .3 + Math.abs(camera.position.y - controls.target.y) * .12;
    const near = THREE.MathUtils.clamp(Math.min(distance * .025, heightLimit), .2, 60);
    if (Math.abs(camera.near - near) > .00001) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    for (const material of [occlusion.ssaoMaterial, occlusion.depthRenderMaterial]) {
      material.uniforms.cameraNear.value = camera.near;
      material.uniforms.cameraFar.value = camera.far;
    }
    occlusion.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
    occlusion.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
  }

  function prepare() {
    syncDepth();
    renderer.getDrawingBufferSize(bufferSize);
    fxaa.material.uniforms.resolution.value.set(1 / bufferSize.x, 1 / bufferSize.y);
    // In the full campus AO is architectural shading, not a second 10M-triangle
    // leaf render. A single isolated CAD building can use full-resolution AO.
    const scale = getModel()?.visible === false ? 1 : .5;
    const width = Math.max(1, Math.round(bufferSize.x * scale));
    const height = Math.max(1, Math.round(bufferSize.y * scale));
    if (occlusion.width !== width || occlusion.height !== height) occlusion.setSize(width, height);
  }

  return {
    prepare, syncDepth, fxaa,
    get stats() {
      const distance = camera.position.distanceTo(controls.target);
      return {
        cameraNear: camera.near,
        cameraFar: camera.far,
        estimatedDepthStepAtTargetMeters: distance ** 2 * (camera.far - camera.near) / (camera.near * camera.far * (2 ** 24 - 1)),
        fullModeSamples: samples,
        fullModePostAA: 'FXAA after OutputPass',
        aoSize: [occlusion.width, occlusion.height],
        foliageColorGeometry: 'all original triangles',
        foliageSSAO: false
      };
    }
  };
}
