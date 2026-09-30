// Keep the editor's choices consistent with faults the simulator can enact.
export const faultLabels = {offline:'通信离线',stuck:'执行器卡滞',trip:'设备跳闸',leak:'支路漏水'};
export function supportedFaults(asset) {
  if (!asset || asset.type==='circuit' || asset.virtual) return [];
  const kinds=['offline'];
  if (asset.controlKind) kinds.push('stuck');
  if (['breaker','pump','ahu'].includes(asset.controlKind)) kinds.push('trip');
  if (asset.controlKind==='valve' && asset.waterBranchId) kinds.push('leak');
  return kinds;
}
export function faultExplanation(asset) {
  const options=supportedFaults(asset);
  if (!options.length) return '这是逻辑分路或静态构件。故障演练请选择对应的实体配电箱或设备。';
  if (!asset.controlKind) return '此监测节点仅支持通信离线；执行器卡滞请选择灯、阀、泵或机组，漏水请选择水路支路阀。';
  if (!options.includes('leak')) return '仅列出本设备适用的故障；支路漏水请在三维中选择水路阀门。';
  return '支路漏水影响该阀所属水路；排除故障后，设备按当前设定恢复。';
}
export function createFaultDrafts() {
  const drafts=new Map();
  return {
    value(asset) {const choices=supportedFaults(asset);const saved=drafts.get(asset?.id);return choices.includes(saved)?saved:(choices[0]||'');},
    set(asset,kind) {if (!supportedFaults(asset).includes(kind)) return false;drafts.set(asset.id,kind);return true;},
    clear() {drafts.clear();}
  };
}
