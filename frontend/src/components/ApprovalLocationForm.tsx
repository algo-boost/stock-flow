import { Form, Selector } from "antd-mobile";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listLocations } from "../api";
import type { Location } from "../api/types";
import { buildSlotPayload } from "../utils/inventorySlot";
import { isGridCapableLocation } from "../utils/shelfGrid";
import { useDataMutationRefetch } from "../utils/dataMutation";
import { LocationSlotPicker } from "./LocationSlotPicker";

export interface ApprovalLocationValue {
  location_id: string;
  row?: number;
  column?: number;
}

interface ApprovalLocationFormProps {
  /** 入库审批且申请未指定库位时为 true */
  required?: boolean;
  materialId?: string;
  value: ApprovalLocationValue;
  onChange: (next: ApprovalLocationValue) => void;
}

export function ApprovalLocationForm({
  required = true,
  materialId,
  value,
  onChange,
}: ApprovalLocationFormProps) {
  const [locations, setLocations] = useState<Location[]>([]);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listLocations());
    } catch {
      setLocations([]);
    }
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  useDataMutationRefetch(["locations"], loadLocations);

  const locationOptions = useMemo(
    () =>
      locations.map((loc) => ({
        label: `${loc.name}（${loc.code}）`,
        value: loc.id,
      })),
    [locations],
  );

  const selectedLocation = locations.find((loc) => loc.id === value.location_id);
  const showGridSlot = Boolean(selectedLocation && isGridCapableLocation(selectedLocation));

  return (
    <Form layout="vertical">
      <Form.Item label={required ? "目标库位（必填）" : "目标库位"}>
        <Selector
          options={locationOptions}
          value={value.location_id ? [value.location_id] : []}
          onChange={(arr) => {
            const location_id = arr[0] ?? "";
            onChange({ location_id, row: undefined, column: undefined });
          }}
        />
      </Form.Item>
      {showGridSlot && selectedLocation && (
        <LocationSlotPicker
          location={selectedLocation}
          materialId={materialId}
          value={{
            row: value.row ?? null,
            column: value.column ?? null,
          }}
          onChange={(next) =>
            onChange({
              ...value,
              row: next.row ?? undefined,
              column: next.column ?? undefined,
            })
          }
        />
      )}
    </Form>
  );
}

export function isApprovalLocationComplete(value: ApprovalLocationValue, location?: Location): boolean {
  if (!value.location_id) return false;
  if (!location || !isGridCapableLocation(location)) return true;
  return (
    Object.keys(
      buildSlotPayload(location, [], {
        row: value.row ?? null,
        column: value.column ?? null,
      }),
    ).length > 0
  );
}

export function buildApprovalLocationPayload(
  itemType: string,
  itemLocationId: string | null | undefined,
  value: ApprovalLocationValue,
  location?: Location,
): { location_id?: string; row?: number; column?: number } | undefined {
  if (itemType === "入库" && !itemLocationId) {
    if (!value.location_id) return undefined;
    const payload: { location_id: string; row?: number; column?: number } = {
      location_id: value.location_id,
    };
    if (location && isGridCapableLocation(location)) {
      Object.assign(
        payload,
        buildSlotPayload(location, [], {
          row: value.row ?? null,
          column: value.column ?? null,
        }),
      );
    }
    return payload;
  }
  if (itemLocationId) {
    return {
      location_id: itemLocationId,
      row: value.row,
      column: value.column,
    };
  }
  return undefined;
}
