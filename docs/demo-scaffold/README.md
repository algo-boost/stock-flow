# 飞书 Bitable 应用脚手架

最小可运行模板。复制 → 填凭证 → 跑通 → 加业务。

## 使用

```bash
# 1. 复制脚手架
cp -r docs/demo-scaffold /path/to/new-project
cd /path/to/new-project

# 2. 后端
cd backend
python -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # 填入飞书凭证（mock 模式可跳过）
python -m uvicorn app.main:app --reload

# 3. 前端
cd frontend
npm install
cp .env.example .env
npm run dev

# 4. 验证
curl http://localhost:8000/api/health
# → {"code":0,"data":{"status":"ok","bitable_mode":"mock",...}}

curl http://localhost:8000/api/materials/search?q=螺丝
# → {"code":0,"data":{"items":[...],"total":1}}
```

## mock 模式（无需飞书凭证）

```env
# backend/.env
BITABLE_MODE=mock
MOCK_AUTH_ENABLED=true
```

前端 API 请求带 `X-Mock-Role: ADMIN` 即可，内存假数据立即可测。

## real 模式（接入真实飞书）

在飞书开放平台创建自建应用 → 获取 App ID/Secret → 创建 Bitable 表格 → 填入 `.env`：

```env
BITABLE_MODE=real
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
BITABLE_APP_TOKEN=tbl_xxx
BITABLE_TABLE_CATEGORIES=tbl_xxx
BITABLE_TABLE_LOCATIONS=tbl_xxx
BITABLE_TABLE_MATERIALS=tbl_xxx
BITABLE_TABLE_INVENTORY=tbl_xxx
BITABLE_TABLE_TRANSACTIONS=tbl_xxx
```

## 目录

```
demo-scaffold/
├── backend/
│   ├── app/
│   │   ├── api/           # auth_routes, materials, admin
│   │   ├── auth/          # deps.py
│   │   ├── bitable/       # client, fields, mock_store, sqlite_cache
│   │   ├── services/      # inventory
│   │   ├── config.py
│   │   ├── models.py
│   │   └── main.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── auth/feishu.ts
│   │   ├── api/index.ts
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
└── README.md
```
