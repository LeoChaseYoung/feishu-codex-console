import type { AccountQuotaSnapshot } from "./account-quota.js";
import { renderAccountQuotaPanel } from "./account-quota-card.js";
import type { FeishuCard } from "./task-card.js";

export interface QuotaCardSnapshot {
  deviceName: string;
  quota: AccountQuotaSnapshot;
  feedback?: string;
}

export function renderQuotaCard(snapshot: QuotaCardSnapshot): FeishuCard {
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: `Codex 账户额度 · ${safe(snapshot.deviceName)}` },
    },
    header: {
      title: { tag: "plain_text", content: "Codex 账户额度" },
      subtitle: { tag: "plain_text", content: safe(snapshot.deviceName) },
      template: snapshot.quota.status === "available" ? "turquoise" : "grey",
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [
        {
          tag: "text_tag",
          text: {
            tag: "plain_text",
            content: snapshot.quota.status === "available" ? "实时读取" : "暂不可用",
          },
          color: snapshot.quota.status === "available" ? "green" : "neutral",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 18px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(snapshot.feedback
          ? [
              {
                tag: "markdown",
                element_id: "quota_feedback",
                text_size: "notation",
                content: `<font color='blue'>${safe(snapshot.feedback)}</font>`,
              },
            ]
          : []),
        renderAccountQuotaPanel(snapshot.quota, "qq"),
        {
          tag: "column_set",
          element_id: "quota_actions",
          flex_mode: "none",
          horizontal_spacing: "8px",
          columns: [
            actionColumn("quota_refresh_btn", "刷新额度", "primary_filled", "quota_refresh"),
            actionColumn("quota_device_btn", "返回控制台", "default", "quota_device"),
          ],
        },
        {
          tag: "markdown",
          element_id: "quota_note",
          text_size: "notation",
          text_align: "center",
          content: "<font color='grey'>数据来自这台设备当前登录的 Codex 账户；不同模型可能使用独立额度窗口。</font>",
        },
      ],
    },
  };
}

function actionColumn(
  elementId: string,
  label: string,
  type: string,
  action: "quota_refresh" | "quota_device",
): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [
      {
        tag: "button",
        element_id: elementId,
        text: { tag: "plain_text", content: label },
        type,
        width: "fill",
        behaviors: [
          {
            type: "callback",
            value: { bridge: "feishu-codex-v4", action },
          },
        ],
      },
    ],
  };
}

function safe(value: string): string {
  return value
    .replaceAll("&", "＆")
    .replaceAll("<", "＜")
    .replaceAll(">", "＞")
    .replaceAll("*", "＊")
    .replaceAll("_", "＿")
    .replaceAll("`", "｀");
}
