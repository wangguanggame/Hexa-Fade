import { _decorator, Component, Node, Enum } from 'cc';
import { NezpRuntime } from '../nezp/NezpRuntime';
import { NezpOverlayAnchor } from './NezpOverlayAnchor';

const { ccclass, property } = _decorator;

/**
 * Overlay 更新模式枚举
 */
export enum OverlayUpdateModeEnum {
    /** 仅在启用时创建（固定尺寸） */
    ON_ENABLE_ONLY = 0,
    /** 节流尺寸检测（响应式） */
    THROTTLE_RESIZE = 1
}

// 注册枚举供编辑器使用
Enum(OverlayUpdateModeEnum);

export type OverlayWidgetUpdateMode = "onEnableOnly" | "throttleResize";
export type OverlayWidgetType = "picture" | "name" | "custom";

/**
 * WidgetBase：把"OverlayView 渲染"挂到一个 Anchor 节点上（贴节点显示 UI）
 *
 * 关键点（来自 fbinstant 8.0 文档）：
 * - 推荐使用官方 API: createProfilePictureOverlayViewAsync / createProfileNameOverlayViewAsync
 * - 自定义 XML 有严格的标签和样式限制，容易出现 "Unsupported Node Type" 错误
 */
@ccclass("NezpOverlayWidgetBase")
export abstract class NezpOverlayWidgetBase extends Component {
    @property({ type: Node, tooltip: "要显示 Overlay 的锚点节点" })
    anchorNode: Node | null = null;

    @property({
        type: OverlayUpdateModeEnum,
        tooltip: "更新模式：\n仅启用时创建 - ON_ENABLE_ONLY：固定尺寸，性能更好\n节流尺寸检测 - THROTTLE_RESIZE：响应式，自动跟随尺寸变化"
    })
    updateModeEnum: OverlayUpdateModeEnum = OverlayUpdateModeEnum.THROTTLE_RESIZE;

    @property({
        tooltip: "尺寸检测间隔（秒），仅在[节流尺寸检测]模式下生效",
        visible: function (this: NezpOverlayWidgetBase) { return this.updateModeEnum === OverlayUpdateModeEnum.THROTTLE_RESIZE; }
    })
    resizeThrottleSec = 0.2;

    @property({ tooltip: "是否在组件启用时自动显示 Overlay。设为 false 则需手动调用 show()" })
    autoShowOnEnable: boolean = true;

    /** 获取当前更新模式字符串 */
    get updateMode(): OverlayWidgetUpdateMode {
        return this.updateModeEnum === OverlayUpdateModeEnum.ON_ENABLE_ONLY ? "onEnableOnly" : "throttleResize";
    }

    /**
     * 注意：这里不依赖 NezpKit.inst.runtime（避免初始化顺序耦合），只要 FBInstant 已经存在就可以创建 Overlay。
     */
    protected runtime: NezpRuntime = new NezpRuntime({ enableLog: false });

    /** 渲染完成后的回调 */
    public onCreated: ((widget: NezpOverlayWidgetBase) => void) | null = null;

    protected overlayView: any | null = null;
    protected anchor: NezpOverlayAnchor | null = null;

    private _lastW: number = -1;
    private _lastH: number = -1;
    private _acc: number = 0;
    private _isInitialized: boolean = false;
    private _manualShowRequested: boolean = false;
    private _isCreating: boolean = false;
    private _needsRecreate: boolean = false; // ✅ 脏位：标记加载期间是否有新的刷新请求
    private _wantsVisible: boolean = true; // 最终期望的显示状态

    /**
     * onLoad: 初始化 anchor 并创建 overlay（只执行一次）
     * 把创建逻辑放在 onLoad，避免节点频繁 active/inactive 时重复创建
     */
    protected onLoad(): void {

    }

    protected start(): void {
        this.runtime.log(`[社交Overlay] [Trace] onLoad [${this.node.name}]`);

        // 根据 autoShowOnEnable 设置初始显示状态
        this._wantsVisible = this.autoShowOnEnable;

        // 修复：如果 anchorNode 丢失（变红），自动回退到当前节点
        const actualAnchorNode = this.anchorNode || this.node;

        this.anchor = actualAnchorNode.getComponent(NezpOverlayAnchor);
        if (!this.anchor) {
            this.runtime.warn(`[NEZP] [Trace] 节点 ${actualAnchorNode.name} 没有 NezpOverlayAnchor 组件`);
            return;
        }

        // 延迟一帧创建 Overlay，确保节点世界坐标已正确计算
        this.scheduleOnce(() => {
            if (this.isValid && this.anchor && !this._isCreating) {
                this.runtime.log(`[社交Overlay] [Trace] onLoad 延迟执行创建 [${this.node.name}]`);
                void this.createOrRecreateOverlayAsync(true);
            }
        }, 0);
    }

    onEnable() {
        this.runtime.log(`[社交Overlay] [Trace] onEnable [${this.node.name}]`);

        // 首次启动检查
        if (!this._isInitialized) {
            this._isInitialized = true;
        }

        // 确保 anchor 显示（DOM 容器需要显示，overlay 显示由外部控制）
        if (this.anchor) {
            this.anchor.show();
        }

        // autoShowOnEnable=false 时，onEnable 完全不控制显示
        // 显示只能通过外部调用 show() 来控制
        if (!this.autoShowOnEnable) {
            this.runtime.log(`[社交Overlay] [Trace] onEnable autoShowOnEnable=false，不自动显示 [${this.node.name}]`);
            return;
        }

        // autoShowOnEnable=true 时，onEnable 恢复显示
        this._wantsVisible = true;

        // 如果 overlay 已存在，直接恢复显示
        if (this.overlayView) {
            this.runtime.log(`[社交Overlay] [Trace] onEnable overlay 已存在，恢复显示 [${this.node.name}]`);
            this.applyOverlayVisibility(true);
            if (typeof this.overlayView.showAsync === "function") {
                void this.overlayView.showAsync();
            }
        }
        // 如果 overlay 还没创建完成（onLoad 的 scheduleOnce 还在等待），不需要额外处理
        // createOrRecreateOverlayAsync 完成后会根据 _wantsVisible 设置显示状态
    }

    update(dt: number) {
        // ✅ 非 FB 平台直接跳过更新逻辑
        // if (PlatformAdapter.platform !== EPlatform.FB) return;

        if (!this.anchor || this.updateMode !== 'throttleResize') return;

        this._acc += dt;
        if (this._acc < this.resizeThrottleSec) return;
        this._acc = 0;

        const s = this.anchor.getOverlaySize();
        const w = Math.round(s.width * 10) / 10;
        const h = Math.round(s.height * 10) / 10;

        if (Math.abs(w - this._lastW) > 0.5 || Math.abs(h - this._lastH) > 0.5) {
            void this.createOrRecreateOverlayAsync(false);
        }
    }

    onDisable() {
        this._wantsVisible = false;
        // 取消可能还在等待的延迟创建回调
        this.unscheduleAllCallbacks();
        // 禁用时只隐藏 overlay，不销毁
        this.applyOverlayVisibility(false);
    }

    onDestroy() {
        this.destroyOverlay();
    }

    /**
     * 显示 Overlay（公开 API）
     * 仅控制 display，不再切换节点激活状态
     */
    public show() {
        this.runtime.log(`%c[社交Overlay] [Trace] show() [${this.node.name}] - 显示 overlay`, 'color: #00ff00; font-weight: bold;');

        this._manualShowRequested = true;
        this._wantsVisible = true;

        if (this._isCreating) {
            this.runtime.log(`[社交Overlay] [Trace] show() 正在创建中，延迟显示 [${this.node.name}]`);
            this.scheduleOnce(() => {
                if (this._wantsVisible && !this._isCreating) {
                    this.applyOverlayVisibility(true);
                }
            }, 0.1);
            return;
        }

        if (!this.overlayView) {
            void this.createOrRecreateOverlayAsync(true);
        } else {
            this.applyOverlayVisibility(true);
            if (typeof this.overlayView.showAsync === "function") {
                void this.overlayView.showAsync();
            }
        }
    }

    /** 是否已经渲染成功并可见 */
    public isRendered(): boolean {
        return !!this.overlayView;
    }

    /**
     * 隐藏 Overlay（公开 API）
     * 仅控制 display，不再切换节点激活状态
     */
    public hide() {
        this.runtime.log(`%c[社交Overlay] [Trace] hide() [${this.node.name}] - 隐藏 overlay`, 'color: #ff0000; font-weight: bold;');

        this._wantsVisible = false;
        this.applyOverlayVisibility(false);
    }

    protected destroyOverlay() {
        if (!this.overlayView) return;

        this.runtime?.log?.(`[社交Overlay] [Trace] destroyOverlay [${this.node?.name}]`);
        const v = this.overlayView;
        this.overlayView = null;

        try {
            if (typeof v.dismissAsync === "function") {
                v.dismissAsync().then(() => {
                    this.runtime?.log?.(`[社交Overlay] [Trace] dismissAsync success [${this.node?.name}]`);
                }).catch((e: any) => {
                    // 使用可选链，如果 runtime 为 null 则静默失败
                    this.runtime?.warn?.(`[社交Overlay] [Trace] dismissAsync failed [${this.node?.name}]:`, e);
                });
            }
        } catch (e) {
            // 使用可选链，如果 runtime 为 null 则静默失败
            this.runtime?.warn?.(`[社交Overlay] [Trace] dismissAsync catch [${this.node?.name}]:`, e);
        }

        try {
            const iframe: HTMLIFrameElement | null =
                (typeof v.getIFrameElement === "function" ? v.getIFrameElement() : null) ||
                v.iframeElement ||
                null;
            if (iframe && iframe.parentNode) {
                iframe.parentNode.removeChild(iframe);
                this.runtime.log(`[社交Overlay] [Trace] DOM iframe removed [${this.node.name}]`);
            }
        } catch (e) {
            this.runtime.warn(`[社交Overlay] [Trace] DOM removal failed [${this.node.name}]:`, e);
        }
    }

    private getOverlayElement(): HTMLElement | null {
        const v = this.overlayView;
        if (!v) return null;
        return (typeof v.getIFrameElement === "function" ? v.getIFrameElement() : null) || v.iframeElement || null;
    }

    private applyOverlayVisibility(visible: boolean) {
        const el = this.getOverlayElement();
        if (!el) {
            this.runtime.warn(`[社交Overlay] [Trace] applyOverlayVisibility: 无法获取 iframe 元素 [${this.node.name}]`);
            return;
        }
        el.style.display = visible ? "block" : "none";
        this.runtime.log(`[社交Overlay] [Trace] applyOverlayVisibility: 设置 display=${visible ? "block" : "none"} [${this.node.name}]`);
    }

    /** 子类实现：返回 overlay 类型和相关参数 */
    protected abstract getOverlayType(): OverlayWidgetType;

    /** 子类实现：返回 playerId（用于 picture/name 类型） */
    protected abstract getPlayerId(): string;

    /** 子类可选实现：自定义 XML（仅当 getOverlayType() 返回 "custom" 时使用） */
    protected async buildXmlAsync?(dim: { width: number; height: number; zIndex: number }): Promise<string>;

    protected async createOrRecreateOverlayAsync(force: boolean) {
        if (!this.isValid || !this.runtime) return;
        // // ✅ 非 FB 平台直接静默跳过，不再打印警告日志
        // if (PlatformAdapter.platform !== EPlatform.FB) {
        //     return;
        // }

        if (this._isCreating) {
            this.runtime.log("[社交Overlay] [Trace] 已经在创建中，标记脏位并在结束后重试", this.node.name);
            this._needsRecreate = true;
            return;
        }

        this.runtime.log("[社交Overlay] [Trace] createOrRecreateOverlayAsync enter", this.node.name, { force });
        this._isCreating = true;
        this._needsRecreate = false; // 开始新流程，清除脏位
        try {
            if (!this.isValid || !this.anchor) {
                this.runtime.warn("[社交Overlay] [Trace] 组件无效或 anchor 为空", this.node.name);
                return;
            }

            const fb = this.runtime.fb();
            if (!fb) {
                this.runtime.warn("[社交Overlay] FBInstant 不存在，跳过 overlay 创建");
                return;
            }
            if (!fb.overlayViews) {
                this.runtime.warn("[社交Overlay] FBInstant.overlayViews 不可用，supportedAPIs:", fb.getSupportedAPIs?.());
                return;
            }

            const s = this.anchor.getOverlaySize();
            this.runtime.log("[社交Overlay] anchor size", this.node.name, s);
            this._lastW = Math.round(s.width * 10) / 10;
            this._lastH = Math.round(s.height * 10) / 10;

            const parent = this.anchor.getOverlayParentElement();
            if (!parent) {
                this.runtime.warn("[社交Overlay] anchor parent DOM 不存在，无法创建 overlay", this.node.name);
                return;
            }

            const zIndex = s.zIndex ?? 2000;
            const iframeStyle = `position: absolute; top: 0; left: 0; width: ${this._lastW}px; height: ${this._lastH}px; pointer-events: none; border-width: 0; overflow: visible; z-index: ${zIndex};`;

            try {
                this.destroyOverlay();

                const overlayType = this.getOverlayType();
                const playerId = this.getPlayerId();
                let view: any = null;

                this.runtime.log("[社交Overlay] 创建类型=", overlayType, "playerId=", playerId);

                if (overlayType === "picture" && playerId) {
                    // 使用官方 API 创建头像
                    view = await fb.overlayViews.createProfilePictureOverlayViewAsync(
                        parent,
                        playerId,
                        iframeStyle
                    );
                } else if (overlayType === "name" && playerId) {
                    // 使用官方 API 创建昵称
                    view = await fb.overlayViews.createProfileNameOverlayViewAsync(
                        parent,
                        playerId,
                        iframeStyle
                    );
                } else if (overlayType === "custom" && this.buildXmlAsync) {
                    // 自定义 XML（参考成功案例格式）
                    const zIndex = s.zIndex ?? 1000;
                    const xml = await this.buildXmlAsync({ width: this._lastW, height: this._lastH, zIndex });
                    this.runtime.log("[社交Overlay] XML 内容:", xml);

                    // 参考成功案例：传入 iframe_styles.css 
                    view = await fb.overlayViews.createOverlayViewWithXMLStringAsync(
                        xml,
                        parent,
                        iframeStyle,
                        "css/iframe_styles.css",  // 第4个参数：CSS 文件路径
                        { width: this._lastW, height: this._lastH, zIndex }
                    );
                }

                // 关键检查：如果在异步创建期间组件被禁用，则不显示并立即销毁
                if (!this.isValid || !this.enabled) {
                    if (view) {
                        try {
                            if (typeof view.dismissAsync === "function") void view.dismissAsync();
                        } catch { }
                    }
                    return;
                }

                // 根据 _wantsVisible 决定是否显示
                if (view && this._wantsVisible && typeof view.showAsync === "function") {
                    await view.showAsync();
                }

                // 最终三重检查：是否在异步期间组件已销毁或被禁用
                if (!this.isValid || !this.enabled) {
                    this.runtime.log("[社交Overlay] [Trace] 创建完成后检测到已失效或隐藏，立即销毁", this.node.name);
                    if (view) {
                        try {
                            if (typeof view.dismissAsync === "function") void view.dismissAsync();
                        } catch { }
                    }
                    this.destroyOverlay();
                    return;
                }

                this.overlayView = view;
                this.runtime.log("[社交Overlay] [Trace] overlay create/show 成功并赋值", this.node.name, "_wantsVisible=", this._wantsVisible);

                // 立即根据 _wantsVisible 设置显示状态（必须在赋值后立即执行）
                this.applyOverlayVisibility(this._wantsVisible);

                // ✅ 延迟一帧强制更新 Anchor 位置，解决动态创建节点位置不正确的问题
                this.scheduleOnce(() => {
                    if (this.isValid && this.anchor) {
                        // 强制更新 Anchor 的 DOM 位置
                        (this.anchor as any).updateHtmlElementTransform?.();
                    }
                }, 0);

                // ✅ 触发回调和本地事件
                this.onCreated?.(this);
                this.node.emit('overlay-created', this);
            } catch (innerE) {
                this.runtime?.warn?.("[NEZP] [Trace] inner create overlay failed:", innerE);
            }
        } catch (e) {
            this.runtime?.warn?.("[NEZP] [Trace] createOrRecreateOverlayAsync failed:", e);
        } finally {
            this._isCreating = false;
            // ✅ 流程结束后检查脏位：如果期间有新请求，立即重试最新 ID
            if (this.isValid && this._needsRecreate && this._wantsVisible) {
                this.runtime.log("[社交Overlay] [Trace] 流程结束检测到脏位，发起链路重试", this.node.name);
                void this.createOrRecreateOverlayAsync(true);
            }
        }
    }
}
