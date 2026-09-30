import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadModel} from './model-loader.js?v=8';
import {installKeyboardNavigation} from '../viewer-v2/navigation.js?v=5';
import {createPickedInspection,resolvePickedInspection,focusPadding} from './focus-bounds.js?v=7';
import {chooseVisibleHit,describePick,isPickGesture,objectIsVisible} from './picking.js';
import {loadManufacturingGeometry,applyManufacturingVisibility,updateManufacturingGeometry,animateManufacturing} from './manufacturing-scene.js?v=8';

const cadBase=new URL('../output/cad-web/',import.meta.url),mepBase=new URL('../output/mep-web/',import.meta.url);
const v3=p=>new THREE.Vector3(p[0],p[2],-p[1]);
export class TwinScene{
 constructor(element,labels,onPick){
  this.element=element;this.labels=labels;this.onPick=onPick;this.cache=new Map();this.view='cut';this.level='all';this.room=null;this.explode=0;this.layers={electrical:true,water:true,hvac:true,labels:true};this.ticket=0;this.pending=false;this.meshById=new Map();
  this.draco=new DRACOLoader().setDecoderPath(new URL('../viewer/vendor/libs/draco/gltf/',import.meta.url).href).setWorkerLimit(2);this.draco.preload();this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#c8d5d6');this.camera=new THREE.PerspectiveCamera(40,1,.2,3000);this.camera.position.set(100,100,150);
  this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.92;this.renderer.localClippingEnabled=true;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;element.prepend(this.renderer.domElement);
  const pmrem=new THREE.PMREMGenerator(this.renderer),env=new RoomEnvironment();this.env=pmrem.fromScene(env,.04);this.scene.environment=this.env.texture;env.dispose();pmrem.dispose();
  this.scene.environmentIntensity=.5;this.scene.add(new THREE.HemisphereLight(0xe7f5ff,0x9faaa1,.6));this.sun=new THREE.DirectionalLight(0xfff3dd,2.7);this.sun.position.set(-100,180,130);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.normalBias=.035;this.sun.shadow.bias=-.0002;this.scene.add(this.sun,this.sun.target);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.13;this.controls.minDistance=2;this.controls.maxDistance=900;this.controls.maxPolarAngle=Math.PI*.49;this.controls.addEventListener('change',()=>this.invalidate());
  this.keyboard=installKeyboardNavigation(this.camera,this.controls,()=>this.invalidate());
  this.highlight=new THREE.Box3Helper(new THREE.Box3(),0xe69b25);this.highlight.visible=false;this.highlight.material.depthTest=false;this.highlight.renderOrder=100;this.scene.add(this.highlight);
  this.ray=new THREE.Raycaster();this.installPicking();
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(element);this.resize();
 }
 installPicking(){
  const canvas=this.renderer.domElement,defaultTitle='单击选中物件 · 拖动旋转视角';let down=null,hoverTimer=0,hoverPoint=null;const pointers=new Set();
  const clearHover=()=>{clearTimeout(hoverTimer);hoverTimer=0;hoverPoint=null;this.hoveredId=null;canvas.style.cursor='grab';canvas.title=defaultTitle;};clearHover();
  canvas.addEventListener('pointerdown',e=>{pointers.add(e.pointerId);clearHover();down=pointers.size===1&&e.button===0&&e.isPrimary!==false?{pointerId:e.pointerId,x:e.clientX,y:e.clientY,maxDistance:0}:null;});
  canvas.addEventListener('pointermove',e=>{
   if(down){down.maxDistance=Math.max(down.maxDistance,Math.hypot(e.clientX-down.x,e.clientY-down.y));return;}
   if(e.buttons||e.pointerType==='touch')return;hoverPoint={x:e.clientX,y:e.clientY};
   // Throttled hover, including the final pointer position, keeps ray tests out
   // of camera drags and avoids a full CAD raycast on every pointer event.
   if(!hoverTimer)hoverTimer=setTimeout(()=>{hoverTimer=0;if(!hoverPoint)return;const hit=this.pickAt(hoverPoint.x,hoverPoint.y);this.hoveredId=hit?.componentId||null;canvas.style.cursor=hit?'pointer':'grab';canvas.title=hit?`${hit.component.label}\n${hit.assetId?'单击查看状态与控制':'单击查看构件与关联设备'} · ${hit.componentId}`:defaultTitle;},85);
  });
  canvas.addEventListener('pointerup',e=>{const start=down;down=null;pointers.delete(e.pointerId);if(!isPickGesture(start,e))return;const hit=this.pickAt(e.clientX,e.clientY);if(hit)this.onPick(hit.assetId||hit.componentId,hit);});
  canvas.addEventListener('pointercancel',e=>{down=null;pointers.delete(e.pointerId);clearHover();});
  canvas.addEventListener('pointerleave',clearHover);
  canvas.addEventListener('lostpointercapture',e=>{pointers.delete(e.pointerId);queueMicrotask(()=>{if(down?.pointerId===e.pointerId)down=null;});});
 }
 pickAt(clientX,clientY){
  if(!this.active||!this.layout)return null;const b=this.renderer.domElement.getBoundingClientRect();
  if(clientX<b.left||clientX>b.right||clientY<b.top||clientY>b.bottom)return null;
  this.scene.updateMatrixWorld();this.camera.updateMatrixWorld();this.ray.near=this.camera.near;this.ray.far=this.camera.far;
  this.ray.setFromCamera(new THREE.Vector2((clientX-b.left)/b.width*2-1,1-(clientY-b.top)/b.height*2),this.camera);
  const candidates=[...this.active.cadMeshes,...this.active.mepMeshes,...(this.active.manufacturingMeshes||[])].filter(objectIsVisible);
  const hit=chooseVisibleHit(this.ray.intersectObjects(candidates,false));
  return hit?{...describePick(hit.object.userData.meta,this.assetMap,this.layout.waterBranches),point:hit.point.toArray(),meshUuid:hit.object.uuid,faceIndex:hit.faceIndex,materialIndex:hit.face?.materialIndex||0,partId:hit.object.userData.component_id||hit.object.name}:null;
 }
 resize(){const w=this.element.clientWidth,h=this.element.clientHeight;this.viewportWidth=w;this.viewportHeight=h;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);this.invalidate();}
 invalidate(){if(this.pending)return;this.pending=true;requestAnimationFrame(t=>this.frame(t));}
 frame(t){this.pending=false;const dt=Math.min((t-(this.lastTime??t-16))/1000,.05);this.lastTime=t;this.keyboard.update(dt);const moved=this.controls.update(),transportMoving=animateManufacturing(this,t);const d=this.camera.position.distanceTo(this.controls.target);const n=THREE.MathUtils.clamp(d/450,.08,4);if(Math.abs(this.camera.near-n)>.01){this.camera.near=n;this.camera.far=Math.max(500,d+1000);this.camera.updateProjectionMatrix();}this.renderer.render(this.scene,this.camera);this.updateLabels();if(moved||transportMoving||this.keyboard.active)this.invalidate();}
 async load(id,layout){
  const ticket=++this.ticket;
  if(!this.cache.has(id))this.cache.set(id,this.fetchModel(id).catch(e=>{this.cache.delete(id);throw e;}));
  const entry=await this.cache.get(id);if(ticket!==this.ticket)return false;
  // compile() traverses hidden meshes too. Keep the pending root hidden so an
  // animation frame cannot briefly draw two buildings while shaders compile.
  entry.compilation??=this.renderer.compileAsync(entry.root,this.camera,this.scene).catch(error=>{entry.compilation=null;throw error;});
  await entry.compilation;if(ticket!==this.ticket)return false;
  if(this.active)this.active.root.visible=false;this.active=entry;if(this.view==='production'&&!entry.manufacturing)this.view='cut';entry.root.visible=true;this.meshById=new Map([...entry.cadMeshes,...entry.mepMeshes].map(m=>[m.userData.meta.id,m]));this.layout=layout;for(const [id,actor] of entry.manufacturingActors||[])this.meshById.set(id,actor);this.assetMap=new Map([...layout.controlAssets,...layout.sensors,...(layout.electricalLoads||[]),...layout.circuits,...(this.manufacturingSpec?.assets||[])].map(a=>[a.id,a]));this.rooms=layout.rooms.filter(r=>r.buildingId===id);this.room=null;this.level=this.rooms[0]?.level||'all';this.selectedId=null;this.pickedInspection=null;this.highlight.visible=false;
  this.labels.replaceChildren();this.labelElements=this.rooms.map(r=>{const el=document.createElement('div');el.className='room-label';el.append(document.createTextNode(r.label));const small=document.createElement('small');small.textContent=r.level+' · 推定布置';el.append(small);this.labels.append(el);return {room:r,el,small};});
  this.applyVisibility();this.fit();this.invalidate();return true;
 }
 async fetchModel(id){
  if(!this.manifests)this.manifests=Promise.all([fetch(new URL('manifest.json',cadBase)).then(r=>r.json()),fetch(new URL('manifest.json',mepBase)).then(r=>{if(!r.ok)throw Error('机电模型尚未生成');return r.json();})]);
  const [cm,mm]=await this.manifests,c=cm.buildings.find(b=>b.id===id),m=mm.buildings.find(b=>b.id===id);if(!c||!m)throw Error('建筑模型清单不完整');
  const root=new THREE.Group();root.name=id;root.visible=false;const entry={id,root,cadMeshes:[],mepMeshes:[]};
  const loader=new GLTFLoader().setDRACOLoader(this.draco);const [cg,mg,cmeta,mmeta]=await Promise.all([loadModel(loader,new URL(c.model+'?v='+c.glbSHA256.slice(0,10),cadBase)),loadModel(loader,new URL(m.model+'?v='+m.glbSHA256.slice(0,10),mepBase)),fetch(new URL(c.metadata,cadBase)).then(r=>r.json()),fetch(new URL(m.metadata,mepBase)).then(r=>r.json()),loadManufacturingGeometry(this,entry,loader)]);
  root.add(cg.scene,mg.scene);Object.assign(entry,{cad:cg.scene,mep:mg.scene,bounds:new THREE.Box3().setFromObject(cg.scene)});
  for(const [group,meta,meshes] of [[cg.scene,cmeta,entry.cadMeshes],[mg.scene,mmeta,entry.mepMeshes]]){const map=new Map(meta.components.map(c=>[c.id,c]));group.traverse(o=>{if(!o.isMesh)return;const c=map.get(o.userData.asset_id)||map.get(o.name);if(!c)return;o.userData.meta=c;o.userData.basePosition=o.position.clone();o.material=o.material.clone();o.userData.baseColor=o.material.color.clone();o.material.side=THREE.DoubleSide;o.material.roughness=.6;o.material.clipShadows=true;o.castShadow=c.system!=='sensors';o.receiveShadow=true;o.geometry.computeBoundingBox();meshes.push(o);});}
  this.scene.add(root);return entry;
 }
 setView(view){this.view=view;if(view==='exterior'||view==='mep')this.room=null;if(view==='production'){this.level='F1';this.room=this.rooms.find(r=>r.id===this.active.id+'_R01')||null;}this.applyVisibility();this.fit();}
 setFloor(level){if(this.view==='production'&&level!=='F1')this.view='cut';this.level=level;this.room=null;this.applyVisibility();this.fit();}
 setLayers(layers,explode){Object.assign(this.layers,layers);this.explode=explode;this.applyVisibility();this.invalidate();}
 applyVisibility(){
  if(!this.active)return;const exterior=this.view==='exterior',mepOnly=this.view==='mep';const relevant=this.rooms.filter(r=>this.level==='all'||r.level===this.level);const zMin=Math.min(...relevant.map(r=>r.floorZ)),zMax=Math.max(...relevant.map(r=>r.floorZ+1.25));this.floorMin=zMin;
  const upper=new THREE.Plane(new THREE.Vector3(0,-1,0),zMax),lower=new THREE.Plane(new THREE.Vector3(0,1,0),-zMin+.7);
  const roomCut=this.room&&!exterior&&!mepOnly,rb=this.room?.bounds;
  const sides=roomCut?[new THREE.Plane(new THREE.Vector3(1,0,0),-rb[0]+1.2),new THREE.Plane(new THREE.Vector3(-1,0,0),rb[3]+1.2),new THREE.Plane(new THREE.Vector3(0,0,1),rb[4]+1.2),new THREE.Plane(new THREE.Vector3(0,0,-1),-rb[1]+1.2)]:[];
  const equipmentTop=new THREE.Plane(new THREE.Vector3(0,-1,0),zMax+2.5),logisticsTop=new THREE.Plane(new THREE.Vector3(0,-1,0),zMax+6);
  for(const o of this.active.cadMeshes){const c=o.userData.meta,logistics=/\bOHT\b|\bFOUP\b|stocker/i.test(c.label);o.visible=!mepOnly;if(this.active.manufacturing&&/Cleanroom process bay|FOUP|OHT|stocker/i.test(c.label))o.visible=false;o.material.clippingPlanes=exterior?[]:[logistics?logisticsTop:['interiors','equipment','piping'].includes(c.system)&&!/partition/i.test(c.label)?equipmentTop:upper,lower,...sides];if(!exterior&&(c.system==='roof'||(c.level==='RF'&&['equipment','piping'].includes(c.system))))o.visible=false;}
  for(const o of this.active.mepMeshes){const c=o.userData.meta,meta=c.meta||{};const room=this.rooms.find(r=>r.id===meta.roomId);const levelOk=(this.level==='all'||!room||room.level===this.level)&&(!roomCut||!room||room.id===this.room.id);const sys=c.system;const enabled=sys==='electrical'||sys==='lighting'?this.layers.electrical:sys==='water'?this.layers.water:sys==='hvac'?this.layers.hvac:true;o.visible=!exterior&&this.view!=='production'&&levelOk&&enabled;o.position.copy(o.userData.basePosition);if(['electrical','lighting','water','hvac'].includes(sys))o.position.y+=this.explode*(sys==='water'?.6:sys==='hvac'?.8:1);const partition=['partition','room_partition','interior_glazing','door'].includes(meta.type);o.material.clippingPlanes=[...(!exterior&&partition?[upper]:[]),...sides];}
  applyManufacturingVisibility(this,sides);this.renderer.shadowMap.needsUpdate=true;this.updateHighlight();this.invalidate();
 }
 currentBounds(){if(this.view==='production'&&this.active?.manufacturing){const b=this.manufacturingSpec.buildings.find(b=>b.id===this.active.id).bounds;return new THREE.Box3(new THREE.Vector3(b[0],b[2],-b[4]),new THREE.Vector3(b[3],b[5],-b[1]));}if(this.room){const b=this.room.bounds;return new THREE.Box3(new THREE.Vector3(b[0],b[2],-b[4]),new THREE.Vector3(b[3],b[5]+this.explode,-b[1]));}if(this.view==='exterior')return this.active.bounds.clone();const rooms=this.rooms.filter(r=>this.level==='all'||r.level===this.level);const b=new THREE.Box3();for(const r of rooms){const q=r.bounds;b.expandByPoint(v3([q[0],q[1],q[2]]));b.expandByPoint(v3([q[3],q[4],q[5]+this.explode]));}return b;}
 fit(bounds){if(!this.active)return;const b=bounds||this.currentBounds(),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());const dir=(this.view==='top'?new THREE.Vector3(0,1,.001):new THREE.Vector3(.48,1,1.3)).normalize(),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),dir).normalize(),up=new THREE.Vector3().crossVectors(dir,right).normalize();const tanV=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)),tanH=tanV*this.camera.aspect;let distance=10;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new THREE.Vector3(x,y,z).sub(center);distance=Math.max(distance,p.dot(dir)+Math.abs(p.dot(right))*1.2/tanH,p.dot(dir)+Math.abs(p.dot(up))*1.25/tanV);}this.controls.target.copy(center);this.camera.position.copy(center).addScaledVector(dir,distance);const radius=Math.max(size.length()*.75,12);this.sun.target.position.copy(center);this.sun.position.copy(center).add(new THREE.Vector3(-radius*.7,radius*1.5,radius));Object.assign(this.sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:1,far:radius*5});this.sun.shadow.camera.updateProjectionMatrix();this.renderer.shadowMap.needsUpdate=true;this.controls.update();this.invalidate();}
 focusRoom(id){this.room=this.rooms.find(r=>r.id===id)||null;if(this.view==='production'&&this.room?.id!==this.active.id+'_R01')this.view='cut';if(this.room){this.level=this.room.level;if(this.view==='exterior')this.view='cut';}this.applyVisibility();this.fit();}
 focusDevice(id){
  const asset=this.assetMap?.get(id),o=this.meshById.get(asset?.type==='circuit'?asset.upstreamPanelId:id);if(!o)return false;
  const picked=this.pickedInspection?.id===id?resolvePickedInspection(this.pickedInspection,o):null;
  if(asset?.manufacturing||asset?.system==='manufacturing'){this.room=this.rooms.find(r=>r.id===asset.roomId)||null;this.level='F1';this.view='production';this.applyVisibility();o.visible=true;this.scene.updateMatrixWorld(true);const b=picked?picked.bounds.clone():new THREE.Box3().setFromObject(o);b.expandByScalar(3);this.fit(b);this.updateHighlight();return true;}
  const c=o.userData.meta,room=this.rooms.find(r=>r.id===c.meta?.roomId);this.room=room||(picked?this.room:null);
  // Public plant equipment has no roomId: infer its floor from its actual CAD
  // elevation, instead of leaving a B1 pump hidden under the selected F1 cut.
  const elevation=picked?picked.point[1]:c.bounds?(c.bounds[2]+c.bounds[5])/2:null;
  const nearest=this.rooms.reduce((best,r)=>!best||Math.abs(r.floorZ-elevation)<Math.abs(best.floorZ-elevation)?r:best,null);
  this.level=room?.level||(this.rooms.some(r=>r.level===c.level)?c.level:nearest?.level||'all');this.view=c.level==='RF'?'exterior':'cut';if(picked?.viewContext){this.view=picked.viewContext.view;this.level=picked.viewContext.level;this.room=this.rooms.find(r=>r.id===picked.viewContext.roomId)||null;}
  if(['electrical','lighting'].includes(c.system))this.layers.electrical=true;else if(c.system==='water')this.layers.water=true;else if(c.system==='hvac')this.layers.hvac=true;
  this.applyVisibility();o.visible=true;if(!picked)o.material.clippingPlanes=[];this.scene.updateMatrixWorld(true);
  const b=picked?picked.bounds.clone():new THREE.Box3().setFromObject(o);b.expandByScalar(focusPadding(b));this.fit(b);this.updateHighlight();return true;
 }
 select(id,detail){this.selectedId=id;this.scene.updateMatrixWorld(true);const object=this.meshById.get(id);this.pickedInspection=object?createPickedInspection(object,detail):null;if(this.pickedInspection)this.pickedInspection.viewContext={view:this.view,level:this.level,roomId:this.room?.id||null};this.updateHighlight();this.invalidate();}
 updateHighlight(){
  const o=this.meshById.get(this.selectedId);this.highlight.visible=Boolean(o&&objectIsVisible(o));if(!this.highlight.visible)return;
  if(this.pickedInspection?.id===this.selectedId)this.highlight.box.copy(resolvePickedInspection(this.pickedInspection,o)?.bounds||new THREE.Box3().setFromObject(o));else this.highlight.box.setFromObject(o);const box=this.highlight.box,material=o.material;
  // Current floor/room cuts are axis aligned. Bound the marker to the rendered
  // fragment so a clicked cut wall does not outline the entire building.
  if(material&&!material.clipIntersection)for(const plane of material.clippingPlanes||[])for(const axis of ['x','y','z']){const n=plane.normal[axis];if(Math.abs(n)>1-1e-6){const edge=-plane.constant/n;if(n>0)box.min[axis]=Math.max(box.min[axis],edge);else box.max[axis]=Math.min(box.max[axis],edge);}}
  this.highlight.visible=!box.isEmpty();
 }
 updateTelemetry(snapshot){
  if(!this.active)return;for(const o of this.active.mepMeshes){const c=o.userData.meta,s=snapshot.assets[c.id],meta=c.meta||{};const material=o.material;let color=o.userData.baseColor,emissive=0,intensity=0;
   if(s){const faults=s.faults?.length||s.quality==='fault';const value=Number(s.observed?.value||0);if(faults){color=new THREE.Color('#e46a52');emissive=0xa33120;intensity=.26;}else if(s.quality==='offline'||s.quality==='unavailable'){color=new THREE.Color('#687b84');}else if(meta.controlKind==='light'){color=new THREE.Color().lerpColors(new THREE.Color('#647271'),new THREE.Color('#fff1c3'),value/100);emissive=0xffd08a;intensity=value/100*.9;}else if(meta.controlKind){color=new THREE.Color(value>1?'#5ab9a8':'#747e83');emissive=value>1?0x143c37:0;intensity=.16;}}
   if(meta.waterBranchId&&!s){const branch=snapshot.waterBranches?.[meta.waterBranchId];if(branch){color=new THREE.Color((branch.flowLpm||0)>0.1?'#319cac':'#5f737a');}}
   if(meta.circuitId&&c.system==='electrical'){const cir=snapshot.circuits?.[meta.circuitId];if(cir)color=new THREE.Color(cir.energized||cir.observed?.value>0?'#d5a14e':'#687681');}
   material.color.copy(color);material.emissive.setHex(emissive);material.emissiveIntensity=intensity;
  }
  this.lastSnapshot=snapshot;this.invalidate();
 }
 updateManufacturing(snapshot){updateManufacturingGeometry(this,snapshot);}
 updateLabels(){if(!this.labelElements)return;this.camera.updateMatrixWorld();const cameraElements=this.camera.matrixWorld.elements,state=[this.active?.id,this.view,this.level,this.room?.id,this.layers.labels,this.lastSnapshot?.time,this.viewportWidth,this.viewportHeight].join('|');if(state===this.labelState&&this.labelCamera?.every((v,i)=>v===cameraElements[i]))return;this.labelState=state;this.labelCamera=[...cameraElements];const p=new THREE.Vector3(),rect={width:this.viewportWidth,height:this.viewportHeight};for(const {room:r,el,small} of this.labelElements){const visible=this.layers.labels&&this.view!=='exterior'&&(!this.room||r.id===this.room.id)&&(this.level==='all'||r.level===this.level);el.hidden=!visible;if(!visible)continue;p.copy(v3([r.center[0],r.center[1],r.floorZ+3.8])).project(this.camera);el.hidden=p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;el.style.left=(p.x*.5+.5)*rect.width+'px';el.style.top=(-p.y*.5+.5)*rect.height+'px';el.classList.toggle('active',r.id===this.room?.id);const state=this.lastSnapshot?.rooms[r.id];if(state)small.textContent=`${r.level} · ${Number(state.temperature??state.temperatureC??0).toFixed(1)}°C`;}}
 get stats(){return {calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,models:this.cache.size,selected:this.selectedId,building:this.active?.id,view:this.view,level:this.level,camera:this.camera.position.toArray(),target:this.controls.target.toArray()};}
}
