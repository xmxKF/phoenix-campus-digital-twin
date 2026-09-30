/**
 * Deterministic, isolated manufacturing/AMHS demonstrator. No equipment connection.
 * All times are deliberately shortened demonstration seconds, never production rates.
 * Coordinates are metres in the CAD system: X east, Y north, Z up.
 * tick(deltaSimulationSeconds, mepSnapshot) consumes the existing building clock.
 */
const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
const mix = (a, b, fraction) => a.map((v, i) => v + (b[i] - v) * fraction);
const list = (v) => Array.isArray(v) ? v : Object.values(v || {});
const STEP = 0.25;
const MOTION_FRAME_LIMIT = 41;
const PROCESS_ORDER = ['CLEAN', 'LITHO', 'ETCH', 'DEPO', 'IMPLANT', 'THERMAL', 'CMP', 'METRO'];
const FINAL_STATES = new Set(['completed']);

export function createManufacturing(input) {
  const spec = clone(input), meta = Object.fromEntries(list(spec.assets).map((a) => [a.id, a]));
  const buildingMeta = list(spec.buildings), routeMeta = spec.routes || {};
  let state, remainder = 0, sequence = 0;
  const maxEvents = 160;

  function validate() {
    if (list(spec.assets).length !== Object.keys(meta).length) throw new Error('制造资产 ID 重复');
    for (const b of buildingMeta) {
      const assets = Object.values(meta).filter((a) => a.buildingId === b.id);
      if (assets.filter((a) => a.kind === 'oht').length !== 1) throw new Error(`${b.id} 演示必须恰有一辆 OHT`);
      const route = routeMeta[b.id], nodes = Object.fromEntries(list(route?.nodes).map((n) => [n.id, n]));
      if (!Object.keys(nodes).length) throw new Error(`${b.id} 缺少轨道节点`);
      for (const n of Object.values(nodes)) if (!Array.isArray(n.position) || n.position.length !== 3 || !n.position.every(Number.isFinite)) throw new Error(`${n.id} 坐标无效`);
      for (const a of assets) {
        if (!Array.isArray(a.position) || a.position.length !== 3 || !a.position.every(Number.isFinite)) throw new Error(`${a.id} 坐标无效`);
        if (['loadport', 'stocker', 'oht'].includes(a.kind) && !nodes[a.nodeId]) throw new Error(`${a.id} 缺少有效轨道停靠点`);
        if (a.kind === 'tool' && (meta[a.portId]?.kind !== 'loadport' || meta[a.portId].buildingId !== b.id)) throw new Error(`${a.id} 装载口无效`);
        if (a.kind === 'carrier' && (meta[a.initialStockerId]?.kind !== 'stocker' || meta[a.initialStockerId].buildingId !== b.id)) throw new Error(`${a.id} 缓存库无效`);
      }
      for (const edge of list(route.edges)) if (!nodes[edge.from] || !nodes[edge.to]) throw new Error(`${b.id} 轨道引用不存在节点`);
      for (const a of assets.filter((v) => ['loadport', 'stocker', 'oht'].includes(v.kind))) {
        for (const target of assets.filter((v) => ['loadport', 'stocker'].includes(v.kind))) findPath(b.id, a.nodeId, target.nodeId);
      }
    }
  }

  function findPath(buildingId, from, to) {
    const route = routeMeta[buildingId], nodes = Object.fromEntries(list(route.nodes).map((n) => [n.id, n]));
    if (from === to) return [from];
    const open = new Set(Object.keys(nodes)), costs = { [from]: 0 }, parents = {};
    while (open.size) {
      let current = null;
      for (const id of open) if (Number.isFinite(costs[id]) && (current === null || costs[id] < costs[current])) current = id;
      if (current === null) break;
      if (current === to) {
        const path = [to];
        while (path[0] !== from) path.unshift(parents[path[0]]);
        return path;
      }
      open.delete(current);
      for (const edge of list(route.edges)) {
        const directed = edge.directed ?? edge.oneWay ?? (edge.bidirectional === false ? true : edge.bidirectional === true ? false : route.directed === true);
        const next = edge.from === current ? edge.to : (!directed && edge.to === current ? edge.from : null);
        if (!next || !open.has(next)) continue;
        const cost = costs[current] + distance(nodes[current].position, nodes[next].position);
        if (cost < (costs[next] ?? Infinity)) { costs[next] = cost; parents[next] = current; }
      }
    }
    throw new Error(`${buildingId} 轨道不可达：${from} → ${to}`);
  }

  function event(b, type, message, extra = {}) {
    const e = { id: `MFG-E-${++sequence}`, time: state.time, buildingId: b.id, type, message, simulated: true, ...extra };
    b.events.unshift(e); b.events.length = Math.min(b.events.length, maxEvents);
    return e;
  }

  function makeBuilding(bm) {
    const b = { id: bm.id, label: bm.label || bm.id, enabled: (bm.enabledByDefault ?? bm.enabled) === true,
      expansion: bm.expansion === true || bm.id === 'FAB2', started: false, simulated: true,
      tools: {}, ports: {}, stockers: {}, carriers: {}, vehicles: {}, infrastructure: {}, lots: [], jobs: [], events: [],
      route: clone(routeMeta[bm.id]), metrics: {}, utility: { ready: true, source: 'standalone-assumption' },
      transportBlocked: false, elapsedActiveSeconds: 0, batchSequence: 0 };
    for (const a of Object.values(meta).filter((x) => x.buildingId === b.id)) {
      const base = { id: a.id, buildingId: b.id, kind: a.kind, label: a.label || a.id, position: [...a.position], status: 'idle', simulated: true, sampleTime: state.time };
      if (a.kind === 'tool') b.tools[a.id] = { ...base, process: a.process, processKey: a.processKey, portId: a.portId,
        duration: Math.max(1, Number(a.duration || a.demoDuration || 24)), lotId: null, progress: 0, elapsed: 0,
        processedCount: 0, fault: false, utilityReady: true, outgoing: false, busySeconds: 0 };
      if (a.kind === 'loadport') b.ports[a.id] = { ...base, nodeId: a.nodeId, toolId: a.toolId, carrierId: null, reservedBy: null, door: 'closed' };
      if (a.kind === 'stocker') b.stockers[a.id] = { ...base, nodeId: a.nodeId,
        slots: Array.from({ length: Math.max(1, a.slotCount || 6) }, (_, i) => ({ index: i, carrierId: null, reservedBy: null,
          position: [...(a.slotPositions?.[i] || [a.position[0], a.position[1], a.position[2] + 0.8 * i])] })) };
      if (a.kind === 'oht') b.vehicles[a.id] = { ...base, nodeId: a.nodeId, position: [...list(b.route.nodes).find((n) => n.id === a.nodeId).position],
        speed: Math.max(0.1, Number(a.speed || 4)), phase: 'idle', path: [], pathIndex: 0, jobId: null,
        carrierId: null, blocked: false, phaseElapsed: 0, travelledMeters: 0, completedJobs: 0, heading: 0,
        carrierOffset: a.carrierOffset || [0, 0, -1.25] };
      if (!['tool', 'loadport', 'stocker', 'carrier', 'oht'].includes(a.kind)) b.infrastructure[a.id] = base;
    }
    for (const a of Object.values(meta).filter((x) => x.buildingId === b.id && x.kind === 'carrier')) {
      const stocker = b.stockers[a.initialStockerId], slot = Number(a.slot ?? a.initialSlot ?? 0);
      if (!stocker.slots[slot] || stocker.slots[slot].carrierId) throw new Error(`${a.id} 初始储位重复或越界`);
      stocker.slots[slot].carrierId = a.id;
      b.carriers[a.id] = { id: a.id, kind: 'carrier', buildingId: b.id, label: a.label || a.id, simulated: true,
        status: 'empty', sampleTime: state.time, lotId: null, jobId: null, homeStockerId: stocker.id, homeSlot: slot,
        position: [...stocker.slots[slot].position], location: { type: 'stocker', assetId: stocker.id, slot } };
    }
    const explicit = bm.processSequence || b.route.processOrder || spec.processSequence;
    b.processSequence = explicit?.length ? explicit.map((id) => b.tools[id] ? id : Object.keys(b.tools).find((tid) => b.tools[tid].process?.toUpperCase() === id.toUpperCase()))
      : Object.values(b.tools).sort((a, c) => {
        const ordinal = (x) => { const p = PROCESS_ORDER.indexOf((x.process || x.id.split('_').at(-1)).toUpperCase()); return p < 0 ? 100 : p; };
        return ordinal(a) - ordinal(c);
      }).map((t) => t.id);
    if (!b.processSequence.length || b.processSequence.some((id) => !b.tools[id])) throw new Error(`${b.id} 工艺演示序列无效`);
    if (b.expansion) b.enabled = false;
    return b;
  }

  function reset() {
    state = { version: 1, time: 0, simulated: true, timingBasis: 'shortened-demonstration-seconds', buildings: {}, commands: [], assetStates: {},
      motionSamples: { startTime: 0, endTime: 0, requestedStartTime: 0, capped: false, assets: {} } };
    remainder = 0; sequence = 0;
    for (const bm of buildingMeta) state.buildings[bm.id] = makeBuilding(bm);
    refresh(); return snapshot();
  }
  function lotFor(b, id) { return b.lots.find((l) => l.id === id); }
  function jobFor(b, id) { return b.jobs.find((j) => j.id === id); }
  function nodesFor(b) { return Object.fromEntries(list(b.route.nodes).map((n) => [n.id, n])); }
  function endpointPosition(b, endpoint) {
    return endpoint.type === 'stocker' ? b.stockers[endpoint.assetId].slots[endpoint.slot].position : b.ports[endpoint.assetId].position;
  }
  function endpointNode(b, endpoint) { return (b.stockers[endpoint.assetId] || b.ports[endpoint.assetId]).nodeId; }
  function isMetrology(tool) { return /METRO|METROLOGY|量测|量測/i.test(`${tool.process} ${tool.id}`); }
  function setLotStatus(b, lot, status, message) {
    if (lot.status === status) return;
    lot.status = status;
    if (message) {
      lot.history.push({ time: state.time, status, message });
      event(b, status, message, { lotId: lot.id, assetId: lot.toolId || lot.carrierId });
    }
  }

  function utilities(b, mep) {
    if (!mep) { b.utility = { ready: true, source: 'standalone-assumption', message: '独立演示假定公用工程可用', sampleTime: state.time }; return; }
    const bm = buildingMeta.find((m) => m.id === b.id);
    const roomId = bm.utilityRoomId || bm.roomId || `${b.id}_R01`;
    const room = mep.rooms?.[roomId];
    const ready = !!room && Number(room.processAvailability) > 0.35 && Number(room.coolingFlowLpm) > 1;
    b.utility = { ready, source: 'building-mep-simulation', roomId, processAvailability: room?.processAvailability ?? null,
      coolingFlowLpm: room?.coolingFlowLpm ?? null, sampleTime: mep.time ?? state.time,
      message: ready ? '模拟供电、冷却与空气条件满足演示联锁' : !room ? '未取得房间公用工程反馈，机台等待' : '模拟供电、PCW 或空气条件不足，机台等待' };
  }

  function processTools(b, dt) {
    for (const tool of Object.values(b.tools)) {
      tool.utilityReady = b.utility.ready;
      const lot = lotFor(b, tool.lotId);
      if (tool.fault) { tool.status = 'fault'; if (lot && !lot.held) setLotStatus(b, lot, 'fault_wait', `${tool.label} 故障，加工进度保留`); continue; }
      if (!lot) { tool.status = 'idle'; continue; }
      if (lot.held) { tool.status = 'held'; setLotStatus(b, lot, 'held'); continue; }
      if (tool.outgoing) { tool.status = 'awaiting_pickup'; continue; }
      if (!b.utility.ready) { tool.status = 'utility_wait'; setLotStatus(b, lot, 'utility_wait', `${tool.label} 等待公用工程联锁恢复`); continue; }
      tool.status = 'processing'; setLotStatus(b, lot, 'processing', `${tool.label} 接收交接确认，开始演示加工`);
      tool.elapsed = Math.min(tool.duration, tool.elapsed + dt); tool.busySeconds += dt;
      tool.progress = tool.elapsed / tool.duration;
      if (tool.elapsed < tool.duration) continue;
      tool.processedCount++; tool.outgoing = true;
      lot.completedStages.push({ toolId: tool.id, process: tool.process, completedAt: state.time });
      lot.stageIndex++;
      event(b, 'process_complete', `${tool.label} 加工完成，等待载具交接`, { assetId: tool.id, lotId: lot.id });
      if (isMetrology(tool)) {
        lot.measurement = { value: 20 + ((lot.ordinal * 7) % 9) / 10, unit: '示范指标', result: lot.requireQualityReview ? 'review' : 'pass', measuredAt: state.time,
          note: '无实际工艺含义的模拟量测值；首批用于人工放行演练' };
        if (lot.requireQualityReview && !lot.qualityReleased) {
          lot.held = true; lot.holdReason = '量测结果待人工复核（演练）'; tool.status = 'held';
          setLotStatus(b, lot, 'held', `${lot.label} 量测 Hold，需人工放行`); continue;
        }
      }
      setLotStatus(b, lot, 'awaiting_transport');
    }
  }

  function schedule(b) {
    for (const lot of b.lots) {
      const carrier = b.carriers[lot.carrierId];
      if (FINAL_STATES.has(lot.status) || lot.held || carrier.jobId || carrier.location.type === 'vehicle') continue;
      if (lot.toolId && !b.tools[lot.toolId].outgoing) continue;
      let destination;
      if (lot.stageIndex >= b.processSequence.length) {
        const slot = b.stockers[carrier.homeStockerId].slots[carrier.homeSlot];
        if (slot.carrierId || slot.reservedBy) continue;
        destination = { type: 'stocker', assetId: carrier.homeStockerId, slot: carrier.homeSlot };
      } else {
        const tool = b.tools[b.processSequence[lot.stageIndex]], port = b.ports[tool.portId];
        if (tool.fault || port.carrierId || port.reservedBy) continue;
        destination = { type: 'loadport', assetId: port.id };
      }
      const job = { id: `MFG-J-${++sequence}`, buildingId: b.id, lotId: lot.id, carrierId: carrier.id,
        source: clone(carrier.location), destination, status: 'queued', requestedAt: state.time,
        pickupConfirmedAt: null, deliveryConfirmedAt: null, vehicleId: null };
      if (destination.type === 'stocker') b.stockers[destination.assetId].slots[destination.slot].reservedBy = job.id;
      else b.ports[destination.assetId].reservedBy = job.id;
      b.jobs.push(job); carrier.jobId = job.id;
      setLotStatus(b, lot, 'queued', `${lot.label} 已派运输任务，等待 OHT`);
      event(b, 'job_queued', '目标储位已预留，等待取货确认', { assetId: carrier.id, lotId: lot.id, jobId: job.id });
    }
  }

  function startPath(b, vehicle, destination) {
    vehicle.path = findPath(b.id, vehicle.nodeId, destination); vehicle.pathIndex = 1;
  }
  function travel(b, vehicle, dt) {
    let remaining = vehicle.speed * dt; const nodes = nodesFor(b);
    while (vehicle.pathIndex < vehicle.path.length && remaining > 1e-9) {
      const next = nodes[vehicle.path[vehicle.pathIndex]], length = distance(vehicle.position, next.position);
      if (length > 1e-9) vehicle.heading = Math.atan2(next.position[1] - vehicle.position[1], next.position[0] - vehicle.position[0]);
      if (length <= remaining) {
        vehicle.position = [...next.position]; vehicle.nodeId = next.id; vehicle.pathIndex++;
        remaining -= length; vehicle.travelledMeters += length;
      } else { vehicle.position = mix(vehicle.position, next.position, remaining / length); vehicle.travelledMeters += remaining; remaining = 0; }
    }
    return vehicle.pathIndex >= vehicle.path.length;
  }
  function carriedPosition(vehicle) { return vehicle.position.map((v, i) => v + vehicle.carrierOffset[i]); }
  function handoffPosition(b, endpoint, vehicle, elapsed, unloading) {
    const source = endpointPosition(b, endpoint), overhead = carriedPosition(vehicle);
    if (endpoint.type !== 'stocker') return mix(unloading ? overhead : source, unloading ? source : overhead, clamp(elapsed / 3, 0, 1));
    // A stocker first presents/retrieves the FOUP at its front dock, then the OHT
    // hoist moves vertically; a shelf is not treated as directly under the rail.
    const dock = meta[endpoint.assetId].dockPosition || meta[endpoint.assetId].position;
    if (unloading) return elapsed < 3 ? mix(overhead, dock, elapsed / 3) : mix(dock, source, clamp((elapsed - 3) / 2, 0, 1));
    return elapsed < 2 ? mix(source, dock, elapsed / 2) : mix(dock, overhead, clamp((elapsed - 2) / 3, 0, 1));
  }

  function transport(b, dt) {
    const vehicle = Object.values(b.vehicles)[0];
    if (vehicle.blocked || b.transportBlocked) { vehicle.status = 'blocked'; return; }
    if (!vehicle.jobId) {
      const job = b.jobs.find((j) => j.status === 'queued' && !lotFor(b, j.lotId).held);
      if (!job) { vehicle.phase = vehicle.status = 'idle'; return; }
      vehicle.jobId = job.id; job.vehicleId = vehicle.id; job.status = 'to_pickup'; job.startedAt = state.time;
      vehicle.phase = 'to_pickup'; startPath(b, vehicle, endpointNode(b, job.source));
    }
    const job = jobFor(b, vehicle.jobId), carrier = b.carriers[job.carrierId], lot = lotFor(b, job.lotId);
    vehicle.status = vehicle.phase;
    if (vehicle.phase === 'to_pickup') {
      if (travel(b, vehicle, dt)) { vehicle.phase = job.status = 'pickup'; vehicle.phaseElapsed = 0; }
    } else if (vehicle.phase === 'pickup') {
      vehicle.phaseElapsed += dt;
      carrier.position = handoffPosition(b, job.source, vehicle, vehicle.phaseElapsed, false);
      if (vehicle.phaseElapsed >= (job.source.type === 'stocker' ? 5 : 3)) {
        if (job.source.type === 'stocker') b.stockers[job.source.assetId].slots[job.source.slot].carrierId = null;
        else {
          const port = b.ports[job.source.assetId], tool = b.tools[port.toolId];
          port.carrierId = null; port.door = 'closed';
          if (tool) { tool.lotId = null; tool.progress = tool.elapsed = 0; tool.outgoing = false; }
          lot.toolId = null;
        }
        carrier.location = { type: 'vehicle', assetId: vehicle.id }; vehicle.carrierId = carrier.id;
        job.pickupConfirmedAt = state.time;
        event(b, 'pickup_confirmed', 'OHT 取货完成，载具归属转移至运输车', { assetId: vehicle.id, lotId: lot.id, jobId: job.id });
        vehicle.phase = job.status = 'to_delivery'; startPath(b, vehicle, endpointNode(b, job.destination));
        setLotStatus(b, lot, lot.held ? 'held' : 'transporting');
      }
    } else if (vehicle.phase === 'to_delivery') {
      const arrived = travel(b, vehicle, dt); carrier.position = carriedPosition(vehicle);
      if (arrived) { vehicle.phase = job.status = 'unload'; vehicle.phaseElapsed = 0; }
    } else if (vehicle.phase === 'unload') {
      vehicle.phaseElapsed += dt;
      carrier.position = handoffPosition(b, job.destination, vehicle, vehicle.phaseElapsed, true);
      if (vehicle.phaseElapsed >= (job.destination.type === 'stocker' ? 5 : 3)) {
        if (job.destination.type === 'stocker') {
          const slot = b.stockers[job.destination.assetId].slots[job.destination.slot];
          slot.carrierId = carrier.id; slot.reservedBy = null;
          lot.completedAt = state.time; setLotStatus(b, lot, 'completed', `${lot.label} 已完成代表工序并回库，收货确认`);
        } else {
          const port = b.ports[job.destination.assetId], tool = b.tools[port.toolId];
          port.carrierId = carrier.id; port.reservedBy = null; port.door = 'interlocked';
          if (tool) { tool.lotId = lot.id; tool.elapsed = tool.progress = 0; tool.outgoing = false; lot.toolId = tool.id; }
          setLotStatus(b, lot, lot.held ? 'held' : 'waiting_process');
        }
        carrier.location = clone(job.destination); carrier.jobId = null; carrier.position = [...endpointPosition(b, job.destination)];
        job.status = 'completed'; job.deliveryConfirmedAt = state.time;
        event(b, 'delivery_confirmed', '下降与交接完成，收货端确认载具到位', { assetId: job.destination.assetId, lotId: lot.id, jobId: job.id });
        vehicle.completedJobs++; vehicle.carrierId = null; vehicle.jobId = null; vehicle.phase = vehicle.status = 'idle';
      }
    }
  }

  function refresh() {
    state.assetStates = {};
    for (const b of Object.values(state.buildings)) {
      b.metrics = { totalLots: b.lots.length, queued: b.lots.filter((l) => ['queued', 'awaiting_transport', 'waiting_process', 'utility_wait', 'fault_wait'].includes(l.status)).length,
        processing: b.lots.filter((l) => l.status === 'processing').length, completed: b.lots.filter((l) => l.status === 'completed').length,
        held: b.lots.filter((l) => l.held && l.status !== 'completed').length,
        transporting: Object.values(b.vehicles).filter((v) => !!v.jobId).length,
        emptyCarriers: Object.values(b.carriers).filter((c) => !c.lotId).length,
        completedWafers: b.lots.filter((l) => l.status === 'completed').reduce((total, l) => total + l.waferCount, 0),
        transportCompleted: Object.values(b.vehicles).reduce((total, v) => total + v.completedJobs, 0) };
      for (const [groupName, group] of Object.entries({ tools: b.tools, ports: b.ports, stockers: b.stockers, carriers: b.carriers, vehicles: b.vehicles, infrastructure: b.infrastructure })) {
        for (const a of Object.values(group)) {
          a.sampleTime = state.time;
          if (groupName === 'ports') a.status = a.carrierId ? 'occupied' : a.reservedBy ? 'reserved' : 'empty';
          if (groupName === 'stockers') { a.occupiedSlots = a.slots.filter((s) => s.carrierId).length; a.capacity = a.slots.length; a.status = `${a.occupiedSlots}/${a.capacity}`; }
          if (groupName === 'carriers') a.status = a.lotId ? lotFor(b, a.lotId)?.status || 'loaded' : 'empty';
          state.assetStates[a.id] = { ...a, enabled: b.enabled, ...(b.enabled ? {} : { status: 'expansion_reserved' }) };
        }
      }
    }
  }

  function motionFrame() {
    const assets = {};
    for (const b of Object.values(state.buildings)) {
      for (const v of Object.values(b.vehicles)) assets[v.id] = { position: [...v.position], heading: v.heading };
      for (const c of Object.values(b.carriers)) assets[c.id] = { position: [...c.position] };
    }
    return { time: state.time, assets };
  }
  function motionWindow(frames, requestedStartTime, capped) {
    const assets = {}, first = frames[0];
    for (const [id, initial] of Object.entries(first.assets)) {
      // Including stationary frames around movement preserves the start/stop and
      // stocker/hoist dwell times. Unmoved assets contribute no output samples.
      const moved = frames.some((frame) => distance(frame.assets[id].position, initial.position) > 1e-9
        || Math.abs((frame.assets[id].heading || 0) - (initial.heading || 0)) > 1e-9);
      if (moved) assets[id] = frames.map((frame) => ({ time: frame.time, ...frame.assets[id] }));
    }
    return { startTime: first.time, endTime: state.time, requestedStartTime, capped, assets };
  }
  function tick(deltaSeconds, mepSnapshot = null) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('制造模拟时间增量必须为非负有限数');
    if (deltaSeconds > 86400) throw new Error('单次演示步长超过 24 小时');
    const requestedStartTime = state.time, frames = [motionFrame()]; let capped = false;
    remainder += deltaSeconds;
    while (remainder + 1e-9 >= STEP) {
      remainder -= STEP; state.time = Math.round((state.time + STEP) * 100) / 100;
      for (const b of Object.values(state.buildings)) {
        if (!b.enabled) continue;
        utilities(b, mepSnapshot);
        if (!b.started) continue;
        b.elapsedActiveSeconds += STEP;
        processTools(b, STEP); schedule(b); transport(b, STEP);
      }
      frames.push(motionFrame());
      if (frames.length > MOTION_FRAME_LIMIT) { frames.shift(); capped = true; }
    }
    // tick(0), or a fraction that advances no fixed step, clears the previous
    // window so a paused renderer cannot accidentally replay the last motion.
    state.motionSamples = motionWindow(frames, requestedStartTime, capped);
    refresh();
  }

  function command(request = {}) {
    const { action, assetId } = request;
    const buildingId = request.buildingId || meta[assetId]?.buildingId;
    let b = state.buildings[buildingId], message, error;
    const receipt = { id: `MFG-C-${++sequence}`, time: state.time, action, buildingId: buildingId || null, assetId: assetId || null, status: 'accepted', simulated: true };
    if (!b) error = '未找到对应厂房';
    else if (assetId && (!meta[assetId] || meta[assetId].buildingId !== b.id)) error = '设备不属于当前厂房';
    else if (action === 'enableExpansion') {
      if (!b.expansion) error = '此操作仅用于扩建预留厂房';
      else if (request.enabled !== true) error = '启用扩建演示须明确 enabled=true；停用请重置该楼';
      else { b.enabled = true; message = '已启用独立的 FAB-2 扩建假设场景，不计入一期或跨楼运输'; }
    } else if (action === 'resetBuilding') {
      const bm = buildingMeta.find((x) => x.id === b.id); state.buildings[b.id] = b = makeBuilding(bm); message = '当前厂房演示已重置；其他厂房保持运行';
    } else if (!b.enabled) error = '该厂房为扩建预留，请先显式启用假设场景';
    else if (action === 'startDemo') {
      const empty = Object.values(b.carriers).filter((c) => !c.lotId && !c.jobId && c.location.type === 'stocker');
      const requested = request.count ?? Math.min(4, empty.length);
      if (!Number.isInteger(requested) || requested < 1 || requested > empty.length) error = `请输入 1–${empty.length} 个批次；每批需一个空载具`;
      else {
        b.started = true;
        for (const carrier of empty.slice(0, requested)) {
          const ordinal = ++b.batchSequence, id = `${b.id}-DEMO-LOT-${String(ordinal).padStart(3, '0')}`;
          const lot = { id, label: `示范批 ${ordinal}`, buildingId: b.id, carrierId: carrier.id,
            ordinal, waferCount: 25, recipe: 'DEMO-REPRESENTATIVE-STATIONS', recipeNote: '代表设备串联演示，非 7nm/5nm 实际制程配方',
            status: 'awaiting_transport', stageIndex: 0, completedStages: [], toolId: null, createdAt: state.time,
            held: false, holdReason: null, requireQualityReview: ordinal === 1, qualityReleased: false, history: [] };
          b.lots.push(lot); carrier.lotId = lot.id;
          event(b, 'lot_created', `${lot.label} 与 ${carrier.label} 绑定，25 片为演示数据`, { lotId: lot.id, assetId: carrier.id });
        }
        message = `已建立 ${requested} 个示范批次，首批在量测后等待人工放行`;
      }
    } else if (action === 'faultTool' || action === 'recoverTool') {
      const tool = b.tools[assetId];
      if (!tool) error = '请选择制造或量测机台';
      else { tool.fault = action === 'faultTool'; tool.status = tool.fault ? 'fault' : tool.lotId ? 'waiting_process' : 'idle'; message = tool.fault ? '机台故障已注入，加工进度保持，等待恢复' : '机台故障已清除，恢复后继续原批次'; }
    } else if (action === 'blockTransport' || action === 'unblockTransport') {
      if (assetId && !b.vehicles[assetId]) error = '请选择 OHT 运输车或整个厂房';
      else { b.transportBlocked = action === 'blockTransport'; for (const v of Object.values(b.vehicles)) v.blocked = b.transportBlocked;
        message = b.transportBlocked ? '运输路径已阻塞，载具与储位预留保持原位' : '运输路径已恢复，继续未完成的交接任务'; }
    } else if (action === 'hold' || action === 'release') {
      const lotId = request.lotId || b.tools[assetId]?.lotId || b.carriers[assetId]?.lotId;
      const lot = lotFor(b, lotId);
      if (!lot) error = '请选择当前批次、带料载具或正在加工的机台';
      else if (lot.status === 'completed') error = '该批次已经收货完成';
      else if (action === 'release' && !lot.held) error = '该批次当前没有 Hold';
      else if (action === 'hold' && lot.held) error = '该批次已经处于 Hold';
      else if (action === 'hold' && b.carriers[lot.carrierId].jobId) error = '载具交接中，请等待本次交接完成后 Hold；运输异常请使用路径阻塞';
      else {
        lot.held = action === 'hold';
        if (lot.held) { lot.holdReason = '用户人工 Hold（演练）'; setLotStatus(b, lot, 'held', `${lot.label} 人工 Hold`); }
        else { if (lot.measurement?.result === 'review') { lot.qualityReleased = true; lot.measurement.releasedAt = state.time; lot.measurement.result = 'released'; }
          lot.holdReason = null; setLotStatus(b, lot, lot.toolId && !b.tools[lot.toolId].outgoing ? 'waiting_process' : 'awaiting_transport', `${lot.label} 人工放行，保留追溯记录`); }
        message = lot.held ? '批次已 Hold，需人工放行后继续' : '批次已放行，继续当前工序或后续交接'; receipt.lotId = lot.id;
      }
    } else error = '不支持的制造演示操作';
    receipt.status = error ? 'rejected' : 'accepted'; receipt.message = error || message;
    if (b) event(b, error ? 'command_rejected' : 'command_accepted', receipt.message, { assetId: assetId || null, commandId: receipt.id });
    state.commands.unshift(receipt); state.commands.length = Math.min(state.commands.length, 160);
    refresh(); return clone(receipt);
  }

  function snapshot() { return clone(state); }
  validate(); reset();
  return { tick, command, snapshot, reset, spec: clone(spec) };
}
