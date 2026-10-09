import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildHouse, HOUSE_W, HOUSE_D } from './house.js';
import { Character } from './character.js';
import { Agent } from './agent.js';
import { Cat } from './cat.js';
import { Robot } from './robot.js';
import { Particles } from './particles.js';
import { createLighting } from './lighting.js';
import { createUI, formatTime } from './ui.js';
import { ContactShadows } from './contact.js';

// URL 参数（方便调试）：?time=21.5 指定开始时间并进入加速模式，?speed=8 指定加速档位
const params = new URLSearchParams(location.search);

// ?seed=123 固定随机数（方便复现问题）
if (params.has('seed')) {
  let a = Number(params.get('seed')) >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 渲染器 / 场景 / 相机 ----------
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
// 屋子有屋顶（只是为了看进去才不画），所以屋里没有太阳投下的硬影子，不开阴影贴图

const scene = new THREE.Scene();
const center = new THREE.Vector3(HOUSE_W / 2, 0.5, HOUSE_D / 2 + 0.6);
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 250);
camera.position.set(center.x + 11, 17, center.z + 17);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(center);
controls.enableDamping = true;
controls.screenSpacePanning = false;
controls.minPolarAngle = 0.25;
controls.maxPolarAngle = 1.3;
controls.minDistance = 4;
controls.maxDistance = 48;
controls.update();

const particles = new Particles(scene);
const house = buildHouse(particles);
scene.add(house.group);
const character = new Character();
house.group.add(character.root);
const lighting = createLighting(scene, center);
const ui = createUI();

// ---------- 时钟：真实时间 / 加速时间 ----------
// clock.minutes 是从"今天 0 点"起算的游戏分钟数
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
const realMinutes = () => (Date.now() - midnight.getTime()) / 60000;

const clock = {
  minutes: realMinutes(),
  get hour() { return (((this.minutes % 1440) + 1440) % 1440) / 60; },
  get day() { return Math.floor(this.minutes / 1440) + 1; },
  get dow() { return (((midnight.getDay() + Math.floor(this.minutes / 1440)) % 7) + 7) % 7; },
};

let mode = 'real';
let rate = 2;
if (params.has('time')) {
  mode = 'fast';
  clock.minutes = Number(params.get('time')) * 60;
}
if (params.has('speed')) {
  mode = 'fast';
  rate = Number(params.get('speed'));
}

const onLog = (text) => ui.log(formatTime(clock.hour), text);
const agent = new Agent({ character, house, clock, particles, onLog });
const cat = new Cat({ house, clock, particles, onLog });
const robot = new Robot({ house, clock, particles });
house.group.add(cat.root, robot.root);
// 脚下一片淡淡的接触阴影，让人、猫、机器人不像飘在地上
const contact = new ContactShadows(house.group);
contact.add(character.root, agent.mover, 0.32, 0.3);
contact.add(cat.root, cat.mover, 0.22, 0.28);
contact.add(robot.root, robot.mover, 0.19, 0.22);
agent.cat = cat;
cat.human = agent;
cat.robot = robot;
robot.human = agent;
agent.start();
cat.start();

// ---------- 控制按钮 ----------
const modeButtons = document.querySelectorAll('[data-mode]');
const speedButtons = document.querySelectorAll('[data-speed]');
const speedRow = document.querySelector('#speed-row');
const speedHint = document.querySelector('#speed-hint');

function refreshControls() {
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === rate));
  speedRow.classList.toggle('hidden', mode === 'real');
  speedHint.textContent = mode === 'real'
    ? '和你电脑上的时间同步'
    : rate === 0 ? '已暂停' : `游戏里一天 ≈ ${Math.round(1440 / rate / 60)} 分钟`;
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  if (mode === 'real') {
    clock.minutes = realMinutes();
    agent.handleTimeJump();
    cat.handleTimeJump();
    ui.log(formatTime(clock.hour), '🕐 回到真实时间');
  } else {
    if (rate === 0) rate = 2;
    ui.log(formatTime(clock.hour), '⏩ 时间加速');
  }
  refreshControls();
}

function setSpeed(r) {
  if (mode !== 'fast') setMode('fast');
  rate = r;
  refreshControls();
}

modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
speedButtons.forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && mode === 'fast') {
    e.preventDefault();
    setSpeed(rate === 0 ? 2 : 0);
  }
});

let wallsHigh = false;
const wallBtn = document.querySelector('#btn-walls');
wallBtn.addEventListener('click', () => {
  wallsHigh = !wallsHigh;
  house.setWallsHigh(wallsHigh);
  wallBtn.textContent = wallsHigh ? '🧱 高墙' : '🧱 矮墙';
});

// 窄屏默认收起面板
const hud = document.querySelector('#hud');
if (window.innerWidth < 760) hud.classList.add('collapsed');
document.querySelector('#hud-toggle').addEventListener('click', () => hud.classList.toggle('collapsed'));

let follow = null;
const followBtns = { human: document.querySelector('#btn-follow'), cat: document.querySelector('#btn-follow-cat') };
for (const [who, btn] of Object.entries(followBtns)) {
  btn.addEventListener('click', () => {
    follow = follow === who ? null : who;
    Object.entries(followBtns).forEach(([w, b]) => b.classList.toggle('active', follow === w));
  });
}

refreshControls();
ui.update({ clock, agent, cat, mode });

// ---------- 主循环 ----------
let fitted = false;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // 竖屏时把镜头拉远一些，让整个房子放得下
  if (!fitted) {
    fitted = true;
    const k = Math.min(3, Math.max(1, 1.5 / camera.aspect));
    camera.position.sub(controls.target).multiplyScalar(k).add(controls.target);
    controls.update();
  }
  particles.setViewport(h, renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
resize();

const followPos = new THREE.Vector3();
let last = performance.now();
let lastDay = clock.day;
let uiTimer = 0;

// 推进一步模拟（渲染循环和测试脚本共用）
function step(dt) {
  let gameMin, simScale;
  if (mode === 'real') {
    const target = realMinutes();
    gameMin = target - clock.minutes;
    clock.minutes = target;
    simScale = 1;
  } else {
    gameMin = dt * rate;
    clock.minutes += gameMin;
    simScale = rate === 0 ? 0 : Math.max(1, rate); // 快进时走路、动作也跟着变快（×60 时是正常速度）
  }
  const simDt = dt * simScale;

  const loco = agent.update(simDt, gameMin);
  cat.update(simDt, gameMin);
  robot.update(simDt, gameMin);
  character.update(simDt, loco);
  particles.update(simDt);
  contact.update();

  const lightsOn = lighting.isDark(clock.hour) && !agent.asleep && !agent.away;
  const { sky } = lighting.update(clock.hour, lightsOn, dt);
  house.update(simDt, gameMin, clock.hour, {
    lightsOn, sky, minutes: clock.minutes,
    movers: [character.root.position, cat.root.position],
  });

  if (clock.day !== lastDay) {
    lastDay = clock.day;
    ui.log('', `—— 第 ${clock.day} 天 ——`);
  }
  return { gameMin, simDt };
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  step(dt);

  if (follow) {
    (follow === 'cat' ? cat.root : character.root).getWorldPosition(followPos);
    followPos.y = center.y;
    const delta = followPos.sub(controls.target).multiplyScalar(1 - Math.exp(-3 * dt));
    controls.target.add(delta);
    camera.position.add(delta);
  }
  controls.update();

  uiTimer -= dt;
  if (uiTimer <= 0) {
    uiTimer = 0.1;
    ui.update({ clock, agent, cat, mode });
  }
  ui.updateBubbles({ character, agent, cat, camera, canvas });

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__home = { agent, cat, robot, clock, house, character, camera, controls, renderer, scene, particles, setMode, setSpeed, step, ui };
