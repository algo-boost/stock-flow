import { useMemo } from "react";
import type { InventoryItem, Location } from "../api/types";
import { LocationShelfGrid } from "./LocationShelfGrid";
import { InventorySlotEditor } from "./InventorySlotEditor";
import { isGridCapableLocation } from "../utils/shelfGrid";
import { formatMaterialSlotPin } from "../utils/inventoryDisplay";

interface DetailLocationBlockProps {
  location: Location;
  materialId: string;
  materialName: string;
  item: InventoryItem;
  locationInventory: InventoryItem[];
  canEdit: boolean;
  onUpdated: (item: InventoryItem, fromKey: string) => void;
}

function slotChipLabel(item: InventoryItem): string {
  if (item.row != null && item.column != null) return `${item.row} 层 ${item.column} 列`;
  if (item.row != null) return `${item.row} 层`;
  return "未标注";
}

export function DetailLocationBlock({
  location,
  materialId,
  materialName,
  item,
  locationInventory,
  canEdit,
  onUpdated,
}: DetailLocationBlockProps) {
  const materialNames = useMemo(() => new Map([[materialId, materialName]]), [materialId, materialName]);
  const slotPin = formatMaterialSlotPin(item);
  const showGrid = isGridCapableLocation(location) && (slotPin.hasSlot || canEdit);

  return (
    <div className="detail-loc-block">
      <div className="detail-loc-bar">
        <div className="detail-loc-bar-left">
          <span className="detail-loc-bar-name">{item.location_name ?? location.name}</span>
          <span className="detail-loc-bar-qty">{item.quantity} 件</span>
        </div>
        <span
          className={`detail-loc-slot-chip${slotPin.hasSlot ? "" : " detail-loc-slot-chip-warn"}`}
        >
          {slotChipLabel(item)}
        </span>
      </div>

      {showGrid ? (
        <div className="detail-loc-grid">
          <LocationShelfGrid
            location={location}
            inventory={locationInventory}
            materialNames={materialNames}
            compact
            detailViewMode
            hideHeader
            highlightMaterialId={materialId}
            onCellClick={() => undefined}
          />
        </div>
      ) : (
        <p className="detail-loc-empty-hint">
          {slotPin.hasSlot ? slotPin.detail : "未记录层/列，移库请用底部「移动」"}
        </p>
      )}

      {canEdit && (
        <InventorySlotEditor
          materialId={materialId}
          item={item}
          canEdit={canEdit}
          onUpdated={onUpdated}
          variant="keeper-correction"
        />
      )}
    </div>
  );
}
