import {
    _decorator, assetManager, Component, instantiate, Label, Layout, Node,
    Prefab, resources, Sprite, SpriteFrame, tween, UIOpacity, Vec3, Button
} from 'cc';
import { GameData } from '../Config/GameData';
import { GameScene } from '../Scene/GameScene';
import { Remind } from '../Tools/Remind/Remind';
import { GameSDK } from '../../sdk/GameSDK';
import { LoadingWaiting } from './LoadingWaiting';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

export type RewardKind = 'COIN' | 'TNT' | 'HAMMER' | 'DRILL' | 'MOVE';

export interface RewardEntry {
    type: RewardKind;
    count: number;
    /** 可选自定义指定 SpriteFrame (优先使用) */
    icon?: SpriteFrame | null;
    /** 可选降级 UUID */
    iconUuid?: string;
}

const REWARD_NAME: Record<RewardKind, string> = {
    COIN: 'Coins',
    MOVE: 'Moves',
    HAMMER: 'Hammer',
    DRILL: 'Drill',
    TNT: 'TNT',
};

// 备用降级 UUID (仅在属性检查器未配置图标且未指定 icon 时兜底使用)
const FALLBACK_ICON_UUID: Record<RewardKind, string> = {
    COIN: '54a4b7fc-6f1a-47f7-9254-8b5c72f0b974@f9941',
    MOVE: 'f35a89e3-203a-4d6e-af10-13b4ba0afeaf@f9941',
    HAMMER: '5373d763-6341-402f-8a26-451b3057b52d@f9941',
    DRILL: 'e9487125-a984-422e-a059-cb06d5f1c982@f9941',
    TNT: '75c91f44-dd95-4372-9a37-9afa7302b3fa@f9941',
};

const ITEM_PREFAB_PATH = 'Other/View/RewardItem';
const PAGE_PREFAB_PATH = 'Other/View/RewardPage';

/**
 * 通用奖励弹窗 (RewardPage)
 * 采用方案 1：优先使用属性检查器中绑定的 SpriteFrame 图标与 ItemPrefab，
 * 具有零加载延迟、避免打包裁剪、不闪烁的优势。
 */
@ccclass('RewardPage')
export class RewardPage extends Component {
    // ======================================== 节点与预制体引用 ========================================
    @property({ type: Node, tooltip: '黑色蒙层背景', group: { name: '节点引用', id: '0' } })
    public bgNode: Node | null = null;

    @property({ type: Node, tooltip: '顶部横幅标题 (title)', group: { name: '节点引用', id: '0' } })
    public titleNode: Node | null = null;

    @property({ type: Node, tooltip: '奖励项排布容器 (showReward)', group: { name: '节点引用', id: '0' } })
    public showRewardContainer: Node | null = null;

    @property({ type: Node, tooltip: '看视频双倍领取按钮 (BtnDoubleClaim)', group: { name: '节点引用', id: '0' } })
    public btnDoubleClaimNode: Node | null = null;

    @property({ type: Node, tooltip: '普通直接领取按钮 (BtnClaim)', group: { name: '节点引用', id: '0' } })
    public btnClaimNode: Node | null = null;

    @property({ type: Prefab, tooltip: '单项奖励卡片预制体 (RewardItem.prefab)', group: { name: '预制体', id: '1' } })
    public itemPrefab: Prefab | null = null;

    // ======================================== 方案 1：属性检查器直接绑定的 SpriteFrame 图标 ========================================
    @property({ type: SpriteFrame, tooltip: '金币图标 (COIN)', group: { name: '奖励图标 (方案1)', id: '2' } })
    public coinIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '锤子图标 (HAMMER)', group: { name: '奖励图标 (方案1)', id: '2' } })
    public hammerIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'TNT 炸弹图标 (TNT)', group: { name: '奖励图标 (方案1)', id: '2' } })
    public tntIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '电钻图标 (DRILL)', group: { name: '奖励图标 (方案1)', id: '2' } })
    public drillIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '加步数图标 (MOVE)', group: { name: '奖励图标 (方案1)', id: '2' } })
    public moveIcon: SpriteFrame | null = null;

    // ======================================== 运行时状态 ========================================
    private static _opening = false;

    private _closing: boolean = false;
    private _claimed: boolean = false;
    private _rewards: RewardEntry[] = [];
    private _onClaimCallback?: (isDouble: boolean) => void;
    private _holdsLoading = false;
    private _openSettled = false;

    // ======================================== 静态快捷打开入口 ========================================
    /**
     * 快捷打开奖励弹窗
     * @param rewards 奖励列表 (最多展示 5 项)
     * @param parent 挂载父节点 (默认为 GameScene 的 topUI 或 Canvas)
     * @param onClaimCallback 领取完成回调 (isDouble: 是否观看视频获得双倍)
     */
    public static show(
        rewards: RewardEntry[],
        parent?: Node,
        onClaimCallback?: (isDouble: boolean) => void
    ): void {
        if (this._opening) return;

        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            return;
        }

        this._opening = true;
        LoadingWaiting.acquire(targetParent, () => {
            resources.load(PAGE_PREFAB_PATH, Prefab, (err, prefab) => {
                const abort = () => {
                    this._opening = false;
                    LoadingWaiting.release();
                };
                if (err || !prefab) {
                    abort();
                    return;
                }
                if (!targetParent.isValid) {
                    abort();
                    return;
                }

                const node = instantiate(prefab);
                const page = node.getComponent(RewardPage) || node.addComponent(RewardPage);
                page.markLoadingHeld();
                node.setParent(targetParent);
                node.setSiblingIndex(targetParent.children.length - 1);
                LoadingWaiting.raise();
                this._opening = false;
                page.open(rewards, onClaimCallback);
            });
        });
    }

    /** 这次打开占用了等待遮罩，奖励项挂好后再关掉。 */
    public markLoadingHeld(): void {
        this._holdsLoading = true;
    }

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameSDK.inst.logEvent('showPage', { value: 'rewardPage' });
        this.initNodeReferences();
        this.initButtons();
    }

    onDestroy() {
        this.finishOpen(false);
    }

    /** 自动查找补全节点引用 (如果 Inspector 未手动拖入) */
    private initNodeReferences() {
        if (!this.bgNode) this.bgNode = this.node.getChildByName('bg');
        if (!this.titleNode) this.titleNode = this.node.getChildByName('title');
        if (!this.showRewardContainer) this.showRewardContainer = this.node.getChildByName('showReward');
        if (!this.btnDoubleClaimNode) this.btnDoubleClaimNode = this.node.getChildByName('BtnDoubleClaim');
        if (!this.btnClaimNode) this.btnClaimNode = this.node.getChildByName('BtnClaim');
    }

    private initButtons() {
        this.btnClaimNode?.on(Node.EventType.TOUCH_END, this.onClaim, this);
        this.btnDoubleClaimNode?.on(Node.EventType.TOUCH_END, this.onClaimDouble, this);
    }

    // ======================================== 页面开启与填充 ========================================
    /**
     * 打开页面并显示奖励
     */
    public open(rewards: RewardEntry[], onClaimCallback?: (isDouble: boolean) => void) {
        this._rewards = (rewards || []).slice(0, 5);
        this._onClaimCallback = onClaimCallback;
        this._claimed = false;
        this._closing = false;

        const opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        opacity.opacity = 0;
        this.fillRewardItems();
    }

    /** 奖励项挂好后再播进场，并关掉等待遮罩。 */
    private finishOpen(playAnim: boolean): void {
        if (this._openSettled) return;
        this._openSettled = true;
        if (playAnim && this.node && this.node.isValid) this.playEnterAnimation();
        if (this._holdsLoading) {
            this._holdsLoading = false;
            LoadingWaiting.release();
        }
    }

    /**
     * 获取指定奖励类型对应的 SpriteFrame 图标 (方案 1 优先)
     */
    public getIconSpriteFrame(type: RewardKind): SpriteFrame | null {
        switch (type) {
            case 'COIN': return this.coinIcon;
            case 'HAMMER': return this.hammerIcon;
            case 'TNT': return this.tntIcon;
            case 'DRILL': return this.drillIcon;
            case 'MOVE': return this.moveIcon;
            default: return null;
        }
    }

    /**
     * 实例化并渲染所有奖励项
     */
    private fillRewardItems() {
        if (!this.showRewardContainer?.isValid) {
            this.finishOpen(true);
            return;
        }

        // 如果在 Inspector 中已绑定 itemPrefab，直接同步渲染；否则从 resources 动态加载
        if (this.itemPrefab) {
            this.renderItems(this.itemPrefab);
            this.finishOpen(true);
            return;
        }

        resources.load(ITEM_PREFAB_PATH, Prefab, (err, prefab) => {
            if (!this.node || !this.node.isValid) return;
            if (err || !prefab || !this.showRewardContainer?.isValid) {
                this.finishOpen(true);
                return;
            }
            this.renderItems(prefab);
            this.finishOpen(true);
        });
    }

    private renderItems(prefab: Prefab) {
        if (!this.showRewardContainer?.isValid) return;
        this.showRewardContainer.removeAllChildren();

        for (const reward of this._rewards) {
            const item = instantiate(prefab);
            item.setParent(this.showRewardContainer);

            // 1. 设置数量文本 (*数量)
            const labelNode = item.getChildByName('text');
            const label = labelNode?.getComponent(Label);
            if (label) {
                label.string = `*${reward.count}`;
            }

            // 2. 设置图标 (方案 1：优先读取 Inspector 绑定的 SpriteFrame)
            const iconNode = item.getChildByName('icon');
            const iconSprite = iconNode?.getComponent(Sprite);
            if (iconSprite) {
                const boundFrame = reward.icon || this.getIconSpriteFrame(reward.type);
                if (boundFrame) {
                    // 同步直接赋值，零延迟、无白块闪烁
                    iconSprite.spriteFrame = boundFrame;
                } else {
                    // 兜底降级：尝试使用 fallback UUID 异步读取
                    const uuid = reward.iconUuid || FALLBACK_ICON_UUID[reward.type];
                    if (uuid) {
                        assetManager.loadAny(uuid, (err, frame: SpriteFrame) => {
                            if (!err && frame && iconSprite.isValid) {
                                iconSprite.spriteFrame = frame;
                            }
                        });
                    }
                }
            }
        }

        // 刷新 Layout 水平排列
        const layout = this.showRewardContainer.getComponent(Layout);
        if (layout) {
            layout.updateLayout();
        }
    }

    // ======================================== 动效表现 ========================================
    private playEnterAnimation() {
        // 1. 整体透明度淡入
        if (this._holdsLoading) {
            LoadingWaiting.fadeInExcept(this.node, this.bgNode, 0.2);
        } else {
            let opacity = this.node.getComponent(UIOpacity);
            if (!opacity) opacity = this.node.addComponent(UIOpacity);
            opacity.opacity = 0;
            tween(opacity).to(0.2, { opacity: 255 }).start();
        }

        // 2. 标题轻微弹性下落
        if (this.titleNode) {
            const originY = 700;
            this.titleNode.setPosition(0, originY + 80, 0);
            tween(this.titleNode)
                .to(0.25, { position: new Vec3(0, originY, 0) }, { easing: 'backOut' })
                .start();
        }

        // 3. 奖励容器缩放弹出
        if (this.showRewardContainer) {
            this.showRewardContainer.setScale(0.4, 0.4, 1);
            tween(this.showRewardContainer)
                .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
        }
    }

    // ======================================== 领取交互 ========================================
    /** 普通 1 倍直接领取 */
    private onClaim() {
        Audio.play(AudioId.uiClick);
        if (this._claimed || this._closing) return;
        this._claimed = true;

        Audio.play(AudioId.claim);
        this.grantRewards(1);
        this.showTip(this.generateTipText(1));
        this._onClaimCallback?.(false);
        this.close();
    }

    /** 看视频 2 倍领取 */
    private onClaimDouble() {
        Audio.play(AudioId.uiClick);
        if (this._claimed || this._closing) return;
        this._claimed = true;

        this.playRewardedVideo(() => {
            Audio.play(AudioId.claim);
            this.grantRewards(2);
            this.showTip(this.generateTipText(2));
            this._onClaimCallback?.(true);
            this.close();
        }, () => {
            this._claimed = false;
        });
    }

    /** 仅成功完成激励视频后执行双倍领取。 */
    private playRewardedVideo(onComplete: () => void, onFail: () => void) {
        GameSDK.inst.logEvent('readyStartAD', { value: 'rewardPage' });
        GameSDK.inst.ShowADVideo('rewardPage').then(() => {
            GameSDK.inst.logEvent('realEndAD', { value: 'rewardPage' });
            onComplete();
        }).catch(() => {
            onFail();
        });
    }

    /** 发放奖励到核心存档 GameData */
    private grantRewards(multiplier: number) {
        for (const reward of this._rewards) {
            const count = reward.count * multiplier;
            if (reward.type === 'COIN') {
                GameData.instance.addCoin(count);
            } else {
                GameData.instance.addProp(reward.type, count);
            }
        }
    }

    private generateTipText(multiplier: number): string {
        if (this._rewards.length !== 1) {
            return 'Rewards claimed.';
        }
        const reward = this._rewards[0];
        const count = reward.count * multiplier;
        if (reward.type === 'COIN') {
            return `You received ${count} gold coins.`;
        }
        const name = REWARD_NAME[reward.type] || reward.type;
        return `You received ${count} ${name}.`;
    }

    private showTip(text: string) {
        Remind.showTipRemind(text);
    }

    /**
     * 关闭弹窗
     */
    public close() {
        if (this._closing) return;
        this._closing = true;

        let opacity = this.node.getComponent(UIOpacity);
        if (!opacity) opacity = this.node.addComponent(UIOpacity);
        tween(opacity)
            .to(0.18, { opacity: 0 })
            .call(() => {
                if (this.node?.isValid) {
                    this.node.destroy();
                }
            })
            .start();
    }
}
