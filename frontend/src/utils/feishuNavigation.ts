import { useEffect, useRef } from "react";
import { configureFeishuJsapi, currentFeishuPageUrl, isFeishuClient, runWhenFeishuReady } from "../auth/feishu";

let jsapiConfigured: Promise<boolean> | null = null;

export function getFeishuJsapiReady(): Promise<boolean> {
  if (!isFeishuClient()) return Promise.resolve(false);
  if (!jsapiConfigured) {
    jsapiConfigured = configureFeishuJsapi();
  }
  return jsapiConfigured;
}

export function useFeishuPageChrome({
  title,
  showBack,
  onBack,
  hideCustomNavbar = true,
}: {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  hideCustomNavbar?: boolean;
}) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    document.title = title;
    if (!isFeishuClient()) return;

    let disposed = false;

    const clearNativeChrome = () => {
      document.body.classList.remove("feishu-native-chrome", "feishu-hide-app-navbar");
    };

    void getFeishuJsapiReady().then((ready) => {
      if (disposed) return;
      if (!ready || !window.tt?.setNavigationBar) {
        clearNativeChrome();
        return;
      }

      runWhenFeishuReady(() => {
        if (disposed) return;

        window.tt?.setNavigationBar?.({
          title,
          navigationBarBackgroundColor: "#ffffff",
          navigationBarFrontColor: "black",
          left: showBack
            ? {
                items: [{ id: "back", text: "返回" }],
              }
            : undefined,
          success: () => {
            if (disposed) return;
            document.body.classList.add("feishu-native-chrome");
            if (hideCustomNavbar) document.body.classList.add("feishu-hide-app-navbar");
          },
          fail: () => {
            clearNativeChrome();
          },
        } as Record<string, unknown>);

        window.tt?.onLeftNavigationBarClick?.({
          success: (res: { id?: string }) => {
            if (res?.id === "back") onBackRef.current?.();
          },
          fail: () => undefined,
        } as Record<string, unknown>);
      });
    });

    return () => {
      disposed = true;
      clearNativeChrome();
    };
  }, [title, showBack, hideCustomNavbar]);

  useEffect(() => {
    if (!isFeishuClient()) return;
    void currentFeishuPageUrl();
  }, [title]);
}
