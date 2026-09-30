import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadModel} from '../viewer-twin/model-loader.js?v=8';
import {CampusSimulation,METRICS} from './simulation.js?v=3.1';

const $=id=>document.getElementById(id);
const base=new URL('../output/cad-web/',import.meta.url);
const ids=['HQ','FAB1','FAB2','LAB','MASK','EXHIBITION','DINING_E','DINING_W'];
const names={HQ:'行政研发楼',FAB1:'FAB 1 主厂房',FAB2:'FAB 2 对称方案',LAB:'LAB 实验楼',MASK:'MASK 厂房',EXHIBITION:'展示中心',DINING_E:'东侧餐厅',DINING_W:'西侧餐厅'};
const systems={foundation:'基础',structure:'柱梁结构',slabs:'楼板',envelope:'外墙',glazing:'幕墙玻璃',roof:'屋顶',equipment:'设备',piping:'管线 / 管架',interiors:'室内工艺',circulation:'楼梯 / 交通'};
const sim=new CampusSimulation();
const cache=new Map();
let api,manifest,active,mode='exterior',request=0,selected,hiddenExterior=[],isolation=false,lightingState,assetBindings=[];
const cadGrid=new THREE.GridHelper(600,60,0x8e9c92,0xafb9b0);cadGrid.visible=false;cadGrid.material.transparent=true;cadGrid.material.opacity=.36;
const clipPlane=new THREE.Plane(new THREE.Vector3(0,0,-1),0);
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const highlight=new THREE.Box3Helper(new THREE.Box3(),0xe19a43);highlight.visible=false;highlight.material.depthTest=false;highlight.renderOrder=100;
function invalidate(shadows=false){api?.invalidate({shadows});}
function updateViewOffset(){if(!api)return;if(mode==='cad'&&!$('twin-panel').hidden&&innerWidth>700)api.camera.setViewOffset(innerWidth,innerHeight,-Math.min(340,innerWidth*.3)/2,0,innerWidth,innerHeight);else api.camera.clearViewOffset();invalidate();}
function message(text){$('cad-message').textContent=text;}
function restoreExterior(){for(const [object,visible] of hiddenExterior)object.visible=visible;hiddenExterior=[];if(api?.model)api.model.visible=true;document.body.classList.remove('cad-isolated');}
function cadLighting(enabled){
 if(!api)return;
 if(enabled){
  if(!lightingState)lightingState={quality:$('quality').value,sun:api.sun.position.clone(),target:api.sun.target.position.clone(),shadow:{left:api.sun.shadow.camera.left,right:api.sun.shadow.camera.right,top:api.sun.shadow.camera.top,bottom:api.sun.shadow.camera.bottom,near:api.sun.shadow.camera.near,far:api.sun.shadow.camera.far},background:api.scene.background.clone()};
  const center=active.bounds.getCenter(new THREE.Vector3()),radius=active.bounds.getSize(new THREE.Vector3()).length()*.65;
  api.sun.position.copy(center).add(new THREE.Vector3(-210,350,180));api.sun.target.position.copy(center);Object.assign(api.sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:1,far:1000});api.sun.shadow.camera.updateProjectionMatrix();api.scene.background=new THREE.Color('#cfd5cf');cadGrid.position.set(center.x,active.bounds.min.y-.35,center.z);cadGrid.visible=true;
  // Respect the user's quality choice. CAD inspection must remain responsive in flow mode.
 }else if(lightingState){
  api.sun.position.copy(lightingState.sun);api.sun.target.position.copy(lightingState.target);Object.assign(api.sun.shadow.camera,lightingState.shadow);api.sun.shadow.camera.updateProjectionMatrix();api.scene.background.copy(lightingState.background);$('quality').value=lightingState.quality;$('quality').dispatchEvent(new Event('change'));lightingState=undefined;cadGrid.visible=false;
 }
}
function applyVisibility(){
 restoreExterior();
 for(const entry of cache.values())if(entry.root)entry.root.visible=mode==='cad'&&entry===active;
 highlight.visible=false;
 if(mode!=='cad'||!active){cadLighting(false);api?.camera.clearViewOffset();if(api){api.occlusion.enabled=true;api.occlusion.normalMaterial.clippingPlanes=[];api.occlusion.normalMaterial.needsUpdate=true;}invalidate(true);return;}
 isolation=$('cad-isolate').checked;
 if(isolation){api.model.visible=false;document.body.classList.add('cad-isolated');}
 else api.model.traverse(object=>{if(object.isMesh&&((object.userData.part_group||'')==='10_'+active.id||object.name.startsWith('10_'+active.id+'__'))){hiddenExterior.push([object,object.visible]);object.visible=false;}});
 cadLighting(isolation);
 syncSectionPass();
 invalidate(true);
}
async function getManifest(){if(!manifest){const response=await fetch(new URL('manifest.json',base),{cache:'no-cache'});if(!response.ok)throw new Error('CAD 清单尚未生成');manifest=await response.json();}return manifest;}
async function loadBuilding(id){
 if(cache.has(id))return cache.get(id).promise;
 const entry={id};cache.set(id,entry);
 entry.promise=(async()=>{
  const data=await getManifest(),record=data.buildings.find(b=>b.id===id);if(!record)throw new Error('没有找到该建筑的 CAD 模型');
  const [gltf,meta]=await Promise.all([loadModel(new GLTFLoader(),new URL(record.model+'?rev='+record.glbSHA256.slice(0,12),base)),fetch(new URL(record.metadata+'?rev='+record.glbSHA256.slice(0,12),base)).then(r=>{if(!r.ok)throw new Error('构件清单加载失败');return r.json();})]);
  const byId=new Map(meta.components.map(c=>[c.id,c]));entry.record=record;entry.meta=meta;entry.root=gltf.scene;entry.meshes=[];entry.bounds=new THREE.Box3().setFromObject(entry.root);entry.root.name='FreeCAD_'+id;
  entry.root.traverse(o=>{if(!o.isMesh)return;const asset=byId.get(o.userData.asset_id)||byId.get(o.name);if(!asset)return;o.userData.cad=asset;o.userData.basePosition=o.position.clone();o.userData.baseVisible=true;o.castShadow=true;o.receiveShadow=true;o.material=o.material.clone();o.material.clippingPlanes=[];o.material.clipShadows=true;o.material.side=THREE.DoubleSide;entry.meshes.push(o);});
  entry.root.visible=false;api.scene.add(entry.root);
  // Compile the incoming building while the previous view remains intact.
  // Reopening a cached building should not traverse and compile the whole campus.
  await api.renderer.compileAsync(entry.root,api.camera,api.scene);
  return entry;
 })().catch(error=>{cache.delete(id);throw error;});
 return entry.promise;
}
function fit(){if(!active)return;const bounds=new THREE.Box3();for(const mesh of active.meshes){if(mesh.visible){mesh.updateWorldMatrix(true,false);bounds.expandByObject(mesh);}}if(bounds.isEmpty())return;const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());const radius=size.length()*.5;const fov=40;let distance=radius/Math.sin(THREE.MathUtils.degToRad(fov/2))*1.02;
 // Reserve room on the left for the CAD panel without moving the building itself.
 api.camera.fov=fov;updateViewOffset();api.camera.updateProjectionMatrix();api.controls.target.copy(center);api.camera.position.copy(center).add(new THREE.Vector3(.45,.48,.75).normalize().multiplyScalar(distance));api.controls.update();invalidate();}
function renderSystemControls(){const container=$('cad-systems');container.replaceChildren();for(const key of [...new Set(active.meshes.map(o=>o.userData.cad.system))]){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.system=key;input.onchange=()=>{for(const o of active.meshes)if(o.userData.cad.system===key)o.visible=input.checked;if(selected&&!selected.visible)highlight.visible=false;invalidate(true);};label.append(input,document.createTextNode(' '+(systems[key]||key)));container.append(label);}}
function applyExplode(){if(!active)return;const amount=Number($('cad-explode').value)/100;$('explode-value').textContent=Math.round(amount*100)+'%';const box=active.bounds,center=box.getCenter(new THREE.Vector3()),height=box.max.y-box.min.y;
 for(const mesh of active.meshes){const b=mesh.userData.basePosition,a=mesh.userData.cad;mesh.position.copy(b);const elevation=(a.bounds[2]+a.bounds[5])*.5;const layer=(elevation-box.min.y)/Math.max(height,1);mesh.position.y+=amount*layer*height*1.5;const side=['envelope','glazing'].includes(a.system)?1:0;mesh.position.x+=side*amount*Math.sign(b.x-center.x)*22;mesh.position.z+=side*amount*Math.sign(b.z-center.z)*15;}
 if(selected)highlight.box.setFromObject(selected);invalidate(true);
}
function syncSectionPass(){if(!api)return;const clipped=mode==='cad'&&Number($('cad-section').value)<100;api.occlusion.enabled=!clipped||isolation;api.occlusion.normalMaterial.clippingPlanes=clipped&&isolation?[clipPlane]:[];api.occlusion.normalMaterial.needsUpdate=true;}
function applySection(){if(!active)return;const value=Number($('cad-section').value);$('section-value').textContent=value===100?'关闭':value+'%';const box=active.bounds;clipPlane.constant=THREE.MathUtils.lerp(box.min.z-1,box.max.z+1,value/100);api.renderer.localClippingEnabled=true;for(const mesh of active.meshes){const prior=mesh.material.clippingPlanes.length;mesh.material.clippingPlanes=value===100?[]:[clipPlane];if((value===100&&prior)||(value<100&&!prior))mesh.material.needsUpdate=true;}syncSectionPass();highlight.visible=false;invalidate(true);}
function selectComponent(mesh){if(!mesh)return;selected=mesh;const a=mesh.userData.cad;const card=$('cad-component');card.replaceChildren();const title=document.createElement('b');title.textContent=a.label;card.append(title,document.createTextNode(`${a.id} · ${systems[a.system]||a.system} · ${a.level}`),document.createElement('br'),document.createTextNode('来源：FreeCAD / '+(a.freecadName||a.id)));highlight.box.setFromObject(mesh);highlight.visible=mesh.visible&&mode==='cad';invalidate();renderTelemetry();}
async function showCAD(focus=true){const ticket=++request,id=$('cad-building').value;$('mode-cad').disabled=true;$('cad-building').disabled=true;message('载入 '+names[id]+' 的 CAD 构件…');
 try{await waitForCampus();const entry=await loadBuilding(id);if(ticket!==request)return;active=entry;mode='cad';selected=null;$('mode-exterior').classList.remove('active');$('mode-cad').classList.add('active');$('cad-controls').hidden=false;$('cad-explode').value=0;$('cad-section').value=100;renderSystemControls();for(const mesh of entry.meshes)mesh.visible=true;applyExplode();applySection();applyVisibility();
  if(focus)fit();
  // Assets are cached by building. Later selections do not fetch or parse them again.
  if(ticket!==request)return;invalidate(true);
  $('cad-drawing').href=new URL(entry.record.drawing,base).href;$('cad-source').href=new URL(entry.record.source,base).href;
  $('cad-component').textContent='点选模型中的构件，查看编号和所属系统。';
  message(`${names[id]} · ${entry.meshes.length} 组构件 · ${entry.record.size[0]} × ${entry.record.size[1]} m${id==='FAB2'?' · 同类推定':''}`);
 }catch(error){if(ticket===request){if(mode==='cad'&&active)$('cad-building').value=active.id;message('CAD 加载失败：'+error.message+'。可再次点击重试。');console.error(error);}}finally{if(ticket===request){$('mode-cad').disabled=false;$('cad-building').disabled=false;}}
}
function showExterior(){++request;mode='exterior';selected=null;$('mode-cad').disabled=false;$('cad-building').disabled=false;$('mode-cad').classList.remove('active');$('mode-exterior').classList.add('active');$('cad-controls').hidden=true;applyVisibility();message('园区外观 · 保留原有完整枝叶。选择 CAD 构件可查看建筑内部。');if(api?.ready)api.setView('north');}
function waitForCampus(){if(api?.ready)return Promise.resolve(api);if(window.campusV2?.ready){initCampus(window.campusV2);return Promise.resolve(api);}return new Promise(resolve=>addEventListener('campus-ready',event=>{initCampus(event.detail);resolve(api);},{once:true}));}
function initCampus(value){if(api)return;api=value;api.scene.add(highlight,cadGrid);let start;
 api.renderer.domElement.addEventListener('pointerdown',event=>{start={x:event.clientX,y:event.clientY};});
 api.renderer.domElement.addEventListener('pointerup',event=>{if(!start||mode!=='cad'||!active||Math.hypot(start.x-event.clientX,start.y-event.clientY)>5)return;const rect=api.renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,api.camera);const hit=raycaster.intersectObjects(active.meshes.filter(m=>m.visible),false).find(h=>!h.object.material.clippingPlanes.length||clipPlane.distanceToPoint(h.point)>=0);if(hit)selectComponent(hit.object);});
}
$('twin-open').onclick=()=>{$('twin-panel').hidden=false;$('twin-open').hidden=true;$('twin-open').setAttribute('aria-expanded','true');updateViewOffset();};
$('twin-close').onclick=()=>{$('twin-panel').hidden=true;$('twin-open').hidden=false;$('twin-open').setAttribute('aria-expanded','false');updateViewOffset();};
$('mode-cad').onclick=()=>showCAD();$('mode-exterior').onclick=showExterior;
$('cad-building').onchange=()=>{selected=null;if(mode==='cad')showCAD();renderTelemetry();};
$('cad-isolate').onchange=()=>applyVisibility();$('cad-fit').onclick=fit;$('cad-explode').oninput=applyExplode;$('cad-section').oninput=applySection;
$('cad-cutaway').onclick=()=>{$('cad-section').value=50;$('cad-explode').value=16;applyExplode();applySection();fit();};
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(mode==='cad'){showExterior();api.setView(button.dataset.view);}}));
function formatTime(t){return [Math.floor(t/60),Math.floor(t%60)].map(v=>String(v).padStart(2,'0')).join(':');}
for(const metric of METRICS){const card=document.createElement('div');card.className='metric';card.id='metric-'+metric.key;card.innerHTML=`<div class="metric-label">${metric.label}</div><strong>—</strong><small>${metric.unit}</small>`;$('telemetry').append(card);}
async function focusAlarm(event){$('cad-building').value=event.buildingId;$('cad-isolate').checked=true;await Promise.all([showCAD(),loadAssetBindings()]);if(!active||active.id!==event.buildingId)return;const binding=assetBindings.find(b=>b.buildingId===event.buildingId);const mesh=active.meshes.find(o=>o.userData.cad.id===binding?.simulationAssetId)||active.meshes.find(o=>o.userData.cad.system==='equipment');if(mesh)selectComponent(mesh);}
function renderTelemetry(){const id=$('cad-building').value,s=sim.sample(id);$('sim-clock').textContent=(sim.paused?'暂停 · ':'SIM · ')+formatTime(sim.elapsed);for(const m of METRICS){const card=$('metric-'+m.key);card.querySelector('strong').textContent=s.values[m.key].toFixed(m.digits);card.classList.toggle('alarm',s.alarms.includes(m.key));}
 $('sim-summary').textContent=(s.alarms.length?`${s.alarms.length} 项指标越过演示阈值`:'指标在演示阈值内')+' · '+names[id]+' · 每秒更新';
 const list=$('sim-events');list.replaceChildren();for(const event of sim.events.filter(e=>e.buildingId===id).slice(0,4)){const btn=document.createElement('button');btn.textContent=`${formatTime(event.time)} ${event.state==='active'?'告警':'恢复'} · ${METRICS.find(m=>m.key===event.metric).label} ${event.value} · 定位关联构件 ↗`;btn.onclick=()=>focusAlarm(event);list.append(btn);}
}
$('sim-scenario').onchange=()=>{sim.setScenario($('sim-scenario').value);renderTelemetry();};
$('sim-pause').onclick=()=>{sim.paused=!sim.paused;$('sim-pause').textContent=sim.paused?'继续模拟':'暂停模拟';renderTelemetry();};
$('sim-reset').onclick=()=>{sim.reset();$('sim-scenario').value='normal';$('sim-pause').textContent='暂停模拟';renderTelemetry();};
let snapshotURL;
$('sim-export').onclick=async()=>{await loadAssetBindings();const snapshot=sim.snapshot(ids);snapshot.assetBindings=assetBindings;const json=JSON.stringify(snapshot,null,2);if(snapshotURL)URL.revokeObjectURL(snapshotURL);snapshotURL=URL.createObjectURL(new Blob([json],{type:'application/json'}));$('snapshot-json').value=json;$('snapshot-download').href=snapshotURL;$('snapshot-preview').hidden=false;$('snapshot-preview').open=true;};
let last=performance.now();setInterval(()=>{const now=performance.now();sim.advance((now-last)/1000);last=now;sim.evaluate(ids);if(!$('twin-panel').hidden)renderTelemetry();},1000);renderTelemetry();
if(window.campusV2?.ready)initCampus(window.campusV2);else addEventListener('campus-ready',e=>initCampus(e.detail),{once:true});
addEventListener('resize',updateViewOffset);
let bindingsPromise;
function loadAssetBindings(){
 if(bindingsPromise)return bindingsPromise;
 bindingsPromise=fetch('../output/cad/components.json').then(r=>{if(!r.ok)throw new Error('CAD资产表未就绪');return r.json();}).then(data=>{assetBindings=ids.flatMap(id=>{const components=data.components.filter(c=>c.buildingId===id);const asset=components.find(c=>c.system==='equipment'&&/AHU|cooling|chiller|air|风|冷/i.test(c.label))||components.find(c=>c.system==='equipment')||components.find(c=>c.system==='envelope');return asset?[{buildingId:id,simulationAssetId:asset.id,metrics:METRICS.map(m=>m.key),bindingType:asset.system==='equipment'?'demonstration equipment association; not physical sensors':'building-zone demonstration anchor; not physical sensors'}]:[];});}).catch(error=>{bindingsPromise=undefined;console.warn(error.message);});
 return bindingsPromise;
}
document.querySelector('.legacy-simulation').addEventListener('toggle',event=>{if(event.target.open)loadAssetBindings();});
window.campusTwin={sim,loadBuilding,showCAD,showExterior,selectComponent,fit,get active(){return active;},get mode(){return mode;},get selected(){return selected?.userData.cad;},get cache(){return cache;},get assetBindings(){return assetBindings;}};
