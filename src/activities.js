// 小豆能做的所有事。score(ctx) = 现在有多想做；steps(ctx) = 具体步骤。
// 每一步：
//   spot    交互点 id（或动态生成的点）
//   anim    动作；minutes 持续游戏分钟（数字/区间）
//   gain    整步结束时总共改变多少需求（按时长平摊）；rate 每游戏小时改变多少
//   fx      持续效果（开电视、开火……），开始时打开、结束时关掉
//   props   手上拿的东西（从这一步出发前就拿着）
//   onStart / onMid / onEnd  改世界状态（库存、脏碗、换衣服……）
//   away    出门；cat  跟猫互动

export const inRange = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
const lack = (v) => Math.min(1, Math.max(0, (100 - v) / 100));
const u2 = (v) => lack(v) ** 2;
const isMealTime = (h) => inRange(h, 6.5, 9.5) || inRange(h, 11.5, 13.5) || inRange(h, 17.5, 20.5);
const awakeHours = (h) => inRange(h, 6, 23.5);

const brush = (c) => [
  { spot: 'vanity', emoji: '🪥', label: '刷牙', anim: 'brush', minutes: [2, 3], props: 'toothbrush', fx: 'bathTap',
    onStart: () => { c.state.toothbrushTaken = true; }, onEnd: () => { c.state.toothbrushTaken = false; } },
  { spot: 'vanity', emoji: '🫧', label: '洗脸', anim: 'faceWash', minutes: [1, 2], fx: 'bathTap', gain: { hygiene: 6 } },
];

export const ACTIVITIES = {
  // ---------------- 睡觉 ----------------
  sleep: {
    log: '困了，准备睡觉',
    score: ({ h, n }) => (inRange(h, 22.5, 5.5) ? 4 + 3 * u2(n.energy) : inRange(h, 21.5, 22.5) && n.energy < 45 ? 2 : 0),
    steps: (c) => [
      ...(!c.daily.brushedNight ? brush(c).map((s, i) => (i === 1 ? { ...s, onEnd: () => { c.daily.brushedNight = true; } } : s)) : []),
      ...(c.char.outfit.top !== 'pajamas' ? [{ spot: 'wardrobe', emoji: '👕', label: '换睡衣', anim: 'change', minutes: [2, 3], fx: 'wardrobe',
        onMid: () => c.char.setOutfit({ top: 'pajamas', towel: false }) }] : []),
      ...(!c.state.curtainsClosed ? [{ spot: 'curtain', emoji: '🪟', label: '拉窗帘', anim: 'curtain', minutes: 1,
        onMid: () => { c.state.curtainsClosed = true; } }] : []),
      { spot: 'bed', emoji: '💤', label: '睡觉', anim: 'sleep', minutes: c.minutesUntilWake(), rate: { energy: 14 }, asleep: true, fx: 'pillow' },
    ],
  },
  nap: {
    log: '有点累，午睡一会儿',
    score: ({ h, n }) => (n.energy < 12 ? 6 : n.energy < 25 && !inRange(h, 21, 7) ? 3 : inRange(h, 12.5, 17) && n.energy < 38 ? 2.5 + 3 * u2(n.energy) : 0),
    steps: () => [{ spot: 'bed', emoji: '😴', label: '午睡', anim: 'sleep', minutes: [40, 75], rate: { energy: 18 }, asleep: true, fx: 'pillow' }],
  },
  wakeUp: {
    log: '起床啦，拉开窗帘',
    score: () => 0,
    steps: (c) => {
      const curtain = c.state.curtainsClosed ? [{ spot: 'curtain', emoji: '☀️', label: '拉开窗帘', anim: 'curtain', minutes: 1,
        onMid: () => { c.state.curtainsClosed = false; }, gain: { fun: 3 } }] : [];
      const toilet = c.n.bladder < 60 ? ACTIVITIES.toilet.steps(c) : [];
      return c.n.bladder < 35 ? [...toilet, ...curtain] : [...curtain, ...toilet]; // 憋得急就先上厕所
    },
  },
  dress: {
    log: '换上家居服',
    score: ({ h, char }) => (char.outfit.top === 'pajamas' && inRange(h, 6, 21) ? (h > 11 ? 6 : 2.2) : 0),
    steps: (c) => [{ spot: 'wardrobe', emoji: '👕', label: '换衣服', anim: 'change', minutes: [2, 3], fx: 'wardrobe',
      onMid: () => c.char.setOutfit({ top: 'home' }) }],
  },
  morningRoutine: {
    log: '刷牙洗脸',
    score: ({ h, daily }) => (!daily.brushedMorning && inRange(h, 5.5, 11) ? 4.5 : 0),
    steps: (c) => brush(c).map((s, i) => (i === 1 ? { ...s, onEnd: () => { c.daily.brushedMorning = true; } } : s)),
  },

  // ---------------- 卫生 ----------------
  toilet: {
    log: '想上厕所',
    repeatable: true,
    score: ({ n }) => 8 * u2(n.bladder) + (n.bladder < 25 ? 4 : 0),
    steps: () => [
      { spot: 'toilet', emoji: '🚽', label: '上厕所', anim: 'toilet', minutes: [3, 6], gain: { bladder: 100 }, props: 'phone' },
      { spot: 'vanity', emoji: '🧼', label: '洗手', anim: 'handwash', minutes: 1, gain: { hygiene: 3 }, fx: 'bathTap' },
    ],
  },
  shower: {
    log: '去冲个澡',
    score: ({ h, n }) => 5 * u2(n.hygiene) + ((inRange(h, 7, 9.5) || inRange(h, 19.5, 22.5)) && n.hygiene < 75 ? 1.8 : 0),
    steps: (c) => [{ spot: 'shower', emoji: '🚿', label: '洗澡', anim: 'shower', minutes: [10, 15], gain: { hygiene: 100, fun: 4 }, fx: 'shower',
      onEnd: () => c.agent.wetHair(25) }],
  },
  bath: {
    log: '放一缸热水泡个澡',
    score: ({ h, n, daily }) => (!daily.bath && inRange(h, 19, 23) && (n.hygiene < 70 || n.fun < 50) ? 1.2 + 2 * u2(n.hygiene) : 0),
    steps: (c) => [
      { spot: 'tubTap', emoji: '🚰', label: '放洗澡水', anim: 'tubFill', minutes: [3, 4], fx: 'tubFill' },
      { spot: 'tub', emoji: '🛁', label: '泡澡', anim: 'bath', minutes: [25, 40], gain: { hygiene: 100, fun: 25, energy: 5 }, fx: 'bath',
        onEnd: () => { c.daily.bath = true; c.agent.wetHair(30); } },
    ],
  },
  skincare: {
    log: '坐到梳妆台前护肤',
    score: ({ h, n, daily }) => (!daily.skincare && inRange(h, 20, 24) && n.hygiene > 70 ? 1.1 : 0),
    steps: (c) => [{ spot: 'dresser', emoji: '🧴', label: '护肤', anim: 'skincare', minutes: [3, 5], gain: { fun: 4 },
      onEnd: () => { c.daily.skincare = true; } }],
  },

  // ---------------- 吃喝 ----------------
  breakfast: {
    log: '做个简单的早餐',
    score: ({ h, n, daily }) => (!daily.breakfast && inRange(h, 6.5, 10.5) && n.hunger < 85 ? 3 + 4 * u2(n.hunger) : 0),
    steps: (c) => [
      { spot: 'fridge', emoji: '🥚', label: '拿鸡蛋', anim: 'reach', minutes: 1, onEnd: () => { c.state.stock = Math.max(0, c.state.stock - 0.5); } },
      { spot: 'stove', emoji: '🍳', label: '煎蛋', anim: 'cook', minutes: [5, 8], fx: 'stove', props: 'spatula' },
      { spot: 'stool', emoji: '🥪', label: '吃早餐', anim: 'eat', minutes: [10, 15], gain: { hunger: 40, fun: 3, thirst: 20 }, props: 'meal',
        onEnd: () => { c.daily.breakfast = true; c.state.dishes = Math.min(4, c.state.dishes + 1); } },
    ],
  },
  meal: {
    log: '肚子饿了，做顿饭',
    score: ({ h, n }) => (n.hunger > 80 ? 0 : 6 * u2(n.hunger) + (n.hunger < 50 ? 1.5 : 0) + ((inRange(h, 11.5, 13.5) || inRange(h, 17.5, 20.5)) && n.hunger < 78 ? 2.5 : 0)),
    steps: (c) => [
      { spot: 'fridge', emoji: '🥕', label: '拿食材', anim: 'reach', minutes: [1, 2], onEnd: () => { c.state.stock = Math.max(0, c.state.stock - 1); } },
      { spot: 'chop', emoji: '🔪', label: '切菜', anim: 'chop', minutes: [4, 6], props: 'knife' },
      { spot: 'stove', emoji: '🍳', label: '炒菜', anim: 'cook', minutes: [8, 13], fx: 'stove', props: 'spatula' },
      { spot: 'dining', emoji: '🍚', label: '吃饭', anim: 'eat', minutes: [15, 25], gain: { hunger: 70, fun: 6, thirst: 25 }, props: 'meal', fx: 'eating',
        onStart: () => c.house.setFx('plate', true) },
      { spot: 'sink', emoji: '🍽️', label: '收拾碗筷', anim: 'reach', minutes: 0.5, props: 'plate',
        onStart: () => c.house.setFx('plate', false),
        onEnd: () => { c.state.dishes = Math.min(4, c.state.dishes + 1); c.state.trash = Math.min(1, c.state.trash + 0.12); } },
    ],
  },
  snack: {
    log: '嘴馋，找点零食',
    score: ({ h, n }) => (n.hunger < 70 && !isMealTime(h) && awakeHours(h) ? 1.0 * u2(n.hunger) + 0.2 : 0),
    steps: (c) => [
      { spot: 'fridge', emoji: '🧊', label: '翻冰箱', anim: 'reach', minutes: 1 },
      { spot: 'stool', emoji: '🍪', label: '吃零食', anim: 'snack', minutes: [4, 7], gain: { hunger: 20, fun: 5 }, props: 'snack',
        onEnd: () => { c.state.trash = Math.min(1, c.state.trash + 0.06); } },
    ],
  },
  coffee: {
    log: '来杯咖啡提提神',
    score: ({ h, daily }) => (!daily.coffee && inRange(h, 7, 11) ? 2.2 : 0),
    steps: (c) => [
      { spot: 'coffee', emoji: '☕', label: '做咖啡', anim: 'reach', minutes: [2, 3], fx: 'coffee' },
      { spot: 'stool', emoji: '☕', label: '喝咖啡', anim: 'sip', minutes: [8, 12], gain: { energy: 12, fun: 4, thirst: 15 }, props: 'mug',
        onEnd: () => { c.daily.coffee = true; c.state.dishes = Math.min(4, c.state.dishes + 1); } },
    ],
  },
  tea: {
    log: '泡杯茶去阳台坐坐',
    score: ({ h, n, daily }) => (!daily.tea && inRange(h, 14, 17.5) && n.fun < 85 ? 1.1 : 0),
    steps: (c) => [
      { spot: 'coffee', emoji: '🍵', label: '泡茶', anim: 'reach', minutes: 2, fx: 'coffee' },
      { spot: 'balChair', emoji: '🍵', label: '在阳台喝茶', anim: 'sip', minutes: [15, 25], gain: { fun: 18, energy: 3, thirst: 20 }, props: 'mug',
        onEnd: () => { c.daily.tea = true; c.state.dishes = Math.min(4, c.state.dishes + 1); } },
    ],
  },
  drink: {
    log: '口渴了，倒杯水',
    repeatable: true,
    score: ({ n }) => 8 * u2(n.thirst) + (n.thirst < 50 ? 1.6 : 0),
    steps: () => [
      { spot: 'sink', emoji: '🚰', label: '接水', anim: 'reach', minutes: 0.5, fx: 'kTap', props: 'cup' },
      { spot: 'sink', emoji: '💧', label: '喝水', anim: 'drink', minutes: [1, 2], gain: { thirst: 60, bladder: -8 }, props: 'cup' },
    ],
  },

  // ---------------- 家务 ----------------
  dishes: {
    log: '把碗洗了',
    score: ({ h, state }) => (state.dishes >= 3 ? 1.6 : state.dishes >= 1 && inRange(h, 19, 22.5) ? 1.0 : state.dishes >= 2 ? 0.5 : 0),
    steps: (c) => (c.state.dishes >= 3 && c.state.dishwasherTimer <= 0
      ? [{ spot: 'dishwasher', emoji: '🍽️', label: '装洗碗机', anim: 'load', minutes: [3, 4],
        onEnd: () => { c.state.dishes = 0; c.state.dishwasherTimer = 90; } }]
      : [{ spot: 'sink', emoji: '🧽', label: '洗碗', anim: 'washDishes', minutes: Math.max(3, c.state.dishes * 2.5), fx: 'kTap',
        onEnd: () => { c.state.dishes = 0; } }]),
  },
  laundryWash: {
    log: '脏衣篮满了，洗衣服',
    score: ({ h, state }) => (state.laundry.stage === 'idle' && state.laundry.dirty > 0.6 && inRange(h, 8, 20) ? 0.8 + state.laundry.dirty : 0),
    steps: (c) => [
      { spot: 'basket', emoji: '🧺', label: '收脏衣服', anim: 'load', minutes: 1, onEnd: () => { c.state.laundry.dirty = 0.02; } },
      { spot: 'washer', emoji: '🫧', label: '放进洗衣机', anim: 'load', minutes: [2, 3], props: 'clothes',
        onEnd: () => { c.state.laundry.stage = 'washing'; c.state.washerTimer = 60; } },
    ],
  },
  laundryHang: {
    log: '衣服洗好了，拿去阳台晾',
    score: ({ h, state }) => (state.laundry.stage === 'washed' && inRange(h, 7, 21) ? 2.2 : 0),
    steps: (c) => [
      { spot: 'washer', emoji: '🧺', label: '取出衣服', anim: 'load', minutes: [1, 2] },
      { spot: 'dryRack', emoji: '👚', label: '晾衣服', anim: 'hang', minutes: [5, 8], props: 'clothes',
        onStart: () => { c.state.laundry.stage = 'drying'; c.state.laundry.timer = 240; } },
    ],
  },
  laundryCollect: {
    log: '衣服晒干了，收进来',
    score: ({ h, state }) => (state.laundry.stage === 'dry' && inRange(h, 8, 21) ? 2.0 : 0),
    steps: (c) => [
      { spot: 'dryRack', emoji: '👚', label: '收衣服', anim: 'hang', minutes: [3, 5], onEnd: () => { c.state.laundry.stage = 'idle'; } },
      { spot: 'wardrobe', emoji: '🧺', label: '叠好放进衣柜', anim: 'reach', minutes: 2, props: 'clothes', fx: 'wardrobe', gain: { fun: 3 } },
    ],
  },
  shopping: {
    log: '冰箱快空了，出门买菜',
    score: ({ h, state }) => (state.stock < 3.5 && inRange(h, 9, 19) ? 1.5 + (state.stock < 1.5 ? 3 : 0) : 0),
    steps: (c) => {
      const trash = c.state.trash > 0.5;
      return [
        { spot: 'bench', emoji: '👟', label: '换鞋', anim: 'shoes', minutes: [1, 2], onMid: () => c.char.setOutfit({ shoes: true }) },
        { spot: 'coatRack', emoji: '🧥', label: '穿外套', anim: 'coat', minutes: 1,
          onMid: () => { c.char.setOutfit({ coat: true }); c.state.coatTaken = true; } },
        ...(trash ? [{ spot: 'trash', emoji: '🗑️', label: '顺手带垃圾', anim: 'reach', minutes: 1, onEnd: () => { c.state.trash = 0; } }] : []),
        { spot: 'mirror', emoji: '🪞', label: '照照镜子', anim: 'mirror', minutes: [0.5, 1], props: trash ? 'trashbag' : null },
        { spot: 'door', emoji: '🛒', label: '出门买菜', anim: 'idle', minutes: [40, 70], away: true, props: trash ? 'trashbag' : null, returnProps: 'shopbag' },
        { spot: 'coatRack', emoji: '🧥', label: '挂外套', anim: 'coat', minutes: 1, props: 'shopbag',
          onMid: () => { c.char.setOutfit({ coat: false }); c.state.coatTaken = false; } },
        { spot: 'bench', emoji: '🩴', label: '换拖鞋', anim: 'shoes', minutes: 1, props: 'shopbag', onMid: () => c.char.setOutfit({ shoes: false }) },
        { spot: 'fridge', emoji: '🥬', label: '把菜放进冰箱', anim: 'reach', minutes: [2, 3], props: 'shopbag', onEnd: () => { c.state.stock = 10; } },
      ];
    },
  },
  takeTrash: {
    log: '垃圾满了，拿出去扔',
    score: ({ h, state }) => (state.trash > 0.85 && state.stock >= 3.5 && inRange(h, 8, 21) ? 1.3 : 0),
    steps: (c) => [
      { spot: 'trash', emoji: '🗑️', label: '打包垃圾', anim: 'reach', minutes: 1, onEnd: () => { c.state.trash = 0; } },
      { spot: 'door', emoji: '🗑️', label: '下楼扔垃圾', anim: 'idle', minutes: [4, 7], away: true, props: 'trashbag', returnProps: null },
    ],
  },
  water: {
    log: '给花浇浇水',
    interruptible: true,
    score: ({ h, state }) => {
      const lv = Object.values(state.plants);
      const min = Math.min(...lv);
      return inRange(h, 8, 18) && min < 0.5 ? 0.6 + (min < 0.25 ? 1.5 : 0) : 0;
    },
    steps: (c) => {
      const order = ['bal1', 'bal2', 'balBig', 'big', 'entrance', 'living', 'bedroom'];
      const need = order.filter((id) => c.state.plants[id] < 0.75);
      return [
        { spot: 'sink', emoji: '🚰', label: '接水', anim: 'reach', minutes: 1, fx: 'kTap', props: 'can' },
        ...need.map((id) => ({ spot: 'plant:' + id, emoji: '🪴', label: '浇花', anim: 'water', minutes: [1, 2], props: 'can',
          onEnd: () => { c.state.plants[id] = 1; } })),
      ];
    },
  },

  // ---------------- 猫 ----------------
  feedCat: {
    log: '橘子的碗空了，添猫粮',
    score: ({ state, cat }) => (state.catFood < 0.25 ? 2.5 + (cat?.begging ? 3 : 0) : 0),
    steps: (c) => [
      { spot: 'catFood', emoji: '🐟', label: '拿猫粮', anim: 'reach', minutes: 0.5 },
      { spot: 'catBowls', emoji: '🐟', label: '添猫粮', anim: 'pour', minutes: 1, props: 'foodbag', gain: { fun: 3 },
        onEnd: () => { c.state.catFood = 1; c.state.catWater = 1; } },
    ],
  },
  cleanLitter: {
    log: '铲猫砂',
    score: ({ h, state }) => (state.litter >= 3 && inRange(h, 8, 22) ? 1.3 : 0),
    steps: (c) => [{ spot: 'litter', emoji: '🧹', label: '铲猫砂', anim: 'scoop', minutes: 2, props: 'scoop',
      onEnd: () => { c.state.litter = 0; c.state.trash = Math.min(1, c.state.trash + 0.1); } }],
  },
  petCat: {
    log: '去撸一会儿猫',
    interruptible: true,
    score: ({ h, n, cat }) => (cat?.pettable && awakeHours(h) && n.fun < 95 ? 1.8 + (inRange(h, 18, 22) ? 0.5 : 0) : 0),
    steps: (c) => [{ spot: () => c.agent.petSpot(), emoji: '🐱', label: '撸猫', anim: 'pet', minutes: [2, 4], rate: { fun: 35 }, cat: 'pet' }],
  },
  playCat: {
    log: '拿逗猫棒陪橘子玩',
    interruptible: true,
    score: ({ h, n, cat }) => (cat?.playful && inRange(h, 8, 22) && n.energy > 40 ? 0.8 : 0),
    steps: (c) => [
      { spot: 'catTree', emoji: '🪄', label: '拿逗猫棒', anim: 'reach', minutes: 0.5, onEnd: () => { c.state.wandTaken = true; } },
      { spot: 'playArea', emoji: '🐱', label: '逗猫', anim: 'wand', minutes: [6, 12], props: 'wand', rate: { fun: 40, energy: -3 }, cat: 'play' },
      { spot: 'catTree', emoji: '🪄', label: '放回逗猫棒', anim: 'reach', minutes: 0.5, props: 'wand', onEnd: () => { c.state.wandTaken = false; } },
    ],
  },

  // ---------------- 娱乐 ----------------
  tv: {
    log: '窝在沙发上看电视',
    interruptible: true,
    score: ({ h, n }) => 0.5 + 2 * u2(n.fun) + (inRange(h, 19, 23) ? 0.9 : 0) + (inRange(h, 12, 14) ? 0.3 : 0),
    steps: (c) => [{ spot: 'sofaTV', emoji: '📺', label: '看电视', anim: 'tv', minutes: [30, 80], rate: { fun: 40, energy: -1 }, fx: 'tv', props: 'remote',
      onStart: () => { c.state.remoteTaken = true; }, onEnd: () => { c.state.remoteTaken = false; } }],
  },
  game: {
    log: '打开游戏机玩两把',
    interruptible: true,
    score: ({ h, n, dow }) => 0.35 + 1.6 * u2(n.fun) + (inRange(h, 20, 23.5) ? 0.4 : 0) + (dow === 0 || dow === 6 ? 0.4 : 0),
    steps: () => [{ spot: 'sofaTV', emoji: '🎮', label: '打游戏', anim: 'game', minutes: [30, 70], rate: { fun: 50, energy: -3 }, fx: 'tvGame', props: 'controller' }],
  },
  music: {
    log: '放张唱片听听',
    interruptible: true,
    score: ({ h, n }) => (inRange(h, 9, 23) ? 0.55 + 1.2 * u2(n.fun) : 0),
    steps: (c) => [
      { spot: 'record', emoji: '💿', label: '放唱片', anim: 'reach', minutes: 1, onEnd: () => { c.state.recordUntil = c.minutes + 50; } },
      { spot: 'sofaGuitar', emoji: '🎵', label: '听音乐', anim: 'music', minutes: [20, 40], rate: { fun: 35 } },
    ],
  },
  guitar: {
    log: '抱起吉他弹一会儿',
    interruptible: true,
    score: ({ h, n }) => (inRange(h, 10, 22.5) ? 0.35 + 1.2 * u2(n.fun) : 0),
    steps: (c) => [
      { spot: 'guitarStand', emoji: '🎸', label: '拿吉他', anim: 'reach', minutes: 0.5, onEnd: () => { c.state.guitarTaken = true; } },
      { spot: 'sofaGuitar', emoji: '🎸', label: '弹吉他', anim: 'guitar', minutes: [15, 30], props: 'guitar', rate: { fun: 45 }, notes: true },
      { spot: 'guitarStand', emoji: '🎸', label: '放回吉他', anim: 'reach', minutes: 0.5, props: 'guitar', onEnd: () => { c.state.guitarTaken = false; } },
    ],
  },
  read: {
    log: '挑本书看看',
    interruptible: true,
    score: ({ h, n }) => 0.4 + 1.4 * u2(n.fun) + (inRange(h, 14, 17) || inRange(h, 21, 23) ? 0.3 : 0),
    steps: () => [
      { spot: 'bookshelf', emoji: '📚', label: '挑书', anim: 'reachHigh', minutes: 1 },
      { spot: 'readChair', emoji: '📖', label: '看书', anim: 'read', minutes: [20, 45], props: 'book', rate: { fun: 30 } },
    ],
  },
  work: {
    log: '开始干活',
    interruptible: true,
    score: ({ h, n, dow, daily }) => (dow >= 1 && dow <= 5 && (inRange(h, 9, 12) || inRange(h, 13.5, 18)) && daily.work < 360 && n.fun > 20 ? 3.5 : 0),
    steps: (c) => [{ spot: 'desk', emoji: '💼', label: '居家办公', anim: 'type', minutes: [50, 90], fx: 'monitor', rate: { fun: -1, energy: -2 },
      onEnd: (s) => { c.daily.work += s.elapsed ?? 60; } }],
  },
  computer: {
    log: '打开电脑刷一会儿',
    interruptible: true,
    score: ({ h, n, dow }) => {
      const workHours = dow >= 1 && dow <= 5 && inRange(h, 9, 18);
      return awakeHours(h) ? (workHours ? 0.1 : 0.45) + 1.5 * u2(n.fun) : 0;
    },
    steps: () => [{ spot: 'desk', emoji: '💻', label: '玩电脑', anim: 'type', minutes: [25, 55], fx: 'monitor', rate: { fun: 35, energy: -3 } }],
  },
  treadmill: {
    log: '上跑步机跑一跑',
    interruptible: true,
    score: ({ h, n, daily }) => (!daily.exercise && n.energy > 50 && (inRange(h, 7, 10) || inRange(h, 17, 20)) ? 1.2 : 0),
    steps: (c) => [{ spot: 'treadmill', emoji: '🏃', label: '跑步', anim: 'run', minutes: [20, 30], fx: 'treadmill',
      gain: { energy: -15, hygiene: -20, thirst: -15, fun: 12 }, onEnd: () => { c.daily.exercise = true; c.state.laundry.dirty = Math.min(1, c.state.laundry.dirty + 0.1); } }],
  },
  yoga: {
    log: '铺开垫子做瑜伽',
    interruptible: true,
    score: ({ h, n, daily }) => (!daily.exercise && n.energy > 35 && (inRange(h, 7, 10) || inRange(h, 17, 21)) ? 1.0 : 0),
    steps: (c) => [{ spot: 'yoga', emoji: '🧘', label: '做瑜伽', anim: 'yoga', minutes: [20, 30], gain: { energy: -5, fun: 15, hygiene: -5 },
      onEnd: () => { c.daily.exercise = true; } }],
  },
  dumbbells: {
    log: '举举哑铃',
    interruptible: true,
    score: ({ h, n, daily }) => (!daily.exercise && n.energy > 45 && (inRange(h, 7, 10) || inRange(h, 17, 21)) ? 0.9 : 0),
    steps: (c) => [
      { spot: 'dumbbells', emoji: '🏋️', label: '拿哑铃', anim: 'reach', minutes: 0.5, onEnd: () => { c.state.dumbbellsTaken = true; } },
      { spot: 'dumbbells', emoji: '🏋️', label: '举哑铃', anim: 'curl', minutes: [10, 15], props: 'dumbbells', gain: { energy: -10, hygiene: -10, fun: 8 } },
      { spot: 'dumbbells', emoji: '🏋️', label: '放回哑铃', anim: 'reach', minutes: 0.5, props: 'dumbbells',
        onEnd: () => { c.state.dumbbellsTaken = false; c.daily.exercise = true; } },
    ],
  },
  lookout: {
    log: '到阳台透透气',
    interruptible: true,
    score: ({ h }) => (inRange(h, 8, 19.5) ? 0.6 : 0),
    steps: () => [{ spot: 'lookout', emoji: '🌤️', label: '看风景', anim: 'lookout', minutes: [5, 10], gain: { fun: 8 } }],
  },
  idle: {
    log: '在屋里溜达溜达',
    interruptible: true,
    score: () => 0.4,
    steps: (c) => [{ spot: () => c.agent.randomSpot(), emoji: '💭', label: '发呆', anim: 'idle', minutes: [3, 8], gain: { fun: 2 } }],
  },
};
