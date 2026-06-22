# 前端适配指南 — 三级分类/库位体系

> 给前端 AI 或开发者的提示词，描述三类数据模型的三级层级变化及前端需适配的要点。

---

## 一、数据模型变化

### 1.1 Category（分类）

```typescript
interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  major_name?: string | null;   // 大类（如"电气类"）
  mid_name?: string | null;     // 🆕 中类（如"电机模组"）
  sub_name?: string | null;     // 小类（如"直流电机"）
  // ...
}
```

**层级规则**（由后端 `derive_category_levels` 自动派生）：
- 根 → `major=name, mid=null, sub=null`
- 父为根 → `major=父.name, mid=null, sub=name`
- 父为二级 → `major=祖父.name, mid=父.name, sub=name`

### 1.2 Material（物料）

```typescript
interface Material {
  major_category?: string | null;
  mid_category?: string | null;   // 🆕
  sub_category?: string | null;
  // ...
}
```

### 1.3 Location（库位）

```typescript
interface Location {
  parent_id?: string | null;      // 🆕 父库位
  major_name?: string | null;     // 🆕 库位大类
  mid_name?: string | null;       // 🆕 库位中类
  sub_name?: string | null;       // 🆕 库位小类
  // ...
}
```

---

## 二、显示适配清单

| 页面/组件 | 原有显示 | 新显示 |
|-----------|---------|--------|
| `Search.tsx` 卡片 | `大类 / 子类` | `大类 / 中类 / 子类` |
| `Search.tsx` 建议 | `大类 / 子类` | 同上 |
| `Detail.tsx` | 大类、子类两行 | 大类、**中类**、子类三行 |
| `History.tsx` | `大类 / 子类` | `大类 / 中类 / 子类` |
| `AdminDataPanel.tsx` | 分类路径 | 三级路径 `大类 › 中类 › 子类` |
| `Locations.tsx` | 库位名+类型 | 加层级面包屑 `A柜 › 第二层 › 第三格` |

**显示公式**（通用）：
```typescript
[major, mid, sub].filter(Boolean).join(" / ") || fallback
```

---

## 三、表单适配清单

### 3.1 MaterialManagePanel（物料修改弹窗）

- 大类选择器 → 选中大类后重置 `midCategory` 和 `categoryId`
- 🆕 中类选择器 → 仅在大类下有中类时显示；选中中类后重置 `categoryId`
- 子类选择器 → 根据 `major + mid` 过滤

**API 提交时增加** `mid_category` 字段。

### 3.2 StockInboundPanel（入库-新增物料）

同上，新建物料表单增加中类级联选择。

### 3.3 Locations.tsx（库位管理）

- 表单增加「父库位」选择器（可选）
- 库位列表显示层级路径和树状缩进（`├ ` 前缀）

---

## 四、API 参数变化

```typescript
// createMaterial / updateMaterial 新增参数
{
  mid_category?: string;  // 🆕
}

// createLocation / updateLocation 新增参数
{
  parent_id?: string;  // 🆕
}
```

---

## 五、注意事项

1. 中类和小类都是**可选**的，旧数据只有大类+子类也能正常显示
2. 使用 `[a, b, c].filter(Boolean).join(" / ")` 模式，自动跳过 null/undefined/空字符串
3. 中类选择器只在 `midOptions.length > 0` 时才渲染
4. 库位层级路径同理：`[major_name, mid_name, sub_name].filter(Boolean).join(" › ")`
