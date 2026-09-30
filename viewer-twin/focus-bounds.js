import * as THREE from '../viewer/vendor/three.module.js';

const topologyCache=new WeakMap();
// A CAD mesh may batch many lamps, columns or rail sections. Welding coincident
// positions joins hard-normal seams so a picked face can recover its solid.
export function connectedPartBounds(geometry,faceIndex){
 const positions=geometry.attributes.position,index=geometry.index;
 const triangles=Math.floor((index?.count||positions.count)/3);
 if(!Number.isInteger(faceIndex)||faceIndex<0||faceIndex>=triangles)return null;
 let topology=topologyCache.get(geometry);
 if(!topology){
  const weld=new Uint32Array(positions.count),keys=new Map(),adj=[];
  for(let i=0;i<positions.count;i++){
   const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(v=>Math.round(v*10000)).join(',');
   if(!keys.has(key)){keys.set(key,keys.size);adj.push([]);}weld[i]=keys.get(key);
  }
  const vertex=i=>index?index.getX(i):i;
  for(let t=0;t<triangles;t++)for(let k=0;k<3;k++)adj[weld[vertex(t*3+k)]].push(t);
  topology={vertex,weld,adj,parts:new Array(triangles)};topologyCache.set(geometry,topology);
 }
 if(topology.parts[faceIndex])return topology.parts[faceIndex].clone();
 const seen=new Set([faceIndex]),queue=[faceIndex],bounds=new THREE.Box3(),point=new THREE.Vector3();
 for(let j=0;j<queue.length;j++)for(let k=0;k<3;k++){
  const vertex=topology.vertex(queue[j]*3+k);bounds.expandByPoint(point.fromBufferAttribute(positions,vertex));
  for(const neighbor of topology.adj[topology.weld[vertex]])if(!seen.has(neighbor)){seen.add(neighbor);queue.push(neighbor);}
 }
 for(const face of queue)topology.parts[face]=bounds;
 return bounds.clone();
}

export function clipInspectionBounds(box,material){
 if(!material||material.clipIntersection)return box;
 for(const p of material.clippingPlanes||[])for(const axis of ['x','y','z']){
  const n=p.normal[axis];if(Math.abs(n)<1-1e-6)continue;
  const edge=-p.constant/n;if(n>0)box.min[axis]=Math.max(box.min[axis],edge);else box.max[axis]=Math.min(box.max[axis],edge);
 }
 return box;
}

export function createPickedInspection(object,detail){
 if(detail?.source!=='model'||!detail.point||!detail.meshUuid)return null;
 const whole=new THREE.Box3().setFromObject(object),size=whole.getSize(new THREE.Vector3());
 // Ordinary tools keep their complete device framing for either input path.
 if(Math.max(size.x,size.y,size.z)<=32)return null;
 const mesh=object.getObjectByProperty('uuid',detail.meshUuid);if(!mesh?.isMesh)return null;
 const point=new THREE.Vector3().fromArray(detail.point);
 const part=connectedPartBounds(mesh.geometry,detail.faceIndex)||mesh.geometry.boundingBox?.clone();
 if(!part)return null;
 const box=part.applyMatrix4(mesh.matrixWorld);
 const material=Array.isArray(mesh.material)?mesh.material[detail.materialIndex||0]:mesh.material;
 clipInspectionBounds(box,material);
 // A floor or a continuous rail can itself be one huge connected solid.
 // Keep a meaningful 12 m neighborhood of the actual visible hit in that case.
 const radius=6,local=new THREE.Box3(point.clone().addScalar(-radius),point.clone().addScalar(radius));
 box.intersect(local);if(box.isEmpty())return null;
 return {id:detail.componentId,point:point.toArray(),bounds:box.clone(),partId:detail.partId||detail.componentId,meshUuid:mesh.uuid,worldToPicked:mesh.matrixWorld.clone().invert()};
}

export function resolvePickedInspection(inspection,object){
 const mesh=object.getObjectByProperty('uuid',inspection.meshUuid);if(!mesh)return null;
 mesh.updateWorldMatrix(true,false);
 const delta=mesh.matrixWorld.clone().multiply(inspection.worldToPicked);
 return {...inspection,bounds:inspection.bounds.clone().applyMatrix4(delta),point:new THREE.Vector3().fromArray(inspection.point).applyMatrix4(delta).toArray()};
}

export function focusPadding(box){
 const size=box.getSize(new THREE.Vector3());
 return Math.min(6,Math.max(2.5,Math.max(size.x,size.y,size.z)*.12));
}
