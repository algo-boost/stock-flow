"""验证 prepare_fields_for_bitable_write 转换逻辑修复。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
from app.bitable.fields import prepare_fields_for_bitable_write, field_link_ids, field_link_id

passed = 0
def check(name, condition, detail=""):
    global passed
    if condition:
        passed += 1
        print(f"  ✅ {name}")
    else:
        print(f"  ❌ {name} {detail}")

# 1. 普通字符串不再当 link
check("普通字符串->link_ids空", field_link_ids("原材料") == [])
check("普通字符串->link_id None", field_link_id("原材料") is None)

# 2. rec 开头仍是 link
check("rec字符串->link_ids", field_link_ids("recABC123") == ["recABC123"])
check("rec字符串->link_id", field_link_id("recABC123") == "recABC123")

# 3. 纯文本字段
r = prepare_fields_for_bitable_write({"物料名称": "螺丝", "规格": "M8", "单位": "个"})
check("纯文本字段", r == {"物料名称": "螺丝", "规格": "M8", "单位": "个"}, str(r))

# 4. Bitable 文本格式
r = prepare_fields_for_bitable_write({"备注": [{"text": "测试备注", "type": "text"}]})
check("Bitable文本格式", r == {"备注": "测试备注"}, str(r))

# 5. 关联字段
r = prepare_fields_for_bitable_write({"物料ID": ["recABC"]})
check("关联字段", r == {"物料ID": ["recABC"]}, str(r))

# 6. 数字字段
r = prepare_fields_for_bitable_write({"数量": 5, "行": 3})
check("数字字段", r == {"数量": 5, "行": 3}, str(r))

# 7. None/空跳过
r = prepare_fields_for_bitable_write({"名称": "测试", "备注": None, "编码": ""})
check("None/空跳过", r == {"名称": "测试"}, str(r))

# 8. 混合字段
r = prepare_fields_for_bitable_write({
    "物料名称": "测试螺栓", "物料ID": ["rec_mat_001"],
    "数量": 8, "备注": [{"text": "紧急", "type": "text"}], "单位": "个",
})
check("混合字段", r == {
    "物料名称": "测试螺栓", "物料ID": ["rec_mat_001"],
    "数量": 8, "备注": "紧急", "单位": "个",
}, str(r))

# 9. 字符串数组（多选等）
r = prepare_fields_for_bitable_write({"标签": ["A", "B"]})
check("字符串数组", r == {"标签": ["A", "B"]}, str(r))

# 10. 数字数组
r = prepare_fields_for_bitable_write({"坐标": [1, 2, 3]})
check("数字数组", r == {"坐标": [1, 2, 3]}, str(r))

print(f"\n{'='*40}")
print(f"{passed}/10 通过" + (" ✅" if passed == 10 else " ❌"))
