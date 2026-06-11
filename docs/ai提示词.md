# AI 提示词

本文档汇总了项目中所有用于 AI 生成代码、文档和表格的提示词。

## 一、用于飞书多维表格 AI 功能生成表格的提示词

请为“物料出入库管理系统”生成用于飞书多维表格（Bitable）的 5 个表结构，满足以下要求：

- 数据模型包括：`categories`, `locations`, `materials`, `inventory`, `transactions`。
- 每张表需包含字段名称、字段类型、字段说明、字段是否必填、以及示例数据项。
- 设计应支持以下业务场景：物料分类管理、库位管理、物料搜索、出库、入库、库存查询、交易流水查询。
- `categories` 表应支持多级分类结构，至少包含根分类、子分类。
- `locations` 表应支持库位编码与类型区分（如 货柜、货架、快递暂存区）。
- `materials` 表应包含物料编码、名称、分类、单位、默认库位等字段。
- `inventory` 表应根据 `material_id` 与 `location_id` 保存当前数量和更新时间，支持按库位汇总。
- `transactions` 表应记录每次出库/入库操作，包含操作类型（in/out）、数量、操作者、时间、备注。
- 请为每张表输出一个简洁说明，明确它在整体系统中的作用。

请输出为飞书 Bitable 可直接迁入的表格设计文本。结束。

## 二、用于 AI 自动生成后端与前端工程的提示词

请为“物料出入库管理系统”生成完整工程骨架，满足以下要求：

- 技术栈：后端 Python 3.10+（FastAPI、uvicorn）、前端 React + Vite（Node 18）、依赖管理分别使用 `requirements.txt` 与 `package.json`。
- 后端结构：`app.main`、`app.config`、`app.auth`（Feishu OAuth/免登）、`app.bitable`（BYTableClient 封装）、`app.api.materials`、`app.api.inventory`、`app.api.transactions`、`app.middleware.auth`。提供上文列出的 8 个 API 的可运行实现（用内存或 Bitable 模拟器替代真实凭证）。
- 前端结构：`src/pages/Search`、`src/pages/Detail`、`src/pages/Inbound`、`src/pages/Outbound`、一个 `src/api` 封装用于调用后端接口，含基本路由与样式。
- 配置与运行：生成 `.env.example`（不包含真实 secret），README 包含本地运行步骤（virtualenv、pip install、npm install、启动命令）。
- 测试：为后端关键逻辑生成若干单元测试（pytest），并提供运行说明。
- 约束：不要在仓库中写入任何真实 secret；Bitable 与 Feishu 的真实凭证用 env 读取；代码需含注释与类型提示。

生成期望产出（按文件）：
- `backend/`：FastAPI 服务可本地启动且返回示例数据。
- `frontend/`：Vite + React 可运行的 H5 页面，能调用后端 API（或 mock）。
- `docs/`：包含本 README 与上面两个设计文档的引用。

结束。

## 三、用于 AI 生成模块实现的提示词

请根据下列模块设计生成后端与前端模块的可运行实现：

1. 后端实现要求：
  - 提供 `BYTableClient` 的最小实现（支持 `get`, `query`, `create`, `update`, `batch`），使用可切换的 HTTP 客户端或内存模拟器。
  - 实现用户鉴权依赖 `get_current_user`（可 Mock），并实现 `require_roles` 装饰器。
  - 实现 `/me`, `/materials/search`, `/materials/{id}`, `/materials/{id}/transactions`, `/outbound`, `/inbound`, `/inventory`, `/admin/bulk-sync` 路由，包含输入校验与示例响应。
  - 为 `outbound` 与 `inbound` 提供幂等校验（客户端应传 `idempotency_key`）。

2. 前端实现要求：
  - 生成基于 Vite 的 React 项目，含 `Search`, `Detail`, `Inbound`, `Outbound` 页面与路由。
  - `src/api` 使用 `fetch` 或 `axios` 封装后端请求，支持 mock 模式与真实后端切换。

3. 输出物件：
  - 完整文件树（backend/ frontend/ docs/）并生成可运行的 README 和 `.env.example`。
  - 为后端关键逻辑生成 `pytest` 测试样例。

约束：不要写入任何真实凭证；所有 secret 从 `.env` 读取；注重模块职责清晰与类型注解。

结束。
