# 物料出入库管理系统 — 开发约定

本仓库所有开发（含 AI Agent）须遵守项目约定。

## 强制规则

Cursor 持久规则：`.cursor/rules/stock-project-conventions.mdc`（`alwaysApply: true`）

## 权威文档

| 文档 | 用途 |
|------|------|
| [docs/产品设计文档.md](docs/产品设计文档.md) | 场景、功能、权限、MVP 范围 |
| [docs/架构设计文档.md](docs/架构设计文档.md) | 技术架构、**§3.4 组合方案实施路径**、数据表、部署 |
| [Wiki 产品设计文档](https://zcnce50wan15.feishu.cn/wiki/Nzw3wX2USiIjtckGQbVckSQRnFf) | 初稿 + 开发过程实录（主文档） |
| [开发过程实录（飞书副本）](https://zcnce50wan15.feishu.cn/docx/YJ4iduq3ToSma8xzuvuci9BlnJg) | 全天协作过程，分享案例 |

**有冲突以文档为准。** 决策变更须先更新文档与文末「变更记录」，再实施。

## MVP 组合方案（已决，反造轮子）

```
Erniu/官方 Bitable 模板  +  lark-samples 网页应用  +  自研薄层（4 H5 页 + 8 API）
```

| 拿来用 | 自研 |
|--------|------|
| [Erniu Bitable 模板](https://ccn1hpzj4iz4.feishu.cn/base/DyAYb1D2RaYcbQsjdsdcZOEOnad) 五表初始化 | 按 PRD 改分类/库位字段 |
| [lark-samples](https://github.com/larksuite/lark-samples) 免登 + JSAPI | 4 页：搜索、出库、入库、详情 |
| [Erniu](https://github.com/dyue708/Erniu-Inventory-management-AI-agent) 出入库写表逻辑（去 AI/利润） | FastAPI 8 个 MVP API + 角色校验 |

- **入口**：[飞书网页应用嵌入工作台](https://open.feishu.cn/document/embed-web-app-into-feishu-workbench/introduction)
- **工期**：组合方案约 1 周（全从零约 2～3 周）
- **部署环境**：可后置，不阻塞 P0/P1

完整条款见 `.cursor/rules/stock-project-conventions.mdc` 与架构文档 §3.4。
