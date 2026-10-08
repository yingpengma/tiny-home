// 所有可做的事。score() 决定"现在有多想做"，steps() 给出具体步骤。
// 每一步：去哪个交互点(spot)、做什么动作(anim)、持续多少游戏分钟、对需求的影响。
//   gain: 整个步骤结束时总共增加多少（按时长平摊）
//   rate: 每游戏小时增加多少
//   fx:   触发房子里的效果（开电视、开火……）
//   prop: 手上拿的东西

export const inRange = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
const lack = (v) => Math.min(1, Math.max(0, (100 - v) / 100));
const urgent = (v) => lack(v) ** 2;
const isMealTime = (h) => inRange(h, 7, 9.5) || inRange(h, 11.5, 13.5) || inRange(h, 17.5, 20);

export const ACTIVITIES = {
  sleep: {
    log: '困了，上床睡觉',
    score: ({ h, n }) =>
      inRange(h, 22, 5.5) ? 4 + 3 * urgent(n.energy)
        : inRange(h, 21, 22) && n.energy < 50 ? 2 : 0,
    steps: (ctx) => [
      { spot: 'bed', emoji: '💤', label: '睡觉', anim: 'sleep', minutes: ctx.minutesUntilWake(), rate: { energy: 14 }, fx: 'bed', asleep: true },
    ],
  },

  nap: {
    log: '有点累，午睡一会儿',
    score: ({ h, n }) =>
      n.energy < 10 ? 6
        : inRange(h, 12.5, 17) && n.energy < 40 ? 2.5 + 3 * urgent(n.energy) : 0,
    steps: () => [
      { spot: 'bed', emoji: '😴', label: '午睡', anim: 'sleep', minutes: [40, 80], rate: { energy: 18 }, fx: 'bed', asleep: true },
    ],
  },

  toilet: {
    log: '想上厕所',
    repeatable: true,
    score: ({ n }) => 8 * urgent(n.bladder) + (n.bladder < 25 ? 4 : 0),
    steps: () => [
      { spot: 'toilet', emoji: '🚽', label: '上厕所', anim: 'toilet', minutes: [3, 6], gain: { bladder: 100 } },
      { spot: 'bathSink', emoji: '🧼', label: '洗手', anim: 'wash', minutes: [1, 2], gain: { hygiene: 4 }, fx: 'tap' },
    ],
  },

  meal: {
    log: '肚子饿了，做顿饭',
    score: ({ h, n }) =>
      n.hunger > 85 ? 0 : 6 * urgent(n.hunger) + (isMealTime(h) && n.hunger < 75 ? 2.2 : 0),
    steps: () => [
      { spot: 'fridge', emoji: '🥕', label: '拿食材', anim: 'use', minutes: [1, 2], fx: 'fridge' },
      { spot: 'stove', emoji: '🍳', label: '做饭', anim: 'cook', minutes: [10, 18], fx: 'stove' },
      { spot: 'dining', emoji: '🍚', label: '吃饭', anim: 'eat', minutes: [15, 25], gain: { hunger: 70, fun: 5 }, fx: 'plate' },
    ],
  },

  snack: {
    log: '嘴馋，找点零食',
    score: ({ h, n }) => (n.hunger < 70 && !isMealTime(h) ? 1.2 * urgent(n.hunger) + 0.15 : 0),
    steps: () => [
      { spot: 'fridge', emoji: '🧊', label: '翻冰箱', anim: 'use', minutes: [1, 2], fx: 'fridge' },
      { spot: 'fridge', emoji: '🍪', label: '吃零食', anim: 'eat', minutes: [4, 7], gain: { hunger: 20, fun: 3 } },
    ],
  },

  drink: {
    log: '口渴了，去倒杯水',
    repeatable: true,
    score: ({ n }) => 6 * urgent(n.thirst) + (n.thirst < 55 ? 0.6 : 0),
    steps: () => [
      { spot: 'kitchenSink', emoji: '🚰', label: '接水', anim: 'use', minutes: 1, fx: 'ktap', prop: 'cup' },
      { spot: 'kitchenSink', emoji: '💧', label: '喝水', anim: 'drink', minutes: [1, 3], gain: { thirst: 60, bladder: -8 }, prop: 'cup' },
    ],
  },

  shower: {
    log: '去洗个澡',
    score: ({ h, n }) =>
      4 * urgent(n.hygiene) + ((inRange(h, 7, 9.5) || inRange(h, 20, 22.5)) && n.hygiene < 75 ? 1.3 : 0),
    steps: () => [
      { spot: 'shower', emoji: '🚿', label: '洗澡', anim: 'shower', minutes: [10, 16], gain: { hygiene: 100, fun: 4 }, fx: 'shower' },
    ],
  },

  tv: {
    log: '窝在沙发上看电视',
    interruptible: true,
    score: ({ h, n }) => 0.5 + 2 * urgent(n.fun) + (inRange(h, 19, 23) ? 0.9 : 0) + (inRange(h, 12, 14) ? 0.3 : 0),
    steps: () => [
      { spot: 'sofa', emoji: '📺', label: '看电视', anim: 'tv', minutes: [30, 90], rate: { fun: 40, energy: -1 }, fx: 'tv' },
    ],
  },

  read: {
    log: '挑本书看看',
    interruptible: true,
    score: ({ h, n }) => 0.4 + 1.5 * urgent(n.fun) + (inRange(h, 14, 17) ? 0.3 : 0),
    steps: () => [
      { spot: 'bookshelf', emoji: '📚', label: '挑书', anim: 'use', minutes: [1, 2] },
      { spot: 'armchair', emoji: '📖', label: '看书', anim: 'read', minutes: [20, 50], rate: { fun: 30 }, prop: 'book' },
    ],
  },

  computer: {
    log: '打开电脑玩一会儿',
    interruptible: true,
    score: ({ h, n }) => 0.45 + 1.8 * urgent(n.fun) + (inRange(h, 9, 12) || inRange(h, 14, 18) ? 0.45 : 0),
    steps: () => [
      { spot: 'desk', emoji: '💻', label: '玩电脑', anim: 'type', minutes: [25, 60], rate: { fun: 35, energy: -3 }, fx: 'monitor' },
    ],
  },

  exercise: {
    log: '活动活动筋骨',
    interruptible: true,
    score: ({ h, n }) =>
      n.energy > 45 && inRange(h, 6.5, 21) ? 0.3 + (inRange(h, 7, 10) || inRange(h, 17, 19) ? 0.7 : 0) : 0,
    steps: () => [
      { spot: 'mat', emoji: '🏃', label: '做运动', anim: 'exercise', minutes: [15, 30], gain: { energy: -12, hygiene: -15, thirst: -12, fun: 15 } },
    ],
  },

  plants: {
    log: '给花浇浇水',
    interruptible: true,
    score: ({ h, day, agent }) => (agent.lastPlantDay !== day && inRange(h, 8, 18) ? 0.9 : 0),
    steps: () => [
      { spot: 'kitchenSink', emoji: '🚰', label: '接水', anim: 'use', minutes: [1, 2], fx: 'ktap', prop: 'can' },
      { spot: 'plant1', emoji: '🪴', label: '浇花', anim: 'water', minutes: [2, 4], prop: 'can' },
      { spot: 'plant2', emoji: '🪴', label: '浇花', anim: 'water', minutes: [2, 4], gain: { fun: 8 }, prop: 'can' },
    ],
    onDone: (agent, day) => { agent.lastPlantDay = day; },
  },

  idle: {
    log: '在屋里溜达溜达',
    interruptible: true,
    score: () => 0.45,
    steps: (ctx) => [
      { spot: ctx.randomSpot(), emoji: '💭', label: '发呆', anim: 'idle', minutes: [3, 8], gain: { fun: 2 } },
    ],
  },
};
