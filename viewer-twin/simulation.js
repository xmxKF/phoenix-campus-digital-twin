/**
 * Causal, deterministic campus demonstration. Units: seconds, kW, L/min, kPa, C.
 * This is an empirical visual simulation, not an engineering calculation or a
 * connection to live BMS equipment. Geometry/IDs come from the FreeCAD manifest.
 *
 * createSimulation(layout).command(id, {mode:'manual',value:0..100,setpoint?:24})
 * tick(realSeconds) advances the common clock at setSpeed(n); pause freezes it.
 * snapshot() is a JSON-safe copy. Acknowledging an alarm never clears its cause.
 */
import {supportedFaults} from './fault-options.js';
const clamp = (x, a = 0, b = 100) => Math.min(b, Math.max(a, x));
const copy = (x) => JSON.parse(JSON.stringify(x));
const entries = (x) => Array.isArray(x) ? x : Object.values(x || {});
const index = (x) => Object.fromEntries(entries(x).map((a) => [a.id || a.assetId, a]));
const approach = (value, target, dt, tau) => target + (value - target) * Math.exp(-dt / tau);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const hash = (s, seed) => [...s].reduce((n, c) => ((n * 31 + c.charCodeAt(0)) >>> 0), seed);
const ACTIVE_COMMANDS = new Set(['pending', 'applied']);
const LABELS = { offline: '通信离线', stuck: '执行器卡滞', trip: '设备跳闸', leak: '支路漏水' };

export function createSimulation(input, options = {}) {
  const layout = copy(input);
  const roomMeta = index(layout.rooms), buildingMeta = index(layout.buildings);
  const circuitMeta = index(layout.circuits), branchMeta = index(layout.waterBranches);
  const controls = index(layout.controlAssets), sensors = index(layout.sensors);
  const loadMeta = index(layout.electricalLoads || layout.loads);
  // Circuit controls are logical sub-breakers. They do not claim extra CAD solids.
  for (const c of Object.values(circuitMeta)) controls[c.id] = {
    ...c, id: c.id, assetId: c.id, controlKind: 'breaker', virtual: true,
    upstreamIds: [c.upstreamPanelId].filter(Boolean), ratedPowerKw: 0,
    defaultState: { position: 1 }, label: `${c.label || c.id} · 分路开关`,
  };
  const meta = { ...controls, ...sensors, ...loadMeta };
  const seed = Number(options.seed ?? 20260930) >>> 0;
  const historyLimit = Math.max(10, Number(options.historyLimit ?? 240));
  const eventLimit = Math.max(50, Number(options.eventLimit ?? 500));
  const sampleInterval = Math.max(1, Number(options.sampleInterval ?? 5));
  const commandDelay = Math.max(0.1, Number(options.commandDelay ?? 1));
  const commandTimeout = Math.max(commandDelay + 10, Number(options.commandTimeout ?? 45));
  let state, physics, faults, seq, powerMemo;

  const roomsFor = (b) => Object.values(state.rooms).filter((r) => r.buildingId === b);
  const roomAssets = (r, kind) => Object.values(controls).filter((a) => a.roomId === r && (!kind || a.controlKind === kind));
  const roomBranches = (r) => Object.values(branchMeta).filter((b) => b.roomId === r);
  const hasFault = (id, kind) => Boolean(faults[id]?.[kind]);
  const timeHour = () => (9 + state.time / 3600) % 24;
  const occupied = () => timeHour() >= 8 && timeHour() < 18;

  function event(type, message, assetId = null, extra = {}) {
    state.events.unshift({ id: `EV-${++seq}`, time: state.time, type, assetId,
      buildingId: meta[assetId]?.buildingId || null, message, ...extra });
    state.events.length = Math.min(state.events.length, eventLimit);
  }

  function alarm(assetId, code, active, message, severity = 'warning') {
    const id = `AL-${assetId}-${code}`;
    let a = state.alarms.find((x) => x.id === id);
    if (!a && !active) return;
    if (!a) {
      a = { id, assetId, buildingId: meta[assetId]?.buildingId || null, code,
        active: false, acknowledged: false, message, severity, raisedAt: state.time };
      state.alarms.push(a);
    }
    if (a.active !== active) {
      a.active = active; a.changedAt = state.time;
      if (active) { a.acknowledged = false; a.raisedAt = state.time; }
      else a.clearedAt = state.time;
      event(active ? 'alarm' : 'recovery', `${message}${active ? '：发生' : '：原因已清除'}`, assetId, { alarmId: id });
    }
  }

  function defaultSetting(a) {
    const d = a.defaultState || {};
    const kind = a.controlKind;
    const value = d.on === false || d.enabled === false ? 0
      : kind === 'light' ? 100 * (d.level ?? 0.8)
      : kind === 'ahu' || kind === 'pump' ? 100 * (d.speed ?? 0.75)
      : 100 * (d.position ?? 1);
    return { mode: 'auto', value: clamp(value), ...(kind === 'ahu' ? { setpoint: d.setpoint ?? 24 } : {}) };
  }

  function autoValue(a) {
    const d = defaultSetting(a), r = state.rooms[a.roomId];
    if (a.controlKind === 'light') {
      if (!r || r.occupancy > 0) return d.value;
      return ['cleanroom', 'maskwrite', 'service', 'pumps'].includes(r.kind) ? d.value : 15;
    }
    if (a.controlKind === 'ahu') return !r || r.occupancy > 0 ? d.value : 30;
    return d.value;
  }

  // Upstream graph evaluation is independent of array order and detects cycles.
  function powered(id, visiting = new Set()) {
    if (powerMemo.has(id)) return powerMemo.get(id);
    if (visiting.has(id)) return false;
    const a = meta[id]; if (!a) return false;
    visiting.add(id);
    const parents = new Set((a.upstreamIds || []).filter((p) => controls[p]?.controlKind === 'breaker'));
    if (a.circuitId && controls[a.circuitId]) parents.add(a.circuitId);
    let result = true;
    for (const p of parents) {
      if (hasFault(p, 'trip') || physics[p]?.value < 50 || !powered(p, new Set(visiting))) { result = false; break; }
    }
    powerMemo.set(id, result); return result;
  }

  function observedState(id) {
    const s = state.assets[id], a = meta[id], p = physics[id];
    const offline = hasFault(id, 'offline');
    s.faults = Object.keys(faults[id] || {});
    s.available = powered(id) && !hasFault(id, 'trip') && !offline;
    s.mode = s.applied?.mode || 'monitor';
    s.quality = offline ? 'offline' : s.faults.length ? 'fault' : !powered(id) ? 'unavailable' : 'good';
    if (!offline) s.observed = { ...p, timestamp: state.time, simulated: true };
    // Offline means the last report is stale, not that physical plant stopped.
    s.stale = offline;
    s.lastSeenAt = s.observed.timestamp;
    s.status = offline ? 'offline' : hasFault(id, 'trip') ? 'tripped'
      : !powered(id) ? 'unpowered' : hasFault(id, 'stuck') ? 'stuck'
      : (p.value > 0.1 ? 'running' : 'off');
    if (a.type === 'sensor' || a.sensorKind) s.status = offline ? 'offline' : powered(id) ? 'monitoring' : 'unpowered';
  }

  function commandResult(c, status, reason) {
    c.status = status; c.reason = reason; c.changedAt = state.time;
    if (status === 'applied') c.appliedAt = state.time;
    if (status === 'confirmed') c.confirmedAt = state.time;
    event('command', `${c.assetId} · ${status} · ${reason}`, c.assetId, { commandId: c.id });
    if (status === 'timeout') alarm(c.assetId, 'feedback_mismatch', true, '请求与执行反馈不一致');
  }

  function processCommands() {
    for (const c of state.commands) {
      if (!ACTIVE_COMMANDS.has(c.status)) continue;
      const s = state.assets[c.assetId];
      if (c.status === 'pending' && state.time >= c.applyAt) {
        if (hasFault(c.assetId, 'offline')) { commandResult(c, 'rejected', '通信离线，命令未送达'); continue; }
        if (!powered(c.assetId)) { commandResult(c, 'rejected', '上游供电中断'); continue; }
        if (hasFault(c.assetId, 'trip')) { commandResult(c, 'rejected', '跳闸原因仍存在'); continue; }
        s.applied = copy(c.target); c.feedbackTarget = c.target.mode === 'auto' ? autoValue(meta[c.assetId]) : c.target.value;
        commandResult(c, 'applied', '模拟执行器已接受，等待位置/运行反馈');
      }
      if (c.status === 'applied') {
        const observed = s.observed;
        if (s.quality === 'good' && Math.abs(observed.value - c.feedbackTarget) <= 1 &&
          (c.target.setpoint == null || observed.setpoint === c.target.setpoint)) {
          commandResult(c, 'confirmed', '模拟反馈已达到请求值');
          alarm(c.assetId, 'feedback_mismatch', false, '请求与执行反馈不一致');
        } else if (state.time >= c.deadline) commandResult(c, 'timeout', '未在时限内收到匹配反馈');
      }
    }
  }

  function actuatorStep(dt) {
    // Breaker contacts are discrete, so loss of feed propagates in this step.
    for (const a of Object.values(controls).filter((x) => x.controlKind === 'breaker')) {
      const s = state.assets[a.id];
      let target = s.applied.mode === 'auto' ? autoValue(a) : s.applied.value;
      if (hasFault(a.id, 'trip')) target = 0;
      if (!hasFault(a.id, 'stuck')) physics[a.id].value = target >= 50 ? 100 : 0;
    }
    powerMemo.clear();
    for (const a of Object.values(controls)) {
      const s = state.assets[a.id], p = physics[a.id], kind = a.controlKind;
      let target = s.applied.mode === 'auto' ? autoValue(a) : s.applied.value;
      if (!powered(a.id) || hasFault(a.id, 'trip')) target = 0;
      if (kind === 'breaker') { p.value = powered(a.id) ? p.value : 0; }
      else if (!hasFault(a.id, 'stuck') || !powered(a.id) || hasFault(a.id, 'trip')) {
        p.value = approach(p.value, target, dt, kind === 'valve' ? 4 : kind === 'light' ? 0.6 : 3);
        if (Math.abs(p.value - target) < 0.02) p.value = target;
      }
      if (!powered(a.id)) p.value = 0;
      const f = p.value / 100;
      p.powerKw = (a.ratedPowerKw || 0) * (kind === 'pump' ? f ** 3 : kind === 'ahu' ? 0.15 * f + 0.85 * f ** 3 : f);
      p.on = p.value > 0.1; p.setpoint = s.applied.setpoint ?? null;
      p.flowLpm = 0; p.pressureKpa = 0; p.airflowM3h = 0;
      if (kind === 'ahu') {
        const r = roomMeta[a.roomId];
        p.airflowM3h = (a.designAirflowM3h || (r ? r.size[0] * r.size[1] * r.size[2] * 4 : 1000)) * f;
      }
    }
  }

  function waterStep() {
    const cache = new Map();
    function lineage(id, visiting = new Set()) {
      if (cache.has(id)) return cache.get(id);
      if (visiting.has(id) || !branchMeta[id]) return { valves: new Set(), pumps: new Set(), valid: false };
      const b = branchMeta[id]; visiting.add(id);
      const parent = b.upstreamBranchId ? lineage(b.upstreamBranchId, visiting) : { valves: new Set(), pumps: new Set(), valid: true };
      const v = { valves: new Set([...parent.valves, ...(b.valveIds || [])]), pumps: new Set([...parent.pumps, ...(b.pumpIds || [])]), valid: parent.valid };
      cache.set(id, v); return v;
    }
    for (const b of Object.values(branchMeta)) {
      const chain = lineage(b.id), r = state.rooms[b.roomId];
      const valveFactor = Math.min(1, ...[...chain.valves].map((id) => (physics[id]?.value ?? 0) / 100));
      const pumpFactor = Math.min(1, ...[...chain.pumps].map((id) => (physics[id]?.value ?? 0) / 100));
      const pcw = b.medium.startsWith('pcw');
      const returning = b.medium.includes('return');
      // A DHW recirculation pump circulates a return loop. Stopping it does not
      // turn off the separately pressurized domestic supply at the taps.
      const drive = pcw || returning ? pumpFactor : 1;
      const leakIds = [...chain.valves].filter((id) => hasFault(id, 'leak'));
      const localLeak = (b.valveIds || []).some((id) => hasFault(id, 'leak'));
      const leakPenalty = leakIds.length ? 0.7 : 1;
      const fraction = chain.valid ? valveFactor * drive : 0;
      const demand = pcw || returning ? 1 : r ? (r.occupancy > 0 ? 0.65 : 0.12) : 1;
      const delivery = b.nominalFlowLpm * fraction * demand * leakPenalty;
      const leak = localLeak ? b.nominalFlowLpm * fraction * 0.5 : 0;
      let temperature = pcw ? 20 : b.medium.includes('hot') ? 35 + 17 * pumpFactor : 26;
      if (returning) temperature -= pcw ? -3 : 3;
      state.waterBranches[b.id] = { id: b.id, buildingId: b.buildingId, roomId: b.roomId,
        medium: b.medium, flowLpm: delivery + leak, deliveredFlowLpm: delivery,
        leakFlowLpm: leak, pressureKpa: (pcw ? 240 : 300) * fraction * leakPenalty,
        temperature, availableFraction: fraction * leakPenalty, simulated: true };
    }
    // Meter totals sum branch draws. Closed-loop return matches connected supply
    // terminals; it must not create fictitious potable-water consumption.
    for (const b of Object.values(branchMeta).filter(x=>['sanitary_drain','grease_waste','lab_waste'].includes(x.medium))) {
      const supply=Object.values(branchMeta).filter(x=>x.roomId===b.roomId&&x.medium.startsWith('domestic')&&!x.medium.includes('return'));
      const flow=sum(supply,x=>state.waterBranches[x.id].deliveredFlowLpm);
      Object.assign(state.waterBranches[b.id],{flowLpm:flow,deliveredFlowLpm:flow,pressureKpa:0,leakFlowLpm:0,availableFraction:flow>0?1:0});
    }
    for (const b of Object.values(branchMeta).filter((x) => !x.roomId)) {
      const o = state.waterBranches[b.id];
      if (!b.medium.includes('return')) {
        const children = Object.values(branchMeta).filter((x) => x.roomId && x.upstreamBranchId === b.id);
        if (children.length) {
          o.deliveredFlowLpm = sum(children, (x) => state.waterBranches[x.id].deliveredFlowLpm);
          o.flowLpm = sum(children, (x) => state.waterBranches[x.id].flowLpm) + o.leakFlowLpm;
        }
      } else if (b.medium === 'pcw_return' && b.upstreamBranchId) {
        o.flowLpm = state.waterBranches[b.upstreamBranchId].flowLpm;
        o.deliveredFlowLpm = o.flowLpm;
      }
    }
    for (const a of Object.values(controls).filter((x) => x.waterBranchId)) {
      const w = state.waterBranches[a.waterBranchId];
      if (w) Object.assign(physics[a.id], { flowLpm: w.flowLpm, pressureKpa: w.pressureKpa, temperature: w.temperature });
    }
  }

  function roomStep(dt) {
    for (const r of Object.values(state.rooms)) {
      const original = roomMeta[r.id];
      const capacity = Math.max(1, Math.floor(original.size[0] * original.size[1] / (['dining', 'cafe', 'exhibit', 'interactive'].includes(r.kind) ? 12 : 18)));
      const always = ['cleanroom', 'maskwrite', 'service', 'pumps', 'inspection'].includes(r.kind);
      r.occupancy = occupied() || always ? Math.max(1, Math.round(capacity * 0.6)) : 0;
      const lights = roomAssets(r.id, 'light'), ahus = roomAssets(r.id, 'ahu');
      r.lightingPercent = lights.length ? sum(lights, (a) => physics[a.id].value) / lights.length : 0;
      // A visualization proxy, not a photometric lighting calculation.
      r.illuminationLux = (['exhibit', 'interactive'].includes(r.kind) ? 350 : 500) * r.lightingPercent / 100;
      const fan = ahus.length ? sum(ahus, (a) => physics[a.id].value / 100) / ahus.length : 0;
      r.airflowM3h = sum(ahus, (a) => physics[a.id].airflowM3h);
      r.setpoint = ahus.length ? sum(ahus, (a) => state.assets[a.id].applied.setpoint) / ahus.length : 24;
      const water = roomBranches(r.id).map((b) => state.waterBranches[b.id]);
      r.waterFlowLpm = sum(water.filter((w) => w.medium.startsWith('domestic') && !w.medium.includes('return')), (w) => w.flowLpm);
      r.coolingFlowLpm = sum(water.filter((w) => w.medium === 'pcw_supply'), (w) => w.flowLpm);
      r.waterPressureKpa = water.length ? sum(water, (w) => w.pressureKpa) / water.length : 0;
      const pcw = water.filter((w) => w.medium === 'pcw_supply');
      const coolingAvailable = pcw.length ? Math.min(...pcw.map((w) => w.availableFraction / 0.75), 1) : 1;
      r.processAvailability = powered(original.panelId) && physics[original.panelId]?.value >= 50 ? clamp(coolingAvailable * fan / 0.75, 0, 1) : 0;
      const electricalLoads = Object.values(loadMeta).filter((a) => a.roomId === r.id);
      let loadPower = 0;
      for (const a of electricalLoads) {
        const needsCooling = (a.waterBranchIds || []).some((id) => branchMeta[id]?.medium === 'pcw_supply');
        const ready = powered(a.id) && !hasFault(a.id, 'trip') && (!needsCooling || coolingAvailable > 0.25);
        const fraction = ready ? (r.occupancy > 0 ? 0.75 : 0.15) : 0;
        physics[a.id] = { ...physics[a.id], value: fraction * 100, on: ready, powerKw: (a.ratedPowerKw || 0) * fraction };
        loadPower += physics[a.id].powerKw;
      }
      r.powerKw = sum(roomAssets(r.id).filter((a) => a.controlKind !== 'breaker'), (a) => physics[a.id].powerKw) + loadPower;
      // First-order thermal and ventilation balance; coefficients intentionally
      // illustrative. No independent sine wave can hide loss of cooling/airflow.
      const outside = 31, heatGain = r.occupancy * 0.000006 + r.powerKw * 0.00003;
      const target = (outside / 2400 + heatGain + fan * r.setpoint / 240) / (1 / 2400 + fan / 240);
      r.temperature = approach(r.temperature, target, dt, 1 / (1 / 2400 + fan / 240));
      const co2Target = 420 + r.occupancy * 120 / Math.max(0.2, r.airflowM3h / 100);
      r.co2 = approach(r.co2, clamp(co2Target, 420, 3000), dt, fan > 0 ? 180 : 900);
      r.humidity = approach(r.humidity, fan > 0.1 ? 52 : 72, dt, 600);
      r.updatedAt = state.time; r.simulated = true;
    }
  }

  function metering() {
    for (const c of Object.values(circuitMeta)) {
      const ids = new Set([...(c.loadAssetIds || []), ...Object.values(meta).filter((a) => a.circuitId === c.id).map((a) => a.id)]);
      const powerKw = sum([...ids], (id) => physics[id]?.powerKw || 0);
      state.circuits[c.id] = { ...c, powerKw, energized: powered(c.id) && physics[c.id].value >= 50, simulated: true };
      physics[c.id].powerKw = powerKw;
    }
    for (const b of Object.values(buildingMeta)) {
      const rs = roomsFor(b.id), previous = state.buildingMetrics[b.id];
      const main = Object.values(branchMeta).filter((w) => w.buildingId === b.id && !w.upstreamBranchId);
      const leaf = Object.values(controls).filter((a) => a.buildingId === b.id && !a.roomId && a.controlKind !== 'breaker');
      const total = sum(rs, (r) => r.powerKw) + sum(leaf, (a) => physics[a.id].powerKw);
      state.buildingMetrics[b.id] = { id: b.id, buildingId: b.id, temperature: rs.length ? sum(rs, (r) => r.temperature) / rs.length : 0,
        powerKw: total, waterFlowLpm: sum(main.filter((x) => x.medium.startsWith('domestic')), (x) => state.waterBranches[x.id].flowLpm),
        coolingFlowLpm: sum(main.filter((x) => x.medium === 'pcw_supply'), (x) => state.waterBranches[x.id].flowLpm),
        occupancy: sum(rs, (r) => r.occupancy), availabilityPercent: rs.length ? sum(rs, (r) => r.processAvailability) / rs.length * 100 : 0,
        energyKwh: previous?.energyKwh || 0, waterLitres: previous?.waterLitres || 0,
        activeAlarms: state.alarms.filter((a) => a.buildingId === b.id && a.active).length,
        simulated: true, time: state.time };
    }
    for (const a of Object.values(controls).filter((x) => x.controlKind === 'breaker' && !x.virtual)) {
      physics[a.id].powerKw = a.roomId ? state.rooms[a.roomId]?.powerKw || 0 : state.buildingMetrics[a.buildingId]?.powerKw || 0;
    }
    for (const a of Object.values(sensors)) {
      const r = state.rooms[a.roomId], w = state.waterBranches[a.waterBranchId];
      const field = { temperature: 'temperature', humidity: 'humidity', co2: 'co2', occupancy: 'occupancy', power: 'powerKw', flow: 'flowLpm', water_flow: 'flowLpm', pressure: 'pressureKpa' }[a.sensorKind];
      const source = ['flow', 'water_flow', 'pressure'].includes(a.sensorKind) ? w : r;
      physics[a.id].value = powered(a.id) ? (source?.[field] ?? null) : null;
      physics[a.id].unit = a.unit; physics[a.id].powerKw = 0;
    }
    for (const id of Object.keys(meta)) observedState(id);
  }

  function sample() {
    for (const [id, m] of Object.entries(state.buildingMetrics)) {
      const a = state.trends.buildings[id];
      a.push({ time: state.time, temperature: m.temperature, powerKw: m.powerKw, waterFlowLpm: m.waterFlowLpm, coolingFlowLpm: m.coolingFlowLpm });
      if (a.length > historyLimit) a.shift();
    }
    for (const [id, r] of Object.entries(state.rooms)) {
      const a = state.trends.rooms[id];
      a.push({ time: state.time, temperature: r.temperature, powerKw: r.powerKw, waterFlowLpm: r.waterFlowLpm, airflowM3h: r.airflowM3h, co2: r.co2 });
      if (a.length > historyLimit) a.shift();
    }
    state.lastSampleAt = state.time;
  }

  function reset() {
    seq = 0; faults = {}; physics = {}; powerMemo = new Map();
    state = { time: 0, speed: options.speed ?? 1, paused: false, simulated: true,
      model: 'deterministic empirical demonstration; not engineering calculations',
      assets: {}, rooms: {}, buildingMetrics: {}, circuits: {}, waterBranches: {},
      commands: [], alarms: [], events: [], trends: { buildings: {}, rooms: {} }, lastSampleAt: 0 };
    for (const [id, a] of Object.entries(meta)) {
      const d = a.controlKind ? defaultSetting(a) : null;
      physics[id] = { value: d?.value ?? 0, powerKw: 0, flowLpm: 0, pressureKpa: 0, airflowM3h: 0 };
      state.assets[id] = { id, assetId: id, buildingId: a.buildingId, roomId: a.roomId ?? null,
        controlKind: a.controlKind || a.sensorKind || 'load', label: a.label || id,
        circuitId: a.circuitId || null, waterBranchId: a.waterBranchId || null,
        virtual: Boolean(a.virtual), controllable: Boolean(a.controlKind),
        desired: d ? copy(d) : null, applied: d ? copy(d) : null,
        observed: { ...physics[id], timestamp: 0, simulated: true }, quality: 'good', faults: [], mode: d?.mode || 'monitor', available: true };
    }
    for (const [id, r] of Object.entries(roomMeta)) {
      state.rooms[id] = { id, buildingId: r.buildingId, kind: r.kind, label: r.label,
        temperature: 26 + (hash(id, seed) % 100) / 100, humidity: 55, co2: 650, occupancy: 1,
        powerKw: 0, waterFlowLpm: 0, coolingFlowLpm: 0, lightingPercent: 80, simulated: true };
      state.trends.rooms[id] = [];
    }
    for (const id of Object.keys(buildingMeta)) state.trends.buildings[id] = [];
    actuatorStep(0); waterStep(); roomStep(0); metering(); sample();
    event('reset', '模拟已复位；现场设备未接入');
    return state.time;
  }

  function tick(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('tick requires finite non-negative seconds');
    if (state.paused || seconds === 0) return state.time;
    let remaining = seconds * state.speed;
    // Bounded substeps preserve dependency order and feedback deadlines under
    // acceleration. No wall-clock timers, network traffic or random telemetry.
    while (remaining > 1e-9) {
      const dt = Math.min(1, remaining); remaining -= dt; state.time += dt;
      powerMemo.clear(); processCommands(); actuatorStep(dt); waterStep(); roomStep(dt); metering(); processCommands();
      for (const m of Object.values(state.buildingMetrics)) {
        m.energyKwh += m.powerKw * dt / 3600;
        m.waterLitres += m.waterFlowLpm * dt / 60;
      }
      if (state.time - state.lastSampleAt >= sampleInterval - 1e-8) sample();
    }
    return state.time;
  }

  function command(assetId, patch = {}) {
    const a = controls[assetId], s = state.assets[assetId];
    const c = { id: `CMD-${++seq}`, assetId, issuedAt: state.time, patch: copy(patch), status: 'pending',
      applyAt: state.time + commandDelay, deadline: state.time + commandTimeout, reason: '待执行' };
    state.commands.unshift(c);
    if(s)s.lastCommandId=c.id;
    let error = !a ? '未知或只读资产' : null;
    if (!error && Object.keys(patch).some((k) => !['mode', 'value', 'setpoint'].includes(k))) error = '不支持的命令字段';
    if (!error && patch.mode != null && !['auto', 'manual'].includes(patch.mode)) error = '模式必须为auto/manual';
    if (!error && patch.value != null && (!Number.isFinite(patch.value) || patch.value < 0 || patch.value > 100)) error = '请求值必须为0—100';
    if (!error && a.controlKind === 'breaker' && patch.value != null && ![0, 100].includes(patch.value)) error = '开关只接受0或100';
    if (!error && patch.setpoint != null && (a.controlKind !== 'ahu' || !Number.isFinite(patch.setpoint) || patch.setpoint < 18 || patch.setpoint > 30)) error = '空调温度设定仅接受18—30°C';
    if (!error && hasFault(assetId, 'offline')) error = '通信离线，命令未送达';
    if (!error && !powered(assetId)) error = '上游供电中断';
    if (!error && hasFault(assetId, 'trip')) error = '跳闸原因仍存在，请先解除模拟故障';
    if (error) commandResult(c, 'rejected', error);
    else {
      for (const previous of state.commands) if (previous !== c && previous.assetId === assetId && ACTIVE_COMMANDS.has(previous.status)) commandResult(previous, 'rejected', '已被更新请求替代');
      const mode = patch.mode || (patch.value != null || patch.setpoint != null ? 'manual' : s.desired.mode);
      c.target = { ...s.desired, ...patch, mode };
      if (mode === 'auto') c.target.value = autoValue(a);
      s.desired = copy(c.target); s.lastCommandId = c.id;
      event('command', `${a.label || assetId}：请求已排队`, assetId, { commandId: c.id });
    }
    if (state.commands.length > 400) state.commands = state.commands.filter((x, i) => i < 400 || ACTIVE_COMMANDS.has(x.status));
    return c.id;
  }

  function injectFault(assetId, kind) {
    const a = meta[assetId]; if (!a) throw new Error(`Unknown asset: ${assetId}`);
    kind = ({ breaker_trip: 'trip', pump_trip: 'trip', communication: 'offline', stuck_valve: 'stuck' })[kind] || kind;
    if (!['offline', 'stuck', 'trip', 'leak'].includes(kind)) throw new Error(`Unknown fault: ${kind}`);
    if (!supportedFaults(a).includes(kind)) throw new Error('该设备不支持此故障类型，请选择对应的实体设备。');
    faults[assetId] ||= {}; faults[assetId][kind] = { since: state.time };
    alarm(assetId, kind, true, `${a.label || assetId}：${LABELS[kind]}`, kind === 'trip' || kind === 'leak' ? 'critical' : 'warning');
    observedState(assetId); return `AL-${assetId}-${kind}`;
  }

  function clearFault(assetId, kind = null) {
    if (!meta[assetId]) throw new Error(`Unknown asset: ${assetId}`);
    kind = ({ breaker_trip: 'trip', pump_trip: 'trip', communication: 'offline', stuck_valve: 'stuck' })[kind] || kind;
    for (const k of Object.keys(faults[assetId] || {})) if (!kind || kind === k) {
      delete faults[assetId][k]; alarm(assetId, k, false, `${meta[assetId].label || assetId}：${LABELS[k]}`);
    }
    event('fault-clear', '已解除模拟故障原因；等待设备/反馈恢复', assetId);
    observedState(assetId);
    // A prior timeout remains in the command log; a new successful command is
    // required to dismiss feedback mismatch, rather than rewriting history.
    return true;
  }

  function ackAlarm(id) {
    const a = state.alarms.find((x) => x.id === id); if (!a) return false;
    a.acknowledged = true; a.acknowledgedAt = state.time;
    event('acknowledge', '报警已确认；活动原因不会被清除', a.assetId, { alarmId: id }); return true;
  }

  reset();
  return {
    tick, command, injectFault, clearFault, ackAlarm, reset,
    setPaused(value) { state.paused = Boolean(value); event('clock', state.paused ? '模拟暂停' : '模拟继续'); },
    setSpeed(value) { if (!Number.isFinite(value) || value <= 0 || value > 60) throw new Error('Speed must be >0 and <=60'); state.speed = value; event('clock', `模拟速度 ${value}x`); },
    snapshot() { return copy(state); },
  };
}
