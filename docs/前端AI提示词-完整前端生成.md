# 物料出入库管理系统 — 前端生成提示词

> 将此提示词复制给前端 AI，用于生成完整的 React + TypeScript + Vite 前端项目。

---

## 项目概述

**物料出入库管理系统** 是面向机器人实验室团队的轻量级库存管理 H5 应用，嵌入飞书工作台。核心目标：记清楚、找得到、可追溯。

**技术栈**：React 18 + TypeScript + Vite + antd-mobile + React Router v6

**后端**：FastAPI，代理到 `/api/*`，返回 `{ code: 0/非0, message: "...", data: ... }` 格式。

---

## 一、环境配置

### 1.1 `vite.config.ts`

```typescript
// Vite dev 代理：/api → http://127.0.0.1:8000（去掉 /api 前缀）
// Dev server port: 5173
// 无需额外配置 CORS
```

### 1.2 `.env`

```
VITE_API_BASE=/api
VITE_USE_MOCK_AUTH=true    # 非飞书环境使用 mock 鉴权
VITE_MOCK_ROLE=USER        # 可选 USER/KEEPER/ADMIN
```

### 1.3 启动

```bash
npm install
npm run dev
```

---

## 二、鉴权体系

### 2.1 鉴权流程

```
App 启动 → AuthProvider 挂载
  ├─ 浏览器（非飞书）→ 请求头带 X-Mock-Role + X-Mock-User
  ├─ 飞书客户端      → 飞书免登获取 code → POST /auth/feishu/login → 拿到 token
  └─ 所有后续请求     → Authorization: Bearer {token}
```

### 2.2 角色定义

| 角色 | 代码 | 权限 |
|------|------|------|
| 研发成员 | `USER` | 搜索物料、提交出库申请、查看个人历史 |
| 库管员 | `KEEPER` | + 入库登记、库内移动、库位维护 |
| 管理员 | `ADMIN` | + 运营中心、审批、数据纠错 |

### 2.3 关键 API

```typescript
GET  /me                          → { user: { open_id, name, role }, role_meta }
POST /auth/feishu/login           → { token }
GET  /auth/jsapi-config?url=...   → { appId, timestamp, nonceStr, signature }
```

---

## 三、路由表

```
/                    → SearchPage（搜索页）
/materials/:id       → DetailPage（物料详情）
/stock               → StockPage（出入库页）
/purchase            → PurchasePage（进货页，ADMIN）
/locations           → LocationsPage（库位管理，KEEPER/ADMIN）
/history             → HistoryPage（流水历史）
/returns             → PendingReturnsPage（待归还）
/admin-center        → AdminCenterPage（运营中心，ADMIN）
/outbound            → 重定向到 /stock
/inbound             → 重定向到 /stock?tab=inbound
/transfer            → 重定向到 /locations?tab=transfer
/approvals           → 重定向到 /admin-center
*                    → 重定向到 /
```

---

## 四、数据模型（TypeScript）

```typescript
type Role = "ADMIN" | "KEEPER" | "USER";

interface User {
  open_id: string;
  name: string;
  role: Role;
}

interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  major_name?: string | null;   // 大类
  mid_name?: string | null;     // 中类
  sub_name?: string | null;     // 小类
  default_location_type?: string | null;
  examples?: string | null;
  material_count?: number;
  stock_quantity?: number;
}

interface Material {
  id: string;
  code: string;
  name: string;
  category_id: string;
  category_name?: string;
  major_category?: string | null;
  mid_category?: string | null;
  sub_category?: string | null;
  unit: string;
  spec?: string;
  barcode?: string;
  default_location_id?: string | null;
  supplier?: string | null;
  min_stock: number;
}

interface Location {
  id: string;
  code: string;
  name: string;
  type: string;
  parent_id?: string | null;
  major_name?: string | null;
  mid_name?: string | null;
  sub_name?: string | null;
}

interface InventoryItem {
  material_id: string;
  location_id: string;
  location_name?: string;
  row?: number | null;
  column?: number | null;
  quantity: number;
  last_updated?: string | null;
}

interface Transaction {
  id: string;
  type: "入库" | "出库" | "移动";
  material_id: string;
  material_name?: string;
  location_id: string;
  location_name?: string;
  quantity: number;
  operator: string;
  remark?: string;
  created_at: string;
}

interface StockRequest {
  id: string;
  type: "入库" | "出库";
  status: "待审批" | "已通过" | "已拒绝";
  material_id: string;
  material_name?: string;
  location_id?: string | null;
  quantity: number;
  requester_name: string;
  remark?: string | null;
  reject_reason?: string | null;
  created_at: string;
}

interface MaterialDetail {
  material: Material;
  inventory: InventoryItem[];
  total_quantity: number;
}
```

---

## 五、API 函数（完整列表）

```typescript
// 用户
getMe(): { user, role_meta }

// 物料
searchMaterials(q, { page, size, searchBy, category }): PaginatedMaterials
getMaterial(id): MaterialDetail
getMaterialTransactions(id, limit?): Transaction[]
createMaterial(payload): Material
updateMaterial(id, payload): Material
deleteMaterial(id): { deleted }

// 分类
listCategories(): Category[]
createCategory({ name, parent_id? }): Category
deleteCategory(id): { deleted }
updateCategory(id, { name? }): Category

// 库位
listLocations(): Location[]
createLocation({ code, name, type, parent_id? }): Location
updateLocation(id, { code?, name?, type?, parent_id? }): Location
deleteLocation(id): { deleted }

// 库位类型
listLocationTypes(): string[]
addLocationType(name): string[]
removeLocationType(name): string[]
updateLocationType(oldName, newName): string[]

// 出入库
postInbound({ material_id, location_id, qty, idempotency_key, note, row?, column? }): { transaction_id }
postOutbound({ material_id, location_id, qty, idempotency_key, note, return_required, return_due_at?, row?, column? }): { transaction_id }
postPurchaseInbound({ supplier, ...InboundCreate }): { transaction_id }
postTransfer({ material_id, from_location_id, to_location_id, qty, idempotency_key, note, to_row?, to_column? }): { transaction_ids }

// 库存
listInventory(materialId?, locationId?): InventoryItem[]
listLowStock(): LowStockItem[]
updateInventorySlot(materialId, locationId, { row, column }): InventoryItem

// 申请审批
createStockRequest(payload): { request_id }
listMyRequests(opts?): StockRequest[]
listApprovalRequests(opts?): StockRequest[]
approveStockRequest(id, payload?): StockRequest
rejectStockRequest(id, reason): StockRequest

// 流水
listTransactions({ keyword?, operator?, start_at?, end_at?, limit? }): Transaction[]

// 归还
listPendingReturns(borrower?): PendingReturn[]

// 管理员
getAdminOverview({ start_at?, end_at? }): AdminOverview
getAdminAudit({ start_at?, end_at?, limit? }): AdminAudit
getAdminSystem(): AdminSystem
refreshBitableCache(): { tables, refreshed, failed }

// 管理员纠错
updateTransaction(id, { quantity?, remark? }): Transaction
updateRequest(id, { quantity?, remark? }): StockRequest
updateInventoryRecord(materialId, locationId, { quantity }, row?, column?): InventoryItem
```

---

## 六、页面详细规格

### 6.1 SearchPage（`/`）— 搜索页

**功能**：
- 搜索栏 + 搜索模式选择（all/name/code/category）
- 搜索建议下拉（分类 + 物料混合）
- 分类树浏览（CategoryTree 组件，支持展开/折叠）
- 物料卡片列表（显示名称、编码、库存量、库位摘要、分类路径）
- 缺货物料红色标记
- 管理员可见分类管理按钮（添加/删除/编辑分类）

**API 调用**：`listCategories()`, `searchMaterials()`, `createCategory()`, `deleteCategory()`, `updateCategory()`

**状态**：`keyword`, `searchBy`, `selectedCategoryId`, `categories`, `items`, `page`, `total`, `loading`

**分类路径显示公式**：`[major_category, mid_category, sub_category].filter(Boolean).join(" / ")`

### 6.2 DetailPage（`/materials/:id`）— 物料详情

**功能**：
- 库存总览卡片（总库存、库位数、安全库存）
- 缺货预警横幅
- 基本信息表（编码、大类、中类、子类、规格、单位、供应商、安全库存、条码）
- 库存分布列表（每个库位的库存量 + 格位信息）
- 格位编辑（InventorySlotEditor，KEEPER/ADMIN 可编辑 row/column）
- 主数据维护面板（MaterialManagePanel，可修改物料名称/分类/规格/供应商，可删除）
- 最近流水列表

**API 调用**：`getMaterial()`, `getMaterialTransactions()`

### 6.3 StockPage（`/stock`）— 出入库页

**功能**：
- 两个 Tab：出库（StockOutboundPanel）/ 入库（StockInboundPanel）
- 入库流程：搜索/选择物料 → 填写数量/备注 → 选择库位/格位 → 提交
- 出库流程：搜索/选择物料 → 填写数量/备注/归还计划 → 选择出库库位 → 提交
- KEEPER/ADMIN 直接出入库；USER 提交申请
- 支持新建物料（选大类→中类（如有）→子类→填写名称/编码/规格）

**API 调用**：`searchMaterials()`, `getMaterial()`, `listLocations()`, `listCategories()`, `createMaterial()`, `postInbound()`, `postOutbound()`, `createStockRequest()`

### 6.4 PurchasePage（`/purchase`）— 进货页（ADMIN）

**功能**：
- 供应商采购入库（区别于普通入库）
- 搜索/选择物料 → 填写数量/供应商 → 入库

**API 调用**：`searchMaterials()`, `listLocations()`, `getMaterial()`, `postPurchaseInbound()`

### 6.5 LocationsPage（`/locations`）— 库位管理（KEEPER/ADMIN）

**功能**：
- 两个 Tab：库位维护 / 库内移动
- **库位维护**：
  - 新增/编辑/删除库位表单
  - 库位列表显示：层级缩进 + 编码 + 类型 + 库存量
  - 父库位选择器（可选，用于建立层级）
  - 管理员可见「库位类型管理」面板（增删改名库位类型）
- **库内移动**：LocationTransferPanel

**API 调用**：`listLocations()`, `listInventory()`, `createLocation()`, `updateLocation()`, `deleteLocation()`, `listLocationTypes()`, `addLocationType()`, `removeLocationType()`, `updateLocationType()`

**库位路径显示公式**：`[major_name, mid_name, sub_name].filter(Boolean).join(" › ")`

### 6.6 HistoryPage（`/history`）— 流水历史

**功能**：
- 流水列表（交易类型、物料名、库位、操作人、时间、备注标签）
- 我的申请列表（状态、类型、审批信息）
- 关键字/操作人/日期范围过滤
- 待归还面板
- ADMIN 快速切换审批入口

**API 调用**：`listTransactions()`, `listMyRequests()`, `listApprovalRequests()`, `listCategories()`

### 6.7 PendingReturnsPage（`/returns`）— 待归还

**功能**：
- 显示用户待归还的物料列表
- 快速导航到出库归还

**API 调用**：`listPendingReturns()`

### 6.8 AdminCenterPage（`/admin-center`）— 运营中心（ADMIN）

**功能**：
- 运营概览卡片（库存总数/流水数/入库量/出库量/待审批/缺货预警）
- 缺货预警列表
- 审批面板（ApprovealsPanel：通过/拒绝申请，出库审批选库位）
- 数据纠错面板（AdminDataPanel）：
  - 流水管理（可点击修改数量和备注）
  - 申请管理（可点击修改数量和备注）
  - 库存管理（可点击修改库存数量）
  - 分类管理（可点击修改分类名称）
- 组织/配置壳层（预览用）
- 审计面板（流水/操作人统计/角色检查）
- 系统状态面板

**API 调用**：`getAdminOverview()`, `getAdminAudit()`, `getAdminSystem()`, `listCategories()`, `listInventory()`, `listApprovalRequests()`, `listLocations()`, `updateTransaction()`, `updateRequest()`, `updateInventoryRecord()`, `updateCategory()`

---

## 七、组件规格

### 7.1 全局组件

| 组件 | 职责 |
|------|------|
| `AuthProvider` | 全局鉴权状态，暴露 `user/loading/refresh/canInbound/canApprove` |
| `AuthGate` | 角色门控，`roles={["ADMIN"]}` 包裹仅管理员可访问的内容 |
| `Layout` | 页面外壳：顶部导航栏 + 底部 TabBar |
| `CacheRefreshButton` | 触发 `/admin/cache/refresh` 刷新 Bitable 缓存 |

### 7.2 分类组件

| 组件 | 职责 |
|------|------|
| `CategoryTree` | 树形分类浏览器，展开/折叠，支持管理员增删改分类 |
| `CategoryCascade` | 级联分类选择器（侧栏+网格） |

### 7.3 物料组件

| 组件 | 职责 |
|------|------|
| `MaterialManagePanel` | 修改物料主数据弹窗（大类→中类→子类级联选择） |
| `InventorySlotEditor` | 编辑物料在库位中的格位（行/列） |

### 7.4 入库/出库组件

| 组件 | 职责 |
|------|------|
| `StockInboundPanel` | 入库工作流（直接入库/申请入库/新建物料） |
| `StockOutboundPanel` | 出库工作流（直接出库/申请出库/归还计划） |

### 7.5 管理组件

| 组件 | 职责 |
|------|------|
| `ApprovalsPanel` | 审批面板，列表 + 通过/拒绝操作 |
| `AdminDataPanel` | 数据纠错面板，流水/申请/库存/分类的列表+编辑弹窗 |
| `LocationTransferPanel` | 库内移动面板 |

### 7.6 UI 组件

| 组件 | 职责 |
|------|------|
| `PageHero` | 页面标题 + 副标题 |
| `SectionCard` | 卡片容器（标题 + 副标题 + 内容） |
| `StatCard` | 统计数字卡片 |
| `InfoRow` | 标签-值行 |
| `MaterialCard` | 物料摘要卡片 |
| `TxBadge` | 交易类型徽章（入库绿/出库红/移动黄） |
| `EmptyState` | 空状态占位 |
| `RoleBadge` | 角色标签 |
| `RolePermissions` | 权限说明 |

---

## 八、工具函数

| 文件 | 函数 | 职责 |
|------|------|------|
| `utils/categoryTree.ts` | `getRootCategories`, `getCategoryChildren`, `getCategoryPath`, `formatCategoryPath`, `buildCategorySections` | 分类树构建与路径格式化 |
| `utils/categoryOrder.ts` | `sortCategoriesForDisplay` | 分类排序 |
| `utils/inventoryDisplay.ts` | `formatInventorySlot`, `formatInventorySummary` | 库存格位格式化 |
| `utils/historyDisplay.ts` | `formatHistoryDate`, `sortRequestsByPriority`, `filterTransactionsByType` | 历史流水格式化 |
| `utils/requestDisplay.ts` | `formatReturnPlan` | 归还计划格式化 |

---

## 九、UI 风格

- **设计系统**：移动优先 H5，卡片式布局
- **配色**：主色 `#3370ff`，成功 `#00b578`，警告 `#ff8800`，危险 `#f54a45`
- **圆角**：卡片 `14px`，小卡片 `10px`
- **字体**：系统默认 sans-serif，等宽用于编码/数字
- **底部 TabBar**：固定底部，首页/出库/入库/历史/个人
- **状态徽章**：药丸形（`border-radius: 999px`）

---

## 十、注意事项

1. API 返回格式 `{ code: 0, message: "ok", data: ... }`，`code !== 0` 表示错误
2. 认证失败自动重试一次（仅飞书环境）
3. 页面 loading 状态用骨架或加载指示器
4. 空数据状态用 `EmptyState` 组件
5. 错误用 `Toast.show({ icon: "fail", content: message })`
6. 分类和库位的层级显示使用 `[a, b, c].filter(Boolean).join(" / ")`
7. 中类/小类为可选，旧数据只有大类+子类也需兼容
8. 中类选择器仅在存在中类数据时才渲染
