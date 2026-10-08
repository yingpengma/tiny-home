import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildHouse, HOUSE_W, HOUSE_D } from './house.js';
import { Character } from './character.js';
import { Agent } from './agent.js';
import { createLighting } from './lighting.js';
import { createUI, formatTime } from './ui.js';

// URL 参数（方便调试）：?time=21.5 指定开始时间并进入加速模式，?speed=8 指定加速档位
const params = new URLSearchParams(location.search);

// ---------- 渲染器 / 场景 / 相机 ----------
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const center = new THREE.Vector3(HOUSE_W / 2, 0.6, HOUSE_D / 2);
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
camera.position.set(center.x + 8.5, 12, center.z + 12.5);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(center);
controls.enableDamping = true;
controls.screenSpacePanning = false;
controls.minPolarAngle = 0.25;
controls.maxPolarAngle = 1.3;
controls.minDistance = 5;
controls.maxDistance = 38;
controls.update();

const house = buildHouse();
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
};

const SPEEDS = [0, 1, 2, 8, 24]; // 每真实秒走多少游戏分钟
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

const agent = new Agent({
  character, house, clock,
  onLog: (text) => ui.log(formatTime(clock.hour), text),
});
agent.start();

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
    // 回到真实时间：时钟直接跳到现在，小人那边按"时间跳变"处理
    clock.minutes = realMinutes();
    agent.handleTimeJump();
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
  wallBtn.textContent = wallsHigh ? '🧱 墙：高' : '🧱 墙：矮';
});

let follow = false;
const followBtn = document.querySelector('#btn-follow');
followBtn.addEventListener('click', () => {
  follow = !follow;
  followBtn.classList.toggle('active', follow);
});

refreshControls();

// ---------- 主循环 ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const followPos = new THREE.Vector3();
let last = performance.now();
let lastDay = clock.day;
let uiTimer = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  let gameMin, simScale;
  if (mode === 'real') {
    const target = realMinutes();
    gameMin = target - clock.minutes;
    clock.minutes = target;
    simScale = 1;
  } else {
    gameMin = dt * rate;
    clock.minutes += gameMin;
    simScale = rate === 0 ? 0 : Math.max(1, rate / 2); // 快进时走路也跟着变快
  }
  const simDt = dt * simScale;

  agent.update(simDt, gameMin);
  character.update(simDt, agent.status.walking);

  const { sky, dark } = lighting.update(clock.hour);
  house.update(dt, clock.hour, { lightsOn: dark && !agent.asleep, sky });

  if (clock.day !== lastDay) {
    lastDay = clock.day;
    ui.log('', `—— 第 ${clock.day} 天 ——`);
  }

  if (follow) {
    character.root.getWorldPosition(followPos);
    followPos.y = center.y;
    const delta = followPos.sub(controls.target).multiplyScalar(1 - Math.exp(-3 * dt));
    controls.target.add(delta);
    camera.position.add(delta);
  }
  controls.update();

  uiTimer -= dt;
  if (uiTimer <= 0) {
    uiTimer = 0.1;
    ui.update({ clock, agent, mode });
  }
  ui.updateBubble(character, agent, camera, canvas);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__home = { agent, clock, house, character, camera, controls, renderer, setMode, setSpeed };
