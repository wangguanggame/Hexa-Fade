import { _decorator, Vec2, Enum } from "cc";
import { NezpOverlayWidgetBase, OverlayWidgetType } from "../nezp_cocos/NezpOverlayWidgetBase";

const { ccclass, property } = _decorator;

/**
 * 玩家小部件显示模式枚举
 */
export enum ArbitraryPlayerModeEnum {
    AVATAR = 0,   // 仅头像
    NAME = 1,     // 仅名字
    PROFILE = 2   // 头像 + 名字
}

// 注册枚举供编辑器使用
Enum(ArbitraryPlayerModeEnum);

export type ArbitraryPlayerMode = "avatar" | "name" | "profile";

/**
 * Arbitrary Player Widget
 * - 贴在 anchorNode 上显示指定玩家的头像/名字/组合
 * - 使用自定义 XML 模板（参考成功案例）
 */
@ccclass("NezpArbitraryPlayerWidget")
export class NezpArbitraryPlayerWidget extends NezpOverlayWidgetBase {
    @property
    playerId: string = "";

    @property({ type: ArbitraryPlayerModeEnum, tooltip: "显示模式：头像/名字/头像+名字" })
    modeEnum: ArbitraryPlayerModeEnum = ArbitraryPlayerModeEnum.AVATAR;

    // --- Name 模式专用属性 ---
    @property({
        tooltip: "字体大小（像素）",
        visible: function (this: NezpArbitraryPlayerWidget) { return this.modeEnum === ArbitraryPlayerModeEnum.NAME; }
    })
    fontSize: number = 16;

    @property({
        tooltip: "字体颜色",
        visible: function (this: NezpArbitraryPlayerWidget) { return this.modeEnum === ArbitraryPlayerModeEnum.NAME; }
    })
    fontColor: string = "#ffffff";

    // 动态绑定时可沿用 Cocos Label 的设计字号与对齐方式。
    public nameTextAlign: "left" | "center" | "right" = "left";
    public nameFontSizeCocos: number = 0;
    public nameOutlineWidthCocos: number = 0;
    public nameOffsetYCocos: number = 0;
    public avatarDecorations: { url: string; width: number; height: number; x: number; y: number; clipHeight?: number }[] = [];

    // --- Avatar/Profile 模式专用属性 ---
    @property({
        tooltip: "头像圆角百分比（11 表示 11%，0 表示不圆角，50 表示圆形）",
        visible: function (this: NezpArbitraryPlayerWidget) { return this.modeEnum !== ArbitraryPlayerModeEnum.NAME; }
    })
    borderRadius: number = 11;

    @property({
        tooltip: "边框图片的 URL，留空则不显示边框",
        visible: function (this: NezpArbitraryPlayerWidget) { return this.modeEnum !== ArbitraryPlayerModeEnum.NAME; }
    })
    frameUrl: string = "";

    @property({
        tooltip: "边框图片的尺寸（Cocos 设计尺寸），0 表示和 anchor 一样大",
        visible: function (this: NezpArbitraryPlayerWidget) { return this.modeEnum !== ArbitraryPlayerModeEnum.NAME; }
    })
    frameSizeCocos: Vec2 = new Vec2(0, 0);

    @property({
        tooltip: "边框图片的偏移（Cocos 设计尺寸）",
        visible: function (this: NezpArbitraryPlayerWidget) { return this.modeEnum !== ArbitraryPlayerModeEnum.NAME; }
    })
    frameOffsetCocos: Vec2 = new Vec2(0, 0);

    @property({
        tooltip: "头像的尺寸（Cocos 设计尺寸），0 表示和锚点一样大。用于当锚点尺寸等于边框尺寸时，缩小头像以适配边框",
        visible: function (this: NezpArbitraryPlayerWidget) { return this.modeEnum !== ArbitraryPlayerModeEnum.NAME; }
    })
    avatarSizeCocos: Vec2 = new Vec2(0, 0);

    /** 获取当前模式字符串 */
    get mode(): ArbitraryPlayerMode {
        switch (this.modeEnum) {
            case ArbitraryPlayerModeEnum.NAME: return "name";
            case ArbitraryPlayerModeEnum.PROFILE: return "profile";
            default: return "avatar";
        }
    }

    /** 使用 custom 类型，使用自定义 XML 模板 */
    protected getOverlayType(): OverlayWidgetType {
        return "custom";
    }

    /** 子类实现：返回 playerId（用于 picture/name 类型） */
    protected getPlayerId(): string {
        // 使用 runtime.fb() 以支持 Mock 模式
        const fb = this.runtime?.fb?.();
        return this.playerId || fb?.player?.getID?.() || "";
    }

    /** 公开访问器：获取当前绑定的玩家 ID（供外部校验使用） */
    public get currentPlayerId(): string {
        return this.getPlayerId();
    }

    /** 动态设置玩家 ID 并刷新 Overlay */
    public setPlayerId(id: string) {
        if (this.playerId === id) return;
        this.playerId = id;
        if (this.enabled) {
            void this.createOrRecreateOverlayAsync(true);
        }
    }

    /** 动态设置边框并在支持的情况下刷新 */
    public setFrame(url: string, size?: Vec2, offset?: Vec2) {
        this.frameUrl = url;
        if (size) this.frameSizeCocos = size;
        if (offset) this.frameOffsetCocos = offset;
        if (this.enabled) {
            void this.createOrRecreateOverlayAsync(true);
        }
    }

    /** 获取处理后的边框图片 URL（确保有 frame/ 前缀） */
    private getFrameUrl(): string {
        if (!this.frameUrl) return "";
        // 如果已经有 frame/ 前缀或是完整 http URL，直接返回
        if (this.frameUrl.startsWith("frame/") || this.frameUrl.startsWith("http")) {
            return this.frameUrl;
        }
        // 添加 frame/ 前缀
        return "frame/" + this.frameUrl;
    }

    /**
     * Cocos 设计尺寸转换为 XML 像素尺寸
     * dim 是 overlay 的实际像素尺寸，anchor 的 Cocos 尺寸存在 anchorNode 的 UITransform 上
     */
    private cocosToXmlSize(cocosSize: number, anchorCocosSize: number, overlayPixelSize: number): number {
        if (cocosSize <= 0 || anchorCocosSize <= 0) return overlayPixelSize;
        return (cocosSize / anchorCocosSize) * overlayPixelSize;
    }

    private cocosToXmlOffset(cocosOffset: number, anchorCocosSize: number, overlayPixelSize: number): number {
        if (anchorCocosSize <= 0) return 0;
        return (cocosOffset / anchorCocosSize) * overlayPixelSize;
    }

    /**
     * 构建 XML 模板（参考成功案例的格式）
     * 关键：使用 {{FBInstant.players[playerId].photo}} 而不是带引号的版本
     */
    protected async buildXmlAsync(dim: { width: number; height: number; zIndex: number }): Promise<string> {
        const id = this.getPlayerId();

        // 获取 anchor 的 Cocos 尺寸
        const anchorUI = (this.anchorNode || this.node).getComponent("cc.UITransform") as any;
        const anchorCocosW = anchorUI?.width || dim.width;
        const anchorCocosH = anchorUI?.height || dim.height;

        if (this.mode === "avatar") {
            // 边框图片处理 - FB SDK 会自动给 src 添加前缀，所以直接使用相对路径
            let frameImage = "";

            // 如果设置了边框 URL，直接使用（不要拼接 origin，FB 会自动处理）
            const frameUrlResolved = this.getFrameUrl();
            if (frameUrlResolved) {
                // 计算边框尺寸，但强制使用正方形（取较小值）避免变形
                let framePixelW = this.cocosToXmlSize(this.frameSizeCocos.x, anchorCocosW, dim.width);
                let framePixelH = this.cocosToXmlSize(this.frameSizeCocos.y, anchorCocosH, dim.height);
                // 强制正方形：取宽高的较小值
                const frameSize = Math.min(framePixelW, framePixelH);
                framePixelW = frameSize;
                framePixelH = frameSize;

                const frameOffsetX = this.cocosToXmlOffset(this.frameOffsetCocos.x, anchorCocosW, dim.width);
                const frameOffsetY = this.cocosToXmlOffset(this.frameOffsetCocos.y, anchorCocosH, dim.height);

                // 居中偏移
                const leftOffset = (dim.width - framePixelW) / 2 + frameOffsetX;
                const topOffset = (dim.height - framePixelH) / 2 - frameOffsetY; // Y 轴翻转

                // 直接使用相对路径，FB SDK 会自动添加前缀
                frameImage = `<Image src="${frameUrlResolved}" style="position: absolute; left: ${leftOffset.toFixed(1)}px; top: ${topOffset.toFixed(1)}px; width: ${frameSize.toFixed(1)}px; height: ${frameSize.toFixed(1)}px; pointer-events: none; z-index: 2;" />`;
                this.runtime.log(`[社交Overlay] 边框图片: ${frameUrlResolved}, 尺寸: ${frameSize.toFixed(1)}x${frameSize.toFixed(1)}`);
            }

            // 计算头像尺寸（如果设置了 avatarSizeCocos 则使用，否则使用 100%）
            let avatarStyle = "width: 100%; height: 100%;";
            if (this.avatarSizeCocos.x > 0 && this.avatarSizeCocos.y > 0) {
                // 计算头像像素尺寸
                let avatarPixelW = this.cocosToXmlSize(this.avatarSizeCocos.x, anchorCocosW, dim.width);
                let avatarPixelH = this.cocosToXmlSize(this.avatarSizeCocos.y, anchorCocosH, dim.height);
                // 强制正方形：取较小值
                const avatarSize = Math.min(avatarPixelW, avatarPixelH);
                // 居中偏移
                const avatarLeftOffset = (dim.width - avatarSize) / 2;
                const avatarTopOffset = (dim.height - avatarSize) / 2;
                avatarStyle = `position: absolute; left: ${avatarLeftOffset.toFixed(1)}px; top: ${avatarTopOffset.toFixed(1)}px; width: ${avatarSize.toFixed(1)}px; height: ${avatarSize.toFixed(1)}px;`;
                this.runtime.log(`[社交Overlay] 头像尺寸: ${avatarSize.toFixed(1)}x${avatarSize.toFixed(1)}, 偏移: (${avatarLeftOffset.toFixed(1)}, ${avatarTopOffset.toFixed(1)})`);
            }

            const decorations = this.avatarDecorations.map((layer, index) => {
                const width = this.cocosToXmlSize(layer.width, anchorCocosW, dim.width);
                const height = this.cocosToXmlSize(layer.height, anchorCocosH, dim.height);
                const left = (dim.width - width) / 2 + this.cocosToXmlOffset(layer.x, anchorCocosW, dim.width);
                const top = (dim.height - height) / 2 - this.cocosToXmlOffset(layer.y, anchorCocosH, dim.height);
                const clipHeight = this.cocosToXmlSize(layer.clipHeight || layer.height, anchorCocosH, dim.height);
                return `<View style="position: absolute; left: ${left.toFixed(1)}px; top: ${top.toFixed(1)}px; width: ${width.toFixed(1)}px; height: ${clipHeight.toFixed(1)}px; overflow: hidden; pointer-events: none; z-index: ${index + 3};"><Image src="${layer.url}" style="position: absolute; left: 0px; top: 0px; width: ${width.toFixed(1)}px; height: ${height.toFixed(1)}px; pointer-events: none;" /></View>`;
            }).join("\n");

            return `
        <View style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: ${dim.zIndex}; overflow: visible;">
          <Image src="{{FBInstant.players[${id}].photo}}" style="${avatarStyle} border-radius: ${this.borderRadius}%; pointer-events: none; z-index: 1; object-fit: cover;" />
          ${frameImage}
          ${decorations}
        </View>
      `;
        }

        if (this.mode === "name") {
            const fontSize = this.nameFontSizeCocos > 0
                ? this.cocosToXmlSize(this.nameFontSizeCocos, anchorCocosH, dim.height)
                : this.fontSize;
            const outlineWidth = this.cocosToXmlSize(this.nameOutlineWidthCocos, anchorCocosH, dim.height);
            const offsetY = this.nameOffsetYCocos / anchorCocosH * dim.height;
            const outlineStyle = this.nameOutlineWidthCocos > 0
                ? `-webkit-text-stroke: ${outlineWidth.toFixed(2)}px #000000; paint-order: stroke fill; text-shadow: -1px 0 #000000, 1px 0 #000000, 0 -1px #000000, 0 1px #000000;`
                : '';
            return `
        <View style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: ${dim.zIndex}; overflow: hidden; display: flex; align-items: center;">
          <Text content="{{FBInstant.players[${id}].name}}" style="font-size: ${fontSize.toFixed(1)}px; line-height: ${dim.height.toFixed(1)}px; transform: translateY(${-offsetY.toFixed(1)}px); ${outlineStyle} text-align: ${this.nameTextAlign}; color: ${this.fontColor}; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; margin: 0; padding: 0;" />
        </View>
      `;
        }

        // profile 模式：头像 + 名字
        const avatarSize = Math.min(dim.width, dim.height);
        // 边框图片处理 - FB SDK 会自动给 src 添加前缀，直接使用相对路径
        let frameImage = "";
        const frameUrlResolved = this.getFrameUrl();
        if (frameUrlResolved) {
            const framePixelW = this.cocosToXmlSize(this.frameSizeCocos.x, anchorCocosW, avatarSize);
            const framePixelH = this.cocosToXmlSize(this.frameSizeCocos.y, anchorCocosH, avatarSize);
            frameImage = `<Image src="${frameUrlResolved}" style="position: absolute; left: 0px; top: 0px; width: ${framePixelW.toFixed(0)}px; height: ${framePixelH.toFixed(0)}px; object-fit: contain; pointer-events: none; z-index: 2;" />`;
        }

        return `
      <View style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: ${dim.zIndex}; overflow: visible;">
        <Image src="{{FBInstant.players[${id}].photo}}" style="position: absolute; left: 0px; top: 0px; width: ${avatarSize.toFixed(0)}px; height: ${avatarSize.toFixed(0)}px; border-radius: ${this.borderRadius}%; pointer-events: none; z-index: 1;object-fit: cover;" />
        ${frameImage}
        <Text content="{{FBInstant.players[${id}].name}}" style="position: absolute; left: ${(avatarSize + 8).toFixed(0)}px; top: 0px; font-size: 16px; line-height: ${avatarSize.toFixed(0)}px; color: #ffffff; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0px;" />
      </View>
    `;
    }
}
