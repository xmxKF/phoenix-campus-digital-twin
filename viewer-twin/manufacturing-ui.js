const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS={idle:'待命',empty:'空闲',queued:'排队',waiting:'等待',waiting_transport:'等待搬运',waiting_pickup:'等待取货',reserved:'已预约',loading:'装载中',pickup:'取货中',picking:'取货中',lifting:'提升中',travelling:'运输中',traveling:'运输中',moving:'运行中',transporting:'运输中',lowering:'下降中',unloading:'卸载中',processing:'加工中',complete:'完成',completed:'已完成',held:'待放行',hold:'暂停 / 待放行',fault:'故障',blocked:'受阻',stopped:'停止',disabled:'扩建未启用',available:'可用',occupied:'已占用',waiting_utility:'等待工艺供给',utility_wait:'等待工艺供给',ready:'就绪',stored:'已入库'};
Object.assign(STATUS,{expansion_reserved:'扩建预留',awaiting_pickup:'等待取货',awaiting_transport:'等待搬运',waiting_process:'等待入机',fault_wait:'等待故障恢复',to_pickup:'前往取货',to_delivery:'载货运输',unload:'卸载交接'});
const processLabels={LITHO:'光刻',ETCH:'刻蚀',DEPO:'薄膜沉积',IMPLANT:'离子注入',THERMAL:'热处理',CMP:'化学机械抛光',CLEAN:'清洗',METRO:'检测量测'};
const stateLabel=s=>STATUS[s]||s||'待命';
const formatTime=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;

export class ManufacturingPanel {
 constructor(engine,spec,{select,show,toast,onChange}){
  this.onChange=onChange;this.engine=engine;this.spec=spec;this.select=select;this.show=show;this.toast=toast;this.building='FAB1';this.assets=new Map(spec.assets.map(a=>[a.id,a]));
  this.panel=$('panel-manufacturing');
  this.panel.innerHTML=`<div class="production-toolbar"><button id="production-show">查看制造区</button><button id="production-start" class="primary">启动示范批次</button><button id="production-transport">暂停运输</button><button id="production-enable" hidden>启用扩建演示</button><span id="production-plan-note"></span><a href="../output/cad-v6/index.html" target="_blank">CAD / 设计依据 ↗</a></div>
   <div id="production-kpis" class="production-kpis"></div><div class="production-columns"><div><p class="production-caption">代表工艺设备 · 点击选中，定位遵循左侧浏览设置</p><div id="production-stations" class="production-stations"></div></div><div><p class="production-caption">批次与运输 · 首批量测后等待手动放行</p><div id="production-jobs"></div></div></div><p class="production-footnote">推定工艺与路由，仅演示状态因果；八类工序各访问一次的示范链，工序顺序与节拍不代表实际晶圆配方或产能。</p><div id="production-events"></div>`;
  $('production-show').onclick=()=>this.show();
  $('production-start').onclick=()=>this.command('startDemo');
  $('production-enable').onclick=()=>this.command('enableExpansion',{enabled:true});
  $('production-transport').onclick=()=>this.command(this.transportBlocked?'unblockTransport':'blockTransport');
 }
 command(action,extra={}){const receipt=this.engine.command({action,buildingId:this.building,...extra});this.toast(receipt.message);if(this.onChange)this.onChange();else this.update(this.building);return receipt;}
 mountBuilding(building){
  this.building=building;this.stationButtons=[];
  $('production-stations').replaceChildren();
  for(const a of this.spec.assets.filter(a=>a.buildingId===building&&['tool','stocker','oht'].includes(a.kind))){
   const button=document.createElement('button');button.className='production-station';button.dataset.mfgAsset=a.id;button.innerHTML=`<span>${escape(a.label)}</span><small></small>`;button.onclick=()=>this.select(a.id);$('production-stations').append(button);this.stationButtons.push({a,button});
  }
 }
 update(building,selected,snapshot=this.engine.snapshot()){
  if(this.building!==building||!this.stationButtons)this.mountBuilding(building);
  const b=snapshot.buildings[building];this.snapshot=snapshot;if(!b||this.panel.hidden)return;
  const m=b.metrics;this.transportBlocked=Object.values(b.vehicles||{}).some(v=>v.blocked);
  $('production-start').disabled=!b.enabled||m.emptyCarriers===0;$('production-enable').hidden=building!=='FAB2'||b.enabled;$('production-transport').disabled=!b.enabled;$('production-transport').textContent=this.transportBlocked?'恢复运输':'暂停运输';
  $('production-plan-note').textContent=b.enabled?(building==='FAB2'?'扩建方案演练 · 不计入一期计划':'FAB-1 · 代表产线模拟'):'FAB-2 扩建预留，尚未启动';
  const kpisHTML=[['排队',m.queued],['加工',m.processing],['运输',m.transporting],['待放行',m.held],['已交付',m.completed]].map(([label,value])=>`<span>${label} <b>${value??0}</b></span>`).join('');
  if(this.lastKpisHTML!==kpisHTML){$('production-kpis').innerHTML=kpisHTML;this.lastKpisHTML=kpisHTML;}
  for(const {a,button} of this.stationButtons){const s=snapshot.assetStates[a.id];button.classList.toggle('active',a.id===selected);button.classList.toggle('fault',Boolean(s?.fault||s?.blocked));button.querySelector('small').textContent=stateLabel(s?.blocked?'blocked':s?.status||s?.phase)+(s?.lotId?' · '+s.lotId:'');}
  const lots=Object.values(b.lots||{});
  const html=lots.length?lots.map(l=>`<div class="production-lot"><b>${escape(l.id)}</b><span>${l.waferCount||0} 片 · ${escape(stateLabel(l.status))}</span><small>${escape(l.carrierId||'')} ${l.held?'· '+escape(l.holdReason||'待放行'):''}</small>${l.qualityHold||l.status==='held'||l.status==='hold'?`<button data-release-lot="${escape(l.id)}">放行</button>`:''}</div>`).join(''):'<p class="empty-message">尚无示范批次。启动后可观察载具取放、运输、加工与量测。</p>';
  if(this.lastLotsHTML!==html){$('production-jobs').innerHTML=html;this.lastLotsHTML=html;$('production-jobs').querySelectorAll('[data-release-lot]').forEach(b=>b.onclick=()=>this.command('release',{lotId:b.dataset.releaseLot}));}
  const eventsHTML=(b.events||[]).slice(0,8).map(e=>`<div class="event-row"><time>${formatTime(e.time||0)}</time><span>${escape(e.message||e.type)}</span></div>`).join('');
  if(this.lastEventsHTML!==eventsHTML){$('production-events').innerHTML=eventsHTML;this.lastEventsHTML=eventsHTML;}
 }
 mountInspector(asset){
  this.inspected=asset;
  const controls=asset.kind==='tool'?'<button data-mfg-action="faultTool">模拟机台故障</button><button data-mfg-action="recoverTool">排除机台故障</button><button data-mfg-action="hold">暂停当前批次</button><button data-mfg-action="release">放行当前批次</button>':asset.kind==='oht'?'<button data-mfg-action="blockTransport">暂停运输</button><button data-mfg-action="unblockTransport">恢复运输</button>':'';
  $('manufacturing-inspector').innerHTML=`<div class="production-device-readings" id="production-device-readings"></div><div class="control-buttons">${controls}</div><p class="scope-note">${asset.kind==='loadport'?'到达装载口后还需完成卸载交接；车辆到达不等于晶圆已入机。':asset.kind==='carrier'?'载具与运输车分别编号；模型位置对应当前储位、车辆或机台端口。':'代表设备与工艺为设计推定，所有命令仅在本地模拟执行。'}</p>`;
  $('manufacturing-inspector').querySelectorAll('[data-mfg-action]').forEach(b=>b.onclick=()=>this.command(b.dataset.mfgAction,{assetId:asset.id}));this.renderInspector(asset);
 }
 renderInspector(asset){
  const snapshot=this.snapshot||this.engine.snapshot(),s=snapshot.assetStates[asset.id];if(!s)return;
  $('device-status').textContent=stateLabel(s.blocked?'blocked':s.status||s.phase);$('device-status').className=s.fault||s.blocked?'fault':'';$('device-mode').textContent='制造 / 物流模拟';
  const b=snapshot.buildings[asset.buildingId],lot=b?.lots?.find(l=>l.id===s.lotId),job=b?.jobs?.find?.(j=>j.id===s.jobId);
  const fields=[['运行状态',stateLabel(s.blocked?'blocked':s.status||s.phase)],['工艺类别',processLabels[asset.processKey]||asset.process],['当前批次',s.lotId],['载具',s.carrierId],['任务',s.jobId],['目标',this.assets.get(job?.destination?.assetId)?.label],['加工进度',Number.isFinite(s.progress)?Math.round(s.progress*100)+'%':undefined],['工艺供给',s.utilityReady===undefined?undefined:s.utilityReady?'可用':'等待供电 / 冷却 / 通风'],['储位占用',s.occupiedSlots===undefined?undefined:`${s.occupiedSlots} / ${asset.slotCount||6}`],['晶圆数',lot?.waferCount],['示范量测',lot?.measurement?`${lot.measurement.value}（演示指标） · ${{review:'待复核',pass:'通过',released:'已放行'}[lot.measurement.result]||lot.measurement.result}`:undefined],['位置',typeof s.location==='string'?s.location:s.location?.id||s.location?.assetId],['采样时刻',formatTime(snapshot.time)]];
  $('production-device-readings').innerHTML=fields.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([label,value])=>`<div class="data-row"><span>${label}</span><b>${escape(value)}</b></div>`).join('');
  $('command-receipt').textContent=(snapshot.commands||[]).find(c=>c.assetId===asset.id)?.message||'模型与批次、载具和设备状态同步。';
  const actions=$('manufacturing-inspector').querySelectorAll('[data-mfg-action]');for(const button of actions){const action=button.dataset.mfgAction;button.disabled=!b?.enabled||(action==='recoverTool'&&!s.fault)||(action==='faultTool'&&s.fault)||(['hold','release'].includes(action)&&!s.lotId);}
 }
}
