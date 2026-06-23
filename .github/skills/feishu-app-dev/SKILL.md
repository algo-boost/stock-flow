---
name: feishu-app-dev
description: |
  飞书自建应用全栈开发。Bitable 多维表格作数据库 + 网页应用嵌入工作台 +
  FastAPI 后端 + React H5 前端。触发词：飞书、Bitable、多维表格、feishu、
  网页应用、H5 免登、JSAPI、tenant_access_token、库存管理、物料管理。
  USE FOR: 新建飞书应用、Bitable CRUD 读写、免登鉴权、ngrok/域名部署、性能优化。
  DO NOT USE FOR: 飞书机器人、飞书小程序、非 Bitable 数据库。
argument-hint: '[飞书应用开发]'
---

# 飞书应用开发

## 决策流（收到需求先判断）

```
1. 数据存哪？ → 默认 Bitable（不引入独立 DB/Redis/PG）
2. 入口？     → 飞书工作台 H5 网页应用
3. 技术栈？   → FastAPI + React + antd-mobile + SQLite WAL
4. 开发顺序？ → mock 跑通 → real 联调 → 部署
5. 部署？     → 有域名→路径A(Nginx+certbot :443) / 无域名→路径B(ngrok :8080)
```

## 六大铁律

### 1. httpx 连接池必须复用
```python
# ✅ 单例复用，整个进程共享
class BYTableClient:
    def __init__(self): self._http = None
    async def _ensure_http(self):
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=8.0),
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=10))
        return self._http
# ❌ 每次 new httpx.AsyncClient → TCP+TLS 握手多花 500ms
```

### 2. 三级缓存，不裸调飞书 API
```
请求 → ① 内存 dict(TTL 300s) → miss → ② SQLite WAL → miss → ③ 飞书 API(1.5-2.5s)
```
启动 lifespan 必须从 SQLite 回填内存缓存。

### 3. 分页在数据库层
```python
# ✅ SQLite 原生 LIMIT/OFFSET
records, total = sqlite.query_records(table_id, limit=50, offset=0, order_desc=True)
# ❌ 全量加载后 Python 切片
records = await _list_all(table_id); return records[:50]
```

### 4. Bitable 字段用专用解析
```python
field_link_id(v)    # link字段: {"record_ids":["rec_xxx"]}
field_user_name(v)  # 用户字段: [{"id":"ou_xxx","name":"张三"}]
field_number(v)     # 数字字段，空值→0
# ❌ 绝不用 fields.get("字段名") 直接取值
```

### 5. 三处 URL 一致
主页URL = 重定向URL = H5可信域名 = `.env` 中 FEISHU_REDIRECT_URI 和 CORS_ORIGINS

### 6. 写操作用失败补偿
```python
await update_inventory(+N)
try: await create_transaction()
except: await update_inventory(-N)  # 回滚
```

## 新建项目

复制脚手架 → 填凭证 → 跑通：
```
cp -r .github/skills/feishu-app-dev/assets/scaffold /path/to/new-project
cd backend && pip install -r requirements.txt && cp .env.example .env
cd frontend && npm install && npm run dev
```
详细说明见 [README](./assets/scaffold/README.md)

## 鉴权模板

```python
# backend/app/auth/deps.py
async def get_current_user(
    settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_mock_role: str | None = Header(default=None, alias="X-Mock-Role"),
) -> User:
    token = _extract_bearer(authorization)
    if token:
        if user := get_session(token): return user
        raise HTTPException(401, "登录已过期")
    if settings.mock_auth_enabled:
        return User(open_id="mock", name="用户", role=_role_from_header(x_mock_role))
    raise HTTPException(401, "未登录")
```

前端免登：
```typescript
// ① JSAPI requestAccessCode → code
// ② POST /api/auth/feishu/login {code} → token
// ③ localStorage.setItem("token", token)
// ④ fetch(url, { headers: { Authorization: `Bearer ${token}` }})
```

## 部署

**先问用户"有域名吗？"**

**有域名 → 路径A：**
```nginx
server { listen 443 ssl; server_name <域名>;
    ssl_certificate /etc/letsencrypt/live/<域名>/fullchain.pem;
    root /var/www/<项目>/frontend/dist;
    location /api/ { proxy_pass http://127.0.0.1:8000/; }
    location / { try_files $uri $uri/ /index.html; } }
server { listen 80; server_name <域名>; return 301 https://$host$request_uri; }
```
`.env`: `FEISHU_REDIRECT_URI=https://<域名>/api/auth/feishu/callback`

**无域名 → 路径B：**
```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
ngrok http 8080
```
Nginx 监听 8080（避 80/443），飞书三处 URL 和 `.env` 同步 ngrok 域名。
⚠️ 提醒用户：免费 ngrok 每次重启域名变。

## Mock 模式

开发初期用 mock：
```env
BITABLE_MODE=mock
MOCK_AUTH_ENABLED=true
```
请求带 `X-Mock-Role: ADMIN`，内存假数据秒级可测。

## 错误速查

| 错误 | 直接修复 |
|------|---------|
| `Data not ready` | retry 3 次 |
| `cannot unpack non-iterable NoneType` | 检查缩进，return 在 except 块内 |
| 飞书白屏 | 移除 console.time、preconnect、SDK async |
| 链接字段空 | 用 field_link_id() 解析 record_ids 数组 |
| 操作人乱码 | 用 field_user_name() 解析 `[{"id":"ou_xxx"}]` |
| ngrok 9009 | unset http_proxy https_proxy |
| 静态页 500 | chmod 755 或移到 /var/www/ |
| 启动预热卡死 | best-effort，失败不阻塞 |
| 角色判定 401 | 检查是否缺 `import logging` |

## 代码审查清单

- [ ] httpx.AsyncClient 单例复用？
- [ ] lifespan 从 SQLite 回填了 _TABLE_CACHE？
- [ ] 流水查询用 sqlite.query_records 分页？
- [ ] 多表读取用 asyncio.gather 并行？
- [ ] link/用户字段用专用解析函数？
- [ ] Bitable 写操作有失败补偿？
