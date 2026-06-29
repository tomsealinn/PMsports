# Codex 修改与部署交接说明

## 目标

把当前原型工程改造成可接入真实数据的 PM体育移动端 H5。首屏必须是可操作赛事列表，不要改成营销页。

## 技术栈

- Vite
- React
- TypeScript
- 纯 CSS，无 UI 框架依赖
- SVG 线性图标组件：`src/components/Icons.tsx`

## 原型参考

原型图已放在：

```text
public/prototypes/A-match-list.png
public/prototypes/B-betslip-sheet.png
public/prototypes/C-match-detail.png
public/prototypes/prototype-board.png
```

独立静态原型备份：

```text
docs/standalone-prototype.html
```

## 需要保留的信息架构

1. 顶部：PM体育品牌、连接状态、设置、登录/余额入口。
2. 核心：足球赛事列表、滚球/今日/早盘/热门/收藏/冠军筛选。
3. 联赛筛选：横向快捷入口 + 底部筛选抽屉。
4. 赛事卡片：主客队、联赛、开赛时间/滚球时间、比分、盘口数量、收藏。
5. 赔率按钮：让球、大小、独赢等，按钮高度不小于 44px。
6. 投注单：底部固定投注按钮，点击后展开 bottom sheet。
7. 赛事详情：移动端全屏抽屉，顶部比分板，下面盘口 tabs。

## 可优先修改的文件

### 页面和状态

```text
src/App.tsx
```

包含筛选、收藏、投注单、详情页开关等状态。真实项目中建议迁移到 Zustand / Redux / React Query。

### 样式

```text
src/styles.css
```

所有视觉 token 和组件样式都在这里。请保留：

```css
font-variant-numeric: tabular-nums;
padding-bottom: env(safe-area-inset-bottom);
```

### 数据

```text
src/data/mockData.ts
```

当前 mock 数据可替换为：

```ts
fetchLeagues()
fetchMatches(filters)
fetchMatchDetail(matchId)
fetchMyBets()
```

### 计算

```text
src/utils/calc.ts
```

投注金额、赔率、预计可赢计算在这里。

## 建议新增 API 层

```text
src/services/api.ts
src/services/ws.ts
```

示例：

```ts
export async function fetchMatches(params: MatchQuery) {
  const res = await fetch('/api/matches?' + new URLSearchParams(params));
  if (!res.ok) throw new Error('fetch matches failed');
  return res.json();
}
```

## 建议新增环境变量

```text
VITE_API_BASE_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com/ws
```

## 验收清单

- `npm install` 正常。
- `npm run dev` 正常预览。
- `npm run build` 无 TypeScript 报错。
- 390px 宽度首屏无横向滚动。
- 赔率按钮高度不小于 44px。
- 选择赔率后投注单、赛事卡、详情页状态同步。
- Bottom sheet 不遮挡 iOS safe area。
- 详情页返回后列表状态保留。
- 联赛筛选可以重置和确认。
- 空状态、错误状态、loading 状态接入前预留。
