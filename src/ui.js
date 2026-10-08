import * as THREE from 'three';
import { NEEDS } from './agent.js';

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

export function formatTime(hour) {
  const m = Math.floor(hour * 60) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function periodName(h) {
  if (h < 5) return '深夜';
  if (h < 8) return '清晨';
  if (h < 11) return '上午';
  if (h < 13) return '中午';
  if (h < 17) return '下午';
  if (h < 19) return '傍晚';
  if (h < 23) return '晚上';
  return '深夜';
}

export function createUI() {
  const needsEl = $('#needs');
  const bars = {};
  for (const n of NEEDS) {
    const row = document.createElement('div');
    row.className = 'need';
    row.innerHTML = `<span class="need-icon">${n.icon}</span><span class="need-label">${n.label}</span><div class="bar"><div class="fill"></div></div>`;
    needsEl.appendChild(row);
    bars[n.key] = row.querySelector('.fill');
  }

  const logEl = $('#log-list');
  const bubble = $('#bubble');
  const anchor = new THREE.Vector3();

  function log(time, text) {
    const li = document.createElement('li');
    li.innerHTML = `<time>${time}</time><span></span>`;
    li.querySelector('span').textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > 40) logEl.lastChild.remove();
  }

  function update({ clock, agent, mode }) {
    const h = clock.hour;
    $('#day').textContent = `第 ${clock.day} 天`;
    $('#time').textContent = formatTime(h);
    $('#period').textContent = periodName(h);
    $('#mode-badge').textContent = mode === 'real' ? '🕐 真实时间' : '⏩ 加速中';
    const s = agent.status;
    $('#doing').textContent = s.walking ? `🚶 去${s.label}` : `${s.emoji} ${s.label}`;
    for (const [k, el] of Object.entries(bars)) {
      const v = agent.needs[k];
      el.style.width = `${v}%`;
      el.style.background = v > 60 ? '#6bbf73' : v > 30 ? '#f2c14e' : '#e35d5b';
    }
  }

  function updateBubble(character, agent, camera, canvas) {
    character.bubbleAnchor(anchor).project(camera);
    if (anchor.z > 1) { bubble.style.display = 'none'; return; }
    const x = (anchor.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-anchor.y * 0.5 + 0.5) * canvas.clientHeight;
    bubble.style.display = 'block';
    bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    const s = agent.status;
    bubble.textContent = s.walking ? `🚶${s.emoji}` : s.emoji;
  }

  return { log, update, updateBubble };
}
