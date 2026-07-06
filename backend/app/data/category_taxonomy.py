"""实验室物料分类标准（两级：父类 → 子类）。与产品设计 §6.3.1 及 H5 分类浏览一致。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CategoryLeafDef:
    name: str
    default_location_type: str
    examples: str = ""


@dataclass(frozen=True)
class CategoryRootDef:
    name: str
    default_location_type: str
    examples: str
    children: tuple[CategoryLeafDef, ...]


LAB_CATEGORY_TAXONOMY: tuple[CategoryRootDef, ...] = (
    CategoryRootDef(
        name="电气类",
        default_location_type="货柜",
        examples="电机、传感器、算力板、线缆等电子电气物料",
        children=(
            CategoryLeafDef("电机模组", "货柜", "同川电机、达妙电机、本末电机、驱动器"),
            CategoryLeafDef("感知设备", "货柜", "激光雷达、2D相机、3D相机、IMU"),
            CategoryLeafDef("算力设备", "货柜", "机器人大脑、小脑、底盘大脑、电控板、PCB"),
            CategoryLeafDef("电气设备", "货柜", "开关、分线盒、按钮、端子排、pBox"),
            CategoryLeafDef("线缆网线", "货柜", "网线、电源线、信号线、USB/HDMI线"),
            CategoryLeafDef("电池电源", "货架", "锂电池、电池包、充电器、电源模块"),
        ),
    ),
    CategoryRootDef(
        name="机械类",
        default_location_type="货架",
        examples="夹爪、减速器、结构件、机加工件等",
        children=(
            CategoryLeafDef("通用设备", "货柜", "插线板、路由器、交换机"),
            CategoryLeafDef("末端执行", "货架", "开合夹爪、平行夹爪、灵巧手、吸盘、快换盘"),
            CategoryLeafDef("金属件", "货架", "机加工件、外观件、铝型材、钣金件、CNC件"),
        ),
    ),
    CategoryRootDef(
        name="耗材类",
        default_location_type="货架",
        examples="螺栓、工具等消耗性物料",
        children=(
            CategoryLeafDef("螺丝螺栓", "专用螺栓架", "内六角、法兰螺栓、专用螺丝、螺母、垫圈"),
            CategoryLeafDef("工具", "工具架", "常用工具、专用工具、测量工具"),
        ),
    ),
    CategoryRootDef(
        name="其他类",
        default_location_type="货架",
        examples="暂无法归入以上大类的物品",
        children=(
            CategoryLeafDef("其他物品", "货架", "操作台、3D打印机、大板件、标准件、3D打印件"),
        ),
    ),
)

ROOT_ORDER = [root.name for root in LAB_CATEGORY_TAXONOMY]
CHILD_ORDER: dict[str, list[str]] = {
    root.name: [leaf.name for leaf in root.children] for root in LAB_CATEGORY_TAXONOMY
}

# mock / 测试用稳定 ID（Bitable real 模式由 record_id 决定）
ROOT_CATEGORY_IDS: dict[str, str] = {
    "电气类": "cat_electrical",
    "机械类": "cat_mechanical",
    "耗材类": "cat_consumables",
    "其他类": "cat_other",
}

LEAF_CATEGORY_IDS: dict[tuple[str, str], str] = {
    ("电气类", "电机模组"): "cat_motor_module",
    ("电气类", "感知设备"): "cat_sensing",
    ("电气类", "算力设备"): "cat_compute",
    ("电气类", "电气设备"): "cat_electrical_equip",
    ("电气类", "线缆网线"): "cat_cable",
    ("电气类", "电池电源"): "cat_battery",
    ("机械类", "通用设备"): "cat_general",
    ("机械类", "末端执行"): "cat_end_effector",
    ("机械类", "金属件"): "cat_metal",
    ("耗材类", "螺丝螺栓"): "cat_fastener",
    ("耗材类", "工具"): "cat_tool",
    ("其他类", "其他物品"): "cat_other_items",
}
