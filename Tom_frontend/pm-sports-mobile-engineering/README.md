# PM体育 H5 移动端工程包

基于已确认的 390 × 844 移动端高保真原型拆分为可运行工程。当前实现为 Vite + React + TypeScript 单页 H5，保留赛事列表、联赛筛选、投注单 bottom sheet、赛事详情全屏抽屉、我的注单、设置等核心交互。

## 快速启动

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址。默认 Vite 端口为 `5173`。

## 构建与预览

```bash
npm run build
npm run preview
```

构建产物输出到 `dist/`，可直接部署到 Vercel、Netlify、Nginx 静态目录或任意静态托管服务。

## 文件结构

```text
pm-sports-mobile-engineering/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── types.ts
│   ├── data/mockData.ts
│   ├── utils/calc.ts
│   └── components/
│       ├── TopBar.tsx
│       ├── MainTabs.tsx
│       ├── LeagueStrip.tsx
│       ├── SearchFilter.tsx
│       ├── DateChips.tsx
│       ├── MatchCard.tsx
│       ├── BottomBetBar.tsx
│       ├── BetSlipSheet.tsx
│       ├── LeagueFilterSheet.tsx
│       ├── MatchDetailDrawer.tsx
│       ├── MyBetsSheet.tsx
│       ├── SettingsSheet.tsx
│       ├── BottomSheet.tsx
│       ├── Toast.tsx
│       └── Icons.tsx
├── public/prototypes/
│   ├── A-match-list.png
│   ├── B-betslip-sheet.png
│   ├── C-match-detail.png
│   └── prototype-board.png
└── docs/standalone-prototype.html
```

## 当前已实现交互

- 顶部栏：PM体育品牌、WS 连接状态、设置、账户余额、我的注单入口。
- 主筛选：全部、滚球、今日、早盘、热门、收藏、冠军。
- 联赛筛选：横向快捷入口 + 底部联赛筛选抽屉。
- 赛事列表：联赛分组、收藏、比分、状态、盘口数量、赔率按钮。
- 投注单：点击赔率加入/移除，底部固定投注条，bottom sheet 展开，金额输入、快捷金额、单关/串关、预计可赢。
- 赛事详情：全屏抽屉、比分板、盘口 tabs、盘口网格、详情页底部投注条。
- 我的注单：全屏 sheet、概览卡、筛选 chips、注单卡片。
- 设置：赔率格式、赛事排序、盘口显示、声音提醒、震动反馈、赔率变化策略。
- Toast：收藏、加入投注单、盘口刷新、投注成功等反馈。

## 替换真实接口的位置

- `src/data/mockData.ts`：当前 mock 的赛事、联赛、注单数据。
- `src/App.tsx`：主状态、筛选逻辑、投注单逻辑。
- `src/utils/calc.ts`：金额、赔率、预计可赢计算。

建议接入真实接口时新增：

```text
src/services/api.ts
src/services/ws.ts
src/store/useSportsStore.ts
```

然后逐步把 `mockData.ts` 替换为 API / WebSocket 数据。
