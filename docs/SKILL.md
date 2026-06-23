---
name: feishu-app-dev
description: |
  飞书自建应用全栈开发 skill。Bitable 多维表格作数据库 + 网页应用嵌入工作台 +
  FastAPI 后端 + React H5 前端。USE FOR: 新建飞书 Bitable 应用项目、实现免登鉴权、
  Bitable CRUD 读写、三级缓存架构、ngrok/域名部署、性能诊断优化。
  DO NOT USE FOR: 飞书机器人、纯前端页面、飞书小程序、非 Bitable 数据库项目。
---

# 飞书应用开发

## 决策流（收到需求先看这里）

```
1. 数据存哪？
   → 默认 Bitable（不引入独立 DB/Redis/PG）
   → 例外：需事务/高并发/复杂 Join → 告知用户 Bitable 不适合

2. 用户入口？
   → 默认飞书工作台 H5 网页应用

3. 技术栈？
   → FastAPI + React + antd-mobile + SQLite WAL 本地缓存

4. 开发顺序？
   → mock 跑通 → real 联调 → 部署

5. 部署？
   → 有域名 → 路径A (Nginx + certbot :443)
   → 无域名 → 路径B (ngrok :8080)
```

## 项目骨架（新建项目照此创建）

```
backend/app/
  api/           # auth_routes, materials, transactions, inventory, admin
  auth/          # deps.py: get_current_user, exchange_code_for_user
  bitable/       # client.py(HTTP), repository.py(业务), fields.py(解析), sqlite_cache.py
  services/      # feishu_client.py(鉴权), inventory.py(业务)
  config.py, models.py, main.py
frontend/src/
  auth/feishu.ts # JSAPI 免登
  api/index.ts   # HTTP + localStorage 缓存层
  components/    # AuthGate, Layout, 业务组件
  pages/         # 业务页面
```

## 六大铁律（违反必出 bug）

### 1. httpx 连接池复用
```python
# ✅ 单例，整个进程复用
class BYTableClient:
    def __init__(self):
        self._http = None
    async def _ensure_http(self):
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=8.0),
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=10))
        return self._http

# ❌ 每次 new → TCP+TLS 握手多花 500ms
async with httpx.AsyncClient(timeout=30.0) as client:
    ...
```

### 2. 三级缓存，绝不裸调飞书 API
```
请求 → ① 内存 dict(TTL 300s) → miss
         → ② SQLite WAL → miss/过期
              → ③ 飞书 API(1.5-2.5s)
```
所有 Bitable 读走 `_list_all()`，不要直接 `client.list_records()`。
启动 lifespan 必须从 SQLite 回填内存缓存：
```python
for table_id in sqlite.snapshot():
    records = sqlite.get_records(table_id)
    _TABLE_CACHE[(app_token, table_id)] = (now, records)
```

### 3. 分页在数据库层，不在内存
```python
# ✅ SQLite 原生分页
records, total = sqlite.query_records(table_id, limit=50, offset=0, order_desc=True)
# ❌ 全量加载后 Python 切片
records = await self._list_all(table_id)
return records[:50]
```

### 4. Bitable 字段用专用解析函数
```python
def field_link_id(value)   # link字段: {"record_ids":["rec_xxx"]}
def field_user_name(value) # 用户字段: [{"id":"ou_xxx","name":"张三"}]
def field_number(value)    # 数字字段，空值→0
# ❌ 绝不用 fields.get("字段名") 直接取值
```

### 5. 飞书三处 URL 必须一致
主页 URL = 重定向 URL = H5 可信域名 = `backend/.env` 中 `FEISHU_REDIRECT_URI` 和 `CORS_ORIGINS`

### 6. 写操作用失败补偿（Bitable 无事务）
```python
await update_inventory(+N)
try:
    await create_transaction()
except:
    await update_inventory(-N)  # 回滚
    raise
```

## 鉴权模板

```python
# backend/app/auth/deps.py
async def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_mock_role: str | None = Header(default=None, alias="X-Mock-Role"),
) -> User:
    token = _extract_bearer(authorization)
    if token:
        user = get_session(token)
        if user: return user
        raise HTTPException(401, "登录已过期")
    if settings.mock_auth_enabled:
        return User(open_id="mock", name=..., role=_role_from_header(x_mock_role))
    raise HTTPException(401, "未登录")

async def exchange_code_for_user(code, settings) -> tuple[User, dict]:
    # code → user_access_token → user_info → 群组角色判定
    client = FeishuClient(settings)
    return await client.exchange_code_for_user(code)
```

前端：
```typescript
// ① JSAPI requestAccessCode → code
// ② POST /api/auth/feishu/login {code} → token
// ③ localStorage.setItem("token", token)
// ④ fetch(url, { headers: { Authorization: `Bearer ${token}` }})
```

## Bitable 客户端模板

```python
class BYTableClient:
    def __init__(self, settings):
        self.settings = settings
        self._http = None  # 懒初始化

    async def _ensure_http(self):
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=8.0),
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=10))
        return self._http

    async def list_records(self, table_id, page_size=500, retries=3):
        """分页读取全表，自动处理 has_more + page_token"""
        token = await self._tenant_token()
        items, page_token = [], None
        while True:
            params = {"page_size": page_size}
            if page_token: params["page_token"] = page_token
            resp = await self._request("GET",
                f"/bitable/v1/apps/{self.settings.bitable_app_token}/tables/{table_id}/records",
                token=token, params=params, retries=retries)
            data = resp.json()["data"]
            items.extend(data.get("items", []))
            if not data.get("has_more"): break
            page_token = data.get("page_token")
        return items

    async def create_record(self, table_id, fields):
        """写记录，必须传 user_id_type=open_id"""
        token = await self._tenant_token()
        resp = await self._request("POST",
            f"/bitable/v1/apps/{self.settings.bitable_app_token}/tables/{table_id}/records",
            token=token, params={"user_id_type": "open_id"}, json={"fields": fields})
        return resp.json()["data"]["record"]

    async def _request(self, method, url, *, token, retries=3, **kwargs):
        http = await self._ensure_http()
        headers = {"Authorization": f"Bearer {token}"}
        for attempt in range(retries):
            try:
                return await http.request(method, url, headers=headers, **kwargs)
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError):
                if attempt + 1 < retries:
                    await asyncio.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"{url} 请求失败")

    async def close(self):
        if self._http: await self._http.aclose()
```

## SQLite 缓存模板

```python
class SqliteCache:
    def __init__(self, db_path):
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")

    def upsert_records(self, table_id, records): ...
    def get_records(self, table_id) -> list[dict]: ...
    def query_records(self, table_id, limit, offset, order_desc, material_id=None):
        """→ (records, total_count)"""
    def get_cache_age(self, table_id) -> float | None: ...
    def archive_before(self, table_id, before_days): ...

    # 必须建索引：
    # CREATE INDEX idx_records_created ON records(table_id, created_time DESC);
    # CREATE INDEX idx_records_material ON records(table_id, json_extract(fields_json,'$.material_id'));
```

## 部署：先问"有域名吗？"

**有域名 → 路径A：**
```nginx
server {
    listen 443 ssl;
    server_name <域名>;
    ssl_certificate     /etc/letsencrypt/live/<域名>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<域名>/privkey.pem;
    root /var/www/<项目>/frontend/dist;
    location /api/ { proxy_pass http://127.0.0.1:8000/; }
    location / { try_files $uri $uri/ /index.html; }
}
server { listen 80; server_name <域名>; return 301 https://$host$request_uri; }
```
`.env`: `FEISHU_REDIRECT_URI=https://<域名>/api/auth/feishu/callback`

**无域名 → 路径B：**
```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
ngrok http 8080
```
Nginx 监听 8080（避 80/443），`.env` 和飞书三处 URL 同步 ngrok 临时域名。
⚠️ 提醒用户：免费 ngrok 每次重启域名变，需重配。

## Mock 模式

开发初期用 mock 跑通，告诉用户：
```env
BITABLE_MODE=mock
MOCK_AUTH_ENABLED=true
```
请求带 `X-Mock-Role: ADMIN` 即可。不依赖飞书和 Bitable。

## 错误速查表

| 错误 | 直接修复 |
|------|---------|
| `Data not ready` | 表刚创建，retry 3 次 |
| `cannot unpack non-iterable NoneType` | 检查缩进，return 是否在 except 块内 |
| 飞书白屏 | 移除 console.time、preconnect、SDK async |
| 链接字段空 | 用 field_link_id() 解析 record_ids 数组 |
| 操作人乱码 | 用 field_user_name() 解析 `[{"id":"ou_xxx"}]` |
| ngrok 9009 | unset http_proxy https_proxy |
| 静态页 500 | chmod 755 或移到 /var/www/ |
| 启动预热卡死 | best-effort，失败不阻塞 |
| 角色判定 401 | 检查是否缺 `import logging` |

## 代码审查检查清单

- [ ] httpx.AsyncClient 单例复用？
- [ ] lifespan 从 SQLite 回填了 _TABLE_CACHE？
- [ ] 流水查询用 sqlite.query_records 分页？
- [ ] 多表读取用 asyncio.gather 并行？
- [ ] health 接口有结果缓存？
- [ ] cache/refresh 有智能跳过？
- [ ] link/用户字段用专用解析函数？
- [ ] Bitable 写操作有失败补偿？
- [ ] 前端触控 ≥44px、用 Dialog.confirm？
