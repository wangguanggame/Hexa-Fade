import { _decorator } from "cc";
import { NezpOverlayWidgetBase, OverlayWidgetType } from "../nezp_cocos/NezpOverlayWidgetBase";

const { ccclass, property } = _decorator;

/**
 * Connected Players Widget
 * - 显示多个玩家的头像/名字列表
 * - 使用自定义 XML（custom 类型）
 * - 注意：自定义 XML 容易出错，如果失败请检查 FB 支持的标签和样式
 */
@ccclass("NezpConnectedPlayersWidget")
export class NezpConnectedPlayersWidget extends NezpOverlayWidgetBase {

	@property
	maxCount = 6;

	@property
	rowHeight = 44;

	private players: { playerID: string }[] = [];

	/** 外部注入数据 */
	setPlayers(players: { playerID: string }[]) {
		this.players = players.slice(0, this.maxCount);
	}

	protected getOverlayType(): OverlayWidgetType {
		return "custom";
	}

	protected getPlayerId(): string {
		return "";
	}

	protected async buildXmlAsync(dim: { width: number; height: number; zIndex: number }): Promise<string> {
		if (!this.players.length) {
			return `
        <View style="width:100%;height:100%;display:flex;alignItems:center;justifyContent:center;">
          <Text content="No connected players"
                style="fontSize:14px;color:#ffffff;opacity:0.75;" />
        </View>
      `;
		}

		const rows = this.players.map((p, i) => {
			const y = i * this.rowHeight;
			const avatar = Math.min(this.rowHeight - 8, 36);

			return `
        <View style="position:absolute;left:0;top:${y}px;width:100%;height:${this.rowHeight}px;
                     flexDirection:row;alignItems:center;">
          <Image src="{{FBInstant.players[${p.playerID}].photo}}"
                 style="marginLeft:6px;width:${avatar}px;height:${avatar}px;borderRadius:999px;" />
          <Text content="{{FBInstant.players[${p.playerID}].name}}"
                style="marginLeft:8px;fontSize:14px;lineHeight:18px;
                       color:#ffffff;whiteSpace:nowrap;overflow:hidden;textOverflow:ellipsis;" />
        </View>
      `;
		}).join("\n");

		return `
      <View style="width:100%;height:100%;overflow:hidden;">
        ${rows}
      </View>
    `;
	}
}
