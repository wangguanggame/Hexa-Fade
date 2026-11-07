import { _decorator } from "cc";
import { NezpOverlayWidgetBase } from "../nezp_cocos/NezpOverlayWidgetBase";

const { ccclass, property } = _decorator;

/**
 * Custom Updates / Invites / Shares（仅显示状态）
 * - 实际调用 update/share/invite 建议在你的业务脚本里调用 NezpKit.inst.social.xxx
 * - 这里贴节点显示“最近一次动作”
 */
@ccclass("NezpShareStatusWidget")
export class NezpShareStatusWidget extends NezpOverlayWidgetBase {
  @property
  lastAction: string = "Idle";

  @property
  lastMessage: string = "";

  public setStatus(action: string, message: string) {
    this.lastAction = action;
    this.lastMessage = message;
    // 触发重建以刷新文本（bundle 没有 update text API）
    // @ts-ignore
    this.createOrRecreateOverlayAsync?.(true);
  }

  protected getOverlayType(): "picture" | "name" | "custom" {
    return "custom";
  }

  protected getPlayerId(): string {
    return "";
  }

  protected async buildXmlAsync(): Promise<string> {
    const msg = (this.lastMessage || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `
      <View style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center;">
        <Text content="${this.lastAction}" style="font-size: 12px; color: #ffffff; opacity: 0.7;" />
        <Text content="${msg}" style="font-size: 14px; color: #ffffff; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" />
      </View>
    `;
  }
}
