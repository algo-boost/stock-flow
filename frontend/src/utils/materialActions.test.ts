import { describe, expect, it } from "vitest";
import { ACTION_ICONS, actionAriaLabel } from "./materialActions";

describe("materialActions", () => {
  it("ACTION_ICONS 覆盖主要快捷操作", () => {
    expect(ACTION_ICONS.outbound).toBe("north");
    expect(ACTION_ICONS.inbound).toBe("south");
    expect(ACTION_ICONS.transfer).toBe("swap_horiz");
  });

  it("actionAriaLabel 返回可见文案", () => {
    expect(actionAriaLabel("outbound", "出库")).toBe("出库");
  });
});
