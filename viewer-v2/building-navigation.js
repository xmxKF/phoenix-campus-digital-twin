import * as THREE from 'three';

const names = {HQ:'行政研发楼',FAB1:'FAB 1 主厂房',FAB2:'FAB 2 扩建预留',LAB:'LAB 实验楼',MASK:'MASK 厂房',EXHIBITION:'展示中心',DINING_E:'东侧餐厅',DINING_W:'西侧餐厅'};
const signs = {'EXHIBITION__&__RECEPTION':'EXHIBITION',INNOVATION____RESEARCH:'HQ',FAB1:'FAB1',FAB2:'FAB2',LAB:'LAB',MASK:'MASK'};
export function resolveBuildingId(object, validIds) {
  const allowed = validIds instanceof Set ? validIds : new Set(validIds);
  for (let node = object; node; node = node.parent) {
    const group = node.userData?.part_group;
    if (group?.startsWith('10_') && allowed.has(group.slice(3))) return group.slice(3);
    for (const id of allowed) if (node.name?.startsWith(`10_${id}__`)) return id;
    if (allowed.has(signs[node.name])) return signs[node.name];
  }
  return null;
}
export function createBuildingPickIndex(root, buildingIds) {
  const allowed = new Set(buildingIds);
  const index = {buildings:[],occluders:[],ids:new WeakMap()};
  root.updateWorldMatrix(true,true);
  root.traverse(object => {
    if (!object.isMesh) return;
    const id = resolveBuildingId(object,allowed);
    if (id) { index.buildings.push(object); index.ids.set(object,id); }
    else index.occluders.push(object);
  });
  return index;
}
function isVisible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return !object.isInstancedMesh || object.count > 0;
}
export function pickBuilding(raycaster,index) {
  const candidate = raycaster.intersectObjects(index.buildings.filter(isVisible),false)[0];
  if (!candidate) return null;
  const far = raycaster.far;
  try {
    raycaster.far = Math.min(far,candidate.distance - 0.0001);
    for (const object of index.occluders) {
      if (!isVisible(object)) continue;
      // Plant instances are compacted after camera changes. A sphere cached by
      // an earlier raycast would no longer describe the visible instance set.
      if (object.isInstancedMesh) object.computeBoundingSphere();
      if (raycaster.intersectObject(object,false).length) return null;
    }
  } finally { raycaster.far = far; }
  return {...candidate,id:index.ids.get(candidate.object)};
}

export function mountBuildingNavigation(api) {
  const $ = id => document.getElementById(id);
  const canvas = api.renderer.domElement;
  const index = createBuildingPickIndex(api.model,api.spec.buildings.map(b=>b.id));
  const bounds = new Map();
  for (const mesh of index.buildings) {
    const id = index.ids.get(mesh);
    if (!bounds.has(id)) bounds.set(id,new THREE.Box3());
    bounds.get(id).expandByObject(mesh);
  }
  const outline = new THREE.Box3Helper(new THREE.Box3(),0xd09135);
  outline.visible = false;
  outline.material.transparent = true;
  outline.material.opacity = .85;
  api.scene.add(outline);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let selectedId = null, gesture = null;
  const exteriorMode = () => window.campusTwin?.mode !== 'cad';
  const twinURL = id => `../viewer-twin/#${encodeURIComponent(id)}`;
  function syncCadLink(id) {
    if (!bounds.has(id)) return;
    $('cad-twin-link').href = twinURL(id);
    $('cad-twin-link').setAttribute('aria-label',`进入${names[id]}的数字孪生`);
  }
  function clear() {
    selectedId = null;
    $('building-card').hidden = true;
    $('building-announcement').textContent = '';
    outline.visible = false;
    api.requestRender();
  }
  function selectBuilding(id,{syncCad=true}={}) {
    if (!bounds.has(id)) { clear(); return; }
    selectedId = id;
    $('picked-building-name').textContent = names[id] || id;
    $('picked-building-note').textContent = id === 'FAB2'
      ? '扩建预留建筑 · 可进入内部查看方案与模拟设备。'
      : '查看内部空间、设备状态与模拟控制。';
    $('building-twin-link').href = twinURL(id);
    $('building-twin-link').setAttribute('aria-label',`进入${names[id]}的数字孪生`);
    $('building-card').hidden = !exteriorMode();
    $('building-announcement').textContent = `已选中${names[id]}，可进入对应数字孪生。`;
    $('building').value = id;
    if (syncCad && !$('cad-building').disabled) {
      $('cad-building').value = id;
      syncCadLink(id);
    }
    outline.box.copy(bounds.get(id));
    outline.visible = exteriorMode();
    api.requestRender();
  }
  canvas.addEventListener('pointerdown',event => {
    if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || !exteriorMode()) {
      gesture = null; return;
    }
    gesture = {id:event.pointerId,x:event.clientX,y:event.clientY,dragged:false};
  });
  canvas.addEventListener('pointermove',event => {
    if (gesture?.id === event.pointerId && Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>6) gesture.dragged = true;
  });
  canvas.addEventListener('pointercancel',() => {gesture=null;});
  canvas.addEventListener('pointerup',event => {
    const start = gesture; gesture = null;
    if (!start || start.id !== event.pointerId || start.dragged || event.button !== 0 || !exteriorMode() || Math.hypot(event.clientX-start.x,event.clientY-start.y)>6) return;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) return;
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    api.camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer,api.camera);
    const hit = pickBuilding(raycaster,index);
    if (hit) selectBuilding(hit.id); else clear();
  });
  $('building-dismiss').addEventListener('click',clear);
  addEventListener('keydown',event => {
    if (event.key === 'Escape' && !event.target.closest?.('input,select,textarea,[contenteditable=true]')) clear();
  });
  addEventListener('campus-cad-building-change',event => {
    const id = event.detail.id;
    syncCadLink(id);
    selectBuilding(id,{syncCad:false});
  });
  addEventListener('campus-mode-change',() => {
    gesture = null;
    if (selectedId) selectBuilding(selectedId,{syncCad:false});
    else { outline.visible=false; $('building-card').hidden=true; api.requestRender(); }
  });
  syncCadLink($('cad-building').value);
  return {selectBuilding,clear,get selectedId(){return selectedId;}};
}
