---
name: feishu-app-fullstack
description: |
  飞书自建应用全栈开发方法论。基于 Bitable 多维表格作数据库 + 网页应用嵌入工作台
  + FastAPI 后端 + React (antd-mobile) H5 前端。触发词：飞书应用开发、Bitable、
  多维表格、feishu app、库存管理、物料管理、FastAPI Bitable、H5 免登。
  USE FOR: 新建飞书 H5 应用、Bitable 数据写入/查询/缓存、飞书免登鉴权、三层缓存优化、
  ngrok/域名部署、mock 模式开发、前端 TS 修复、审批流程设计。
  DO NOT USE FOR: 飞书机器人开发、飞书小程序、非 Bitable 数据库、纯后端/纯前端不涉及飞书。
argument-hint: '[飞书应用全栈开发]'
---

# 飞书应用全栈开发（AI 编码助手专用）

## 决策树

```
收到飞书应用需求：
├─ 数据存哪？ → Bitable（不引入 PG/MySQL/Redis）
├─ 入口？     → 飞书工作台 H5 网页应用
├─ 前端？     → React 18 + TypeScript + antd-mobile + Material Symbols icons
├─ 后端？     → FastAPI + httpx 连接池 + SQLite WAL
├─ 鉴权？     → 飞书免登 JSAPI → code → token → Bearer header
├─ 角色？     → IM 群组成员判断 ADMIN/KEEPER/USER + env override 兜底
├─ 开发？     → mock 跑通 → real 联调 → 部署
└─ 部署？     → PM2 + Nginx/certbot 或 ngrok
```

## 铁律（违反必出 Bug）

### 1. SQLite 缓存永不过期

```python
# ✅ 正确：SQLite 有数据直接用，不判过期，后台异步刷新
if sqlite_age is not None:
    records = sqlite.get_records(table_id)
    if records:
        _TABLE_CACHE[key] = (now, records)
        asyncio.create_task(_background_refresh(table_id, key))  # 后台刷新
        return records  # 毫秒级

# ❌ 错误：SQLite 和内存共用 TTL，过期就跳过 SQLite 直拉飞书
sqlite_stale = sqlite_age is None or (now - sqlite_age > ttl)
if not sqlite_stale: use(sqlite)
```

### 2. 删 UI 必须全链路清理

删除一段 JSX → 同步删除：
- `import { X } from "antd-mobile"` 中未使用的组件
- `useState` / `useRef` / `useMemo` 中未使用的变量
- 事件处理函数（`handleCreate`, `onDelete` 等）
- `from "../api"` 中未使用的 API 函数
- `import type` 中未使用的类型

删完立即跑 `npx tsc --noEmit`，逐行修 TS6133。

### 3. ActionSheet + handler 时序：不准提前 close

```tsx
// ❌ BUG：closeMenu() 先清空 menuTarget → handleMenuAction 检查 null → return
onAction={async (action) => {
  closeMenu();
  await handleMenuAction(action.key);
}}

// ✅ handler 内部自己 setMenuTarget(null)
onAction={async (action) => {
  await handleMenuAction(action.key);
}}
```

### 4. 危险操作必须三步确认

```
按钮预检查（disabled={stock>0}）→ ActionSheet（danger:true）→ Dialog.confirm
```

审批通过也必须确认：`Dialog.confirm("确认通过XX出库N件？通过后立即扣减库存")`

### 5. Layout 不能嵌套

独立页面用 `component + <Layout>`，嵌入 tab 时只用 component（不含 Layout）。解决方案：
```tsx
export function PurchaseContent() { /* 内容 */ }
export default function PurchasePage() {  // 独立路由用
  return <AuthGate><Layout><PurchaseContent/></Layout></AuthGate>
}
// Stock tabs 里：<PurchaseContent/>  // 无 Layout
```

### 6. 前端缓存数组用 useMemo

Layout 的 tabs 列表每次渲染重建→底部导航栏不必要重渲染→页面闪烁。
```tsx
const tabs = useMemo(() => [...], [user, canApprove, pendingCount]);
```

---

## 错误速查

| 错误现象 | 直接定位 |
|---------|---------|
| 5 分钟后页面加载极慢或不显示 | SQLite 缓存被 TTL 误判过期，直拉飞书 API |
| ActionSheet 弹出但点选项无反应 | `closeMenu()` 在 `handleMenuAction` 之前执行 |
| 页面出现两个导航栏 | Layout 嵌套（嵌入 tab 时用了含 Layout 的 Page 组件） |
| `git pull` 报 `.db` 文件冲突 | `.db` / `tsbuildinfo` 未加入 .gitignore |
| TS6133 成片报错 | 删 JSX 没删对应 import/state/function |
| 审批"通过"按钮一键执行 | 缺 `Dialog.confirm` 确认 |
| `pm2: command not found` | PM2 在服务器上，本地用 `npm run dev` + `uvicorn` |
| `feishu_events` 回调 404 | 路由前缀不一致（装饰器里写了 `/api/` 但 main.py 又加了一遍） |

## 代码审查清单

执行任何修改后必须验证：
- [ ] `npx tsc --noEmit` exit 0
- [ ] `python -m py_compile *.py` 全部通过
- [ ] 前端 API 路径 = 后端路由 × `/api` 前缀
- [ ] 所有删除/审批操作有 Dialog.confirm 二次确认
- [ ] 没有 `import { useRef } from "react"` 然后 `useRef` 未使用
- [ ] ActionSheet `onAction` 没有提前 `closeMenu()`
- [ ] 没有 `<Layout>` 嵌套 `<Layout>`
- [ ] SQLite 缓存不判 TTL 过期
- [ ] `danger: true` 标记所有硬删除选项
- [ ] `.gitignore` 含 `*.db` 和 `*.tsbuildinfo`

## 技术栈固定组合

```
前端: React 18 + TypeScript 5 + Vite 5 + antd-mobile 5 + Material Symbols (Google Fonts) + react-router-dom 6
后端: FastAPI + httpx(连接池) + SQLite(WAL) + Bitable API
部署: PM2 + Nginx + certbot 或 ngrok
缓存: 内存 dict(300s TTL) → SQLite(持久化,不过期) → Bitable API(1.5~7s)
```

## Mock 模式快速开发

```env
BITABLE_MODE=mock
MOCK_AUTH_ENABLED=true
```
请求带 `X-Mock-Role: ADMIN|KEEPER|USER`，所有数据在内存，秒级可测全流程。
