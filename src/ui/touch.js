// On-screen controls for phones and tablets.
//
//   left half  - a floating stick: put a thumb down anywhere and drag. Sideways banks, up climbs,
//                down dives (the pause menu can invert it, like I on a keyboard).
//   right      - boost (hold), brake (hold; tap twice to land, as with Space), and the kickflip
//                once it has been earned.
//   top        - camera and pause; the treasure counter opens the journal; the landing prompt
//                itself is a button ("land", "take off").
//
// Everything goes through Input (player/input.js): `touch` for what is held, press() for taps,
// with the same codes the keyboard uses, so the game cannot tell the two apart.

const $ = (id) => document.getElementById(id);
const R = 58;              // px: full deflection of the stick
const DEAD = 0.1;          // fraction of R that does nothing

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.root = $('touch');
    this.stick = { id: -1, ox: 0, oy: 0 };
    this._bindStick();
    this._hold($('tBoost'), 'boost');
    this._hold($('tBrake'), 'brake', () => this.input.press('Space'));
    this._tap($('tFlip'), () => this.input.press('KeyQ'));
    this._tap($('tCam'), () => this.input.press('KeyC'));
    // (these two open something that covers the screen: on 'click', so the tap's own click does not
    // land on what has just opened and shut it again)
    $('tPause')?.addEventListener('click', (e) => { e.preventDefault(); this.pause(true); });
    this._bindMenu();

    // the landing prompt is a button: what it does is set by game/index.js (data-act)
    const prompt = $('prompt');
    prompt?.addEventListener('pointerdown', (e) => {
      const act = prompt.dataset.act;
      if (!act || !prompt.classList.contains('show')) return;
      e.preventDefault();
      if (act === 'land') this.input.press('Space2');
      else if (act === 'takeoff') this.input.press('Space');
      this._buzz(12);
    });
    // the treasure counter opens the journal (it listens for J)
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('#hud .treasures')) { e.preventDefault(); e.stopPropagation(); this._key('KeyJ'); }
    }, true);

    // no pinch-zoom, no double-tap zoom, no long-press callouts over the game
    for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS can leave the audio "interrupted" after a call or the app switcher: wake it on a touch
    document.addEventListener('touchstart', () => {
      const ctx = this.game.sound?.ctx;
      if (ctx && ctx.state !== 'running' && this.game.state === 'play' && !this.game.paused) ctx.resume?.();
    }, { passive: true });
  }

  show() { this.root.hidden = false; }

  // ---------------------------------------------------------------------------------- stick
  _bindStick() {
    const zone = $('tStickZone'), base = $('tStick'), knob = $('tKnob'), s = this.stick, T = this.input.touch;
    const place = (x, y) => { base.style.transform = `translate(${x}px, ${y}px)`; };
    const rest = () => {
      // where the stick waits when no thumb is on it: low on the left
      const r = zone.getBoundingClientRect();
      s.rx = r.left + Math.min(150, r.width * 0.35);
      s.ry = r.bottom - Math.min(130, r.height * 0.36);
      if (s.id < 0) place(s.rx, s.ry);
    };
    rest();
    window.addEventListener('resize', rest);
    window.visualViewport?.addEventListener('resize', rest);

    const move = (e) => {
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const shape = (v) => {
        const a = Math.abs(v);
        return a < DEAD ? 0 : Math.sign(v) * Math.pow((a - DEAD) / (1 - DEAD), 1.25);
      };
      T.x = shape(dx / R);
      T.y = -shape(dy / R);          // up the screen climbs
    };
    zone.addEventListener('pointerdown', (e) => {
      if (s.id >= 0) return;
      e.preventDefault();
      s.id = e.pointerId;
      s.ox = e.clientX; s.oy = e.clientY;
      try { zone.setPointerCapture(e.pointerId); } catch { /* (synthetic pointers) */ }
      place(s.ox, s.oy);
      base.classList.add('on');
      move(e);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === s.id) { e.preventDefault(); move(e); } });
    const end = (e) => {
      if (e.pointerId !== s.id) return;
      s.id = -1;
      T.x = 0; T.y = 0;
      knob.style.transform = '';
      base.classList.remove('on');
      place(s.rx, s.ry);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  // ---------------------------------------------------------------------------------- buttons
  _hold(el, what, onDown) {
    if (!el) return;
    const T = this.input.touch, ids = new Set();
    const set = () => { T[what] = ids.size > 0; el.classList.toggle('on', ids.size > 0); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ids.add(e.pointerId);
      try { el.setPointerCapture(e.pointerId); } catch { /* (synthetic pointers) */ }
      set();
      onDown?.();
      this._buzz(8);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, (e) => { ids.delete(e.pointerId); set(); });
  }

  _tap(el, fn) {
    el?.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); this._buzz(8); });
  }

  /** A key press, for the parts of the game that listen to the keyboard themselves. */
  _key(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace(/^Key/, '').toLowerCase() }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.replace(/^Key/, '').toLowerCase() }));
  }

  _buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* not everywhere */ } }

  // ---------------------------------------------------------------------------------- pause menu
  _bindMenu() {
    const g = this.game, menu = $('pauseMenu');
    if (!menu) return;
    const fs = $('mFull');
    const canFull = !!document.documentElement.requestFullscreen && !g.device.ios;
    if (fs) fs.hidden = !canFull;
    const label = () => {
      $('mInvert').querySelector('b').textContent = this.input.invert ? 'on' : 'off';
      $('mSound').querySelector('b').textContent = g.sound?.muted ? 'off' : 'on';
      if (fs) fs.querySelector('b').textContent = document.fullscreenElement ? 'on' : 'off';
      $('mHud').querySelector('b').textContent = $('hud').classList.contains('quiet') ? 'hidden' : 'shown';
    };
    this._label = label;
    const on = (id, fn) => $(id)?.addEventListener('click', (e) => { e.preventDefault(); fn(); label(); });
    on('mResume', () => this.pause(false));
    on('mInvert', () => { this.input.invert = !this.input.invert; });
    on('mSound', () => { g.sound?.toggleMute(); });
    on('mHud', () => { $('hud').classList.toggle('quiet'); });
    on('mFull', () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      setTimeout(label, 400);
    });
    // a tap on the dimmed world outside the card resumes too
    menu.addEventListener('click', (e) => { if (e.target === menu && performance.now() - this._opened > 400) this.pause(false); });
  }

  pause(on) {
    const g = this.game, menu = $('pauseMenu');
    if (!menu || g.state !== 'play') return;
    if (on && g.paused) return;               // (the journal holds the world still too)
    g.paused = on;
    menu.hidden = !on;
    this.input.touch.x = this.input.touch.y = 0;
    if (on) { this._opened = performance.now(); this._label?.(); g.sound?.ctx?.suspend?.(); } else {
      this.input.pressed.clear();
      if (!g.sound?.muted) g.sound?.ctx?.resume?.();
    }
  }
}
