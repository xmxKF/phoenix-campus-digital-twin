import * as THREE from 'three';
import {sampleMotion} from './manufacturing-motion.js';
import {loadModel} from './model-loader.js?v=8';
const cadPoint=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const base=new URL('../output/manufacturing-web/',import.meta.url);

export async function loadManufacturingGeometry(scene,entry,loader){
 if(!scene.manufacturingSpec?.buildings.some(b=>b.id===entry.id))return;
 scene.manufacturingManifest??=fetch(new URL('manifest.json',base)).then(r=>{if(!r.ok)throw Error('制造模型清单未就绪');return r.json();});
 const manifest=await scene.manufacturingManifest,m=manifest.buildings.find(b=>b.id===entry.id);if(!m)return;
 const [gltf,metadata]=await Promise.all([loadModel(loader,new URL(m.model+'?v='+(m.glbSHA256||m.sha256||'6').slice(0,12),base)),fetch(new URL(m.metadata,base)).then(r=>r.json())]);
 entry.manufacturing=gltf.scene;entry.root.add(gltf.scene);entry.manufacturingMeshes=[];entry.manufacturingActors=new Map();
 const components=new Map(metadata.components.map(c=>[c.id,c]));const assets=new Map(scene.manufacturingSpec.assets.filter(a=>a.buildingId===entry.id).map(a=>[a.id,a]));
 gltf.scene.traverse(o=>{const id=o.userData.asset_id||o.name,a=assets.get(id);if(a&&!o.isMesh)entry.manufacturingActors.set(id,o);});
 gltf.scene.traverse(o=>{if(!o.isMesh)return;let parent=o;while(parent&&!assets.has(parent.userData.asset_id||parent.name))parent=parent.parent;const id=parent?(parent.userData.asset_id||parent.name):(o.userData.asset_id||o.name),a=assets.get(id);if(!a)return;const c=components.get(id)||{id,label:a.label,buildingId:a.buildingId,level:'F1',system:'manufacturing',meta:a};
  o.userData.meta={...c,id,meta:{...a,...c.meta},system:'manufacturing'};o.userData.basePosition=o.position.clone();o.material=o.material.clone();o.userData.baseColor=o.material.color.clone();o.userData.baseEmissive=o.material.emissive.clone();o.userData.baseEmissiveIntensity=o.material.emissiveIntensity;
  o.userData.isStatusLight=['status_light','status_red','status_amber'].includes(o.userData.role);o.material.side=THREE.DoubleSide;o.material.clipShadows=true;o.castShadow=!['carrier','oht'].includes(a.kind);o.receiveShadow=true;o.geometry.computeBoundingBox();entry.manufacturingMeshes.push(o);
  if(!entry.manufacturingActors.has(id))entry.manufacturingActors.set(id,o);
 });
 for(const [id,actor] of entry.manufacturingActors){const a=assets.get(id),c=components.get(id);actor.userData.meta={...c,id,label:a.label,buildingId:a.buildingId,level:'F1',system:'manufacturing',meta:{...a,...c?.meta}};}
}

export function applyManufacturingVisibility(scene,sides=[]){
 const e=scene.active;if(!e?.manufacturing)return;
 const visible=!['exterior','mep'].includes(scene.view)&&(scene.level==='all'||scene.level==='F1')&&(!scene.room||scene.room.id===e.id+'_R01');e.manufacturing.visible=visible;
 for(const o of e.manufacturingMeshes){o.visible=visible;o.material.clippingPlanes=sides;}
}

export function updateManufacturingGeometry(scene,snapshot){
 const e=scene.active;if(!e?.manufacturing)return;
 const states=snapshot.assetStates||{},window=snapshot.motionSamples;e.root.updateWorldMatrix(true,true);
 const newWindow=e.motionTime!==snapshot.time;
 for(const [id,actor] of e.manufacturingActors){const state=states[id];if(!state)continue;
  if(state.position&&['carrier','oht'].includes(actor.userData.meta.meta.kind)&&newWindow){
   const samples=window?.assets?.[id];
   if(samples?.length>1){actor.userData.motion={samples,startTime:window.startTime,endTime:window.endTime,start:performance.now(),duration:240};actor.position.copy(actor.parent.worldToLocal(cadPoint(samples[0].position)));}
   else{delete actor.userData.motion;actor.position.copy(actor.parent.worldToLocal(cadPoint(state.position)));if(state.heading!==undefined)actor.rotation.y=state.heading;}
  }
 }
 e.motionTime=snapshot.time;
 for(const o of e.manufacturingMeshes){const s=states[o.userData.meta.id];if(!s)continue;const mat=o.material;
  mat.color.copy(o.userData.baseColor);mat.emissive.copy(o.userData.baseEmissive);mat.emissiveIntensity=o.userData.baseEmissiveIntensity;
  if(o.userData.isStatusLight){const activeRole=s.fault||s.blocked?'status_red':['held','hold','utility_wait'].includes(s.status)?'status_amber':'status_light';const lit=s.enabled!==false&&o.userData.role===activeRole;mat.emissive.copy(mat.color);mat.emissiveIntensity=lit?.9:0;}
  else if(s.fault){mat.color.lerp(new THREE.Color('#c17a67'),.35);}
 }
 scene.manufacturingMoving=[...e.manufacturingActors.values()].some(a=>a.userData.motion);scene.updateHighlight();scene.invalidate();
}
export function animateManufacturing(scene,t){
 if(!scene.active?.manufacturingActors||!scene.manufacturingMoving)return false;let moving=false;
 for(const actor of scene.active.manufacturingActors.values()){const motion=actor.userData.motion;if(!motion)continue;const k=Math.min(1,Math.max(0,(t-motion.start)/motion.duration));const pose=sampleMotion(motion.samples,motion.startTime+(motion.endTime-motion.startTime)*k);actor.position.copy(actor.parent.worldToLocal(cadPoint(pose.position)));if(pose.heading!==undefined)actor.rotation.y=pose.heading;if(k===1)delete actor.userData.motion;else moving=true;}
 scene.manufacturingMoving=moving;scene.updateHighlight();return moving;
}
