import { _decorator } from "cc";
import { NezpOverlayWidgetBase, OverlayWidgetType } from "../nezp_cocos/NezpOverlayWidgetBase";
import { NezpKit } from "../nezp/NezpKit";

const { ccclass, property } = _decorator;

/**
 * Global Leaderboards（贴节点显示榜单列表）
 * - entries 来自 provider（原生或后端）
 * - 名字/头像用 Overlay 的 {{FBInstant.players['id']...}} 渲染（符合 NEZP）
 */
@ccclass("NezpLeaderboardWidget")
export class NezpLeaderboardWidget extends NezpOverlayWidgetBase {
	@property
	leaderboardName: string = "global";

	@property
	maxCount = 5;

	@property
	rowHeight = 44;

	protected getOverlayType(): OverlayWidgetType {
		return "custom";
	}

	protected getPlayerId(): string {
		// 排行榜主视图不需要单一 playerId，循环中会处理各个条目的 playerId
		return "";
	}

	protected async buildXmlAsync(dim: { width: number; height: number; zIndex: number }): Promise<string> {
		NezpKit.inst.init();
		const res = await NezpKit.inst.leaderboardProvider.getEntriesAsync(this.leaderboardName, this.maxCount, 0);
		let list = res.ok ? res.data : [];

		// 当服务器返回空数据或错误时，添加当前玩家自己的数据
		if (!list || list.length === 0) {
			const fb = this.runtime?.fb?.();
			const myPlayerId = fb?.player?.getID?.() || "";
			if (myPlayerId) {
				this.runtime.log("[排行榜] 服务器无数据，使用当前玩家数据作为默认显示");
				list = [{
					playerId: myPlayerId,
					rank: 1,
					score: 0
				}];
			} else {
				// 没有玩家 ID 也没有数据，显示空提示
				return `
          <View style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
            <Text content="No leaderboard data" style="font-size: 14px; color: #ffffff; opacity: 0.75;" />
          </View>
        `;
			}
		}

		const rows = list.map((it, i) => {
			const y = i * this.rowHeight;
			const avatar = Math.min(this.rowHeight - 8, 36);
			const rank = (it.rank ?? (i + 1)).toString();
			const score = (it.score ?? 0).toString();

			return `
        <View style="position: absolute; left: 0; top: ${y}px; width: 100%; height: ${this.rowHeight}px; flex-direction: row; align-items: center;">
          <Text content="${rank}" style="margin-left: 6px; width: 24px; font-size: 14px; color: #ffffff; opacity: 0.9;" />
          <Image src="{{FBInstant.players[${it.playerId}].photo}}" style="width: ${avatar}px; height: ${avatar}px; border-radius: 999px;" />
          <Text content="{{FBInstant.players[${it.playerId}].name}}" style="margin-left: 8px; flex: 1; font-size: 14px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" />
          <Text content="${score}" style="margin-right: 8px; font-size: 14px; color: #ffffff; font-weight: 700;" />
        </View>
      `;
		}).join("\n");

		return `
      <View style="width: 100%; height: 100%; overflow: hidden;">
        ${rows}
      </View>
    `;
	}
}
