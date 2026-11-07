import {
    _decorator, Component, Node, Label, ScrollView, Layout, Prefab,
    resources, instantiate, tween, Vec3, UIOpacity, sys, UITransform,
    Button, Color, BlockInputEvents, Sprite, Widget
} from 'cc';
import { GameData, GameDataEvent } from '../Config/GameData';
import { GameScene } from '../Scene/GameScene';
import { Remind } from '../Tools/Remind/Remind';
import { GameSDK } from '../../sdk/GameSDK';
import { LoadingWaiting } from './LoadingWaiting';
import {
    DEFAULT_IAP_PRODUCTS, IAPProductItem, formatIapFontPrice, getProductByNodeName
} from '../Config/IAPStoreConfig';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

const IAP_PREFAB_PATH = 'Other/View/IapPage';

/**
 * 内购商店页面 (IapPage)
 * 对齐 CarMatch_OnLine shopPageMgr 架构，支持：
 * 1. 自动适配展示 特惠礼包、去除广告、超级大礼包、金币档位等 7 种商品
 * 2. 价格标签自动根据位图字体 numimage1.fnt 格式化 (点对应 'D'，如 $1D99)
 * 3. 购买去广告非消耗品后持久化至 GameData 并自动隐藏对应卡片，ScrollView 自动重排
 * 4. 接入 GameSDK.inst.purchase() 平台内购接口，附带专属旋转加载等待遮罩
 * 5. 购买成功后权益直接到账并弹出浮动提示（避免 RewardPage 广告翻倍导致内购不平衡）
 */
@ccclass('IapPage')
export class IapPage extends Component {
    // ======================================== 属性挂载 ========================================
    @property({ type: Node, tooltip: '背景遮罩节点 (bg)', group: { name: '节点引用', id: '0' } })
    public bgNode: Node | null = null;

    @property({ type: Node, tooltip: '主画框节点 (Frame)', group: { name: '节点引用', id: '0' } })
    public frameNode: Node | null = null;

    @property({ type: Node, tooltip: '滚动视图节点 (ScrollView)', group: { name: '节点引用', id: '0' } })
    public scrollViewNode: Node | null = null;

    @property({ type: Node, tooltip: '卡片容器节点 (content)', group: { name: '节点引用', id: '0' } })
    public contentNode: Node | null = null;

    @property({ type: Node, tooltip: '内购购买专属等待遮罩 (PurchaseMask)', group: { name: '节点引用', id: '0' } })
    public purchaseMask: Node | null = null;

    // ======================================== 私有变量 ========================================
    private _purchasing: boolean = false;
    private _holdsLoading: boolean = false;
    private _openLoadingTimer: any = null;
    private _isLoadingWaitingActive: boolean = false;
    private _loadingTimeoutTimer: any = null;
    private _itemsMap: Map<string, { cardNode: Node; btnNode: Node; priceLabel: Label | null; product: IAPProductItem }> = new Map();

    // ======================================== 静态快捷打开入口 ========================================
    /**
     * 快捷弹出 IapPage 界面 (支持任意场景直接打开)
     * @param parent 挂载父节点 (默认为 GameScene.topUI 或 Canvas)
     */
    public static show(parent?: Node): void {
        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            return;
        }

        LoadingWaiting.acquire(targetParent, () => {
            resources.load(IAP_PREFAB_PATH, Prefab, (err, prefab) => {
                if (err || !prefab) {
                    LoadingWaiting.release();
                    return;
                }
                if (!targetParent.isValid) {
                    LoadingWaiting.release();
                    return;
                }

                const node = instantiate(prefab);
                const page = node.getComponent(IapPage) || node.addComponent(IapPage);
                page.markLoadingHeld();
                node.setParent(targetParent);
                node.setSiblingIndex(targetParent.children.length - 1);
                LoadingWaiting.raise();
            });
        });
    }

    /** 标识当前打开占用了 LoadingWaiting，待页面准备好后再行释放 */
    public markLoadingHeld(): void {
        this._holdsLoading = true;
    }

    // ======================================== LoadingWaiting 等待遮罩控制 ========================================
    /**
     * 主动显示等待遮罩 (带超时兜底保护)
     */
    public showLoadingWaiting(timeoutSeconds: number = 5.0): void {
        if (this._isLoadingWaitingActive) return;
        this._isLoadingWaitingActive = true;

        const targetParent = GameScene.instance?.getTopUIParent() || this.node;
        LoadingWaiting.acquire(targetParent, () => {
            LoadingWaiting.raise();
        });

        if (this._loadingTimeoutTimer) {
            clearTimeout(this._loadingTimeoutTimer);
        }
        this._loadingTimeoutTimer = setTimeout(() => {
            if (this._isLoadingWaitingActive) {
                this.hideLoadingWaiting();
            }
        }, timeoutSeconds * 1000);
    }

    /**
     * 关闭等待遮罩
     */
    public hideLoadingWaiting(): void {
        if (this._loadingTimeoutTimer) {
            clearTimeout(this._loadingTimeoutTimer);
            this._loadingTimeoutTimer = null;
        }
        if (!this._isLoadingWaitingActive) return;
        this._isLoadingWaitingActive = false;
        LoadingWaiting.release();
    }

    // ======================================== 生命周期 ========================================
    onLoad() {
        this.initNodeReferences();
        this.initProductsUI();
        this.registerEvents();
    }

    start() {
        // 至少让等待层跨过首次渲染，避免同一帧挂载并销毁导致玩家完全看不到。
        if (this._holdsLoading) {
            this._openLoadingTimer = setTimeout(() => this.releaseOpenLoading(), 350);
        }

        // 同步去广告展示状态
        this.syncRemoveAdsState(true);

        // 播放卡片入场动效
        this.playEnterAnimation();

        // 页面打开埋点 (参考 CarMatch_OnLine)
        try {
            GameSDK.inst.logEvent('showPage', { value: 'IapPage' });
        } catch (e) {
        }
    }

    onDisable() {
        this.releaseOpenLoading();
        this.hideLoadingWaiting();
    }

    onDestroy() {
        this.releaseOpenLoading();
        this.hideLoadingWaiting();
        this.unregisterEvents();
        if (this.purchaseMask && this.purchaseMask.isValid) {
            this.purchaseMask.destroy();
            this.purchaseMask = null;
        }
    }

    private releaseOpenLoading(): void {
        if (this._openLoadingTimer) {
            clearTimeout(this._openLoadingTimer);
            this._openLoadingTimer = null;
        }
        if (!this._holdsLoading) return;
        this._holdsLoading = false;
        LoadingWaiting.release();
    }

    // ======================================== 初始化与节点绑定 ========================================
    /**
     * 自动补全节点引用
     */
    private initNodeReferences(): void {
        if (!this.bgNode) {
            this.bgNode = this.node.getChildByName('bg');
        }
        if (!this.frameNode) {
            this.frameNode = this.node.getChildByName('Frame');
        }
        if (!this.scrollViewNode && this.frameNode) {
            this.scrollViewNode = this.frameNode.getChildByName('ScrollView');
        }
        if (!this.contentNode && this.scrollViewNode) {
            const sv = this.scrollViewNode.getComponent(ScrollView);
            if (sv && sv.content) {
                this.contentNode = sv.content;
            } else {
                const view = this.scrollViewNode.getChildByName('view');
                this.contentNode = view ? view.getChildByName('content') : this.scrollViewNode.getChildByName('content');
            }
        }
        if (!this.purchaseMask || !this.purchaseMask.isValid) {
            this.purchaseMask = this.node.getChildByName('PurchaseMask');
        }
        if (this.purchaseMask) {
            this.purchaseMask.active = false;
            const op = this.purchaseMask.getComponent(UIOpacity);
            if (op) op.opacity = 0;
        }
    }

    /**
     * 确保 PurchaseMask 节点就绪 (若预制体中缺失则动态创建全屏遮罩兜底)
     */
    private ensurePurchaseMaskCreated(): Node {
        if (this.purchaseMask && this.purchaseMask.isValid) return this.purchaseMask;

        this.purchaseMask = this.node.getChildByName('PurchaseMask');
        if (this.purchaseMask && this.purchaseMask.isValid) return this.purchaseMask;

        const topParent = GameScene.instance?.getTopUIParent();
        if (topParent) {
            const existing = topParent.getChildByName('PurchaseMask');
            if (existing && existing.isValid) {
                this.purchaseMask = existing;
                return existing;
            }
        }

        const maskNode = new Node('PurchaseMask');
        const tf = maskNode.addComponent(UITransform);
        tf.setContentSize(1080, 1920);

        const sprite = maskNode.addComponent(Sprite);
        sprite.color = new Color(0, 0, 0, 200);

        const op = maskNode.addComponent(UIOpacity);
        op.opacity = 0;

        maskNode.addComponent(BlockInputEvents);

        const iconNode = new Node('loadingIcon');
        const iconTf = iconNode.addComponent(UITransform);
        iconTf.setContentSize(277, 292);
        iconNode.setParent(maskNode);

        // 加载现有 LoadingWaiting 的旋转图标
        resources.load('Public/View/LoadingWaiting', Prefab, (err, prefab) => {
            if (!err && prefab) {
                const dummy = instantiate(prefab);
                const dummyIcon = dummy.getChildByName('loadingIcon');
                const dummySp = dummyIcon?.getComponent(Sprite);
                if (dummySp && dummySp.spriteFrame && iconNode.isValid) {
                    const iconSp = iconNode.getComponent(Sprite) || iconNode.addComponent(Sprite);
                    iconSp.spriteFrame = dummySp.spriteFrame;
                    // 与 LoadingWaiting 的图标尺寸和缩放保持一致。
                    iconSp.sizeMode = Sprite.SizeMode.CUSTOM;
                    const dummyTf = dummyIcon.getComponent(UITransform);
                    if (dummyTf) iconTf.setContentSize(dummyTf.contentSize);
                    iconNode.setScale(dummyIcon.scale);
                }
                dummy.destroy();
            }
        });

        maskNode.setParent(this.node);
        maskNode.active = false;
        this.purchaseMask = maskNode;
        return maskNode;
    }

    /**
     * 显示内购专属购买遮罩 (对齐 CarMatch_OnLine)
     */
    public showPurchaseMask(): void {
        this.ensurePurchaseMaskCreated();
        if (!this.purchaseMask || !this.purchaseMask.isValid) return;

        // 对齐 CarMatch_OnLine: 提至顶层容器（GameScene.topUI 或 Canvas），彻底防止被底层容器裁剪遮挡
        const topParent = GameScene.instance?.getTopUIParent() || this.node;
        if (this.purchaseMask.parent !== topParent) {
            this.purchaseMask.setParent(topParent);
        }
        this.purchaseMask.setPosition(0, 0, 0);
        this.purchaseMask.setSiblingIndex(topParent.children.length - 1);
        this.purchaseMask.active = true;

        const widget = this.purchaseMask.getComponent(Widget);
        if (widget) {
            widget.updateAlignment();
        }

        const op = this.purchaseMask.getComponent(UIOpacity);
        if (op) {
            op.opacity = 255; // 立即展现半透明黑底，给予玩家即时的视觉反馈
        }

        const icon = this.purchaseMask.getChildByName('loadingIcon');
        if (icon && icon.isValid) {
            tween(icon).stop();
            tween(icon).by(1.0, { angle: -360 }).repeatForever().start();
        }

    }

    /**
     * 隐藏内购专属购买遮罩
     */
    public hidePurchaseMask(): void {
        if (!this.purchaseMask || !this.purchaseMask.isValid || !this.purchaseMask.active) return;

        const icon = this.purchaseMask.getChildByName('loadingIcon');
        if (icon && icon.isValid) {
            tween(icon).stop();
        }

        const op = this.purchaseMask.getComponent(UIOpacity);
        if (op) {
            tween(op).stop();
            tween(op).to(0.15, { opacity: 0 }).call(() => {
                if (this.purchaseMask && this.purchaseMask.isValid) {
                    this.purchaseMask.active = false;
                }
            }).start();
        } else {
            this.purchaseMask.active = false;
        }

    }

    /**
     * 初始化各商品的 UI 绑定与价格文本设置
     */
    private initProductsUI(): void {
        if (!this.contentNode) {
            return;
        }

        this._itemsMap.clear();

        // 1. 遍历默认配置商品
        DEFAULT_IAP_PRODUCTS.forEach(product => {
            const cardNode = this.findCardNode(product.nodeName);
            if (!cardNode) {
                return;
            }

            // 查找购买按钮 BtnPurchase
            const btnNode = cardNode.getChildByName('BtnPurchase');
            if (!btnNode) {
                return;
            }

            // 查找价格文本 Label
            const priceNode = btnNode.getChildByName('price');
            const priceLabel = priceNode ? priceNode.getComponent(Label) : null;
            if (priceLabel) {
                // 格式化价格，兼容 numimage1.fnt 点字符映射为 'D'
                priceLabel.string = formatIapFontPrice(product.priceUSD);
            }

            // 绑定点击事件 (同时监听 TOUCH_END 和 Button 的 click 事件，多层绑定防止失效)
            const onClickHandler = () => {
                Audio.play(AudioId.uiClick);
                this.onBtnPurchaseClick(product);
            };

            btnNode.off(Node.EventType.TOUCH_END);
            btnNode.on(Node.EventType.TOUCH_END, onClickHandler, this);

            const btn = btnNode.getComponent(Button);
            if (btn) {
                btnNode.off('click');
                btnNode.on('click', onClickHandler, this);
            }

            if (priceNode) {
                priceNode.off(Node.EventType.TOUCH_END);
                priceNode.on(Node.EventType.TOUCH_END, onClickHandler, this);
            }

            this._itemsMap.set(product.nodeName, {
                cardNode,
                btnNode,
                priceLabel,
                product
            });
        });
    }

    /**
     * 在 content 节点树下定位商品节点（支持多层级如 CoinRow1/Coin100）
     */
    private findCardNode(nodeName: string): Node | null {
        if (!this.contentNode) return null;

        // 1. 尝试直接作为 content 的一级子节点查找
        const directChild = this.contentNode.getChildByName(nodeName);
        if (directChild) return directChild;

        // 2. 遍历子节点（如 CoinRow1, CoinRow2）查找深层子节点
        for (const child of this.contentNode.children) {
            const deepChild = child.getChildByName(nodeName);
            if (deepChild) return deepChild;
        }

        return null;
    }

    // ======================================== 事件注册与同步 ========================================
    private registerEvents(): void {
        GameData.event.on(GameDataEvent.REMOVE_ADS_CHANGED, this.onRemoveAdsChanged, this);
    }

    private unregisterEvents(): void {
        GameData.event.off(GameDataEvent.REMOVE_ADS_CHANGED, this.onRemoveAdsChanged, this);
    }

    /**
     * 去广告状态变动回调
     */
    private onRemoveAdsChanged(isRemove: boolean): void {
        this.syncRemoveAdsState(false);
    }

    /**
     * 同步去广告卡片显示状态
     * @param immediate 是否立即隐藏而不播放缩放淡出
     */
    private syncRemoveAdsState(immediate: boolean = false): void {
        const removeAdsItem = this._itemsMap.get('RemoveAds');
        if (!removeAdsItem || !removeAdsItem.cardNode.isValid) return;

        const isRemoved = GameData.instance.isRemoveAds;
        if (!isRemoved) {
            removeAdsItem.cardNode.active = true;
            return;
        }

        if (immediate) {
            removeAdsItem.cardNode.active = false;
            this.refreshContentLayout();
        } else {
            // 平滑淡出并缩起动画
            const node = removeAdsItem.cardNode;
            let op = node.getComponent(UIOpacity);
            if (!op) op = node.addComponent(UIOpacity);

            tween(node)
                .to(0.25, { scale: new Vec3(0.8, 0.8, 1) }, { easing: 'cubicIn' })
                .start();

            tween(op)
                .to(0.25, { opacity: 0 })
                .call(() => {
                    node.active = false;
                    this.refreshContentLayout();
                })
                .start();
        }
    }

    /**
     * 触发布局组件立即重新排版
     */
    private refreshContentLayout(): void {
        if (!this.contentNode) return;
        const layout = this.contentNode.getComponent(Layout);
        if (layout) {
            layout.updateLayout();
        }
    }

    // ======================================== 视觉与动效 ========================================
    /**
     * 播放卡片入场动效 (参考 CarMatch_OnLine)
     */
    private playEnterAnimation(): void {
        if (!this.contentNode) return;

        const children = this.contentNode.children.filter(c => c.active);
        const duration = 0.35;

        children.forEach((child, index) => {
            const originalPos = child.position.clone();
            const originalScale = child.scale.clone();

            let op = child.getComponent(UIOpacity);
            if (!op) op = child.addComponent(UIOpacity);

            op.opacity = 0;
            child.setScale(new Vec3(originalScale.x * 0.9, originalScale.y * 0.9, 1));
            child.setPosition(new Vec3(originalPos.x, originalPos.y - 40, originalPos.z));

            tween(child)
                .delay(index * 0.05)
                .to(duration, { position: originalPos, scale: originalScale }, { easing: 'backOut' })
                .start();

            tween(op)
                .delay(index * 0.05)
                .to(0.2, { opacity: 255 })
                .start();
        });
    }

    // ======================================== 购买核心业务 ========================================
    /**
     * 点击购买商品按钮处理
     */
    private async onBtnPurchaseClick(product: IAPProductItem): Promise<void> {
        if (this._purchasing) return;
        this._purchasing = true;


        // 1. 统计埋点 (对齐 CarMatch_OnLine)
        try {
            GameSDK.inst.logEvent('purchaseProduct', { value: product.id });
        } catch (e) {
        }

        // 2. 立即激活内购专属等待遮罩 (居中旋转 loadingIcon + 半透明黑底 + BlockInputEvents)
        this.showPurchaseMask();

        try {
            // 3. 校验并调用内购接口
            const success = await this.doPurchase(product);
            if (success) {
                this.onPurchaseSuccess(product);
            }
        } catch (err: any) {
            GameSDK.inst.logEvent('purchaseResult', { value: product.id, result: err?.code === 'USER_INPUT' ? 'cancelled' : 'failed', code: err?.code || 'exception' });
            Remind.show(typeof err === 'string' ? err : (err?.message || 'Purchase failed!'));
        } finally {
            this._purchasing = false;
            this.hidePurchaseMask();
        }
    }

    /**
     * 执行实际支付逻辑
     * 在真实支持 FBInstant 内购环境下调用 SDK
     */
    private async doPurchase(product: IAPProductItem): Promise<boolean> {
        // A. 平台 SDK 已准备就绪
        let isSdkReady = false;
        try {
            isSdkReady = !!(GameSDK.inst && typeof GameSDK.inst.isReady === 'function' && GameSDK.inst.isReady());
        } catch (e) {
            isSdkReady = false;
        }

        if (isSdkReady) {
            const result = await GameSDK.inst.purchase(product.id);
            if (result && result.success) {
                GameSDK.inst.logEvent('purchaseResult', { value: product.id, result: 'success' });
                return true;
            } else {
                GameSDK.inst.logEvent('purchaseResult', { value: product.id, result: result?.code === 'USER_INPUT' ? 'cancelled' : 'failed', code: result?.code || 'unknown_error' });
                const errorMsg = result?.message || 'Purchase was cancelled or failed.';
                Remind.show(errorMsg);
                return false;
            }
        }

        // B. 不支持内购的环境
        GameSDK.inst.logEvent('purchaseResult', { value: product.id, result: 'unsupported', code: 'not_ready' });
        Remind.show('Purchases are not supported on this device.');
        return false;
    }

    /**
     * 购买成功后续处理：发放道具、发放金币、标记去广告、保存存档、弹出直接提示
     * （不弹出 RewardPage，避免看广告翻倍导致内购数值不均衡）
     */
    private onPurchaseSuccess(product: IAPProductItem): void {
        Audio.play(AudioId.buy);

        // 1. 如果包含永久去广告权益
        if (product.isRemoveAds) {
            GameData.instance.setRemoveAds(true);
            Remind.show('Ad removal unlocked successfully!');
        } else {
            Remind.show('Purchase successful!');
        }

        // 2. 增加金币并刷新
        if (product.coins > 0) {
            GameData.instance.addCoin(product.coins);
        }

        // 3. 增加道具并刷新
        if (product.props && product.props.length > 0) {
            product.props.forEach(p => {
                GameData.instance.addProp(p.type, p.count);
            });
        }

        // 4. 持久化存档
        GameData.instance.saveData();
    }
}
