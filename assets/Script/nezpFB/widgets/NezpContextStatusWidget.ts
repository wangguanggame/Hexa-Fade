import { _decorator } from "cc";
import { NezpOverlayWidgetBase, OverlayWidgetType } from "../nezp_cocos/NezpOverlayWidgetBase";
import { NezpKit } from "../nezp/NezpKit";

const { ccclass, property } = _decorator;

/**
 * Changing Contexts（显示当前 context id）
 * - 选择/切换/创建 context 的交互，建议由 Cocos Button 触发调用 NezpKit.inst.social.xxx
 * - 本组件负责把“当前状态”贴在节点上显示
 */
@ccclass("NezpContextStatusWidget")
export class NezpContextStatusWidget extends NezpOverlayWidgetBase {
  protected getOverlayType(): OverlayWidgetType {
    return "custom";
  }
  protected getPlayerId(): string {
    return "";
  }
  @property
  title: string = "Context";

  protected async buildXmlAsync(): Promise<string> {
    NezpKit.inst.init();
    const ctxId = NezpKit.inst.social.getContextId() || "None";

    return `
      <View style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center;">
        <Text content="${this.title}" style="font-size: 12px; color: #ffffff; opacity: 0.7;" />
        <Text content="${ctxId}" style="font-size: 14px; color: #ffffff; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" />
      </View>
    `;
  }
}
