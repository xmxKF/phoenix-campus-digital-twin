import * as THREE from 'three';

const keyActions = new Map([
  ['ArrowUp', 'forward'], ['ArrowDown', 'backward'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
  ['KeyQ', 'down'], ['KeyE', 'up'], ['PageDown', 'down'], ['PageUp', 'up']
]);
const actions = new Set(keyActions.values());
const editingSelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"]';
const closest = (target, selector) => target instanceof Element ? target.closest(selector) : null;
const isEditing = target => Boolean(closest(target, editingSelector));

// A mouse selection is a completed action. Return its focus to the scene so the
// next arrow moves the camera. Keyboard select editing remains native until the
// user commits with Enter or leaves with Escape; never intercept its arrow keys.
export function installSelectFocusHandoff(focusTarget, root = document) {
  const sessions = new WeakMap();
  const timers = new Set();
  const sessionFor = select => {
    if (!sessions.has(select)) sessions.set(select, { mode: 'keyboard', changed: false, opened: false });
    return sessions.get(select);
  };
  const nativeOpen = select => {
    try { return select.matches(':open'); } catch { return null; }
  };
  const handoff = select => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      // Do not move focus if an asynchronous building load/user action has already
      // put it elsewhere. Deferring also lets the native picker finish its commit.
      if (document.activeElement === select) focusTarget?.focus({ preventScroll: true });
      sessions.delete(select);
    }, 0);
    timers.add(timer);
  };
  const pointerDown = event => {
    const select = closest(event.target, 'select');
    if (select) sessions.set(select, { mode: 'pointer', changed: false, opened: true });
  };
  const keyDown = event => {
    const select = closest(event.target, 'select');
    if (!select) return;
    const state = sessionFor(select);
    state.mode = 'keyboard';
    if (event.code === 'Escape' || (event.code === 'Enter' && (state.changed || state.opened || nativeOpen(select)))) {
      handoff(select);
    } else if (event.code === 'Enter' || event.code === 'Space' || event.code === 'F4' || (event.altKey && event.code === 'ArrowDown')) {
      state.opened = true;
    }
  };
  const change = event => {
    const select = closest(event.target, 'select');
    if (!select) return;
    const state = sessionFor(select);
    state.changed = true;
    if (state.mode === 'pointer') handoff(select);
  };
  const click = event => {
    const select = closest(event.target, 'select');
    // Chromium reports :open for the native popup. This also covers picking the
    // already selected option, which intentionally does not emit a change event.
    if (select && sessionFor(select).mode === 'pointer' && nativeOpen(select) === false) handoff(select);
  };
  const focusOut = event => {
    const select = closest(event.target, 'select');
    if (select) sessions.delete(select);
  };
  root.addEventListener('pointerdown', pointerDown, true);
  root.addEventListener('keydown', keyDown, true);
  root.addEventListener('change', change);
  root.addEventListener('click', click);
  root.addEventListener('focusout', focusOut);
  return () => {
    for (const timer of timers) clearTimeout(timer);
    root.removeEventListener('pointerdown', pointerDown, true);
    root.removeEventListener('keydown', keyDown, true);
    root.removeEventListener('change', change);
    root.removeEventListener('click', click);
    root.removeEventListener('focusout', focusOut);
  };
}

// Translate both camera and OrbitControls target, preserving the inspection angle.
// Forward/back stay in the horizontal world plane; Q/E move vertically in world Y.
export function installKeyboardNavigation(camera, controls, requestRender) {
  const keys = new Set(), heldButtons = new Set(), pendingPresses = new Set();
  const buttonCleanups = new Set();
  let pendingBoost = false;
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), movement = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const focusTarget = controls.domElement;
  if (focusTarget && !focusTarget.hasAttribute('tabindex')) focusTarget.tabIndex = 0;
  const focusCanvas = event => { if (event.button === 0) focusTarget?.focus({ preventScroll: true }); };
  focusTarget?.addEventListener('pointerdown', focusCanvas);
  const removeSelectHandoff = installSelectFocusHandoff(focusTarget);
  const release = () => { keys.clear(); heldButtons.clear(); pendingPresses.clear(); pendingBoost = false; };
  const down = event => {
    if (isEditing(event.target) || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') keys.add(event.code);
    const action = keyActions.get(event.code);
    if (!action) return;
    event.preventDefault();
    keys.add(event.code);
    pendingPresses.add(action);
    pendingBoost ||= event.shiftKey;
    requestRender();
  };
  const upKey = event => {
    const handled = keys.delete(event.code);
    if (handled && keyActions.has(event.code) && !isEditing(event.target)) event.preventDefault();
  };
  const visibility = () => { if (document.hidden) release(); };
  const focus = event => { if (isEditing(event.target)) release(); };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', upKey);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('focusin', focus);
  const held = action => heldButtons.has(action) || [...keys].some(key => keyActions.get(key) === action);

  return {
    get active() { return [...actions].some(action => held(action) || pendingPresses.has(action)); },
    release,
    // Bind any six-axis pad; native keyboard button activation gives one short step,
    // while mouse/touch press-and-hold produces continuous movement with capture.
    bindButtons(container) {
      const buttons = [...container.querySelectorAll('[data-camera-move]')];
      const listeners = [];
      for (const button of buttons) {
        const action = button.dataset.cameraMove;
        if (!actions.has(action)) continue;
        const start = event => {
          if (event.button !== 0 || button.disabled) return;
          event.preventDefault();
          focusTarget?.focus({ preventScroll: true });
          button.setPointerCapture?.(event.pointerId);
          heldButtons.add(action); pendingPresses.add(action); pendingBoost ||= event.shiftKey;
          requestRender();
        };
        const stop = () => heldButtons.delete(action);
        const click = event => {
          if (event.detail !== 0 || button.disabled) return;
          pendingPresses.add(action); pendingBoost ||= event.shiftKey;
          focusTarget?.focus({ preventScroll: true }); requestRender();
        };
        for (const [name, fn] of [['pointerdown', start], ['pointerup', stop], ['pointercancel', stop], ['lostpointercapture', stop], ['click', click]]) {
          button.addEventListener(name, fn); listeners.push([button, name, fn]);
        }
      }
      const cleanup = () => {
        for (const [button, name, fn] of listeners) button.removeEventListener(name, fn);
        for (const button of buttons) heldButtons.delete(button.dataset.cameraMove);
        buttonCleanups.delete(cleanup);
      };
      buttonCleanups.add(cleanup);
      return cleanup;
    },
    update(seconds) {
      // Retain quick taps that start/end between heavy render frames. Aliases such
      // as Q + PageDown count once rather than doubling one movement direction.
      const pressed = action => held(action) || pendingPresses.has(action);
      const longitudinal = Number(pressed('forward')) - Number(pressed('backward'));
      const horizontal = Number(pressed('right')) - Number(pressed('left'));
      const altitude = Number(pressed('up')) - Number(pressed('down'));
      const tapOnly = pendingPresses.size > 0 && ![...actions].some(held);
      const boosted = keys.has('ShiftLeft') || keys.has('ShiftRight') || pendingBoost;
      pendingPresses.clear(); pendingBoost = false;
      if ((!longitudinal && !horizontal && !altitude) || !controls.enabled) return false;
      camera.getWorldDirection(forward); forward.y = 0;
      if (forward.lengthSq() < .0001) {
        forward.setFromMatrixColumn(camera.matrixWorld, 1); forward.y = 0;
      }
      if (forward.lengthSq() < .0001) forward.set(0, 0, -1);
      forward.normalize(); right.crossVectors(forward, up).normalize();
      movement.copy(forward).multiplyScalar(longitudinal).addScaledVector(right, horizontal).addScaledVector(up, altitude).normalize();
      const speed = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * .35, 10, 320);
      const dt = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, tapOnly ? .04 : 0), .1);
      movement.multiplyScalar(speed * (boosted ? 2.5 : 1) * dt);
      camera.position.add(movement); controls.target.add(movement);
      requestRender(); return true;
    },
    dispose() {
      release(); removeSelectHandoff();
      for (const cleanup of [...buttonCleanups]) cleanup();
      focusTarget?.removeEventListener('pointerdown', focusCanvas);
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', upKey);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('focusin', focus);
    }
  };
}
