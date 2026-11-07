import { NezpResult, PlayerId, OverlayRect, OverlayTextStyle, ProfileOverlayLayout, } from "./NezpTypes";
import { NezpRuntime } from "./NezpRuntime";

/**
 * NEZP - Arbitrary Player 渲染（名字/头像）
 *
 * 注意：
 * - 真实头像/昵称仅能由 OverlayView 渲染（Meta 安全层）。
 * - 这里的 parent 传入“跟随 Cocos 节点的 DOM”（由 nezp-cocos 层提供）。
 */
export class NezpOverlayViews {
	private runtime: NezpRuntime;
	private overlayViewParent: any | null = null;

	constructor(runtime: NezpRuntime) {
		this.runtime = runtime;
	}

	public setOverlayViewParent(parent: any) {
		this.overlayViewParent = parent;
	}

	private rectToInitialData(rect: OverlayRect) {
		return {
			width: Number(rect.width).toFixed(1),
			height: Number(rect.height).toFixed(1),
			zIndex: rect.zIndex ?? 1000,
		};
	}

	private getAlignItems(align: OverlayTextStyle["verticalAlign"]): string {
		switch (align) {
			case "top":
				return "flex-start";
			case "bottom":
				return "flex-end";
			case "center":
			default:
				return "center";
		}
	}

	/**
	 * 构建文本样式
	 * @param style 样式
	 * @returns
	 */
	private buildTextStyle(style: OverlayTextStyle = {}): string {
		const fontFamily = style.fontFamily ?? "Arial";
		const fontSize = style.fontSize ?? 20;
		const lineHeight = style.lineHeight ?? fontSize;
		const color = style.color ?? "#FFFFFF";
		const weight = style.bold ? "bold" : "normal";
		const fontStyle = style.italic ? "italic" : "normal";
		const horizontalAlign = style.horizontalAlign ?? "left";
		return `font-family: ${fontFamily}; font-size: ${fontSize}px; line-height: ${lineHeight}px; color: ${color}; font-weight: ${weight}; font-style: ${fontStyle}; horizontalAlign: ${horizontalAlign};`;
	}

	/**
	 * 创建头像 OverlayView
	 * @param playerId 玩家 ID
	 * @param rect 位置和大小
	 * @param parent 父节点
	 * @returns
	 */
	public async createPictureOverlayViewWithPlayerIdAsync(playerId: PlayerId, rect: OverlayRect, parent?: any,): Promise<NezpResult<any>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: false, error: this.runtime.makeError("FB_NOT_AVAILABLE", "FBInstant 不可用") };

		try {
			const init = this.rectToInitialData({ ...rect, zIndex: rect.zIndex ?? 1000 });
			const xml = `
        <View style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: ${init.zIndex}; overflow: hidden;">
          <Image src="{{FBInstant.players[${playerId}].photo}}" style="border-radius: 11%; width: 100%; height: 100%; pointer-events: none;object-fit: cover;" />
        </View>
      `;
			const iframeStyle = `position: absolute; top: 0; left: 0; width: ${init.width}px; height: ${init.height}px; pointer-events: none; border-width: 0; overflow: visible; z-index: ${init.zIndex}`;

			// ⚠️ createOverlayViewWithXMLStringAsync(...) 创建完后必须调用 showAsync() 才会显示。
			// ⚠️ cssFilePath 是可选的：若项目里没有该文件，传入会导致初始化失败，因此这里默认不传（undefined）。
			const view = await fb.overlayViews.createOverlayViewWithXMLStringAsync(
				xml,
				parent ?? this.overlayViewParent,
				iframeStyle,
				"css/iframe_styles.css",
				init,
			);
			if (view && typeof view.showAsync === "function") await view.showAsync();
			return { ok: true, data: view };
		} catch (e) {
			this.runtime.warn("createPictureOverlayViewWithPlayerIdAsync error", e);
			return { ok: false, error: this.runtime.makeError("OVERLAY_CREATE_FAILED", "创建头像 OverlayView 失败", e) };
		}
	}

	/**
	 * 创建名字 OverlayView
	 * @param playerId 玩家 ID
	 * @param rect 位置和大小
	 * @param textStyle 文本样式
	 * @param verticalAlign 垂直对齐方式
	 * @param parent 父节点
	 * @returns
	 */
	public async createTextOverlayViewWithPlayerIdAsync(
		playerId: PlayerId,
		rect: OverlayRect & { textStyle?: OverlayTextStyle; verticalAlign?: OverlayTextStyle["verticalAlign"] },
		parent?: any,
	): Promise<NezpResult<any>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: false, error: this.runtime.makeError("FB_NOT_AVAILABLE", "FBInstant 不可用") };

		try {
			const init = this.rectToInitialData({ width: rect.width, height: rect.height, zIndex: rect.zIndex ?? 1000 });
			const alignItems = this.getAlignItems(rect.verticalAlign);
			const styleStr = this.buildTextStyle(rect.textStyle);

			const xml = `
        <View style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: ${init.zIndex}; overflow: hidden; display: flex; alignItems: ${alignItems};">
          <Text content="{{FBInstant.players[${playerId}].name}}" style="{{style}}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" />
        </View>
      `;
			const iframeStyle = `position: absolute; top: 0; left: 0; width: ${init.width}px; height: ${init.height}px; pointer-events: none; border-width: 0; overflow: visible; z-index: ${init.zIndex}`;

			const view = await fb.overlayViews.createOverlayViewWithXMLStringAsync(
				xml,
				parent ?? this.overlayViewParent,
				iframeStyle,
				"css/iframe_styles.css",
				{ style: styleStr, width: init.width, height: init.height, zIndex: init.zIndex },
			);
			if (view && typeof view.showAsync === "function") await view.showAsync();
			return { ok: true, data: view };
		} catch (e) {
			this.runtime.warn("createTextOverlayViewWithPlayerIdAsync error", e);
			return { ok: false, error: this.runtime.makeError("OVERLAY_CREATE_FAILED", "创建名字 OverlayView 失败", e) };
		}
	}

	/**
	 * 创建 Profile OverlayView
	 * @param player 玩家
	 * @param layout 布局
	 * @param rect 位置和大小
	 * @param parent 父节点
	 * @returns
	 */
	public async createProfileOverlayViewAsync(player: { id: PlayerId }, layout: ProfileOverlayLayout, rect: OverlayRect, parent?: any): Promise<NezpResult<any>> {
		const fb = this.runtime.fb();
		if (!fb) return { ok: false, error: this.runtime.makeError("FB_NOT_AVAILABLE", "FBInstant 不可用") };

		try {
			const init = this.rectToInitialData({ ...rect, zIndex: rect.zIndex ?? 1000 });
			const styleStr = this.buildTextStyle(layout.textStyle);

			const xml = `
        <View style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: ${init.zIndex}; overflow: hidden;">
          <Image
            src="{{FBInstant.players[${player.id}].photo}}"
            style="position: absolute; left: ${layout.imgLeft}px; top: ${layout.imgTop}px; width: ${layout.imgWidth}px; height: ${layout.imgHeight}px; border-radius: 21%; pointer-events: none;object-fit: cover;"
          />
          <Text
            content="{{FBInstant.players[${player.id}].name}}"
            style="{{style}}; horizontalAlign: left; verticalAlign: center; position: absolute; left: ${layout.nameLeft}px; top: ${layout.nameTop}px; margin: 0px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          />
        </View>
      `;
			const iframeStyle = `position: absolute; top: 0; left: 0; width: ${init.width}px; height: ${init.height}px; pointer-events: none; border-width: 0; overflow: visible; z-index: ${init.zIndex}`;

			const view = await fb.overlayViews.createOverlayViewWithXMLStringAsync(
				xml,
				parent ?? this.overlayViewParent,
				iframeStyle,
				"css/iframe_styles.css",
				{ style: styleStr, width: init.width, height: init.height, zIndex: init.zIndex },
			);
			if (view && typeof view.showAsync === "function") await view.showAsync();
			return { ok: true, data: view };
		} catch (e) {
			this.runtime.warn("createProfileOverlayViewAsync error", e);
			return { ok: false, error: this.runtime.makeError("OVERLAY_CREATE_FAILED", "创建 Profile OverlayView 失败", e) };
		}
	}
}
