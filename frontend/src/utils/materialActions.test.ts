import { describe, expect, it } from "vitest";
import { ACTION_ICONS, actionAriaLabel } from "./materialActions";

describe("materialActions", () => {
  it("ACTION_ICONS 覆盖主要快捷操作", () => {
    expect(ACTION_ICONS.outbound).toBe("arrow-up");
    expect(ACTION_ICONS.inbound).toBe("arrow-down");
    expect(ACTION_ICONS.transfer).toBe("swap");
  });

  it("actionAriaLabel 返回可见文案", () => {
    expect(actionAriaLabel("outbound", "出库")).toBe("出库");
  });
});
