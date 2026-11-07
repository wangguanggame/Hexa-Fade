import { _decorator } from "cc";
import { NezpOverlayWidgetBase } from "../nezp_cocos/NezpOverlayWidgetBase";
import { NezpKit } from "../nezp/NezpKit";

const { ccclass, property } = _decorator;

/**
 * Notifications（贴节点显示订阅状态）
 * - 交互建议：用 Cocos Button 调用 trySubscribe()
 */
@ccclass("NezpNotificationsWidget")
export class NezpNotificationsWidget extends NezpOverlayWidgetBase {
  @property
  title: string = "Notifications";

  private state: string = "Unknown";

  protected getOverlayType(): "picture" | "name" | "custom" {
    return "custom";
  }

  protected getPlayerId(): string {
    return "";
  }


  async tryRefresh() {
    NezpKit.inst.init();
    const res = await NezpKit.inst.notifications.canSubscribeBotAsync();
    this.state = res.ok ? (res.data.canSubscribe ? "Can Subscribe" : "Cannot Subscribe") : "Error";
    // @ts-ignore
    this.createOrRecreateOverlayAsync?.(true);
  }

  async trySubscribe() {
    NezpKit.inst.init();
    const can = await NezpKit.inst.notifications.canSubscribeBotAsync();
    if (can.ok && can.data.canSubscribe) {
      await NezpKit.inst.notifications.subscribeBotAsync();
    }
    await this.tryRefresh();
  }

  protected async buildXmlAsync(): Promise<string> {
    return `
      <View style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center;">
        <Text content="${this.title}" style="font-size: 12px; color: #ffffff; opacity: 0.7;" />
        <Text content="${this.state}" style="font-size: 14px; color: #ffffff; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" />
      </View>
    `;
  }
}
