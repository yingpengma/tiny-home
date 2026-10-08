# 小屋日常 · Tiny Home

一个住在 3D 小屋里的小人"小豆"，按自己的需求过日子：饿了做饭、渴了喝水、憋了上厕所、困了睡觉，闲下来看电视、看书、玩电脑、浇花、做运动。

- **需求驱动**：饱腹 / 水分 / 膀胱 / 精力 / 娱乐 / 清洁 6 项需求随时间下降，按"紧急程度 + 时段偏好 + 随机"挑下一件事
- **两种时间**：默认和访客本地时间同步；也可以切到加速模式（×60 ~ ×1440，空格暂停）
- **昼夜变化**：天色、阳光随时间变化，天黑且小豆醒着时自动开灯
- 纯静态网页，three.js 已放在 `vendor/` 里，无需 npm / 构建

## 本地运行

ES Module 不能直接双击打开，需要起一个静态服务器：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

调试参数：`?time=21.5` 从 21:30 开始并进入加速模式，`?speed=8` 指定加速档位（每真实秒走多少游戏分钟）。

## 部署到 GitHub Pages

1. 新建仓库（例如 `tiny-home`），把本目录内容推到 `main` 分支
2. 仓库 Settings → Pages → Source 选 "Deploy from a branch"，分支 `main`、目录 `/ (root)`
3. 几分钟后访问 `https://<用户名>.github.io/tiny-home/`，再从主页加个链接即可

## 代码结构

| 文件 | 作用 |
|---|---|
| `src/house.js` | 房子、家具、灯、交互点、寻路网格 |
| `src/character.js` | 小人模型和程序化动作（走、坐、躺、吃、洗澡…） |
| `src/activities.js` | 所有活动的打分规则和执行步骤，**加新行为改这里** |
| `src/agent.js` | 需求衰减、决策、走路/坐下/执行的状态机 |
| `src/grid.js` | 0.5m 网格 + A* 寻路 |
| `src/lighting.js` | 昼夜光照 |
| `src/ui.js` / `src/main.js` | 界面、时钟、主循环 |

three.js r186（MIT，见 `vendor/THREE-LICENSE`）。
