import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Form, Input, Selector, Stepper, Toast } from "antd-mobile";
import { deleteMaterial, listCategories, updateMaterial } from "../api";
import type { Category, Material, MaterialDetail } from "../api/types";
import { SectionCard } from "./ui";

type Props = {
  detail: MaterialDetail;
  hasTransactions: boolean;
  onUpdated: (material: Material) => void;
  onDeleted: () => void;
};

export function MaterialManagePanel({ detail, hasTransactions, onUpdated, onDeleted }: Props) {
  const { material, total_quantity } = detail;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState(material.name);
  const [code, setCode] = useState(material.code);
  const [majorCategory, setMajorCategory] = useState(material.major_category ?? "");
  const [midCategory, setMidCategory] = useState(material.mid_category ?? "");
  const [categoryId, setCategoryId] = useState(material.category_id);
  const [unit, setUnit] = useState(material.unit);
  const [spec, setSpec] = useState(material.spec ?? "");
  const [supplier, setSupplier] = useState(material.supplier ?? "");
  const [minStock, setMinStock] = useState(material.min_stock ?? 5);

  useEffect(() => {
    void listCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setName(material.name);
    setCode(material.code);
    setMajorCategory(material.major_category ?? "");
    setMidCategory(material.mid_category ?? "");
    setCategoryId(material.category_id);
    setUnit(material.unit);
    setSpec(material.spec ?? "");
    setSupplier(material.supplier ?? "");
    setMinStock(material.min_stock ?? 5);
  }, [material]);

  const majorOptions = useMemo(() => {
    const names = new Set<string>();
    for (const cat of categories) {
      if (cat.major_name) names.add(cat.major_name);
      else if (!cat.parent_id) names.add(cat.name);
    }
    return [...names].map((value) => ({ label: value, value }));
  }, [categories]);

  const midOptions = useMemo(
    () =>
      categories
        .filter((cat) => cat.major_name === majorCategory && cat.mid_name && !cat.sub_name)
        .map((cat) => ({ label: cat.mid_name || cat.name, value: cat.mid_name || cat.name })),
    [categories, majorCategory],
  );

  const subOptions = useMemo(
    () =>
      categories
        .filter(
          (cat) =>
            cat.major_name === majorCategory &&
            cat.mid_name === midCategory &&
            cat.sub_name,
        )
        .map((cat) => ({ label: cat.sub_name || cat.name, value: cat.id })),
    [categories, majorCategory, midCategory],
  );

  const canDelete = total_quantity === 0 && !hasTransactions;

  const onSave = async () => {
    if (!name.trim()) {
      Toast.show({ content: "请填写物料名称" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updateMaterial(material.id, {
        name: name.trim(),
        code: code.trim() || undefined,
        category_id: categoryId,
        major_category: majorCategory || undefined,
        mid_category: midCategory || undefined,
        sub_category: categories.find((c) => c.id === categoryId)?.sub_name || undefined,
        unit: unit.trim() || "个",
        spec: spec.trim() || undefined,
        supplier: supplier.trim() || undefined,
        min_stock: minStock,
      });
      Toast.show({ icon: "success", content: "物料已更新" });
      setEditing(false);
      onUpdated(updated);
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    Dialog.confirm({
      content: `确认删除物料「${material.name}」？删除后不可恢复。`,
      confirmText: "删除",
      onConfirm: async () => {
        setSaving(true);
        try {
          await deleteMaterial(material.id);
          Toast.show({ icon: "success", content: "物料已删除" });
          onDeleted();
        } catch (e) {
          Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "删除失败" });
        } finally {
          setSaving(false);
        }
      },
    });
  };

  return (
    <SectionCard title="主数据维护" subtitle="纠错新增错误的物料；有库存或流水时不可删除">
      <div className="material-manage-actions">
        <Button size="small" fill="outline" onClick={() => setEditing(true)} disabled={saving}>
          修改
        </Button>
        <Button
          size="small"
          color="danger"
          fill="outline"
          disabled={!canDelete || saving}
          onClick={onDelete}
        >
          删除
        </Button>
      </div>
      {!canDelete && (
        <div className="form-hint" style={{ marginTop: 8 }}>
          {total_quantity > 0
            ? `当前仍有库存 ${total_quantity}，请先出库后再删除。`
            : hasTransactions
              ? "已有出入库流水，不能删除；可修改名称/分类等信息。"
              : null}
        </div>
      )}

      <Dialog
        visible={editing}
        title="修改物料"
        content={
          <Form layout="vertical" className="form-card">
            <Form.Item label="物料名称">
              <Input value={name} onChange={setName} />
            </Form.Item>
            <Form.Item label="物料编码">
              <Input value={code} onChange={setCode} />
            </Form.Item>
            <Form.Item label="大类">
              <Selector
                options={majorOptions}
                value={majorCategory ? [majorCategory] : []}
                onChange={(arr) => {
                  const next = arr[0] ?? "";
                  setMajorCategory(next);
                  setMidCategory("");
                  setCategoryId("");
                }}
              />
            </Form.Item>
            {midOptions.length > 0 && (
              <Form.Item label="中类">
                <Selector
                  options={midOptions}
                  value={midCategory ? [midCategory] : []}
                  onChange={(arr) => {
                    const next = arr[0] ?? "";
                    setMidCategory(next);
                    setCategoryId("");
                  }}
                />
              </Form.Item>
            )}
            <Form.Item label="子类">
              <Selector
                options={subOptions}
                value={categoryId ? [categoryId] : []}
                onChange={(arr) => setCategoryId(arr[0] ?? categoryId)}
              />
            </Form.Item>
            <Form.Item label="单位">
              <Input value={unit} onChange={setUnit} />
            </Form.Item>
            <Form.Item label="规格型号">
              <Input value={spec} onChange={setSpec} placeholder="可选" />
            </Form.Item>
            <Form.Item label="供货商">
              <Input value={supplier} onChange={setSupplier} placeholder="可选" />
            </Form.Item>
            <Form.Item label="安全库存">
              <Stepper min={0} max={9999} value={minStock} onChange={setMinStock} />
            </Form.Item>
          </Form>
        }
        actions={[
          { key: "cancel", text: "取消", onClick: () => setEditing(false) },
          { key: "save", text: saving ? "保存中…" : "保存", bold: true, onClick: () => void onSave() },
        ]}
        onClose={() => setEditing(false)}
      />
    </SectionCard>
  );
}
