import { isFeishuClient, runWhenFeishuReady } from "../auth/feishu";
import { getFeishuJsapiReady } from "./feishuNavigation";

export interface FeishuContactBrief {
  open_id: string;
  name: string;
}

function pickContactUser(raw: Record<string, unknown>): FeishuContactBrief | null {
  const openId = String(raw.openId ?? raw.open_id ?? "").trim();
  const name = String(raw.name ?? raw.nickname ?? raw.en_name ?? "").trim();
  if (!openId) return null;
  return { open_id: openId, name: name || openId };
}

/** 调起飞书通讯录选人（单选），非飞书环境抛错 */
export async function chooseFeishuContact(): Promise<FeishuContactBrief> {
  if (!isFeishuClient()) {
    throw new Error("请在飞书客户端中使用通讯录选人");
  }
  const ready = await getFeishuJsapiReady();
  if (!ready) {
    throw new Error("飞书 JSAPI 未就绪，请稍后重试");
  }

  return new Promise((resolve, reject) => {
    runWhenFeishuReady(() => {
      const chooseContact = (
        window.tt as { chooseContact?: (opts: Record<string, unknown>) => void } | undefined
      )?.chooseContact;
      if (!chooseContact) {
        reject(new Error("当前飞书版本不支持通讯录选人"));
        return;
      }
      chooseContact({
        multi: false,
        ignore: false,
        enableChooseDepartment: false,
        externalContact: false,
        success: (res: { data?: Array<Record<string, unknown>> }) => {
          const picked = (res.data ?? []).map(pickContactUser).find(Boolean);
          if (!picked) {
            reject(new Error("未选择联系人"));
            return;
          }
          resolve(picked);
        },
        fail: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("cancel") || msg.includes("取消")) {
            reject(new Error("已取消选择"));
            return;
          }
          reject(err instanceof Error ? err : new Error("通讯录选人失败"));
        },
      });
    });
  });
}
