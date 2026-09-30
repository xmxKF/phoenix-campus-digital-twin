// Match the rendered fragment, not just a mesh's uncut geometry. Three's
// Raycaster does not apply visibility inherited from parents or clip planes.
export function objectIsVisible(object){
 for(let current=object;current;current=current.parent)if(!current.visible)return false;
 return true;
}

export function hitMaterial(hit){
 return Array.isArray(hit.object.material)?hit.object.material[hit.face?.materialIndex||0]:hit.object.material;
}

export function hitIsVisible(hit){
 if(!objectIsVisible(hit.object))return false;
 const material=hitMaterial(hit);
 if(!material||material.visible===false||(material.transparent&&material.opacity<=.01))return false;
 const planes=material.clippingPlanes||[];
 const outside=plane=>plane.distanceToPoint(hit.point)<-1e-5;
 return !(planes.length&&(material.clipIntersection?planes.every(outside):planes.some(outside)));
}

export function chooseVisibleHit(hits){
 let transparent;
 for(const hit of hits){
  if(!hitIsVisible(hit))continue;
  const material=hitMaterial(hit);
  if((material.transparent&&material.opacity<.75)||material.transmission>.1){transparent??=hit;continue;}
  return hit;
 }
 return transparent||null;
}

export function describePick(component,assetMap,waterBranches=[]){
 const meta=component.meta||{},assetId=assetMap.has(component.id)?component.id:assetMap.has(meta.assetId)?meta.assetId:null;
 const related=new Set([meta.circuitId,...(meta.upstreamIds||[])]);
 for(const branchId of new Set([meta.waterBranchId,...(meta.waterBranchIds||[])])){
  const branch=waterBranches.find(b=>b.id===branchId);
  for(const id of [...(branch?.valveIds||[]),...(branch?.pumpIds||[])])related.add(id);
 }
 return {componentId:component.id,component,assetId,relatedAssetIds:[...related].filter(id=>id&&id!==assetId&&assetMap.has(id)),source:'model'};
}

// Use maximum travel, not only release position: an orbit that returns to its
// starting point is still a drag. Multi-touch and non-primary buttons never pick.
export function isPickGesture(start,event){
 return Boolean(start&&start.pointerId===event.pointerId&&event.button===0&&start.maxDistance<=6&&Math.hypot(event.clientX-start.x,event.clientY-start.y)<=6);
}
