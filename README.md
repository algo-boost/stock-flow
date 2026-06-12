# 物料出入库管理系统

飞书 H5 + FastAPI + Bitable 组合方案。默认 **mock 模式**可本地浏览器调试；配置凭证 + ngrok 后可在飞书客户端内免登联调。

## 本地启动（Mock）

### 后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

### 前端

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

浏览器打开 http://localhost:5173 。API 经 Vite 代理到 `http://127.0.0.1:8000`。

### 测试

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest
```

## Mock 鉴权（浏览器）

开发期通过请求头模拟角色（后端 `MOCK_AUTH_ENABLED=true`）：

| Header | 示例 | 说明 |
|--------|------|------|
| `X-Mock-Role` | `USER` / `KEEPER` / `ADMIN` | 角色 |
| `X-Mock-User` | `dev001` | 用户标识 |

前端默认角色：`VITE_MOCK_ROLE=USER`（`frontend/.env`）。

## 飞书本地联调（ngrok）

### 1. 飞书开放平台

1. 创建**企业自建应用**，记录 `App ID` / `App Secret`
2. **权限**：导入仓库根目录 [`feishu_permission_import.json`](feishu_permission_import.json)，并申请 `im:chat.members:read`（群组角色判定）
3. **网页应用**：启用 H5；**主页地址**填 ngrok HTTPS 域名（如 `https://xxxx.ngrok-free.app/`）
4. **安全设置**：重定向 URL、H5 可信域名与主页一致
5. 将应用**发布到测试版本**并加入可用范围

### 2. 内网穿透

只需穿透**前端** dev server（API 走 Vite `/api` 代理）：

```powershell
ngrok http 5173
```

记下 HTTPS 地址，例如 `https://abcd1234.ngrok-free.app`。

### 3. 后端 `.env`

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_REDIRECT_URI=https://abcd1234.ngrok-free.app/
MOCK_AUTH_ENABLED=false
BITABLE_MODE=mock
CORS_ORIGINS=http://localhost:5173,https://abcd1234.ngrok-free.app
```

`BITABLE_MODE=real` 时还需填 `BITABLE_APP_TOKEN` 与各表 `tbl_...` ID。

群组角色（可选，chat_id 为 `oc_` 开头）：

```env
FEISHU_GROUP_ADMIN=oc_xxx
FEISHU_GROUP_KEEPER=oc_xxx
FEISHU_GROUP_USER=oc_xxx
```

未配置群组时，登录用户默认 `USER` 角色。

### 4. 前端 `.env`

```env
VITE_USE_MOCK_AUTH=false
VITE_API_BASE=/api
```

### 5. 启动并验证

```powershell
# 终端 1
cd backend; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000

# 终端 2
cd frontend; npm run dev

# 终端 3
ngrok http 5173
```

1. 飞书开放平台主页地址改为当前 ngrok 域名
2. 飞书客户端 → 工作台 → 打开该网页应用
3. 应自动 `requestAuthCode` → 后端 `/auth/feishu/login` → 返回 Bearer token
4. 检查 `GET /health`：`feishu_configured: true`

### 鉴权流程

```
飞书客户端打开 H5
  → GET /auth/jsapi-config?url=当前页
  → h5sdk.config + tt.requestAuthCode
  → POST /auth/feishu/login { code }
  → 返回 token，前端存 localStorage
  → 后续请求带 Authorization: Bearer <token>
```

浏览器非飞书环境且 `MOCK_AUTH_ENABLED=true` 时仍可用 `X-Mock-Role` 调试。

## API（MVP）

| 方法 | 路径 | 角色 |
|------|------|------|
| GET | `/me` | ALL |
| POST | `/auth/feishu/login` | ALL |
| GET | `/auth/feishu/callback` | ALL |
| GET | `/auth/jsapi-config` | ALL |
| GET | `/materials/search` | ALL |
| GET | `/materials/{id}` | ALL |
| GET | `/materials/{id}/transactions` | ALL |
| GET | `/inventory` | ALL |
| POST | `/inbound` | KEEPER, ADMIN |
| POST | `/outbound` | ALL |
| POST | `/admin/bulk-sync` | ADMIN |

## 文档

见 [docs/](docs/) 目录；权威 PRD / 架构见 `docs/产品设计文档.md`、`docs/架构设计文档.md`。

## 后续

1. 填入 Bitable 表 ID，设 `BITABLE_MODE=real` 读写真实数据
2. 配置飞书群组 chat_id 完成三角色映射
3. 工作台正式嵌入与 UAT 验收
