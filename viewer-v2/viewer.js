import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RGBELoader} from './vendor/RGBELoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {mountNavigationHelp} from './navigation-ui.js';
import {installKeyboardNavigation} from './navigation.js?v=5';
import {createRenderQuality} from './render-quality.js?v=4';
import {loadDeliveredModel} from './model-delivery.js?v=9';
import {exteriorDelivery} from './model-delivery-config.js?v=9';
import {MeshoptDecoder} from './vendor/meshopt_decoder.mjs';

const $ = id => document.getElementById(id);
const startedAt = performance.now();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bbcbd0');
scene.fog = new THREE.Fog('#bbcbd0', 1900, 5200);
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .6, 9000);
const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: false});
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.body.prepend(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '三维园区；方向键前后横移，E上升Q下降，Shift加速');

const composer = new EffectComposer(renderer);
const occlusion = new SSAOPass(scene, camera, innerWidth, innerHeight, 16);
occlusion.kernelRadius = 7;
occlusion.minDistance = .00007;
occlusion.maxDistance = .0012;
composer.addPass(new RenderPass(scene, camera));
composer.addPass(occlusion);
composer.addPass(new OutputPass());
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * .486;
controls.minDistance = 18;
controls.maxDistance = 2900;

const sun = new THREE.DirectionalLight('#fff8e8', 2.2);
sun.position.set(-430, 720, -510);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left: -700, right: 700, top: 700, bottom: -700, near: 1, far: 2000});
sun.shadow.normalBias = .7;
sun.shadow.bias = -.00035;
scene.add(sun, sun.target);

const cv = a => new THREE.Vector3(a[0], a[2], -a[1]);
const names = {HQ: '行政研发楼', FAB1: 'FAB 1', FAB2: 'FAB 2', LAB: 'LAB 实验楼', MASK: 'MASK 厂房', EXHIBITION: '展示中心', DINING_E: '东侧餐厅', DINING_W: '西侧餐厅'};
let model, spec, views = {}, view = 'north', ready = false, renderDirty = true;
let fullQuality = false, frameCount = 0, lastTime = performance.now(), fpsTime = lastTime, fps = 0;
let baseStats = {calls: 0, triangles: 0}, readyMilliseconds = 0, latestRenderMilliseconds = 0;
const loadingStages = {};
let deliveryStats = {};
const contextObjects = [], plantChunks = [], tags = [], frameCallbacks = new Set();
const renderQuality = createRenderQuality({renderer, composer, occlusion, camera, controls, getPlants: () => plantChunks, getModel: () => model});
const preservation = {sourceBatches: 0, sourceInstances: 0, retainedInstances: 0, originalGeometryTriangles: 0, retainedGeometryTriangles: 0, expandedTriangles: 0, geometryUnchanged: true, matricesUnchanged: true};
const requestRender = (options = {}) => {
  renderDirty = true;
  if (options.shadows) renderer.shadowMap.needsUpdate = true;
};
controls.addEventListener('change', requestRender);
const keyboard = installKeyboardNavigation(camera, controls, requestRender);
mountNavigationHelp(document.body, keyboard, {campus:true});

function applyView(name) {
  const v = views[name];
  if (!v) return false;
  view = name;
  // Flush outstanding OrbitControls damping before an atomic camera change.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  camera.position.copy(cv(v[0]));
  controls.target.copy(cv(v[1]));
  camera.fov = name === 'top' ? 46 : THREE.MathUtils.radToDeg(2 * Math.atan(36 / (2 * v[2] * 1.607)));
  camera.updateProjectionMatrix();
  controls.update();
  controls.enableDamping = damping;
  camera.updateMatrixWorld();
  return true;
}
function setView(name) {
  if (!applyView(name)) return;
  keyboard.release();
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  // This light is fixed in world space. A new camera requires no shadow redraw.
  // The spatial index uses the new camera before rendering its first frame.
  requestRender();
  window.dispatchEvent(new CustomEvent('campus:viewchange', {detail: {view: name}}));
}
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => setView(button.dataset.view));
function applyQuality() {
  fullQuality = $('quality').value === 'full';
  const ratio = fullQuality ? Math.min(devicePixelRatio, 1.25, 1920 / innerWidth, 1440 / innerHeight) : Math.min(1, 1600 / innerWidth, 1000 / innerHeight);
  renderer.setPixelRatio(ratio);
  composer.setPixelRatio(ratio);
  const size = fullQuality ? 4096 : 2048;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  // Both modes keep every original plant and leaf triangle. Smooth mode saves
  // pixel work, shadow resolution and the second full-scene SSAO geometry pass.
  requestRender({shadows: true});
}
$('quality').onchange = applyQuality;
$('details').onclick = () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  $('details').setAttribute('aria-expanded', String(open));
};
$('context').onchange = () => {
  for (const object of contextObjects) object.visible = $('context').checked;
  requestRender({shadows: true});
};
$('labels').onchange = requestRender;
$('building').onchange = () => {
  const building = spec?.buildings.find(b => b.id === $('building').value);
  if (!building) return;
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.target.copy(cv([building.position[0], building.position[1], building.size[2] / 2]));
  camera.position.copy(controls.target).add(new THREE.Vector3(160, 140, -230));
  camera.fov = 40;
  camera.updateProjectionMatrix();
  controls.update();
  controls.enableDamping = damping;
  view = building.id;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.remove('active'));
  requestRender();
};

const plantIndex = [];
const plantFrustum = new THREE.Frustum(), plantVP = new THREE.Matrix4();
const cullSphere = new THREE.Sphere();
let plantVisibilityKey = '';
function partitionPlants(root) {
  root.updateMatrixWorld(true);
  const originals = [];
  root.traverse(object => { if (object.isInstancedMesh) originals.push(object); });
  const matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(), worldBox = new THREE.Box3();
  for (const source of originals) {
    const sourceMatrices = source.instanceMatrix.array.slice();
    const matrices = [], cells = new Map(), bounds = new Float32Array(source.count * 4);
    const cellSize = source.userData.lod === 'far' ? 240 : 100;
    const sourceTriangles = (source.geometry.index?.count || source.geometry.attributes.position.count) / 3;
    if (!source.geometry.boundingSphere) source.geometry.computeBoundingSphere();
    preservation.sourceBatches++;
    preservation.sourceInstances += source.count;
    preservation.originalGeometryTriangles += sourceTriangles;
    preservation.expandedTriangles += sourceTriangles * source.count;
    source.userData.originalCount = source.count;
    source.userData.sourceGeometryUUID = source.geometry.uuid;
    for (let i = 0; i < source.count; i++) {
      matrices.push(sourceMatrices.subarray(i * 16, i * 16 + 16));
      source.getMatrixAt(i, matrix);
      matrix.premultiply(source.matrixWorld);
      sphere.copy(source.geometry.boundingSphere).applyMatrix4(matrix);
      // Store conservative world-space bounds once; source transforms are static.
      bounds.set([sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius + .01], i * 4);
      const key = `${Math.floor(sphere.center.x / cellSize)},${Math.floor(sphere.center.z / cellSize)}`;
      if (!cells.has(key)) cells.set(key, {indices: [], box: new THREE.Box3()});
      const cell = cells.get(key);
      cell.indices.push(i);
      sphere.radius += .02;
      cell.box.union(sphere.getBoundingBox(worldBox));
      for (let n = 0; n < 16; n++) {
        if (matrices[i][n] !== source.instanceMatrix.array[i * 16 + n]) preservation.matricesUnchanged = false;
      }
    }
    plantIndex.push({source, sourceMatrices, matrices, bounds, cells: [...cells.values()], fullCount: source.count, geometry: source.geometry});
    source.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    source.frustumCulled = false;
    preservation.retainedInstances += source.count;
    preservation.retainedGeometryTriangles += sourceTriangles;
    plantChunks.push(source);
  }
  if (!preservation.geometryUnchanged || !preservation.matricesUnchanged || preservation.sourceInstances !== preservation.retainedInstances) {
    throw new Error('植物实例保留校验失败');
  }
}
function restoreAllPlants() {
  for (const entry of plantIndex) {
    entry.source.instanceMatrix.array.set(entry.sourceMatrices);
    entry.source.count = entry.fullCount;
    entry.source.instanceMatrix.needsUpdate = true;
  }
  plantVisibilityKey = '';
}
function updatePlantVisibility() {
  if (!model?.visible) { plantVisibilityKey = ''; return; }
  camera.updateMatrixWorld();
  plantVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const key = plantVP.elements.join(',');
  if (key === plantVisibilityKey) return;
  plantVisibilityKey = key;
  plantFrustum.setFromProjectionMatrix(plantVP);
  for (const entry of plantIndex) {
    let visibleCount = 0;
    for (const cell of entry.cells) {
      if (!plantFrustum.intersectsBox(cell.box)) continue;
      for (const index of cell.indices) {
        const offset = index * 4;
        cullSphere.center.fromArray(entry.bounds, offset);
        cullSphere.radius = entry.bounds[offset + 3];
        if (!plantFrustum.intersectsSphere(cullSphere)) continue;
        entry.source.instanceMatrix.array.set(entry.matrices[index], visibleCount * 16);
        visibleCount++;
      }
    }
    entry.source.count = visibleCount;
    entry.source.instanceMatrix.needsUpdate = true;
  }
}

const yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function warmGPU() {
  const warmStarted = performance.now();
  $('progress').textContent = '植物完整保留 · 正在预编译材质与阴影…';
  const textures = new Set();
  scene.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  let uploaded = 0;
  for (const texture of textures) {
    renderer.initTexture(texture);
    if (++uploaded % 4 === 0) await yieldFrame();
  }
  await renderer.compileAsync(scene, camera);
  const target = new THREE.WebGLRenderTarget(64, 64);
  // compileAsync covers every material independent of camera visibility. Upload
  // each geometry once instead of drawing the full foliage six times at startup.
  const cullFlags = [];
  model.traverse(object => {
    if (object.isMesh) { cullFlags.push([object, object.frustumCulled]); object.frustumCulled = false; }
  });
  renderer.setRenderTarget(target);
  renderQuality.syncDepth();
  renderer.render(scene, camera);
  for (const [object, flag] of cullFlags) object.frustumCulled = flag;
  await yieldFrame();
  renderer.setRenderTarget(null);
  // Compile the optional SSAO pipeline off-screen during loading as well.
  composer.setSize(64, 64);
  composer.renderToScreen = false;
  occlusion.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
  occlusion.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
  composer.render();
  composer.renderToScreen = true;
  composer.setSize(innerWidth, innerHeight);
  target.dispose();
  renderQuality.prepare();
  loadingStages.gpuWarmMilliseconds = Math.round(performance.now() - warmStarted);
}
const shadowWarmTarget = new THREE.WebGLRenderTarget(1, 1);
const shadowBoundaryScene = new THREE.Scene();
function render() {
  const begin = performance.now();
  renderQuality.prepare();
  if (renderer.shadowMap.needsUpdate) {
    // Shadow visibility belongs to the light, not the inspection camera. Restore
    // all plants for this occasional off-screen shadow refresh before culling.
    restoreAllPlants();
    renderer.setRenderTarget(shadowWarmTarget);
    renderer.render(scene, camera);
    // r170 updates instanced attributes once per renderer frame. Shadow drawing
    // runs after its frame counter advances, so the next scene traversal may
    // otherwise reuse the shadow pass' full-instance GPU buffer with the new
    // compacted CPU count. An empty off-screen render creates a clean update
    // boundary without drawing another set of leaves or altering Three internals.
    renderer.render(shadowBoundaryScene, camera);
    renderer.setRenderTarget(null);
  }
  updatePlantVisibility();
  if (fullQuality) {
    occlusion.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
    occlusion.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
    renderer.info.autoReset = false;
    renderer.info.reset();
    composer.render();
    renderer.info.autoReset = true;
  } else {
    renderer.render(scene, camera);
  }
  latestRenderMilliseconds = performance.now() - begin;
  baseStats = {calls: renderer.info.render.calls, triangles: renderer.info.render.triangles};
  renderDirty = false;
  frameCount++;
}
const projected = new THREE.Vector3();
function updateLabels() {
  for (const tag of tags) {
    projected.copy(tag.p).project(camera);
    tag.el.hidden = !$('labels').checked || projected.z > 1 || projected.z < 0;
    tag.el.style.left = `${(projected.x * .5 + .5) * innerWidth}px`;
    tag.el.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;
  }
}
function animate(time) {
  requestAnimationFrame(animate);
  const delta = Math.min((time - lastTime) / 1000, .1);
  lastTime = time;
  if (!ready || document.hidden) return;
  keyboard.update(delta);
  controls.update();
  for (const callback of frameCallbacks) if (callback(time, delta)) requestRender();
  if (renderDirty) {
    render();
    updateLabels();
  }
  if (time - fpsTime > 1500) {
    fps = frameCount > 5 ? Math.round(frameCount * 1000 / (time - fpsTime)) : 0;
    frameCount = 0;
    fpsTime = time;
  }
}
window.campusV2 = {
  scene, camera, controls, renderer, composer, occlusion, sun, keyboard, setView, requestRender, renderQuality,
  invalidate: requestRender,
  get model() { return model; },
  get spec() { return spec; },
  get plantChunks() { return plantChunks; },
  get ready() { return ready; },
  registerSceneObject(object) { scene.add(object); requestRender({shadows: true}); return object; },
  addFrameCallback(callback) { frameCallbacks.add(callback); return () => frameCallbacks.delete(callback); },
  get stats() {
    return {ready, fps, ...baseStats, view, idleAO: false, quality: fullQuality ? 'full' : 'balanced', pixelRatio: renderer.getPixelRatio(), plantBatches: plantChunks.length, spatialCells: plantIndex.reduce((n, p) => n + p.cells.length, 0), visiblePlantInstances: plantChunks.reduce((n, p) => n + p.count, 0), farBatches: plantChunks.filter(p => p.userData.lod === 'far').length, preservation: {...preservation}, rendering: renderQuality.stats, delivery: {...deliveryStats}, loadingStages: {...loadingStages}, readyMilliseconds, latestRenderMilliseconds};
  }
};

try {
  const resources = await Promise.all([
    fetch('../analysis/v2/reconstruction-contract.json').then(r => { if (!r.ok) throw new Error('场景合同加载失败'); return r.json(); }),
    fetch('../evidence/v2/build.json').then(r => { if (!r.ok) throw new Error('视角数据加载失败'); return r.json(); }),
    new RGBELoader().loadAsync('../assets/v2/kloofendal_48d_partly_cloudy_puresky_1k.hdr'),
    (async () => {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const {model: gltf, delivery, parseMilliseconds} = await loadDeliveredModel(exteriorDelivery, buffer => {
        $('progress').textContent = '模型已下载 · 正在准备建筑与完整枝叶…';
        return loader.parseAsync(buffer, new URL('../output/v2/', import.meta.url).href);
      }, progress => {
        const percentage = Math.min(100, Math.round(progress.loaded / progress.total * 100));
        $('progress').textContent = `模型 ${percentage}% · 已接收 ${(progress.loaded / 1048576).toFixed(1)} MB`;
      });
      deliveryStats = delivery;
      loadingStages.modelParseMilliseconds = parseMilliseconds;
      return gltf;
    })()
  ]);
  [spec] = resources;
  views = resources[1].views;
  resources[2].mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = resources[2];
  scene.environmentIntensity = .65;
  model = resources[3].scene;
  scene.add(model);
  model.traverse(object => {
    if (!object.isMesh) return;
    const name = object.name + ' ' + (object.userData.part_group || '');
    object.castShadow = !name.includes('southern-terrain') && !name.includes('ground');
    object.receiveShadow = !name.includes('__water');
    if (object.name.startsWith('02_ROADS')) object.castShadow = object.receiveShadow = false;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
        if (!texture) continue;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (!texture.isCompressedTexture) {
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
        }
      }
      if (material.name.startsWith('botanic')) material.side = THREE.DoubleSide;
    }
  });
  partitionPlants(model);
  model.traverse(object => {
    const name = object.name + ' ' + (object.userData.part_group || '');
    if (name.includes('21_CONTEXT') || name.includes('22_URBAN_CONTEXT')) contextObjects.push(object);
  });
  for (const building of spec.buildings) {
    const option = document.createElement('option');
    option.value = building.id;
    option.textContent = names[building.id];
    $('building').append(option);
    const element = document.createElement('span');
    element.className = 'tag';
    element.textContent = names[building.id];
    element.hidden = true;
    $('labels-layer').append(element);
    tags.push({el: element, p: cv([building.position[0], building.position[1], building.size[2] + 9])});
  }
  applyQuality();
  setView('north');
  await warmGPU();
  render();
  updateLabels();
  ready = true;
  readyMilliseconds = Math.round(performance.now() - startedAt);
  window.__CAMPUS_READY__ = true;
  $('loading').hidden = true;
  $('status').textContent = '园区 · 八栋主体建筑 · 完整枝叶';
  window.dispatchEvent(new CustomEvent('campus:ready', {detail: window.campusV2}));
  window.dispatchEvent(new CustomEvent('campus-ready', {detail: window.campusV2}));
} catch (error) {
  $('progress').textContent = '资源加载失败，请检查网络后刷新重试。';
  console.error(error);
  window.__CAMPUS_ERROR__ = String(error);
}
requestAnimationFrame(animate);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  applyQuality();
});

