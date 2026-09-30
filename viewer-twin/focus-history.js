// A focus jump is reversible without changing the selected device or simulation.
export function captureObservation(scene){
 return {building:scene.active?.id,position:scene.camera.position.toArray(),target:scene.controls.target.toArray(),view:scene.view,level:scene.level,roomId:scene.room?.id||null,layers:{...scene.layers},explode:scene.explode,sun:scene.sun.position.toArray(),sunTarget:scene.sun.target.position.toArray(),shadow:Object.fromEntries(['left','right','top','bottom','near','far'].map(k=>[k,scene.sun.shadow.camera[k]]))};
}
export function restoreObservation(scene,state){
 if(!state||state.building!==scene.active?.id)return false;
 scene.view=state.view;scene.level=state.level;scene.room=scene.rooms.find(r=>r.id===state.roomId)||null;scene.layers={...state.layers};scene.explode=state.explode;scene.applyVisibility();
 scene.camera.position.fromArray(state.position);scene.controls.target.fromArray(state.target);scene.sun.position.fromArray(state.sun);scene.sun.target.position.fromArray(state.sunTarget);Object.assign(scene.sun.shadow.camera,state.shadow);scene.sun.shadow.camera.updateProjectionMatrix();scene.renderer.shadowMap.needsUpdate=true;scene.controls.update();scene.invalidate();return true;
}
export function createFocusHistory(limit=20){
 const entries=[];
 return {get size(){return entries.length;},remember(scene){const next=captureObservation(scene);if(JSON.stringify(entries.at(-1))===JSON.stringify(next))return;entries.push(next);if(entries.length>limit)entries.shift();},back(scene){while(entries.length){if(restoreObservation(scene,entries.pop()))return true;}return false;},clear(){entries.length=0;}};
}
export function shouldAutoFocus({enabled,source}){return enabled===true&&source==='list';}
