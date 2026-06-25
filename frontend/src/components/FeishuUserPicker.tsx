import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Toast } from "antd-mobile";
import { searchFeishuUsers } from "../api";
import type { FeishuUserBrief } from "../api/types";
import { isFeishuClient } from "../auth/feishu";
import { chooseFeishuContact } from "../utils/feishuContact";

export interface ApplicantSelection {
  open_id: string;
  name: string;
}

interface FeishuUserPickerProps {
  label?: string;
  value: ApplicantSelection | null;
  onChange: (next: ApplicantSelection | null) => void;
  /** 库管/管理员可代选；普通用户仅本人 */
  allowProxy?: boolean;
  currentUser?: ApplicantSelection | null;
  placeholder?: string;
}

export function FeishuUserPicker({
  label = "申请人",
  value,
  onChange,
  allowProxy = false,
  currentUser,
  placeholder = "搜索姓名选择飞书用户",
}: FeishuUserPickerProps) {
  const [keyword, setKeyword] = useState("");
  const [options, setOptions] = useState<FeishuUserBrief[]>([]);
  const [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const inFeishu = isFeishuClient();

  const effectiveValue = useMemo(() => {
    if (value) return value;
    if (!allowProxy && currentUser) return currentUser;
    return null;
  }, [allowProxy, currentUser, value]);

  const loadUsers = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const items = await searchFeishuUsers(q);
      setOptions(items);
    } catch (e) {
      setOptions([]);
      Toast.show({ icon: "fail", content: e instanceof Error ? e.message : "加载用户列表失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowProxy || inFeishu) return;
    const timer = window.setTimeout(() => {
      void loadUsers(keyword);
    }, keyword ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [allowProxy, inFeishu, keyword, loadUsers]);

  const handleChooseContact = async () => {
    setChoosing(true);
    try {
      const picked = await chooseFeishuContact();
      onChange(picked);
      setKeyword("");
      setOptions([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "选人失败";
      if (!msg.includes("取消")) {
        Toast.show({ icon: "fail", content: msg });
      }
    } finally {
      setChoosing(false);
    }
  };

  if (!allowProxy && currentUser) {
    return (
      <div className="feishu-user-picker feishu-user-picker-readonly">
        <div className="feishu-user-picker-label">{label}</div>
        <div className="feishu-user-selected">
          <span className="feishu-user-selected-name">{currentUser.name}</span>
          <span className="feishu-user-selected-hint">（当前飞书账号）</span>
        </div>
      </div>
    );
  }

  return (
    <div className="feishu-user-picker">
      <div className="feishu-user-picker-label">{label}</div>
      {effectiveValue ? (
        <div className="feishu-user-selected">
          <span className="feishu-user-selected-name">{effectiveValue.name}</span>
          <button
            type="button"
            className="feishu-user-clear"
            onClick={() => {
              onChange(null);
              setKeyword("");
            }}
          >
            清除
          </button>
        </div>
      ) : (
        <p className="stock-hint">未指定时将记为当前操作人</p>
      )}

      {inFeishu ? (
        <Button
          className="feishu-user-choose-btn"
          color="primary"
          fill="outline"
          size="small"
          loading={choosing}
          onClick={() => void handleChooseContact()}
        >
          从飞书通讯录选择
        </Button>
      ) : (
        <>
          <Input
            placeholder={placeholder}
            value={keyword}
            onChange={setKeyword}
            clearable
          />
          {loading && <p className="stock-hint">正在搜索…</p>}
          {!loading && options.length > 0 && (
            <div className="feishu-user-options">
              {options.map((item) => (
                <button
                  key={item.open_id}
                  type="button"
                  className={`feishu-user-option${
                    effectiveValue?.open_id === item.open_id ? " feishu-user-option-active" : ""
                  }`}
                  onClick={() => {
                    onChange({ open_id: item.open_id, name: item.name });
                    setKeyword("");
                    setOptions([]);
                  }}
                >
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && keyword.trim() && options.length === 0 && (
            <p className="stock-hint">未找到匹配用户，请确认其在角色群内</p>
          )}
          {!loading && !keyword.trim() && options.length === 0 && (
            <p className="stock-hint">本地 Mock：输入姓名搜索测试用户</p>
          )}
        </>
      )}
    </div>
  );
}

export function applicantPayload(selection: ApplicantSelection | null, currentUser?: ApplicantSelection | null) {
  const subject = selection ?? currentUser;
  if (!subject?.open_id || !subject.name) return {};
  return {
    applicant_open_id: subject.open_id,
    applicant_name: subject.name,
  };
}
