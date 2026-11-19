'use strict';
/* ==========================================================
   CANNON PHYSICS – La batalla del momento de inercia
   script.js — física, niveles, render en Canvas, sonido e interfaz

   Modelo físico:
     • El cañón es una barra uniforme que gira alrededor de un eje
       perpendicular ubicado en uno de sus extremos:  I = ⅓·M·L²
     • Segunda ley de Newton para la rotación:       τ = I·α  →  α = τ/I
     • Al mantener una flecha se aplica +τ o −τ; al soltar, el freno
       aplica el mismo torque en sentido contrario hasta detenerlo.
   ========================================================== */

/* ==========================================================
   1. UTILIDADES
   ========================================================== */
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;
const TAU_2PI = Math.PI * 2;

/** Formatea un número con hasta d decimales (sin ceros sobrantes). */
function fmt(v, d = 2) {
  if (!isFinite(v)) return '—';
  const r = Number(v.toFixed(d));
  return String(Object.is(r, -0) ? 0 : r);
}
/** Segundos → mm:ss */
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
/** Convierte el texto del jugador en número. Acepta coma o punto decimal. Devuelve NaN si no es válido. */
function parseAnswer(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return parseFloat(s);
}
/** Tolerancia: 1,5 % relativo o 0,02 absoluto (permite redondeos a 2 decimales). */
function isCorrect(ans, correct) {
  return Math.abs(ans - correct) <= Math.max(0.02, Math.abs(correct) * 0.015);
}

/** Almacenamiento local seguro (puede fallar en modo privado). */
const Store = {
  get(k, d) { try { const v = localStorage.getItem('cp_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cp_' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
};

/* ==========================================================
   2. FÍSICA
   ========================================================== */
const Physics = {
  /** Momento de inercia de una barra uniforme respecto a un extremo [kg·m²] */
  inertia: (M, L) => (M * L * L) / 3,
  /** Aceleración angular [rad/s²] */
  alpha: (tau, I) => tau / I,
  /** Torque necesario [N·m] */
  torque: (I, alpha) => I * alpha,
  /** Longitud a partir de I y M [m] */
  lengthFrom: (I, M) => Math.sqrt((3 * I) / M),
  /** Tiempo para girar θ desde el reposo con α constante [s] */
  timeToRotate: (theta, alpha) => Math.sqrt((2 * theta) / alpha),
};

/* ==========================================================
   3. SONIDO (Web Audio sintetizado: no requiere archivos)
   ========================================================== */
const MELODY = [62, 0, 65, 67, 69, 0, 69, 0, 70, 69, 67, 65, 64, 0, 62, 0,
                62, 0, 65, 67, 69, 0, 72, 0, 74, 72, 70, 69, 67, 65, 64, 62];
const BASS = [38, 38, 46, 45, 38, 41, 43, 45];
const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

const Sound = {
  ctx: null, master: null, sfxGain: null, musicGain: null, noiseBuf: null,
  musicOn: Store.get('music', true),
  sfxOn: Store.get('sfx', true),
  musicTimer: null, nextNote: 0, step: 0,

  /** Crea el contexto de audio (debe llamarse tras una interacción del usuario). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.2; this.musicGain.connect(this.master);
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      if (this.musicOn) this.startMusic();
    } catch (e) { this.ctx = null; }
  },

  tone(freq, dur, type = 'sine', vol = 0.3, when = 0, dest = null, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, when);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  },

  noise(dur, vol, filterType, f0, f1, when = 0) {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter(); filt.type = filterType;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.05);
  },

  play(name) {
    if (!this.ctx || !this.sfxOn) return;
    switch (name) {
      case 'shot': this.noise(0.5, 0.7, 'lowpass', 1800, 180); this.tone(120, 0.35, 'sine', 0.6, 0, null, 40); break;
      case 'enemyShot': this.noise(0.4, 0.3, 'lowpass', 1200, 150); this.tone(90, 0.3, 'sine', 0.25, 0, null, 40); break;
      case 'boom': this.noise(1.1, 0.85, 'lowpass', 1400, 70); this.tone(70, 0.8, 'triangle', 0.5, 0, null, 30); break;
      case 'bigboom': this.noise(1.8, 1.0, 'lowpass', 1600, 50); this.tone(55, 1.4, 'triangle', 0.6, 0, null, 25); break;
      case 'splash': this.noise(0.45, 0.3, 'highpass', 700, 3000); break;
      case 'hit': this.noise(0.6, 0.7, 'lowpass', 900, 100); this.tone(160, 0.3, 'square', 0.15, 0, null, 60); break;
      case 'correct': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'square', 0.1, i * 0.09)); break;
      case 'wrong': this.tone(330, 0.22, 'sawtooth', 0.14); this.tone(220, 0.4, 'sawtooth', 0.14, 0.2); break;
      case 'click': this.tone(900, 0.05, 'triangle', 0.08); break;
      case 'unlock': this.tone(440, 0.12, 'triangle', 0.15); this.tone(880, 0.25, 'triangle', 0.15, 0.1); break;
      case 'firework': this.noise(0.5, 0.35, 'bandpass', 3000, 600); break;
      case 'win': [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.16, i * 0.14)); break;
      case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.38, 'sawtooth', 0.1, i * 0.22)); break;
      default: break;
    }
  },

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = setInterval(() => this.schedule(), 60);
  },
  stopMusic() { if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; },

  /** Programa las notas con anticipación usando el reloj del audio. */
  schedule() {
    if (!this.ctx) return;
    const spb = 60 / 138 / 2; // corcheas a 138 bpm
    const now = this.ctx.currentTime;
    if (this.nextNote < now - 0.1) this.nextNote = now + 0.05; // la pestaña estuvo en segundo plano
    while (this.nextNote < now + 0.25) {
      const i = this.step % MELODY.length;
      const n = MELODY[i];
      const when = this.nextNote - now;
      if (n) this.tone(midiToFreq(n), spb * 0.9, 'triangle', 0.16, when, this.musicGain);
      if (i % 4 === 0) this.tone(midiToFreq(BASS[Math.floor(i / 4) % BASS.length]), spb * 3.6, 'sine', 0.28, when, this.musicGain);
      this.nextNote += spb;
      this.step++;
    }
  },

  toggle(kind) {
    this.init();
    if (kind === 'music') {
      this.musicOn = !this.musicOn; Store.set('music', this.musicOn);
      if (this.musicOn) this.startMusic(); else this.stopMusic();
    } else {
      this.sfxOn = !this.sfxOn; Store.set('sfx', this.sfxOn);
      if (this.sfxOn) this.play('click');
    }
    refreshToggles();
  },
};

/** Actualiza el texto/estado de todos los botones de sonido. */
function refreshToggles() {
  document.querySelectorAll('[data-toggle]').forEach((el) => {
    const kind = el.getAttribute('data-toggle');
    const on = kind === 'music' ? Sound.musicOn : Sound.sfxOn;
    el.classList.toggle('off', !on);
    if (el.classList.contains('icon-btn')) {
      el.textContent = kind === 'music' ? '🎵' : (on ? '🔊' : '🔇');
    } else {
      el.textContent = kind === 'music' ? `🎵 Música: ${on ? 'ON' : 'OFF'}` : `${on ? '🔊' : '🔇'} Efectos: ${on ? 'ON' : 'OFF'}`;
    }
  });
}

/* ==========================================================
   4. CONFIGURACIÓN DEL JUEGO Y DE LOS NIVELES
   ========================================================== */
const W = 1280, H = 720;          // resolución lógica del canvas
const SEA_Y = 540;                 // nivel medio del mar
const GRAVITY = 700;               // px/s² (gravedad visual de los proyectiles)
const BALL_SPEED = 860;            // px/s
const THETA_MIN = -5 * DEG;
const THETA_MAX = 75 * DEG;
const PLAYER_X = 200;
const PS = 0.85;                   // escala del barco del jugador
const L_VALUES = [1, 1.5, 2, 2.5, 3, 3.5, 4];

const LEVELS = {
  1: {
    name: 'Entrenamiento', icon: '🎯',
    desc: 'Aprende qué es el momento de inercia, dónde está el eje de rotación y cómo usar I = ⅓·M·L². Después practica tu puntería con barriles flotantes.',
    goals: ['Estudiar el ejemplo resuelto paso a paso', 'Calcular el momento de inercia de tu cañón', 'Hundir los 3 barriles de práctica'],
    challenge: 'inertia', tutorial: true, aimGuide: true,
    targets: [640, 860, 1080],
  },
  2: {
    name: 'Primer enfrentamiento', icon: '⚔️',
    desc: '¡Aparecen los primeros barcos enemigos! Calcula el momento de inercia y la aceleración angular α = τ/I para desbloquear tu cañón.',
    goals: ['Calcular I y α del cañón', 'Hundir 3 barcos enemigos', 'Cuidar la vida de tu barco'],
    challenge: 'alpha', aimGuide: true,
    fleet: { count: 3, maxAlive: 3, ranges: [[700, 880], [820, 1000], [940, 1140]], speed: [22, 38], hp: 2, scale: 0.62 },
    fire: { min: 6, max: 9, dmg: 10, err: 230, volley: 1 },
  },
  3: {
    name: 'Selección de cañones', icon: '🛠️',
    desc: 'En la armería hay varios cañones. Con el mismo torque, elige el que tenga el MENOR momento de inercia para lograr la mayor aceleración angular.',
    goals: ['Comparar I = ⅓ML² de cada cañón', 'Elegir el cañón más ágil', 'Hundir 4 barcos enemigos'],
    challenge: 'select', aimGuide: true,
    fleet: { count: 4, maxAlive: 3, ranges: [[680, 900], [800, 1050], [900, 1150], [750, 1100]], speed: [40, 70], hp: 2, scale: 0.6 },
    fire: { min: 5, max: 8, dmg: 12, err: 190, volley: 1 },
  },
  4: {
    name: 'Batalla avanzada', icon: '🌊',
    desc: 'Enemigos más rápidos y a diferentes distancias. Ya no tendrás guía de apuntado: analiza tu cañón, calcula I y α y anticipa el giro.',
    goals: ['Calcular I y α', 'Controlar el ángulo sin guía', 'Hundir 6 barcos rápidos'],
    challenge: 'alpha', aimGuide: false,
    fleet: { count: 6, maxAlive: 3, ranges: [[620, 760], [780, 960], [980, 1160], [650, 900], [900, 1150], [700, 1100]], speed: [80, 130], hp: 2, scale: 0.56 },
    fire: { min: 3.5, max: 6, dmg: 12, err: 160, volley: 1 },
  },
  5: {
    name: 'Batalla final', icon: '☠️',
    desc: 'El buque insignia de la flota enemiga tiene 4 escudos. Cada vez que rompas uno deberás resolver un nuevo desafío que combina todo lo aprendido.',
    goals: ['Fase 1: aceleración angular', 'Fase 2: selección de cañón', 'Fase 3: torque necesario', 'Fase 4: despejar la longitud'],
    challenge: 'boss', aimGuide: false,
    boss: { hp: 16, range: [860, 1090], speed: 35, scale: 1.0 },
    bossChallenges: ['alpha', 'select', 'torque', 'length'],
    fire: { min: 2.8, max: 4.2, dmg: 12, err: 150, volley: 2 },
  },
};

/* ==========================================================
   5. ESTADO GLOBAL
   ========================================================== */
const G = {
  screen: 'menu', level: 1, cfg: LEVELS[1],
  score: 0, lives: 3, levelStartScore: 0,
  stats: { correct: 0, wrong: 0, levelsCompleted: 0, totalTime: 0 },
  levelTime: 0, levelMistakes: 0,
  mode: 'idle',            // idle | intro | challenge | battle | locked | ending | dead | complete
  paused: false, modalOpen: false,
  playerHP: 100, playerSink: 0, shipY: SEA_Y, vt: 0,
  cannon: null,
  enemies: [], balls: [], enemyBalls: [], particles: [], texts: [], queue: [],
  enemyMaxHp: 1, spawnTimer: 0, shake: 0,
  endTimer: 0, lockTimer: 0, deadTimer: 0, bossPhase: 0,
  challengeAttempts: 0, lastSolution: '', victory: false,
};
const keys = { left: false, right: false };

/* ==========================================================
   6. CAÑÓN DEL JUGADOR
   ========================================================== */
function newCannon(spec, solved) {
  const prevTheta = G.cannon ? G.cannon.theta : 20 * DEG;
  return {
    M: spec.M, L: spec.L, tau: spec.tau,
    I: Physics.inertia(spec.M, spec.L),
    theta: prevTheta, omega: 0, alphaNow: 0,
    unlocked: false, solved: !!solved,
    cooldown: 0, recoil: 0, state: 'Bloqueado',
  };
}
/** Longitud y grosor visuales proporcionales a L y M. */
const cannonLen = (c) => 50 + c.L * 19;
const cannonThick = (c) => 10 + Math.min(c.M, 20) * 0.9;

function playerPivot() {
  return { x: PLAYER_X + 62 * PS, y: G.shipY - 62 * PS + G.playerSink * 40 };
}

/** Integra el movimiento de rotación usando α = τ/I. */
function updateCannon(dt) {
  const c = G.cannon;
  if (!c) return;
  c.cooldown = Math.max(0, c.cooldown - dt);
  c.recoil = Math.max(0, c.recoil - 40 * dt);

  let input = 0;
  if (c.unlocked && G.mode === 'battle') {
    if (keys.left) input -= 1;
    if (keys.right) input += 1;
  }
  const alphaMax = Physics.alpha(c.tau, c.I);

  if (input !== 0) {
    // Se aplica el torque τ del cañón: α = τ / I
    c.alphaNow = input * alphaMax;
    c.omega += c.alphaNow * dt;
    c.state = input > 0 ? 'Girando ↑' : 'Girando ↓';
  } else if (Math.abs(c.omega) > 1e-6) {
    // Freno: el mismo torque en sentido opuesto hasta detenerse
    const dec = alphaMax * dt;
    if (Math.abs(c.omega) <= dec) { c.omega = 0; c.alphaNow = 0; }
    else { c.alphaNow = -Math.sign(c.omega) * alphaMax; c.omega += c.alphaNow * dt; }
    c.state = 'Frenando';
  } else {
    c.alphaNow = 0;
    c.state = c.unlocked ? 'En reposo' : 'Bloqueado 🔒';
  }
  c.theta += c.omega * dt;
  if (c.theta < THETA_MIN) { c.theta = THETA_MIN; c.omega = 0; }
  if (c.theta > THETA_MAX) { c.theta = THETA_MAX; c.omega = 0; }
}

function fireCannon() {
  const c = G.cannon;
  if (!c || G.screen !== 'game' || !c.unlocked || G.mode !== 'battle' || G.paused || G.modalOpen) return;
  if (c.cooldown > 0) return;
  const p = playerPivot();
  const len = cannonLen(c);
  const dx = Math.cos(c.theta), dy = -Math.sin(c.theta);
  const x = p.x + dx * len, y = p.y + dy * len;
  G.balls.push({ x, y, vx: dx * BALL_SPEED, vy: dy * BALL_SPEED, trail: [] });
  c.cooldown = 0.75;
  c.recoil = 10;
  G.shake = Math.max(G.shake, 4);
  for (let i = 0; i < 10; i++) addParticle({ type: 'fire', x, y, vx: dx * rand(80, 260) + rand(-40, 40), vy: dy * rand(80, 260) + rand(-40, 40), life: rand(0.15, 0.35), size: rand(4, 9) });
  for (let i = 0; i < 8; i++) addParticle({ type: 'smoke', x, y, vx: dx * rand(20, 90) + rand(-20, 20), vy: dy * rand(20, 90) - rand(10, 40), life: rand(0.8, 1.5), size: rand(8, 16) });
  Sound.play('shot');
}

/* ==========================================================
   7. ENEMIGOS
   ========================================================== */
function makeShip(spec, inRange) {
  const fire = G.cfg.fire || { min: 5, max: 8 };
  const [minX, maxX] = spec.range;
  return {
    kind: 'ship', x: inRange ? rand(minX, maxX) : W + 170, y: SEA_Y,
    minX, maxX, entered: inRange, dir: Math.random() < 0.5 ? -1 : 1,
    speed: spec.speed, hp: spec.hp, maxHp: spec.hp, scale: spec.scale,
    fireCD: rand(fire.min, fire.max) * 0.7 + (inRange ? 1.5 : 0.5),
    alive: true, sink: 0, flash: 0, phase: rand(0, 6), tilt: 0, smokeT: 0,
  };
}

function shipRect(e) {
  const s = e.scale;
  return { l: e.x - 150 * s, r: e.x + 138 * s, t: e.y - 238 * s, b: e.y + 22 * s };
}

function enemyFire(e) {
  const f = G.cfg.fire;
  const s = e.scale;
  const volley = e.kind === 'boss' ? (f.volley || 1) : 1;
  for (let k = 0; k < volley; k++) {
    const sx = e.x - 112 * s, sy = e.y - (30 + k * 18) * s;
    const tx = PLAYER_X + 12 + rand(-1, 1) * f.err;
    const ty = G.shipY - 60;
    const T = clamp(Math.abs(sx - tx) / 520, 1.1, 2.2) + k * 0.25;
    const vx = (tx - sx) / T;
    const vy = (ty - sy - 0.5 * GRAVITY * T * T) / T;
    G.enemyBalls.push({ x: sx, y: sy, vx, vy });
    for (let i = 0; i < 6; i++) addParticle({ type: 'smoke', x: sx, y: sy, vx: rand(-60, -10), vy: rand(-30, 5), life: rand(0.6, 1.2), size: rand(6, 12) });
    addParticle({ type: 'fire', x: sx, y: sy, vx: -120, vy: -20, life: 0.2, size: 9 });
  }
  Sound.play('enemyShot');
}

function updateEnemies(dt) {
  const fire = G.cfg.fire;
  for (const e of G.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    if (e.kind === 'barrel') {
      e.y = waveY(e.x, G.vt) - 4;
      if (!e.alive) e.sink += dt;
      continue;
    }
    if (!e.alive) { e.sink += dt; continue; }

    // Movimiento: entrada desde la derecha y patrulla en su rango
    if (!e.entered) {
      e.x -= e.speed * 1.6 * dt;
      if (e.x <= e.maxX) { e.entered = true; e.dir = -1; }
    } else {
      e.x += e.dir * e.speed * dt;
      if (e.x < e.minX) { e.x = e.minX; e.dir = 1; }
      if (e.x > e.maxX) { e.x = e.maxX; e.dir = -1; }
    }
    // Separación: dos barcos no se enciman (el que viene detrás cambia de rumbo)
    for (const o of G.enemies) {
      if (o === e || !o.alive || o.kind === 'barrel' || !e.entered || !o.entered) continue;
      const minDist = 150 * (e.scale + o.scale);
      if (Math.abs(o.x - e.x) < minDist && Math.sign(o.x - e.x) === e.dir) e.dir = -e.dir;
    }
    e.y = waveY(e.x, G.vt);
    e.tilt = Math.sin(G.vt * 1.3 + e.phase) * 0.03;

    // Humo cuando está dañado
    if (e.hp < e.maxHp) {
      e.smokeT -= dt;
      if (e.smokeT <= 0) {
        e.smokeT = 0.12;
        addParticle({ type: 'smoke', x: e.x + rand(-40, 40) * e.scale, y: e.y - 60 * e.scale, vx: rand(-10, 10), vy: rand(-50, -25), life: rand(1, 1.8), size: rand(8, 14), dark: true });
      }
    }

    // Disparo enemigo (solo en combate)
    if (fire && G.mode === 'battle' && e.entered) {
      e.fireCD -= dt;
      if (e.fireCD <= 0) { enemyFire(e); e.fireCD = rand(fire.min, fire.max); }
    }
  }
  // Eliminar barcos hundidos
  G.enemies = G.enemies.filter((e) => !(e.sink > 3));

  // Refuerzos
  const f = G.cfg.fleet;
  if (f && G.queue.length && G.mode === 'battle') {
    const alive = G.enemies.filter((e) => e.alive).length;
    if (alive < f.maxAlive) {
      G.spawnTimer -= dt;
      if (G.spawnTimer <= 0) { G.enemies.push(makeShip(G.queue.shift(), false)); G.spawnTimer = 2.2; }
    }
  }
}

function enemyHpFraction() {
  let cur = 0;
  for (const e of G.enemies) if (e.alive) cur += e.hp;
  for (const q of G.queue) cur += q.hp;
  return G.enemyMaxHp > 0 ? cur / G.enemyMaxHp : 0;
}

/* ==========================================================
   8. PROYECTILES Y COLISIONES
   ========================================================== */
function updateBalls(dt) {
  for (const b of G.balls) {
    b.vy += GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 9) b.trail.shift();

    for (const e of G.enemies) {
      if (!e.alive) continue;
      let hit = false;
      if (e.kind === 'barrel') hit = Math.hypot(b.x - e.x, b.y - (e.y - 18)) < 34;
      else { const r = shipRect(e); hit = b.x > r.l && b.x < r.r && b.y > r.t && b.y < r.b; }
      if (hit) { handleHit(e, b); b.dead = true; break; }
    }
    if (b.dead) continue;
    if (b.y > waveY(b.x, G.vt) + 4) { splash(b.x, waveY(b.x, G.vt)); b.dead = true; }
    else if (b.x > W + 60 || b.x < -60 || b.y > H + 60) b.dead = true;
  }
  G.balls = G.balls.filter((b) => !b.dead);
}

function handleHit(e, b) {
  explosion(b.x, b.y, false);
  Sound.play('boom');
  if (e.kind === 'barrel') {
    e.alive = false;
    for (let i = 0; i < 14; i++) addParticle({ type: 'debris', x: e.x, y: e.y - 18, vx: rand(-200, 200), vy: rand(-380, -120), life: rand(0.8, 1.4), size: rand(4, 8), g: 700, rot: rand(0, 6), vr: rand(-10, 10) });
    addScore(50, e.x, e.y - 60, '+50 ¡Barril!');
    updateHUD();
    return;
  }
  if (G.mode !== 'battle') { addText('¡Escudo!', b.x, b.y - 30, '#9fe3ff'); return; }
  e.hp -= 1;
  e.flash = 0.22;
  addScore(10, b.x, b.y - 30, '+10');
  if (e.hp <= 0) {
    e.alive = false;
    explosion(e.x, e.y - 70 * e.scale, true);
    Sound.play('bigboom');
    const pts = e.kind === 'boss' ? 500 : 150;
    addScore(pts, e.x, e.y - 260 * e.scale, `+${pts} ¡Hundido!`);
  } else if (e.kind === 'boss') {
    checkBossPhase(e);
  }
  updateHUD();
}

function checkBossPhase(e) {
  const c = G.cfg;
  const phaseHp = c.boss.hp / c.bossChallenges.length;
  const threshold = c.boss.hp - phaseHp * (G.bossPhase + 1);
  if (e.hp <= threshold && e.hp > 0 && G.bossPhase < c.bossChallenges.length - 1) {
    G.bossPhase++;
    G.mode = 'locked';
    G.lockTimer = 1.4;
    G.cannon.unlocked = false;
    keys.left = keys.right = false;
    showToast(`🛡️ ¡El buque insignia levanta un escudo! Desafío ${G.bossPhase + 1} de ${c.bossChallenges.length}…`);
  }
}

function updateEnemyBalls(dt) {
  const r = { l: PLAYER_X - 120 * PS, r: PLAYER_X + 150 * PS, t: G.shipY - 235 * PS, b: G.shipY + 20 * PS };
  for (const b of G.enemyBalls) {
    b.vy += GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (G.mode !== 'dead' && b.x > r.l && b.x < r.r && b.y > r.t && b.y < r.b) {
      b.dead = true;
      explosion(b.x, b.y, false);
      Sound.play('hit');
      G.shake = Math.max(G.shake, 10);
      G.playerHP = Math.max(0, G.playerHP - G.cfg.fire.dmg);
      addText(`−${G.cfg.fire.dmg} ❤`, b.x, b.y - 30, '#ff6b6b');
      updateHUD();
      if (G.playerHP <= 0 && (G.mode === 'battle' || G.mode === 'locked')) playerDies();
      continue;
    }
    if (b.y > waveY(b.x, G.vt) + 4) { splash(b.x, waveY(b.x, G.vt)); b.dead = true; }
    else if (b.x < -60 || b.x > W + 60 || b.y > H + 60) b.dead = true;
  }
  G.enemyBalls = G.enemyBalls.filter((b) => !b.dead);
}

/* ==========================================================
   9. PARTÍCULAS Y EFECTOS
   ========================================================== */
function addParticle(p) {
  p.max = p.life;
  if (G.particles.length < 700) G.particles.push(p);
}
function addText(text, x, y, color = '#ffe08a') {
  G.texts.push({ text, x, y, color, life: 1.4, max: 1.4 });
}
function explosion(x, y, big) {
  const n = big ? 30 : 14;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU_2PI), sp = rand(60, big ? 380 : 220);
    addParticle({ type: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.6), size: rand(5, big ? 16 : 10) });
  }
  for (let i = 0; i < n * 0.6; i++) addParticle({ type: 'smoke', x: x + rand(-15, 15), y: y + rand(-15, 15), vx: rand(-40, 40), vy: rand(-80, -20), life: rand(0.9, 1.8), size: rand(10, big ? 28 : 18), dark: true });
  for (let i = 0; i < (big ? 16 : 6); i++) addParticle({ type: 'debris', x, y, vx: rand(-260, 260), vy: rand(-420, -120), life: rand(0.8, 1.5), size: rand(3, 8), g: 800, rot: rand(0, 6), vr: rand(-12, 12) });
  G.shake = Math.max(G.shake, big ? 16 : 6);
}
function splash(x, y) {
  for (let i = 0; i < 14; i++) addParticle({ type: 'water', x: x + rand(-6, 6), y, vx: rand(-90, 90), vy: rand(-320, -120), life: rand(0.5, 0.9), size: rand(2.5, 5), g: 900 });
  addParticle({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.7, size: 6 });
  Sound.play('splash');
}
function fireworks(x, y) {
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#4cc9f0', '#f8f9fa', '#ff9f1c'];
  const col = pick(colors);
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * TAU_2PI, sp = rand(140, 260);
    addParticle({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.8, 1.3), size: rand(2, 3.5), color: col, g: 120 });
  }
  Sound.play('firework');
}
/** Celebración al resolver un desafío: confeti y destellos dorados en el cañón. */
function celebrate() {
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#4cc9f0', '#ffffff'];
  for (let i = 0; i < 90; i++) addParticle({ type: 'confetti', x: rand(0, W), y: rand(-80, -10), vx: rand(-40, 40), vy: rand(60, 200), life: rand(2, 3.4), size: rand(5, 9), color: pick(colors), g: 60, rot: rand(0, 6), vr: rand(-8, 8) });
  const p = playerPivot();
  for (let i = 0; i < 30; i++) {
    const a = rand(0, TAU_2PI), sp = rand(40, 180);
    addParticle({ type: 'spark', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.6, 1.1), size: rand(2, 4), color: '#ffd166', g: 0 });
  }
}

function updateParticles(dt) {
  for (const p of G.particles) {
    p.life -= dt;
    if (p.g) p.vy += p.g * dt;
    if (p.type === 'smoke') { p.vx *= 0.98; p.vy *= 0.98; p.size += 14 * dt; }
    if (p.type === 'confetti') p.vx += Math.sin(G.vt * 4 + p.rot) * 20 * dt;
    if (p.vr) p.rot += p.vr * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  G.particles = G.particles.filter((p) => p.life > 0);
  for (const t of G.texts) { t.life -= dt; t.y -= 40 * dt; }
  G.texts = G.texts.filter((t) => t.life > 0);
}

/* ==========================================================
   10. BUCLE DE ACTUALIZACIÓN
   ========================================================== */
function update(dt) {
  G.vt += dt;
  if (G.screen !== 'game') return;

  if (!G.paused && (G.mode === 'challenge' || G.mode === 'battle' || G.mode === 'locked')) {
    G.levelTime += dt;
    G.stats.totalTime += dt;
  }
  if (G.paused) return;

  G.shipY = waveY(PLAYER_X, G.vt) - 4;
  updateParticles(dt);
  G.shake = Math.max(0, G.shake - 30 * dt);
  if (G.modalOpen) return;

  updateCannon(dt);
  updateEnemies(dt);
  updateBalls(dt);
  updateEnemyBalls(dt);

  switch (G.mode) {
    case 'battle': {
      const remaining = G.enemies.filter((e) => e.alive).length + G.queue.length;
      if (remaining === 0) {
        G.mode = 'ending';
        G.endTimer = 2.6;
        G.cannon.unlocked = false;
        showToast('🏴‍☠️ ¡Nivel despejado!');
      }
      break;
    }
    case 'locked':
      G.lockTimer -= dt;
      if (G.lockTimer <= 0) startChallenge(G.cfg.bossChallenges[G.bossPhase], startBattle);
      break;
    case 'ending':
      G.endTimer -= dt;
      if (Math.random() < dt * 3) fireworks(rand(450, 1150), rand(90, 300));
      if (G.endTimer <= 0) completeLevel();
      break;
    case 'dead':
      G.playerSink = Math.min(3, G.playerSink + dt);
      if (Math.random() < dt * 6) explosion(PLAYER_X + rand(-80, 80), G.shipY - rand(20, 120), false);
      G.deadTimer -= dt;
      if (G.deadTimer <= 0) showLifeLost();
      break;
    default: break;
  }
}

/* ==========================================================
   11. RENDER — ESCENARIO
   ========================================================== */
const gameCanvas = $('gameCanvas');
const gctx = gameCanvas.getContext('2d');
const menuCanvas = $('menuCanvas');
const mctx = menuCanvas.getContext('2d');
const labCanvas = $('labCanvas');
const lctx = labCanvas.getContext('2d');

const CLOUDS = Array.from({ length: 7 }, () => ({ x0: rand(0, 1700), y: rand(0.08, 0.5), s: rand(0.6, 1.4), sp: rand(8, 22) }));

/** Altura de la superficie del mar en x (dos ondas superpuestas). */
function waveY(x, t, base = SEA_Y) {
  return base + Math.sin(x * 0.011 + t * 1.5) * 6 + Math.sin(x * 0.027 - t * 2.1) * 3.5;
}

function drawSky(ctx, w, h, horizon) {
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#16324f');
  g.addColorStop(0.45, '#3f7fb3');
  g.addColorStop(0.85, '#f2c98a');
  g.addColorStop(1, '#f7dcae');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon + 2);
  const sx = w * 0.8, sy = horizon * 0.42, r = h * 0.06;
  const sg = ctx.createRadialGradient(sx, sy, r * 0.3, sx, sy, r * 3.2);
  sg.addColorStop(0, 'rgba(255,240,190,0.9)');
  sg.addColorStop(0.3, 'rgba(255,214,140,0.35)');
  sg.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(sx, sy, r * 3.2, 0, TAU_2PI); ctx.fill();
  ctx.fillStyle = '#fff3c9';
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU_2PI); ctx.fill();
}

function drawCloud(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const blobs = [[0, 0, 60, 24], [-42, 8, 38, 17], [44, 8, 42, 18], [-12, -16, 34, 20], [20, -12, 30, 18]];
  ctx.fillStyle = '#d8e3ee';
  for (const [bx, by, rx, ry] of blobs) { ctx.beginPath(); ctx.ellipse(bx, by + 5, rx, ry, 0, 0, TAU_2PI); ctx.fill(); }
  ctx.fillStyle = '#f8fbff';
  for (const [bx, by, rx, ry] of blobs) { ctx.beginPath(); ctx.ellipse(bx, by, rx, ry, 0, 0, TAU_2PI); ctx.fill(); }
  ctx.restore();
}
function drawClouds(ctx, w, h, horizon, t) {
  for (const c of CLOUDS) {
    const x = ((c.x0 + t * c.sp) % (w + 400)) - 200;
    drawCloud(ctx, x, c.y * horizon, c.s * (h / 720));
  }
}

function drawIslands(ctx, horizon) {
  ctx.fillStyle = '#4f7f6c';
  ctx.beginPath(); ctx.moveTo(880, horizon); ctx.quadraticCurveTo(930, horizon - 22, 990, horizon - 14); ctx.quadraticCurveTo(1030, horizon - 8, 1060, horizon); ctx.fill();
  ctx.fillStyle = '#3d6a5a';
  ctx.beginPath(); ctx.moveTo(420, horizon); ctx.quadraticCurveTo(480, horizon - 42, 545, horizon - 32); ctx.quadraticCurveTo(610, horizon - 22, 660, horizon); ctx.fill();
  // palmera
  ctx.strokeStyle = '#4a3523'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(540, horizon - 32); ctx.quadraticCurveTo(548, horizon - 60, 538, horizon - 84); ctx.stroke();
  ctx.fillStyle = '#2f5d3a';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.6;
    ctx.beginPath();
    ctx.ellipse(538 + Math.cos(a) * 16, horizon - 84 + Math.sin(a) * 8 + 6, 20, 5, a, 0, TAU_2PI);
    ctx.fill();
  }
}

function drawSeaBack(ctx, w, h, base, t) {
  const horizon = base - 50;
  const g = ctx.createLinearGradient(0, horizon, 0, h);
  g.addColorStop(0, '#2a7bb0'); g.addColorStop(0.3, '#1b5f8f'); g.addColorStop(1, '#0b2f4f');
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const yy = horizon + 7 + i * 8;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 16) {
      const y = yy + Math.sin(x * 0.03 + t * (1 + i * 0.3) + i) * 1.2;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#1f6c9e';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 10) ctx.lineTo(x, waveY(x, t, base));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(190,230,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 10) { const y = waveY(x, t, base); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
}

function drawSeaFront(ctx, w, h, base, t) {
  ctx.fillStyle = 'rgba(22,92,140,0.9)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 10) ctx.lineTo(x, waveY(x, t + 0.7, base + 14));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 14]);
  ctx.lineDashOffset = -t * 30;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 10) { const y = waveY(x, t + 0.7, base + 14); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.setLineDash([]);
  // destellos
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 14; i++) {
    const x = (i * 97 + t * 25) % w;
    const y = base + 40 + ((i * 53) % (h - base - 50));
    ctx.fillRect(x, y, 14, 2);
  }
}

/* ---------- Barcos ---------- */
const PAL_PLAYER = { hull: '#6b3f22', hullDark: '#43260f', stripe: '#d4a537', mast: '#4a2c14', sail: '#f3e9d2', sailEdge: '#c8b48a', jib: '#e9dcbc', flag: '#141414', emblem: '#141414', emblemBg: '#f3e9d2' };
const PAL_ENEMY = { hull: '#5a3420', hullDark: '#3a1f10', stripe: '#9b2d20', mast: '#3e2614', sail: '#d8d0bd', sailEdge: '#a8987a', jib: '#cfc5ae', flag: '#b3261e', emblem: '#b3261e', emblemBg: '#d8d0bd', stripes: true };
const PAL_BOSS = { hull: '#2b1b14', hullDark: '#120b07', stripe: '#c9a227', mast: '#22150c', sail: '#2a2a2a', sailEdge: '#555', jib: '#333', flag: '#111', emblem: '#d63c2f', emblemBg: '#2a2a2a', boss: true };

function drawSkull(ctx, x, y, r, color, bg) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color; ctx.lineWidth = r * 0.32; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-r * 1.3, r * 0.7); ctx.lineTo(r * 1.3, r * 1.7); ctx.moveTo(-r * 1.3, r * 1.7); ctx.lineTo(r * 1.3, r * 0.7); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, -r * 0.1, r, 0, TAU_2PI); ctx.fill();
  ctx.fillRect(-r * 0.55, r * 0.55, r * 1.1, r * 0.55);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(-r * 0.38, -r * 0.05, r * 0.27, 0, TAU_2PI); ctx.arc(r * 0.38, -r * 0.05, r * 0.27, 0, TAU_2PI); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, r * 0.25); ctx.lineTo(-r * 0.12, r * 0.45); ctx.lineTo(r * 0.12, r * 0.45); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawSail(ctx, x0, y0, x1, y1, pal, stripes) {
  const mid = (y0 + y1) / 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
  ctx.quadraticCurveTo(x1 + 14, mid, x1, y1);
  ctx.lineTo(x0, y1);
  ctx.quadraticCurveTo(x0 + 14, mid, x0, y0);
  ctx.closePath();
  ctx.fillStyle = pal.sail; ctx.fill();
  if (stripes) {
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(179,38,30,0.75)';
    for (let x = x0 + 10; x < x1; x += 30) ctx.fillRect(x, y0, 12, y1 - y0);
    ctx.restore();
  }
  ctx.strokeStyle = pal.sailEdge; ctx.lineWidth = 2; ctx.stroke();
}

/** Dibuja un barco en coordenadas locales (proa hacia +x cuando facing = 1). */
function drawShip(ctx, x, y, s, facing, pal, tilt, t, flash = 0, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(s * facing, s);

  // Mástiles y vergas
  ctx.fillStyle = pal.mast;
  ctx.fillRect(4, -236, 8, 192);
  ctx.fillRect(-74, -192, 7, 148);
  ctx.strokeStyle = pal.mast; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(128, -56); ctx.lineTo(188, -80); ctx.stroke();
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(40,25,10,0.7)';
  ctx.beginPath(); ctx.moveTo(8, -236); ctx.lineTo(188, -80); ctx.moveTo(8, -236); ctx.lineTo(-130, -78); ctx.moveTo(-70, -192); ctx.lineTo(-136, -80); ctx.stroke();

  // Foque (vela triangular)
  ctx.fillStyle = pal.jib;
  ctx.beginPath(); ctx.moveTo(16, -206); ctx.lineTo(170, -78); ctx.lineTo(24, -74); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = pal.sailEdge; ctx.lineWidth = 2; ctx.stroke();

  // Velas
  drawSail(ctx, -44, -222, 58, -156, pal, pal.stripes);
  drawSail(ctx, -52, -146, 66, -62, pal, pal.stripes);
  drawSail(ctx, -112, -180, -32, -98, pal, pal.stripes);
  drawSkull(ctx, 8, -110, 16, pal.emblem, pal.emblemBg);

  // Bandera ondeante
  const wv = Math.sin(t * 6) * 4;
  ctx.fillStyle = pal.flag;
  ctx.beginPath(); ctx.moveTo(12, -250); ctx.quadraticCurveTo(32, -252 + wv, 52, -244 + wv); ctx.lineTo(50, -226 + wv); ctx.quadraticCurveTo(30, -230 - wv, 12, -228); ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.mast; ctx.fillRect(9, -254, 4, 22);
  if (pal.boss) drawSkull(ctx, 30, -240 + wv * 0.6, 5, '#d63c2f', '#111');

  // Casco
  ctx.beginPath();
  ctx.moveTo(-138, -80); ctx.lineTo(-88, -80); ctx.lineTo(-84, -48); ctx.lineTo(112, -48); ctx.lineTo(148, -66);
  ctx.quadraticCurveTo(140, -20, 108, 8); ctx.quadraticCurveTo(80, 24, 40, 24);
  ctx.lineTo(-90, 24); ctx.quadraticCurveTo(-128, 20, -132, -20); ctx.closePath();
  const hg = ctx.createLinearGradient(0, -80, 0, 24);
  hg.addColorStop(0, pal.hull); hg.addColorStop(1, pal.hullDark);
  ctx.fillStyle = hg; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = pal.stripe; ctx.fillRect(-150, -36, 320, 7);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5;
  for (let yy = -20; yy < 24; yy += 10) { ctx.beginPath(); ctx.moveTo(-150, yy); ctx.lineTo(160, yy); ctx.stroke(); }
  ctx.fillStyle = '#1a0f07';
  for (let px = -70; px <= 90; px += 34) { ctx.beginPath(); ctx.arc(px, -14, 5.5, 0, TAU_2PI); ctx.fill(); }
  if (pal.boss) for (let px = -50; px <= 90; px += 34) { ctx.beginPath(); ctx.arc(px, 5, 4.5, 0, TAU_2PI); ctx.fill(); }
  ctx.fillStyle = '#f4c95d';
  ctx.fillRect(-130, -72, 10, 10); ctx.fillRect(-114, -72, 10, 10);
  if (flash > 0) { ctx.fillStyle = `rgba(255,60,40,${flash * 2.5})`; ctx.fillRect(-150, -90, 320, 120); }
  ctx.restore();
  ctx.strokeStyle = pal.hullDark; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-84, -56); ctx.lineTo(112, -56); ctx.stroke();
  ctx.lineWidth = 2;
  for (let px = -80; px <= 110; px += 19) { ctx.beginPath(); ctx.moveTo(px, -56); ctx.lineTo(px, -48); ctx.stroke(); }
  ctx.restore();
}

/** Cañón: barra que gira alrededor de un eje en su extremo (punto dorado). */
function drawCannon(ctx, px, py, theta, len, thick, recoil, opts = {}) {
  ctx.save();
  ctx.translate(px, py);
  // Cureña (soporte de madera) y ruedas
  ctx.fillStyle = '#5a3a1e';
  ctx.beginPath(); ctx.moveTo(-18, -2); ctx.lineTo(18, -2); ctx.lineTo(24, 12); ctx.lineTo(-24, 12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2e1c0c'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#2e1c0c';
  ctx.beginPath(); ctx.arc(-14, 12, 6, 0, TAU_2PI); ctx.arc(14, 12, 6, 0, TAU_2PI); ctx.fill();

  // Tubo del cañón
  ctx.save();
  ctx.rotate(-theta);
  ctx.translate(-recoil, 0);
  const rear = thick, front = thick * 0.72;
  const mg = ctx.createLinearGradient(0, -rear / 2, 0, rear / 2);
  mg.addColorStop(0, '#7b8794'); mg.addColorStop(0.35, '#3d4651'); mg.addColorStop(1, '#14181d');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.arc(-thick * 0.35, 0, thick * 0.3, 0, TAU_2PI); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -rear / 2); ctx.lineTo(len, -front / 2); ctx.lineTo(len, front / 2); ctx.lineTo(0, rear / 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a3038';
  ctx.fillRect(len - 7, -front * 0.65, 9, front * 1.3);
  ctx.fillStyle = '#c9a227';
  for (const f of [0.33, 0.66]) {
    const hh = rear + (front - rear) * f;
    ctx.fillRect(len * f - 2, -hh * 0.6, 5, hh * 1.2);
  }
  ctx.fillStyle = '#05070a';
  ctx.beginPath(); ctx.ellipse(len + 2, 0, 2, front * 0.32, 0, 0, TAU_2PI); ctx.fill();
  ctx.restore();

  // Eje de rotación
  const pulse = opts.glow ? 3 + Math.sin(G.vt * 5) * 2 : 0;
  if (opts.glow) {
    ctx.strokeStyle = 'rgba(255,209,102,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 11 + pulse, 0, TAU_2PI); ctx.stroke();
  }
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU_2PI); ctx.fill();
  ctx.fillStyle = '#7a5a10';
  ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU_2PI); ctx.fill();
  ctx.restore();
}

function drawBarrel(ctx, x, y, t, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 2 + x) * 0.1);
  ctx.strokeStyle = '#3b2412'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, -70); ctx.stroke();
  ctx.fillStyle = '#e63946';
  ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(24, -63 + Math.sin(t * 6) * 2); ctx.lineTo(0, -56); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath(); ctx.ellipse(0, -14, 20, 24, 0, 0, TAU_2PI); ctx.fill();
  ctx.strokeStyle = '#3b2412'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-19, -26); ctx.lineTo(19, -26); ctx.moveTo(-19, -2); ctx.lineTo(19, -2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(0, -14, 10, 0, TAU_2PI); ctx.fill();
  ctx.fillStyle = '#e63946';
  ctx.beginPath(); ctx.arc(0, -14, 6.5, 0, TAU_2PI); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(0, -14, 2.5, 0, TAU_2PI); ctx.fill();
  ctx.restore();
}

function drawBall(ctx, b, enemy) {
  if (b.trail) {
    for (let i = 0; i < b.trail.length; i++) {
      const p = b.trail[i];
      ctx.fillStyle = `rgba(255,255,255,${(i / b.trail.length) * 0.35})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2 + i * 0.4, 0, TAU_2PI); ctx.fill();
    }
  }
  ctx.fillStyle = enemy ? '#3a0d08' : '#111';
  ctx.beginPath(); ctx.arc(b.x, b.y, enemy ? 6 : 7, 0, TAU_2PI); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.arc(b.x - 2, b.y - 2, 2.2, 0, TAU_2PI); ctx.fill();
}

function drawParticles(ctx) {
  for (const p of G.particles) {
    const k = clamp(p.life / p.max, 0, 1);
    switch (p.type) {
      case 'fire': {
        ctx.fillStyle = k > 0.6 ? `rgba(255,240,170,${k})` : k > 0.3 ? `rgba(255,150,40,${k})` : `rgba(200,50,20,${k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.6), 0, TAU_2PI); ctx.fill();
        break;
      }
      case 'smoke':
        ctx.fillStyle = p.dark ? `rgba(50,45,42,${k * 0.5})` : `rgba(210,210,210,${k * 0.55})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU_2PI); ctx.fill();
        break;
      case 'debris':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillStyle = `rgba(90,58,30,${k})`; ctx.fillRect(-p.size, -p.size / 3, p.size * 2, p.size / 1.5);
        ctx.restore();
        break;
      case 'water':
        ctx.fillStyle = `rgba(210,240,255,${k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU_2PI); ctx.fill();
        break;
      case 'ring':
        ctx.strokeStyle = `rgba(230,248,255,${k})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 + (1 - k) * 40, 3 + (1 - k) * 8, 0, 0, TAU_2PI); ctx.stroke();
        break;
      case 'spark':
        ctx.fillStyle = p.color || '#ffd166';
        ctx.globalAlpha = k;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU_2PI); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case 'confetti':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
        break;
      default: break;
    }
  }
}

function drawTexts(ctx) {
  ctx.textAlign = 'center';
  ctx.font = 'bold 24px Nunito, sans-serif';
  for (const t of G.texts) {
    ctx.globalAlpha = clamp(t.life / t.max * 1.5, 0, 1);
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Recuadro de física en el canvas (siempre visible, también en móviles). */
function drawPhysicsReadout(ctx) {
  const c = G.cannon;
  if (!c) return;
  ctx.save();
  roundRect(ctx, 14, 14, 360, 104, 12);
  ctx.fillStyle = 'rgba(43,29,14,0.82)'; ctx.fill();
  ctx.strokeStyle = '#e8b53e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px Nunito, sans-serif';
  ctx.fillStyle = '#e8b53e';
  ctx.fillText(`CAÑÓN  M = ${c.M} kg · L = ${c.L} m · τ = ${fmt(c.tau)} N·m`, 26, 38);
  ctx.fillStyle = '#f4e4c1';
  if (c.solved) {
    ctx.fillText(`I = ⅓·M·L² = ${fmt(c.I)} kg·m²`, 26, 62);
    ctx.fillText(`α = τ/I = ${fmt(c.tau)}/${fmt(c.I)} = ${fmt(c.tau / c.I)} rad/s²`, 26, 84);
  } else {
    ctx.fillText('I = ¿?   α = ¿?   (resuelve el desafío)', 26, 62);
    ctx.fillText('🔒 Cañón bloqueado', 26, 84);
  }
  ctx.fillStyle = '#9fe3ff';
  ctx.fillText(`θ = ${fmt(c.theta / DEG, 1)}°   ω = ${fmt(c.omega, 2)} rad/s   α actual = ${fmt(c.alphaNow, 2)}`, 26, 106);
  ctx.restore();
}

/** Etiquetas educativas: eje de rotación y longitud L. */
function drawAxisLabels(ctx, p, c) {
  const len = cannonLen(c);
  ctx.save();
  ctx.font = 'bold 14px Nunito, sans-serif';
  ctx.textAlign = 'center';
  // Eje
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(p.x - 6, p.y + 6); ctx.lineTo(p.x - 40, p.y + 46); ctx.stroke();
  roundRect(ctx, p.x - 112, p.y + 44, 112, 24, 8);
  ctx.fillStyle = 'rgba(43,29,14,0.85)'; ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.fillText('EJE DE ROTACIÓN', p.x - 56, p.y + 61);
  // Cota L paralela al cañón
  const nx = Math.sin(c.theta), ny = Math.cos(c.theta); // normal (hacia arriba-izquierda)
  const off = cannonThick(c) / 2 + 14;
  const ax = p.x - nx * off, ay = p.y - ny * off;
  const bx = ax + Math.cos(c.theta) * len, by = ay - Math.sin(c.theta) * len;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.fillText(`L = ${c.L} m`, (ax + bx) / 2 - nx * 14, (ay + by) / 2 - ny * 14);
  ctx.restore();
}

function drawAimGuide(ctx, p, c) {
  const len = cannonLen(c);
  const dx = Math.cos(c.theta), dy = -Math.sin(c.theta);
  const x0 = p.x + dx * len, y0 = p.y + dy * len;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let t = 0.04; t < 0.5; t += 0.035) {
    const x = x0 + dx * BALL_SPEED * t;
    const y = y0 + dy * BALL_SPEED * t + 0.5 * GRAVITY * t * t;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU_2PI); ctx.fill();
  }
}

function render() {
  const ctx = gctx;
  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-G.shake, G.shake) * 0.6, rand(-G.shake, G.shake) * 0.6);
  const horizon = SEA_Y - 50;
  drawSky(ctx, W, H, horizon);
  drawClouds(ctx, W, H, horizon, G.vt);
  drawIslands(ctx, horizon);
  drawSeaBack(ctx, W, H, SEA_Y, G.vt);

  // Enemigos
  for (const e of G.enemies) {
    if (e.kind === 'barrel') {
      drawBarrel(ctx, e.x, e.y + e.sink * 40, G.vt, e.alive ? 1 : Math.max(0, 1 - e.sink));
      continue;
    }
    const pal = e.kind === 'boss' ? PAL_BOSS : PAL_ENEMY;
    const sinkY = e.sink * 45, sinkTilt = e.sink * 0.22;
    drawShip(ctx, e.x, e.y + sinkY, e.scale, -1, pal, e.tilt + sinkTilt, G.vt + e.phase, e.flash, e.alive ? 1 : Math.max(0, 1 - e.sink / 3));
    if (e.alive) {
      const bw = e.kind === 'boss' ? 150 : 76;
      const by = e.y - 268 * e.scale;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(e.x - bw / 2, by, bw, 9);
      ctx.fillStyle = '#e74c3c'; ctx.fillRect(e.x - bw / 2 + 1, by + 1, (bw - 2) * (e.hp / e.maxHp), 7);
      if (e.kind === 'boss') {
        const n = G.cfg.bossChallenges.length;
        ctx.fillStyle = '#fff';
        for (let i = 1; i < n; i++) ctx.fillRect(e.x - bw / 2 + (bw * i) / n - 1, by, 2, 9);
        ctx.font = 'bold 15px Nunito, sans-serif'; ctx.textAlign = 'center';
        const label = `Buque insignia · Escudo ${Math.min(G.bossPhase + 1, n)}/${n}`;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(label, e.x, by - 6);
        ctx.fillText(label, e.x, by - 6);
      }
    }
  }

  // Jugador
  const tiltP = G.playerSink * 0.18;
  drawShip(ctx, PLAYER_X, G.shipY + G.playerSink * 40, PS, 1, PAL_PLAYER, Math.sin(G.vt * 1.2) * 0.015 + tiltP, G.vt);
  const c = G.cannon;
  if (c) {
    const p = playerPivot();
    if (G.cfg.aimGuide && c.unlocked && G.mode === 'battle') drawAimGuide(ctx, p, c);
    drawCannon(ctx, p.x, p.y, c.theta, cannonLen(c), cannonThick(c), c.recoil, { glow: G.level <= 2 || !c.unlocked });
    if (!c.unlocked && G.mode !== 'dead') {
      ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🔒', p.x + 4, p.y - 26);
    }
    if ((G.level <= 2 || !c.unlocked) && G.mode !== 'dead') drawAxisLabels(ctx, p, c);
  }

  for (const b of G.balls) drawBall(ctx, b, false);
  for (const b of G.enemyBalls) drawBall(ctx, b, true);
  drawSeaFront(ctx, W, H, SEA_Y, G.vt);
  drawParticles(ctx);
  drawTexts(ctx);
  ctx.restore();

  drawPhysicsReadout(ctx);
  if (G.level === 1 && G.mode === 'battle') {
    ctx.save();
    ctx.font = 'bold 18px Nunito, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, W / 2 - 230, H - 46, 460, 32, 10); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('Mantén ← / → para aplicar torque · ESPACIO para disparar', W / 2, H - 24);
    ctx.restore();
  }
}

/* ---------- Ilustración animada del menú ---------- */
const menuState = { balls: [], parts: [], fireT: 2 };
function renderMenu(dt) {
  const ctx = mctx, w = menuCanvas.width, h = menuCanvas.height, base = 250, t = G.vt;
  drawSky(ctx, w, h, base - 50);
  for (const c of CLOUDS.slice(0, 4)) drawCloud(ctx, ((c.x0 * 0.5 + t * c.sp) % (w + 300)) - 150, c.y * 150, c.s * 0.6);
  drawSeaBack(ctx, w, h, base, t);
  const ey = waveY(590, t, base);
  drawShip(ctx, 590, ey, 0.42, -1, PAL_ENEMY, Math.sin(t * 1.3) * 0.03, t);
  const sy = waveY(200, t, base) - 3;
  drawShip(ctx, 200, sy, 0.62, 1, PAL_PLAYER, Math.sin(t * 1.2) * 0.02, t);
  const theta = (25 + Math.sin(t * 0.9) * 18) * DEG;
  const px = 200 + 62 * 0.62, py = sy - 62 * 0.62;
  drawCannon(ctx, px, py, theta, 70, 16, 0, { glow: true });

  // Disparos decorativos
  menuState.fireT -= dt;
  if (menuState.fireT <= 0) {
    menuState.fireT = 2.4;
    const dx = Math.cos(theta), dy = -Math.sin(theta);
    menuState.balls.push({ x: px + dx * 70, y: py + dy * 70, vx: dx * 420, vy: dy * 420 });
    for (let i = 0; i < 8; i++) menuState.parts.push({ x: px + dx * 70, y: py + dy * 70, vx: rand(-30, 60), vy: rand(-50, 0), life: 1, max: 1, s: rand(5, 10), smoke: true });
  }
  for (const b of menuState.balls) {
    b.vy += 300 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y > waveY(b.x, t, base)) {
      b.dead = true;
      for (let i = 0; i < 10; i++) menuState.parts.push({ x: b.x, y: b.y, vx: rand(-60, 60), vy: rand(-180, -60), life: 0.7, max: 0.7, s: rand(2, 4), g: 500 });
    }
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, TAU_2PI); ctx.fill();
  }
  menuState.balls = menuState.balls.filter((b) => !b.dead);
  for (const p of menuState.parts) {
    p.life -= dt; if (p.g) p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    const k = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.smoke ? `rgba(220,220,220,${k * 0.6})` : `rgba(220,245,255,${k})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.smoke ? p.s + (1 - k) * 10 : p.s, 0, TAU_2PI); ctx.fill();
  }
  menuState.parts = menuState.parts.filter((p) => p.life > 0);
  drawSeaFront(ctx, w, h, base, t);
}

/* ---------- Laboratorio de la pantalla de teoría ---------- */
const Lab = { theta: 0, omega: 0, hold: 0 };
function labValues() {
  const M = Number($('lab-M').value), L = Number($('lab-L').value), tau = Number($('lab-tau').value);
  const I = Physics.inertia(M, L);
  return { M, L, tau, I, alpha: Physics.alpha(tau, I) };
}
function labUpdateText() {
  const v = labValues();
  $('lab-M-v').textContent = `${v.M} kg`;
  $('lab-L-v').textContent = `${v.L} m`;
  $('lab-tau-v').textContent = `${v.tau} N·m`;
  $('lab-I').textContent = `${fmt(v.I)} kg·m²`;
  $('lab-alpha').textContent = `${fmt(v.alpha)} rad/s²`;
  $('lab-t').textContent = `${fmt(Physics.timeToRotate(Math.PI / 2, v.alpha))} s`;
  Lab.theta = 0; Lab.omega = 0; Lab.hold = 0.3;
}
function labTick(dt) {
  const v = labValues();
  if (Lab.hold > 0) {
    Lab.hold -= dt;
    if (Lab.hold <= 0 && Lab.theta >= Math.PI / 2) { Lab.theta = 0; Lab.omega = 0; Lab.hold = 0.3; }
  } else {
    Lab.omega += v.alpha * dt;
    Lab.theta += Lab.omega * dt;
    if (Lab.theta >= Math.PI / 2) { Lab.theta = Math.PI / 2; Lab.hold = 0.9; }
  }
  const ctx = lctx, w = labCanvas.width, h = labCanvas.height;
  ctx.fillStyle = '#fbf1da'; ctx.fillRect(0, 0, w, h);
  const px = 60, py = 255;
  ctx.strokeStyle = 'rgba(91,58,30,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(px, py, 230, -Math.PI / 2, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 240, py); ctx.moveTo(px, py); ctx.lineTo(px, py - 240); ctx.stroke();
  const len = 26 + v.L * 42, th = 4 + v.M * 0.8;
  ctx.save(); ctx.translate(px, py); ctx.rotate(-Lab.theta);
  ctx.fillStyle = '#3d4651'; ctx.fillRect(0, -th / 2, len, th);
  ctx.restore();
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px, py, 36, -Lab.theta, 0); ctx.stroke();
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(px, py, 8, 0, TAU_2PI); ctx.fill();
  ctx.fillStyle = '#7a5a10'; ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU_2PI); ctx.fill();
  ctx.fillStyle = '#2b1d0e'; ctx.font = 'bold 15px Nunito, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`θ = ${fmt(Lab.theta / DEG, 0)}°`, 300, 40);
  ctx.fillText(`ω = ${fmt(Lab.omega, 2)} rad/s`, 300, 62);
  ctx.fillText(`α = ${fmt(v.alpha, 2)} rad/s²`, 300, 84);
  ctx.fillText('Eje', px - 30, py + 28);
}

/* ==========================================================
   12. INTERFAZ: HUD, TOAST, MODALES
   ========================================================== */
const overlay = $('overlay');
const modal = $('modal');
const pauseOverlay = $('pause-overlay');

function updateHUD() {
  $('hud-level').textContent = G.level;
  $('hud-level-name').textContent = G.cfg ? G.cfg.name : '';
  $('hud-score').textContent = G.score;
  $('hud-lives').textContent = '❤'.repeat(Math.max(0, G.lives)) + '♡'.repeat(Math.max(0, 3 - G.lives));
  $('bar-player').style.width = `${clamp(G.playerHP, 0, 100)}%`;
  $('bar-enemy').style.width = `${clamp(enemyHpFraction() * 100, 0, 100)}%`;
}

let hudAccum = 0;
let lastTimeText = '';
function hudTick(dt) {
  const tt = fmtTime(G.levelTime);
  if (tt !== lastTimeText) { $('hud-time').textContent = tt; lastTimeText = tt; }
  hudAccum += dt;
  if (hudAccum < 0.1) return;
  hudAccum = 0;
  const c = G.cannon;
  if (!c) return;
  $('lp-M').textContent = `${c.M} kg`;
  $('lp-L').textContent = `${c.L} m`;
  $('lp-tau').textContent = `${fmt(c.tau)} N·m`;
  $('lp-I').textContent = c.solved ? `${fmt(c.I)} kg·m²` : '¿?';
  $('lp-alpha').textContent = c.solved ? `${fmt(c.tau / c.I)} rad/s²` : '¿?';
  $('lp-theta').textContent = `${fmt(c.theta / DEG, 1)}°`;
  $('lp-omega').textContent = `${fmt(c.omega, 2)} rad/s`;
  $('lp-state').textContent = G.paused ? 'Pausa' : c.state;
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function addScore(pts, x, y, label) {
  G.score = Math.max(0, G.score + pts);
  if (label && x !== undefined) addText(label, x, y);
}

function openModal(html, cls = '') {
  modal.className = 'modal ' + cls;
  modal.innerHTML = html;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  G.modalOpen = true;
  keys.left = keys.right = false;
  modal.scrollTop = 0;
}
function closeModal() {
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  G.modalOpen = false;
}
/** Asocia un clic a un elemento del modal (si existe). */
function bind(id, fn) {
  const el = $(id);
  if (el) el.addEventListener('click', (ev) => { Sound.play('click'); fn(ev); });
}

function dataTable(rows) {
  return `<table class="data-table">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
}
/** Boceto SVG del cañón (barra) con su eje en el extremo. */
function cannonSketch(M, L) {
  const len = 30 + L * 40, th = 6 + Math.min(M, 20) * 0.9;
  return `<svg class="sketch" viewBox="0 0 220 70" aria-hidden="true">
    <rect x="18" y="${35 - th / 2}" width="${len}" height="${th}" rx="3" fill="#7b8794"/>
    <circle cx="18" cy="35" r="7" fill="#ffd166"/><circle cx="18" cy="35" r="2.5" fill="#7a5a10"/>
    <line x1="18" y1="${44 + th / 2}" x2="${18 + len}" y2="${44 + th / 2}" stroke="#f4e4c1" stroke-dasharray="4 3"/>
    <text x="${18 + len / 2}" y="${60 + th / 2}" fill="#f4e4c1" font-size="11" text-anchor="middle">L = ${L} m</text>
    <text x="4" y="14" fill="#ffd166" font-size="10">eje</text>
  </svg>`;
}
const F_I = 'I = <sup>1</sup>&frasl;<sub>3</sub> · M · L²';
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

/* ==========================================================
   13. GENERADOR DE EJERCICIOS (valores aleatorios, resultados exactos)
   ========================================================== */
/** Torque "redondo" que produce una α jugable (0,8 – 2,5 rad/s²). */
function niceTau(I) {
  const a = pick([0.8, 1, 1.2, 1.5, 2, 2.5]);
  return Math.max(0.5, Math.round(I * a * 10) / 10);
}
function inertiaProc(M, L, I) {
  return [
    `L² = (${L} m)² = ${fmt(L * L, 4)} m²`,
    `M · L² = ${M} kg × ${fmt(L * L, 4)} m² = ${fmt(M * L * L, 4)} kg·m²`,
    `I = ${fmt(M * L * L, 4)} ÷ 3 = <b>${fmt(I, 4)} kg·m²</b>`,
  ];
}
function inertiaPhysics(M, L, I) {
  return `<p>Un momento de inercia de <b>${fmt(I)} kg·m²</b> indica cuánto se resiste el cañón a cambiar su rotación alrededor del eje de su base.</p>
    <p>Si el cañón fuera el doble de largo (${fmt(2 * L)} m), I sería <b>4 veces mayor</b> (${fmt(4 * I)} kg·m²) porque L está al cuadrado; si tuviera el doble de masa, I solo se <b>duplicaría</b> (${fmt(2 * I)} kg·m²).</p>`;
}
function alphaPhysics(tau, I) {
  const a = tau / I;
  return `<p>Con un torque de ${fmt(tau)} N·m, la velocidad angular del cañón aumenta <b>${fmt(a)} rad/s cada segundo</b>. Desde el reposo, girar 30° (π/6 rad) le toma t = √(2θ/α) = <b>${fmt(Physics.timeToRotate(Math.PI / 6, a))} s</b>.</p>
    <p>Unidades: N·m ÷ kg·m² = 1/s² = rad/s². Si I fuera el doble, α sería la mitad con el mismo torque.</p>`;
}

const EXERCISES = {
  /* --- Calcular I --- */
  inertia() {
    const M = randInt(2, 12), L = pick(L_VALUES);
    const I = Physics.inertia(M, L), tau = niceTau(I);
    return {
      type: 'inertia', title: 'Calcula el momento de inercia', cannon: { M, L, tau },
      data: [['Masa (M)', `${M} kg`], ['Longitud (L)', `${L} m`], ['Eje de rotación', 'Extremo (base)']],
      prompt: 'Tu cañón es una <b>barra uniforme</b> que gira alrededor de un eje perpendicular situado en su base. Calcula su <b>momento de inercia I</b>.',
      fields: [{ label: 'I =', unit: 'kg·m²', correct: I }],
      hint: 'Usa I = ⅓·M·L². Primero eleva la longitud al cuadrado, luego multiplica por la masa y divide entre 3.',
      steps: [
        { t: 'Fórmula utilizada', h: `<div class="eq">${F_I}</div><p>Barra uniforme que gira alrededor de un eje perpendicular en uno de sus extremos.</p>` },
        { t: 'Valores reemplazados', h: `<div class="eq">I = ⅓ · (${M} kg) · (${L} m)²</div>` },
        { t: 'Procedimiento', h: ul(inertiaProc(M, L, I)) },
        { t: 'Resultado', h: `<div class="eq result">I = ${fmt(I)} kg·m²</div>` },
        { t: 'Explicación física', h: inertiaPhysics(M, L, I) + `<p>Este cañón aplica τ = ${fmt(tau)} N·m, así que girará con α = τ/I = <b>${fmt(tau / I)} rad/s²</b>.</p>` },
      ],
    };
  },

  /* --- Calcular I y α --- */
  alpha() {
    const M = randInt(2, 12), L = pick(L_VALUES);
    const I = Physics.inertia(M, L), tau = niceTau(I), a = tau / I;
    return {
      type: 'alpha', title: 'Momento de inercia y aceleración angular', cannon: { M, L, tau },
      data: [['Masa (M)', `${M} kg`], ['Longitud (L)', `${L} m`], ['Torque aplicado (τ)', `${fmt(tau)} N·m`], ['Eje de rotación', 'Extremo (base)']],
      prompt: 'Calcula el <b>momento de inercia</b> del cañón y determina la <b>aceleración angular</b> que produce el torque disponible.',
      fields: [{ label: 'I =', unit: 'kg·m²', correct: I }, { label: 'α =', unit: 'rad/s²', correct: a }],
      hint: 'Primero I = ⅓·M·L². Luego, de τ = I·α, despeja α = τ / I.',
      steps: [
        { t: 'Fórmulas utilizadas', h: `<div class="eq">${F_I}</div> &nbsp; <div class="eq">τ = I · α &nbsp;⟹&nbsp; α = τ / I</div>` },
        { t: 'Valores reemplazados', h: `<div class="eq">I = ⅓ · (${M} kg) · (${L} m)²</div><br><div class="eq">α = ${fmt(tau)} N·m ÷ I</div>` },
        { t: 'Procedimiento', h: ul(inertiaProc(M, L, I).concat([`α = ${fmt(tau)} ÷ ${fmt(I, 4)} = <b>${fmt(a, 4)} rad/s²</b>`])) },
        { t: 'Resultado', h: `<div class="eq result">I = ${fmt(I)} kg·m²</div> &nbsp; <div class="eq result">α = ${fmt(a)} rad/s²</div>` },
        { t: 'Explicación física', h: alphaPhysics(tau, I) },
      ],
    };
  },

  /* --- Calcular I y el torque necesario --- */
  torque() {
    const M = randInt(2, 12), L = pick(L_VALUES);
    const I = Physics.inertia(M, L), a = pick([0.8, 1, 1.2, 1.5, 2, 2.5]), tau = Physics.torque(I, a);
    return {
      type: 'torque', title: 'Torque necesario', cannon: { M, L, tau },
      data: [['Masa (M)', `${M} kg`], ['Longitud (L)', `${L} m`], ['α deseada', `${a} rad/s²`], ['Eje de rotación', 'Extremo (base)']],
      prompt: `Para seguir al buque insignia necesitas que el cañón gire con <b>α = ${a} rad/s²</b>. Calcula su momento de inercia y el <b>torque necesario</b>.`,
      fields: [{ label: 'I =', unit: 'kg·m²', correct: I }, { label: 'τ =', unit: 'N·m', correct: tau }],
      hint: 'Calcula I = ⅓·M·L² y luego usa directamente τ = I·α.',
      steps: [
        { t: 'Fórmulas utilizadas', h: `<div class="eq">${F_I}</div> &nbsp; <div class="eq">τ = I · α</div>` },
        { t: 'Valores reemplazados', h: `<div class="eq">I = ⅓ · (${M} kg) · (${L} m)²</div><br><div class="eq">τ = I · (${a} rad/s²)</div>` },
        { t: 'Procedimiento', h: ul(inertiaProc(M, L, I).concat([`τ = ${fmt(I, 4)} kg·m² × ${a} rad/s² = <b>${fmt(tau, 4)} N·m</b>`])) },
        { t: 'Resultado', h: `<div class="eq result">I = ${fmt(I)} kg·m²</div> &nbsp; <div class="eq result">τ = ${fmt(tau)} N·m</div>` },
        { t: 'Explicación física', h: `<p>Para lograr la misma aceleración angular, un cañón con mayor momento de inercia necesita <b>más torque</b>: τ crece en proporción directa a I.</p><p>Si este cañón fuera el doble de largo, necesitaría ${fmt(4 * tau)} N·m (4 veces más) para conseguir la misma α.</p>` },
      ],
    };
  },

  /* --- Despejar la longitud --- */
  length() {
    const M = 3 * randInt(1, 4), L = pick(L_VALUES);
    const I = Physics.inertia(M, L), tau = niceTau(I);
    return {
      type: 'length', title: 'Despeja la longitud del cañón', cannon: { M, L, tau },
      data: [['Masa (M)', `${M} kg`], ['Momento de inercia (I)', `${fmt(I)} kg·m²`], ['Torque (τ)', `${fmt(tau)} N·m`], ['Eje de rotación', 'Extremo (base)']],
      prompt: 'El último cañón de la armería perdió su etiqueta de longitud. Con su masa y su momento de inercia, <b>calcula su longitud L</b>.',
      fields: [{ label: 'L =', unit: 'm', correct: L }],
      hint: 'Despeja de I = ⅓·M·L²: multiplica por 3, divide entre M y saca raíz cuadrada → L = √(3I/M).',
      steps: [
        { t: 'Fórmula utilizada', h: `<div class="eq">${F_I} &nbsp;⟹&nbsp; L² = 3I / M &nbsp;⟹&nbsp; L = √(3I / M)</div>` },
        { t: 'Valores reemplazados', h: `<div class="eq">L = √( 3 · ${fmt(I)} kg·m² ÷ ${M} kg )</div>` },
        { t: 'Procedimiento', h: ul([`3 · I = 3 × ${fmt(I)} = ${fmt(3 * I, 4)} kg·m²`, `3I / M = ${fmt(3 * I, 4)} ÷ ${M} = ${fmt(L * L, 4)} m²`, `L = √${fmt(L * L, 4)} = <b>${fmt(L)} m</b>`]) },
        { t: 'Resultado', h: `<div class="eq result">L = ${fmt(L)} m</div>` },
        { t: 'Explicación física', h: `<p>Comprobación: I = ⅓ · ${M} · (${fmt(L)})² = ${fmt(I)} kg·m² ✔.</p><p>Como I depende de L², la longitud se obtiene con una <b>raíz cuadrada</b>: si I se multiplicara por 4, la longitud solo se duplicaría.</p>` },
      ],
    };
  },

  /* --- Selección del cañón con menor I --- */
  select() {
    let opts = [];
    for (let tries = 0; tries < 300; tries++) {
      opts = [0, 1, 2].map(() => {
        const M = randInt(2, 14), L = pick(L_VALUES);
        return { M, L, I: Physics.inertia(M, L) };
      });
      const Is = opts.map((o) => o.I).sort((a, b) => a - b);
      const inRange = Is[0] >= 1.5 && Is[2] <= 80;
      const gap = Is[1] > Is[0] * 1.15;
      const best = opts.reduce((a, b) => (a.I <= b.I ? a : b));
      const lightest = opts.reduce((a, b) => (a.M <= b.M ? a : b));
      const tricky = lightest !== best; // el más liviano no siempre es el mejor
      if (inRange && gap && (tricky || tries > 150)) break;
    }
    const names = ['A', 'B', 'C'];
    opts.forEach((o, i) => { o.name = names[i]; });
    const bestIdx = opts.reduce((bi, o, i, arr) => (o.I < arr[bi].I ? i : bi), 0);
    const tau = Math.max(1, Math.round(opts[bestIdx].I * pick([1.5, 2, 2.5])));
    opts.forEach((o) => { o.alpha = tau / o.I; });
    return { type: 'select', title: 'Selecciona el mejor cañón', opts, bestIdx, tau };
  },
};

/* ==========================================================
   14. DESAFÍOS (render, validación, explicación)
   ========================================================== */
function startChallenge(type, onSuccess, isRetry = false) {
  if (!isRetry) G.challengeAttempts = 0;
  G.mode = 'challenge';
  if (G.cannon) { G.cannon.unlocked = false; G.cannon.omega = 0; }
  const ex = EXERCISES[type]();
  if (type === 'select') renderSelect(ex, onSuccess);
  else {
    G.cannon = newCannon(ex.cannon, false); // el cañón visible ya tiene las nuevas M y L
    renderNumeric(ex, onSuccess);
  }
}

function phaseTag() {
  const base = `Nivel ${G.level}`;
  return G.level === 5 ? `${base} · Escudo ${G.bossPhase + 1}/${G.cfg.bossChallenges.length}` : base;
}

function renderNumeric(ex, onSuccess) {
  const fieldsHTML = ex.fields.map((f, i) => `
    <label class="field" for="ans-${i}">
      <span class="f-label">${f.label}</span>
      <input id="ans-${i}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="Ej: 4.5">
      <span class="f-unit">${f.unit}</span>
    </label>`).join('');

  openModal(`
    <div class="panel-head"><span class="tag">${phaseTag()}</span><h2>📜 ${ex.title}</h2></div>
    <div class="phys-grid">
      <div class="data-box"><h3>DATOS DEL CAÑÓN</h3>${dataTable(ex.data)}${cannonSketch(ex.cannon.M, ex.cannon.L)}</div>
      <div class="challenge-box">
        <h3>DESAFÍO</h3>
        <p class="prompt">${ex.prompt}</p>
        <div class="fields">${fieldsHTML}</div>
        <p class="note">Puedes usar punto o coma decimal. Redondea a 2 decimales.</p>
        <p id="ans-msg" class="msg" role="alert"></p>
        <div class="row"><button class="btn small ghost" id="m-hint">💡 Pista</button><button class="btn" id="m-check">✔ Verificar</button></div>
        <div id="m-hintbox" class="hint hidden">${ex.hint}</div>
      </div>
    </div>`, 'wide');

  if (!('ontouchstart' in window)) setTimeout(() => { const f = $('ans-0'); if (f) f.focus(); }, 120);
  bind('m-hint', () => $('m-hintbox').classList.toggle('hidden'));

  const check = () => {
    const vals = [];
    let invalid = -1;
    ex.fields.forEach((f, i) => {
      const inp = $(`ans-${i}`);
      inp.classList.remove('bad');
      const v = parseAnswer(inp.value);
      if (isNaN(v)) { if (invalid < 0) invalid = i; inp.classList.add('bad'); }
      vals.push(v);
    });
    const msg = $('ans-msg');
    if (invalid >= 0) {
      msg.textContent = `Ingresa un número válido en "${ex.fields[invalid].label.replace(' =', '')}" (por ejemplo 4.5 o 4,5).`;
      $(`ans-${invalid}`).focus();
      return;
    }
    const negIdx = vals.findIndex((v) => v <= 0);
    if (negIdx >= 0) {
      msg.textContent = 'Estas magnitudes deben ser positivas. Revisa tu respuesta.';
      $(`ans-${negIdx}`).classList.add('bad');
      return;
    }
    const results = ex.fields.map((f, i) => isCorrect(vals[i], f.correct));
    const ok = results.every(Boolean);
    const answersHTML = ex.fields.map((f, i) => `
      <div class="ans-row ${results[i] ? 'good' : 'bad'}">
        <span>${f.label} tu respuesta: <b>${fmt(vals[i], 4)} ${f.unit}</b></span>
        <span>${results[i] ? '✔ Correcto' : `✘ Valor correcto: <b>${fmt(f.correct)} ${f.unit}</b>`}</span>
      </div>`).join('');
    registerAnswer(ok);
    showSolution(ex.steps, ok, answersHTML,
      () => { G.cannon = newCannon(ex.cannon, true); onSuccess(); },
      () => startChallenge(ex.type, onSuccess, true));
  };
  bind('m-check', check);
  ex.fields.forEach((f, i) => {
    $(`ans-${i}`).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
  });
}

function renderSelect(ex, onSuccess) {
  const cards = ex.opts.map((o, i) => {
    const len = 30 + o.L * 26, th = 6 + o.M * 1.1;
    return `<button class="cannon-card" data-idx="${i}">
      <h4>Cañón ${o.name}</h4>
      <svg class="sketch" viewBox="0 0 150 50" aria-hidden="true">
        <rect x="14" y="${25 - th / 2}" width="${len}" height="${th}" rx="3" fill="#3d4651"/>
        <circle cx="14" cy="25" r="6" fill="#ffd166"/>
      </svg>
      <p>Masa: ${o.M} kg</p><p>Longitud: ${o.L} m</p>
    </button>`;
  }).join('');
  openModal(`
    <div class="panel-head"><span class="tag">${phaseTag()}</span><h2>🛠️ ${ex.title}</h2></div>
    <div class="challenge-box">
      <h3>DESAFÍO</h3>
      <p class="prompt">Todos los cañones giran alrededor de un eje en su base y reciben el <b>mismo torque: τ = ${ex.tau} N·m</b>. Elige el cañón con el <b>menor momento de inercia</b> para obtener la <b>mayor aceleración angular</b>.</p>
      <div class="cannon-cards">${cards}</div>
      <div class="row"><button class="btn small ghost" id="m-hint">💡 Pista</button></div>
      <div id="m-hintbox" class="hint hidden">Calcula I = ⅓·M·L² para cada uno. ¡Ojo! La longitud está al cuadrado: un cañón liviano pero largo puede tener más inercia que uno pesado y corto.</div>
    </div>`, 'wide');
  bind('m-hint', () => $('m-hintbox').classList.toggle('hidden'));

  modal.querySelectorAll('.cannon-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-idx'));
      const ok = idx === ex.bestIdx;
      registerAnswer(ok);
      const best = ex.opts[ex.bestIdx];
      const picked = ex.opts[idx];
      const lightest = ex.opts.reduce((a, b) => (a.M <= b.M ? a : b));
      const rows = ex.opts.map((o, i) => `<tr class="${i === ex.bestIdx ? 'best' : ''} ${i === idx ? 'picked' : ''}">
        <td>${o.name}</td><td>${o.M}</td><td>${o.L}</td><td>${fmt(o.L * o.L, 4)}</td><td>${fmt(o.I)}</td><td>${fmt(o.alpha)}</td></tr>`).join('');
      const second = ex.opts.filter((o) => o !== best).reduce((a, b) => (a.I <= b.I ? a : b));
      let insight =`<p>Con el mismo torque, α = τ/I: <b>el cañón con menor I acelera más</b>. El cañón ${best.name} logra α = ${fmt(best.alpha)} rad/s², ${fmt(best.alpha / second.alpha)} veces la del cañón ${second.name}.</p>`;
      if (lightest !== best) {
        insight += `<p>Fíjate: el cañón ${lightest.name} es el más liviano (${lightest.M} kg), pero al medir ${lightest.L} m su L² = ${fmt(lightest.L * lightest.L, 4)} hace que I = ${fmt(lightest.I)} kg·m². <b>La longitud pesa más que la masa</b> porque está al cuadrado.</p>`;
      } else {
        insight += '<p>Aquí el cañón más liviano también es el de menor inercia, pero recuerda que la longitud, al estar al cuadrado, suele ser el factor decisivo.</p>';
      }
      if (!ok) insight += `<p>Elegiste el cañón ${picked.name} (I = ${fmt(picked.I)} kg·m²), que tiene más inercia que el ${best.name}.</p>`;
      const steps = [
        { t: 'Fórmulas utilizadas', h: `<div class="eq">${F_I}</div> &nbsp; <div class="eq">α = τ / I</div>` },
        { t: 'Valores reemplazados', h: ul(ex.opts.map((o) => `Cañón ${o.name}: I = ⅓ · (${o.M} kg) · (${o.L} m)²`)) },
        { t: 'Procedimiento', h: `<table class="cmp-table"><tr><th>Cañón</th><th>M (kg)</th><th>L (m)</th><th>L² (m²)</th><th>I (kg·m²)</th><th>α = ${ex.tau}/I (rad/s²)</th></tr>${rows}</table>` },
        { t: 'Resultado', h: `<div class="eq result">Mejor opción: Cañón ${best.name} → I = ${fmt(best.I)} kg·m², α = ${fmt(best.alpha)} rad/s²</div>` },
        { t: 'Explicación física', h: insight },
      ];
      const answersHTML = `<div class="ans-row ${ok ? 'good' : 'bad'}"><span>Elegiste: <b>Cañón ${picked.name}</b></span><span>${ok ? '✔ ¡El más ágil!' : `✘ El mejor era el <b>Cañón ${best.name}</b>`}</span></div>`;
      showSolution(steps, ok, answersHTML,
        () => { G.cannon = newCannon({ M: best.M, L: best.L, tau: ex.tau }, true); onSuccess(); },
        () => startChallenge('select', onSuccess, true));
    });
  });
}

/** Registra puntuación y estadísticas de una respuesta. */
function registerAnswer(ok) {
  if (ok) {
    G.stats.correct++;
    const bonus = G.challengeAttempts === 0 ? 50 : 0;
    addScore(100 + bonus);
    G.lastBonus = bonus;
    Sound.play('correct');
    celebrate();
  } else {
    G.stats.wrong++;
    G.challengeAttempts++;
    G.levelMistakes++;
    addScore(-20);
    Sound.play('wrong');
    G.shake = 6;
  }
  updateHUD();
}

/** Muestra fórmula, sustitución, procedimiento, resultado y explicación física. */
function showSolution(steps, ok, answersHTML, onGo, onRetry) {
  const stepsHTML = steps.map((s, i) => `
    <div class="step"><div class="step-num">${i + 1}</div>
      <div><h4>${s.t}</h4><div class="step-body">${s.h}</div></div></div>`).join('');
  const headMsg = ok
    ? `+100 puntos${G.lastBonus ? ' y +50 por acertar al primer intento' : ''}. ¡El cañón queda desbloqueado!`
    : 'Revisa el procedimiento. Pierdes 20 puntos, pero puedes intentarlo de nuevo con datos nuevos.';
  openModal(`
    <div class="sol-head ${ok ? 'ok' : 'ko'}"><h2>${ok ? '✅ ¡Correcto, capitán!' : '❌ Respuesta incorrecta'}</h2><p>${headMsg}</p></div>
    <div class="answers">${answersHTML}</div>
    <h3 class="sec-title">Solución paso a paso</h3>
    <div class="steps">${stepsHTML}</div>
    <div class="row center">${ok ? '<button class="btn big" id="m-go">⚓ ¡A los cañones!</button>' : '<button class="btn big" id="m-retry">🔄 Intentar de nuevo</button>'}</div>`, 'wide');
  if (ok) G.lastSolution = stepsHTML;
  bind('m-go', onGo);
  bind('m-retry', onRetry);
}

function startBattle() {
  closeModal();
  G.mode = 'battle';
  G.cannon.unlocked = true;
  G.cannon.solved = true;
  G.cannon.omega = 0;
  G.spawnTimer = 1.5;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  Sound.play('unlock');
  showToast(`🔓 Cañón desbloqueado · α = ${fmt(G.cannon.tau / G.cannon.I)} rad/s² · ← → para girar, ESPACIO para disparar`);
  updateHUD();
}

/* ==========================================================
   15. FLUJO DE NIVELES
   ========================================================== */
function startLevel(n) {
  closeModal();
  hidePause();
  G.level = n;
  G.cfg = LEVELS[n];
  G.levelStartScore = G.score;
  G.levelTime = 0;
  G.levelMistakes = 0;
  G.playerHP = 100;
  G.playerSink = 0;
  G.enemies = []; G.balls = []; G.enemyBalls = []; G.particles = []; G.texts = []; G.queue = [];
  G.bossPhase = 0; G.lastSolution = ''; G.spawnTimer = 1.5; G.shake = 0;
  G.cannon = null;
  G.cannon = newCannon({ M: 5, L: 2, tau: 10 }, false);
  const c = G.cfg;
  if (c.targets) c.targets.forEach((x, i) => G.enemies.push({ kind: 'barrel', x, y: SEA_Y, hp: 1, maxHp: 1, alive: true, sink: 0, flash: 0, phase: i }));
  if (c.fleet) {
    const f = c.fleet;
    for (let i = 0; i < f.count; i++) G.queue.push({ range: f.ranges[i % f.ranges.length], speed: rand(f.speed[0], f.speed[1]), hp: f.hp, scale: f.scale });
    for (let i = 0; i < f.maxAlive && G.queue.length; i++) G.enemies.push(makeShip(G.queue.shift(), true));
  }
  if (c.boss) {
    const b = c.boss;
    const boss = makeShip({ range: b.range, speed: b.speed, hp: b.hp, scale: b.scale }, true);
    boss.kind = 'boss';
    G.enemies.push(boss);
  }
  G.enemyMaxHp = G.enemies.reduce((s, e) => s + e.hp, 0) + G.queue.reduce((s, q) => s + q.hp, 0);
  G.mode = 'intro';
  G.paused = false;
  updateHUD();
  showLevelIntro();
}

function showLevelIntro() {
  const c = G.cfg;
  openModal(`
    <div class="level-intro">
      <div class="level-badge">NIVEL ${G.level} DE 5</div>
      <h2>${c.icon} ${c.name}</h2>
      <p>${c.desc}</p>
      <ul class="goals">${c.goals.map((g) => `<li>${g}</li>`).join('')}</ul>
      <div class="row center">
        ${c.tutorial ? '<button class="btn ghost" id="m-skip">Saltar tutorial</button>' : ''}
        <button class="btn big" id="m-start">¡Comenzar!</button>
      </div>
    </div>`);
  bind('m-start', () => { if (c.tutorial) showTutorial(0); else beginLevelChallenge(); });
  bind('m-skip', beginLevelChallenge);
}

function beginLevelChallenge() {
  const type = G.level === 5 ? G.cfg.bossChallenges[0] : G.cfg.challenge;
  startChallenge(type, startBattle);
}

/* ---------- Tutorial del nivel 1 ---------- */
const TUTORIAL = [
  {
    title: '¿Qué es el momento de inercia?',
    html: `<svg class="diagram" viewBox="0 0 320 150" aria-hidden="true">
        <path d="M60 110 A 150 150 0 0 1 150 30" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="5 4"/>
        <polygon points="150,30 138,30 146,40" fill="#c0392b"/>
        <rect x="60" y="102" width="220" height="16" rx="4" fill="#3d4651"/>
        <circle cx="60" cy="110" r="10" fill="#ffd166"/><circle cx="60" cy="110" r="3.5" fill="#7a5a10"/>
        <text x="42" y="140" font-size="13" fill="#2b1d0e" font-weight="700">Eje</text>
        <text x="170" y="96" font-size="13" fill="#2b1d0e" font-weight="700">L</text>
        <text x="200" y="140" font-size="12" fill="#2b1d0e">masa M repartida</text>
      </svg>
      <p>El <b>momento de inercia (I)</b> mide qué tan difícil es hacer girar un objeto (o detenerlo) alrededor de un eje. Es como la “masa” de las rotaciones.</p>
      <p>Tu cañón es una <b>barra uniforme</b> que gira alrededor de un eje perpendicular ubicado en su <b>base</b> (uno de sus extremos).</p>`,
  },
  {
    title: 'Las variables y el eje',
    html: `<div class="formula-box">I = ⅓ · M · L²</div>
      <ul>
        <li><b>I</b>: momento de inercia, en <b>kg·m²</b>.</li>
        <li><b>M</b>: masa del cañón, en <b>kg</b>.</li>
        <li><b>L</b>: longitud del cañón, en <b>m</b>, medida desde el eje.</li>
        <li><b>Eje de rotación</b>: el <b>punto dorado</b> en la base del cañón. Toda la barra gira a su alrededor.</li>
      </ul>
      <p>Más masa → más inercia. Más longitud → <b>mucha</b> más inercia, porque L está al cuadrado.</p>`,
  },
  {
    title: 'Ejemplo resuelto paso a paso',
    html: `<p><b>Datos:</b> M = 3 kg, L = 2 m.</p>
      <ol>
        <li>Fórmula: <span class="eq">${F_I}</span></li>
        <li>Reemplazamos: <span class="eq">I = ⅓ · (3) · (2)²</span></li>
        <li>Elevamos L al cuadrado: <span class="eq">(2)² = 4 m²</span></li>
        <li>Multiplicamos: <span class="eq">3 kg · 4 m² = 12 kg·m²</span></li>
        <li>Dividimos entre 3: <span class="eq">12 ÷ 3 = 4</span></li>
      </ol>
      <div class="formula-box">I = 4 kg·m²</div>`,
  },
  {
    title: 'Del momento de inercia al movimiento',
    html: `<div class="formula-box">τ = I · α &nbsp;⟹&nbsp; α = τ / I</div>
      <p>Cuando mantienes <b>←</b> o <b>→</b>, aplicas el torque τ del cañón y este acelera con <b>α = τ/I</b>. Al soltar, el freno aplica el mismo torque en sentido contrario.</p>
      <p>Por eso <b>tu cañón se mueve según su momento de inercia</b>: con un I grande gira y frena lentamente; con un I pequeño responde rápido.</p>
      <p>Ahora resuelve tu primer ejercicio para desbloquear el cañón. ¡Suerte, capitán!</p>`,
  },
];

function showTutorial(i) {
  const page = TUTORIAL[i];
  const dots = TUTORIAL.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
  const last = i === TUTORIAL.length - 1;
  openModal(`
    <div class="panel-head"><span class="tag">Tutorial ${i + 1}/${TUTORIAL.length}</span><h2>${page.title}</h2></div>
    <div class="tuto-body">${page.html}</div>
    <div class="tuto-dots">${dots}</div>
    <div class="row center">
      ${i > 0 ? '<button class="btn ghost" id="m-prev">⬅ Anterior</button>' : '<button class="btn ghost" id="m-skip">Saltar</button>'}
      <button class="btn" id="m-next">${last ? '📝 Resolver ejercicio' : 'Siguiente ➡'}</button>
    </div>`, 'wide');
  bind('m-prev', () => showTutorial(i - 1));
  bind('m-skip', beginLevelChallenge);
  bind('m-next', () => { if (last) beginLevelChallenge(); else showTutorial(i + 1); });
}

/* ---------- Fin de nivel ---------- */
function completeLevel() {
  G.mode = 'complete';
  if (G.cannon) G.cannon.unlocked = false;
  const base = 200;
  const timeBonus = Math.max(0, Math.round(400 - G.levelTime * 3));
  const hpBonus = Math.round(G.playerHP);
  const perfect = G.levelMistakes === 0 ? 150 : 0;
  addScore(base + timeBonus + hpBonus + perfect);
  G.stats.levelsCompleted = Math.max(G.stats.levelsCompleted, G.level);
  updateHUD();
  Sound.play('win');
  const last = G.level === 5;
  openModal(`
    <div class="level-intro">
      <div class="level-badge">NIVEL ${G.level} COMPLETADO</div>
      <h2>${last ? '🏆 ¡Derrotaste al buque insignia!' : '🎉 ¡Victoria, capitán!'}</h2>
      <table class="summary-table">
        <tr><td>Nivel completado</td><td>+${base}</td></tr>
        <tr><td>Bono de tiempo (${fmtTime(G.levelTime)})</td><td>+${timeBonus}</td></tr>
        <tr><td>Bono de vida (${Math.round(G.playerHP)}%)</td><td>+${hpBonus}</td></tr>
        <tr><td>Sin errores en los desafíos</td><td>${perfect ? '+' + perfect : '—'}</td></tr>
        <tr class="total"><td>Puntuación total</td><td>${G.score}</td></tr>
      </table>
      <div class="row center">
        <button class="btn big" id="m-next">${last ? '📊 Ver resultados' : 'Siguiente nivel ➡'}</button>
      </div>
    </div>`);
  bind('m-next', () => { if (last) { G.victory = true; showResults(true); } else startLevel(G.level + 1); });
}

/* ---------- Derrota ---------- */
function playerDies() {
  G.mode = 'dead';
  G.deadTimer = 2.4;
  if (G.cannon) G.cannon.unlocked = false;
  explosion(PLAYER_X, G.shipY - 80, true);
  Sound.play('bigboom');
  setTimeout(() => Sound.play('lose'), 500);
}

function showLifeLost() {
  G.mode = 'idle';
  G.lives--;
  updateHUD();
  if (G.lives > 0) {
    openModal(`
      <div class="level-intro">
        <h2>💥 ¡Tu barco ha sido hundido!</h2>
        <p>Pierdes una vida. Te quedan <b>${G.lives}</b> ${G.lives === 1 ? 'vida' : 'vidas'}.</p>
        <p class="small">Consejo: un cañón con menor α tarda más en girar. Empieza a mover el cañón antes y suelta la flecha un poco antes del ángulo deseado para que el freno lo detenga a tiempo.</p>
        <div class="row center"><button class="btn ghost" id="m-menu">🏠 Menú</button><button class="btn big" id="m-retry">↻ Reintentar nivel</button></div>
      </div>`);
    bind('m-retry', restartLevel);
    bind('m-menu', goMenu);
  } else {
    openModal(`
      <div class="level-intro">
        <h2>☠️ ¡Sin vidas!</h2>
        <p>La flota enemiga ganó esta batalla, pero no la guerra. Revisa tus resultados y continúa desde el nivel ${G.level}.</p>
        <div class="row center"><button class="btn big" id="m-res">📊 Ver resultados</button></div>
      </div>`);
    bind('m-res', () => showResults(false));
  }
}

function restartLevel() {
  G.score = G.levelStartScore;
  startLevel(G.level);
}

/* ---------- Resultados ---------- */
function showResults(victory) {
  closeModal();
  hidePause();
  G.mode = 'idle';
  const { correct, wrong, levelsCompleted, totalTime } = G.stats;
  const total = correct + wrong;
  const acc = total ? correct / total : 0;
  const pts = acc * 60 + (levelsCompleted / 5) * 40;
  let grade, label;
  if (pts >= 90) { grade = 'S'; label = 'Leyenda de los siete mares'; }
  else if (pts >= 80) { grade = 'A'; label = 'Capitán experto'; }
  else if (pts >= 65) { grade = 'B'; label = 'Contramaestre'; }
  else if (pts >= 50) { grade = 'C'; label = 'Grumete aplicado'; }
  else { grade = 'D'; label = 'Marinero en formación'; }
  $('res-title').textContent = victory ? '🏆 ¡Victoria total!' : '☠️ Fin de la batalla';
  $('res-grade').textContent = grade;
  $('res-grade-label').textContent = label;
  $('res-score').textContent = G.score;
  $('res-levels').textContent = `${levelsCompleted} / 5`;
  $('res-correct').textContent = correct;
  $('res-wrong').textContent = wrong;
  $('res-acc').textContent = `${Math.round(acc * 100)}%`;
  $('res-time').textContent = fmtTime(totalTime);
  $('res-note').textContent = `${grade} · ${fmt((pts / 100) * 5, 1)} / 5.0`;
  $('res-continue').classList.toggle('hidden', victory);
  $('res-continue-lvl').textContent = G.level;
  const best = Store.get('best', 0);
  if (G.score > best) Store.set('best', G.score);
  showScreen('results');
}

/* ==========================================================
   16. PAUSA, NAVEGACIÓN Y PANTALLAS
   ========================================================== */
function togglePause() {
  if (G.screen !== 'game' || G.mode === 'idle' || G.mode === 'complete') return;
  if (G.paused) hidePause(); else showPause();
}
function showPause() {
  G.paused = true;
  keys.left = keys.right = false;
  pauseOverlay.classList.add('show');
  pauseOverlay.setAttribute('aria-hidden', 'false');
}
function hidePause() {
  G.paused = false;
  pauseOverlay.classList.remove('show');
  pauseOverlay.setAttribute('aria-hidden', 'true');
}

function showDataPanel() {
  if (G.modalOpen || G.screen !== 'game' || !G.cannon || G.paused) return;
  const c = G.cannon;
  const a = c.tau / c.I;
  openModal(`
    <div class="panel-head"><span class="tag">Nivel ${G.level}</span><h2>📋 Panel de física</h2></div>
    <div class="phys-grid">
      <div class="data-box"><h3>DATOS DEL CAÑÓN</h3>${dataTable([
        ['Masa (M)', `${c.M} kg`], ['Longitud (L)', `${c.L} m`], ['Torque (τ)', `${fmt(c.tau)} N·m`],
        ['Momento de inercia (I)', c.solved ? `${fmt(c.I)} kg·m²` : '¿?'],
        ['Aceleración angular (α)', c.solved ? `${fmt(a)} rad/s²` : '¿?'],
      ])}${cannonSketch(c.M, c.L)}</div>
      <div class="challenge-box">
        <h3>CÓMO SE MUEVE TU CAÑÓN</h3>
        <p>Mantener <b>←</b> o <b>→</b> aplica τ = ${fmt(c.tau)} N·m. La aceleración angular es α = τ/I${c.solved ? ` = <b>${fmt(a)} rad/s²</b>` : ''}.</p>
        <p>Al soltar, el freno aplica el mismo torque en sentido contrario. Si giras durante un tiempo t y luego sueltas, el cañón recorre en total θ = α·t² (la mitad acelerando y la mitad frenando).</p>
        ${c.solved ? `<p>Desde el reposo, girar 30° acelerando todo el tiempo tarda t = √(2θ/α) = <b>${fmt(Physics.timeToRotate(Math.PI / 6, a))} s</b>.</p>` : ''}
      </div>
    </div>
    ${G.lastSolution ? `<h3 class="sec-title">Último desafío resuelto</h3><div class="steps">${G.lastSolution}</div>` : ''}
    <div class="row center"><button class="btn big" id="m-close">⚔️ Volver a la batalla</button></div>`, 'wide');
  bind('m-close', closeModal);
}

const fader = $('fader');
function showScreen(name) {
  fader.classList.add('on');
  setTimeout(() => {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    G.screen = name;
    if (name === 'game') { fitCanvas(); requestAnimationFrame(fitCanvas); }
    if (name === 'theory') labUpdateText();
    fader.classList.remove('on');
  }, 260);
}

function newGame() {
  Sound.init();
  G.score = 0;
  G.lives = 3;
  G.stats = { correct: 0, wrong: 0, levelsCompleted: 0, totalTime: 0 };
  G.victory = false;
  showScreen('game');
  startLevel(1);
}

function goMenu() {
  closeModal();
  hidePause();
  G.mode = 'idle';
  showScreen('menu');
}

/** Ajusta el canvas a 16:9 dentro del espacio disponible. */
function fitCanvas() {
  const stage = $('stage');
  const wrap = $('canvas-wrap');
  if (!stage || !wrap) return;
  const r = stage.getBoundingClientRect();
  const availW = r.width - 12, availH = r.height - 12;
  if (availW <= 0 || availH <= 0) return;
  let w = availW, h = (w * 9) / 16;
  if (h > availH) { h = availH; w = (h * 16) / 9; }
  wrap.style.width = `${Math.floor(w)}px`;
  wrap.style.height = `${Math.floor(h)}px`;
}

/* ==========================================================
   17. ENTRADAS (teclado, táctil, botones)
   ========================================================== */
function setupInput() {
  window.addEventListener('keydown', (e) => {
    if (G.screen !== 'game') return;
    const tag = e.target && e.target.tagName ? e.target.tagName : '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (e.key === 'Escape' || ((e.key === 'p' || e.key === 'P') && !typing)) { e.preventDefault(); togglePause(); return; }
    if (typing || G.modalOpen || G.paused) return;
    if (e.key === 'ArrowLeft') { keys.left = true; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { keys.right = true; e.preventDefault(); }
    else if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (!e.repeat) fireCannon(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    else if (e.key === 'ArrowRight') keys.right = false;
    else if ((e.code === 'Space' || e.key === ' ') && G.screen === 'game' && !G.modalOpen) {
      const tag = e.target && e.target.tagName ? e.target.tagName : '';
      if (tag !== 'INPUT') e.preventDefault();
    }
  });
  window.addEventListener('blur', () => { keys.left = keys.right = false; });

  // Botones táctiles (mantener presionado)
  const hold = (id, key) => {
    const el = $(id);
    const on = (e) => { e.preventDefault(); Sound.init(); keys[key] = true; el.classList.add('pressed'); };
    const off = () => { keys[key] = false; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', on);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, off));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold('ctrl-left', 'left');
  hold('ctrl-right', 'right');
  const fireBtn = $('ctrl-fire');
  fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); Sound.init(); fireBtn.classList.add('pressed'); fireCannon(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => fireBtn.addEventListener(ev, () => fireBtn.classList.remove('pressed')));
  fireBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // Navegación del menú y botones "volver"
  document.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      Sound.init();
      Sound.play('click');
      const go = btn.getAttribute('data-go');
      if (go === 'play') newGame();
      else showScreen(go);
    });
  });
  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => Sound.toggle(btn.getAttribute('data-toggle')));
  });

  // HUD
  $('btn-pause').addEventListener('click', () => { Sound.play('click'); togglePause(); });
  $('btn-restart').addEventListener('click', () => { Sound.play('click'); hidePause(); restartLevel(); });
  $('btn-data').addEventListener('click', () => { Sound.play('click'); showDataPanel(); });

  // Pausa
  $('p-resume').addEventListener('click', () => { Sound.play('click'); hidePause(); });
  $('p-restart').addEventListener('click', () => { Sound.play('click'); hidePause(); restartLevel(); });
  $('p-menu').addEventListener('click', () => { Sound.play('click'); goMenu(); });

  // Resultados
  $('res-again').addEventListener('click', () => { Sound.play('click'); newGame(); });
  $('res-menu').addEventListener('click', () => { Sound.play('click'); showScreen('menu'); });
  $('res-continue').addEventListener('click', () => {
    Sound.play('click');
    G.lives = 3;
    G.score = G.levelStartScore;
    showScreen('game');
    startLevel(G.level);
  });

  // Laboratorio
  ['lab-M', 'lab-L', 'lab-tau'].forEach((id) => $(id).addEventListener('input', labUpdateText));

  // Activar audio con la primera interacción
  const unlockAudio = () => { Sound.init(); window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio); };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.screen === 'game' && !G.paused && (G.mode === 'battle' || G.mode === 'challenge' || G.mode === 'locked')) showPause();
  });
}

/* ==========================================================
   18. BUCLE PRINCIPAL E INICIO
   ========================================================== */
let lastFrame = performance.now();
function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  try {
    if (G.screen === 'game') {
      update(dt);
      render();
      hudTick(dt);
    } else {
      G.vt += dt;
      if (G.screen === 'menu') renderMenu(dt);
      else if (G.screen === 'theory') labTick(dt);
    }
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(loop);
}

function init() {
  setupInput();
  refreshToggles();
  labUpdateText();
  G.cannon = newCannon({ M: 5, L: 2, tau: 10 }, false);
  requestAnimationFrame(loop);
}
init();
