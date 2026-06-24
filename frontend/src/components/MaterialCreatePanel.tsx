import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Form, Input, Selector, Stepper, Toast } from "antd-mobile";
import { createMaterial, listCategories } from "../api";
import type { Category } from "../api/types";
import { SectionCard } from "./ui";

export function MaterialCreatePanel({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [majorCategory, setMajorCategory] = useState("");
  const [midCategory, setMidCategory] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unit, setUnit] = useState("个");
  const [spec, setSpec] = useState("");
  const [supplier, setSupplier] = useState("");
  const [minStock, setMinStock] = useState(5);

  useEffect(() => {
    void listCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

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

  const resetForm = () => {
    setName("");
    setCode("");
    setMajorCategory("");
    setMidCategory("");
    setCategoryId("");
    setUnit("个");
    setSpec("");
    setSupplier("");
    setMinStock(5);
  };

  const onSubmit = async () => {
    if (!name.trim()) {
      Toast.show({ content: "请填写物料名称" });
      return;
    }
    if (!categoryId) {
      Toast.show({ content: "请选择分类" });
      return;
    }
    setSaving(true);
    try {
      await createMaterial({
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
      Toast.show({ icon: "success", content: "物料已创建" });
      setOpen(false);
      resetForm();
      onCreated?.();
    } catch (e) {
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "创建失败" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="新建物料" subtitle="创建后需入库才有库存">
      <Button size="small" color="primary" fill="outline" onClick={() => setOpen(true)}>
        新建物料
      </Button>

      <Dialog
        visible={open}
        title="新建物料"
        content={
          <Form layout="vertical" className="form-card">
            <Form.Item label="物料名称">
              <Input value={name} onChange={setName} placeholder="必填" />
            </Form.Item>
            <Form.Item label="物料编码">
              <Input value={code} onChange={setCode} placeholder="可选，留空自动生成" />
            </Form.Item>
            <Form.Item label="大类">
              <Selector
                options={majorOptions}
                value={majorCategory ? [majorCategory] : []}
                onChange={(arr) => {
                  setMajorCategory(arr[0] ?? "");
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
                    setMidCategory(arr[0] ?? "");
                    setCategoryId("");
                  }}
                />
              </Form.Item>
            )}
            <Form.Item label="子类">
              <Selector
                options={subOptions}
                value={categoryId ? [categoryId] : []}
                onChange={(arr) => setCategoryId(arr[0] ?? "")}
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
          { key: "cancel", text: "取消", onClick: () => setOpen(false) },
          { key: "save", text: saving ? "创建中…" : "创建", bold: true, onClick: () => void onSubmit() },
        ]}
        onClose={() => setOpen(false)}
      />
    </SectionCard>
  );
}
