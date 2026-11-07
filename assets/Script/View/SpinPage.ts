import {
    _decorator, Component, Node, Button, Label, Sprite, SpriteFrame,
    Prefab, instantiate, resources, assetManager, tween, Vec3, UIOpacity
} from 'cc';
import { GameSDK } from '../../sdk/GameSDK';
import { GameScene } from '../Scene/GameScene';
import { RewardPage } from './RewardPage';
import { LoadingWaiting } from './LoadingWaiting';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { GameData, GameDataEvent } from '../Config/GameData';

const { ccclass, property } = _decorator;

/**
 * 奖品配置项数据接口
 */
export interface SpinPrizeItem {
    id: number;
    type: 'COIN' | 'TNT' | 'HAMMER' | 'DRILL' | 'MOVE';
    name: string;
    count: number;
    iconUuid: string;
}

/**
 * 转盘 8 个扇区的奖品预设定义 (与效果图 1、2 严格一致)
 * 0: 金币 *200 (绿色扇区)
 * 1: 加步数 *2 (玫红扇区)
 * 2: 金币 *200 (深紫扇区)
 * 3: 电钻 *2 (橙色扇区)
 * 4: 金币 *200 (红色扇区)
 * 5: 锤子 *2 (蓝色扇区)
 * 6: 金币 *200 (天蓝扇区)
 * 7: TNT *2 (金黄扇区)
 */
export const SPIN_PRIZES: ReadonlyArray<SpinPrizeItem> = [
    { id: 0, type: 'COIN', name: 'Coins', count: 200, iconUuid: '54a4b7fc-6f1a-47f7-9254-8b5c72f0b974@f9941' },
    { id: 1, type: 'MOVE', name: 'Moves +1', count: 2, iconUuid: 'f35a89e3-203a-4d6e-af10-13b4ba0afeaf@f9941' },
    { id: 2, type: 'COIN', name: 'Coins', count: 200, iconUuid: '54a4b7fc-6f1a-47f7-9254-8b5c72f0b974@f9941' },
    { id: 3, type: 'DRILL', name: 'Drill', count: 2, iconUuid: 'e9487125-a984-422e-a059-cb06d5f1c982@f9941' },
    { id: 4, type: 'COIN', name: 'Coins', count: 200, iconUuid: '54a4b7fc-6f1a-47f7-9254-8b5c72f0b974@f9941' },
    { id: 5, type: 'HAMMER', name: 'Hammer', count: 2, iconUuid: '5373d763-6341-402f-8a26-451b3057b52d@f9941' },
    { id: 6, type: 'COIN', name: 'Coins', count: 200, iconUuid: '54a4b7fc-6f1a-47f7-9254-8b5c72f0b974@f9941' },
    { id: 7, type: 'TNT', name: 'TNT', count: 2, iconUuid: '75c91f44-dd95-4372-9a37-9afa7302b3fa@f9941' },
];

/** 幸运转盘抽奖冷却时长（毫秒，默认 1 小时） */
const SPIN_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * 幸运转盘页面控制器 (SpinPage)
 */
@ccclass('SpinPage')
export class SpinPage extends Component {
    // ======================================== 属性检查器绑定 / 自动获取 ========================================
    @property({ type: Node, tooltip: '黑色半透明蒙层背景', group: { name: '容器节点', id: '0' } })
    public bgNode: Node | null = null;

    @property({ type: Node, tooltip: '转盘外层包装容器', group: { name: '核心节点', id: '1' } })
    public spinBoxNode: Node | null = null;

    @property({ type: Node, tooltip: '旋转圆盘节点', group: { name: '核心节点', id: '1' } })
    public spinNode: Node | null = null;

    @property({ type: Node, tooltip: '指针节点', group: { name: '核心节点', id: '1' } })
    public pointerNode: Node | null = null;

    @property({ type: Node, tooltip: '免费提示节点 (desc_free)', group: { name: '提示节点', id: '2' } })
    public descFreeNode: Node | null = null;

    @property({ type: Node, tooltip: '倒计时提示节点 (desc_time)', group: { name: '提示节点', id: '2' } })
    public descTimeNode: Node | null = null;

    @property({ type: Label, tooltip: '倒计时文本组件', group: { name: '提示节点', id: '2' } })
    public lblCountdown: Label | null = null;

    @property({ type: Node, tooltip: '免费随机抽取按钮 (BtnRandom)', group: { name: '交互按钮', id: '3' } })
    public btnRandom: Node | null = null;

    @property({ type: Node, tooltip: '首次跳过/关闭按钮 (BtnNothanks1)', group: { name: '交互按钮', id: '3' } })
    public btnNoThanks1: Node | null = null;

    @property({ type: Node, tooltip: '看视频再抽一次按钮 (BtnRetry)', group: { name: '交互按钮', id: '3' } })
    public btnRetry: Node | null = null;

    @property({ type: Node, tooltip: '冷却中跳过/关闭按钮 (BtnNothanks2)', group: { name: '交互按钮', id: '3' } })
    public btnNoThanks2: Node | null = null;

    @property({ type: Node, tooltip: '右上角关闭按钮 (BtnClose)', group: { name: '交互按钮', id: '3' } })
    public btnClose: Node | null = null;

    @property({ type: Prefab, tooltip: 'SpinItem 奖品预制体 (可选，留空则从 resources 加载)', group: { name: '预制体', id: '4' } })
    public spinItemPrefab: Prefab | null = null;

    // ======================================== 内部状态 ========================================
    private _isSpinning: boolean = false;
    private _adPlaying: boolean = false;
    private _isClosing: boolean = false;
    private _rewardOpen: boolean = false;
    private _currentAngle: number = 0;
    private _itemsCreated: boolean = false;
    private _holdsLoading = false;
    private _openSettled = false;
    private static _opening = false;

    public static isShowingOrOpening(): boolean {
        return this._opening || !!GameScene.instance?.spinPageNode?.isValid;
    }

    /** 冷却已结束，可以免费转一次。 */
    public static hasFreeSpin(): boolean {
        const lastTime = GameData.instance.lastSpinTimestamp;
        return !lastTime || Date.now() - lastTime >= SPIN_COOLDOWN_MS;
    }

    // ======================================== 静态快捷唤起 ========================================
    /**
     * 快捷打开 SpinPage。先盖上等待页，奖品格子实例化完再关掉。
     * @param parent 挂载父节点，通常为 topUI
     * @param callback 完成回调
     */
    public static show(parent?: Node, callback?: (spinPage: SpinPage) => void): void {
        const opened = GameScene.instance?.spinPageNode;
        if (opened && opened.isValid) {
            const page = opened.getComponent(SpinPage);
            if (callback && page) callback(page);
            return;
        }
        if (this._opening) return;

        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            return;
        }

        this._opening = true;
        LoadingWaiting.acquire(targetParent, () => {
            resources.load('Other/View/SpinPage', Prefab, (err, prefab) => {
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
                const existed = GameScene.instance?.spinPageNode;
                if (existed && existed.isValid) {
                    abort();
                    const page = existed.getComponent(SpinPage);
                    if (callback && page) callback(page);
                    return;
                }

                const node = instantiate(prefab);
                const sp = node.getComponent(SpinPage) || node.addComponent(SpinPage);
                sp.markLoadingHeld();
                node.setParent(targetParent);
                LoadingWaiting.raise();
                this._opening = false;
                if (GameScene.instance) {
                    GameScene.instance.spinPageNode = node;
                }
                if (callback) callback(sp);
            });
        });
    }

    /** 这次打开占用了等待遮罩，实例化结束后由页面自己关掉。 */
    public markLoadingHeld(): void {
        this._holdsLoading = true;
    }

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameSDK.inst.logEvent('showPage', { value: 'spinPage' });
        this.autoFindNodes();
        this.initButtons();
        if (this._holdsLoading) {
            const uiOpacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
            uiOpacity.opacity = 0;
        }
    }

    start() {
        this.refreshState();
        this.setupSpinItems();
    }

    onDestroy() {
        this.finishOpen(false);
    }

    /** 扇区奖品实例化结束：先播进场，再关掉等待遮罩。 */
    private finishOpen(playAnim: boolean): void {
        if (this._openSettled) return;
        this._openSettled = true;
        if (playAnim && this.node && this.node.isValid) {
            this.playEnterAnimation();
        }
        if (this._holdsLoading) {
            this._holdsLoading = false;
            LoadingWaiting.release();
        }
    }

    update(deltaTime: number) {
        // 倒计时刷新
        if (this.descTimeNode && this.descTimeNode.active && this.lblCountdown) {
            this.updateCountdownLabel();
        }
    }

    // ======================================== 节点自动查找与绑定 ========================================
    private autoFindNodes() {
        if (!this.bgNode) this.bgNode = this.node.getChildByName('bg');
        if (!this.spinBoxNode) this.spinBoxNode = this.node.getChildByName('spinBox');

        if (this.spinBoxNode) {
            if (!this.spinNode) this.spinNode = this.spinBoxNode.getChildByName('spin');
            if (!this.pointerNode) this.pointerNode = this.spinBoxNode.getChildByName('pointer');
        }

        if (!this.descFreeNode) this.descFreeNode = this.node.getChildByName('desc_free');
        if (!this.descTimeNode) this.descTimeNode = this.node.getChildByName('desc_time');

        if (this.descTimeNode && !this.lblCountdown) {
            const textNode = this.descTimeNode.getChildByName('text');
            if (textNode) this.lblCountdown = textNode.getComponent(Label);
        }

        if (!this.btnRandom) this.btnRandom = this.node.getChildByName('BtnRandom');
        if (!this.btnNoThanks1) this.btnNoThanks1 = this.node.getChildByName('BtnNothanks1');
        if (!this.btnRetry) this.btnRetry = this.node.getChildByName('BtnRetry');
        if (!this.btnNoThanks2) this.btnNoThanks2 = this.node.getChildByName('BtnNothanks2');
        if (!this.btnClose) this.btnClose = this.node.getChildByName('BtnClose');
    }

    /**
     * 初始化按钮交互监听
     */
    private initButtons() {
        // 1. 抽奖按钮 (BtnRandom)
        if (this.btnRandom) {
            this.btnRandom.on(Node.EventType.TOUCH_END, this.onBtnRandomClick, this);
        }

        // 2. 视频再次抽取按钮 (BtnRetry)
        if (this.btnRetry) {
            this.btnRetry.on(Node.EventType.TOUCH_END, this.onBtnRetryClick, this);
        }

        // 3. 关闭按钮 (BtnClose, BtnNothanks1, BtnNothanks2)
        if (this.btnClose) {
            this.btnClose.on(Node.EventType.TOUCH_END, this.close, this);
        }
        if (this.btnNoThanks1) {
            this.btnNoThanks1.on(Node.EventType.TOUCH_END, this.close, this);
        }
        if (this.btnNoThanks2) {
            this.btnNoThanks2.on(Node.EventType.TOUCH_END, this.close, this);
        }
    }

    // ======================================== 弹窗出场动效 ========================================
    private playEnterAnimation() {
        if (this.spinBoxNode) {
            this.spinBoxNode.setScale(new Vec3(0.6, 0.6, 1));
        }

        if (this._holdsLoading) {
            LoadingWaiting.fadeInExcept(this.node, this.bgNode, 0.2);
        } else {
            // 整体淡入
            let uiOpacity = this.node.getComponent(UIOpacity);
            if (!uiOpacity) {
                uiOpacity = this.node.addComponent(UIOpacity);
            }
            uiOpacity.opacity = 0;
            tween(uiOpacity)
                .to(0.2, { opacity: 255 })
                .start();
        }

        // 内容弹性放大
        if (this.spinBoxNode) {
            tween(this.spinBoxNode)
                .to(0.28, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'backOut' })
                .to(0.12, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'quadOut' })
                .start();
        }
    }

    // ======================================== 装配 8 个扇区奖品 ========================================
    /**
     * 动态实例化并布局 8 个 SpinItem 到转盘上
     */
    private setupSpinItems() {
        if (this._itemsCreated || !this.spinNode) {
            this.finishOpen(true);
            return;
        }

        let pending = 0;
        const iconJobs: Array<() => void> = [];
        const reveal = () => {
            if (!this.node || !this.node.isValid) return;
            this.finishOpen(true);
        };

        const onPrefabReady = (itemPrefab: Prefab) => {
            if (!this.spinNode || !this.spinNode.isValid) {
                this.finishOpen(true);
                return;
            }
            this.spinNode.removeAllChildren();

            const radius = 245; // 距离圆盘中心的半径

            for (let i = 0; i < SPIN_PRIZES.length; i++) {
                const prize = SPIN_PRIZES[i];
                const itemNode = instantiate(itemPrefab);
                itemNode.name = `SpinItem_${i}_${prize.name}`;
                itemNode.setParent(this.spinNode);

                // 计算各扇区朝向角度：
                // 转盘顶部为 12 点钟方向（竖直分隔线），绿色扇区中心在顺时针 22.5° 处
                // 极坐标笛卡尔系：从 +X 轴开始，12 点钟为 90°
                const deg = 90 - (22.5 + i * 45);
                const rad = deg * (Math.PI / 180);

                const posX = radius * Math.cos(rad);
                const posY = radius * Math.sin(rad);
                itemNode.setPosition(new Vec3(posX, posY, 0));

                // Item 自身旋转：让 icon 指向盘外，文字指向盘心
                // 顺时针旋转角度为 -(22.5 + i * 45)
                const rotZ = -(22.5 + i * 45);
                itemNode.setRotationFromEuler(0, 0, rotZ);

                // 填充数据 (数量与图标)
                const lbl = itemNode.getChildByName('text')?.getComponent(Label);
                if (lbl) {
                    lbl.string = `*${prize.count}`;
                }

                const iconComp = itemNode.getChildByName('icon')?.getComponent(Sprite);
                if (iconComp && prize.iconUuid) {
                    iconComp.node.active = false;
                    pending++;
                    const uuid = prize.iconUuid;
                    iconJobs.push(() => {
                        assetManager.loadAny(uuid, (err, frame: SpriteFrame) => {
                            if (!err && frame && iconComp.isValid) {
                                iconComp.spriteFrame = frame;
                            }
                            if (iconComp.isValid) iconComp.node.active = true;
                            pending--;
                            if (pending <= 0) reveal();
                        });
                    });
                }
            }

            this._itemsCreated = true;
            if (pending === 0) {
                reveal();
                return;
            }
            iconJobs.forEach((job) => job());
        };

        if (this.spinItemPrefab) {
            onPrefabReady(this.spinItemPrefab);
        } else {
            resources.load('Other/View/SpinItem', Prefab, (err, prefab) => {
                if (!this.node || !this.node.isValid) return;
                if (err || !prefab) {
                    this.finishOpen(true);
                    return;
                }
                this.spinItemPrefab = prefab;
                onPrefabReady(prefab);
            });
        }
    }

    // ======================================== 状态与倒计时管理 ========================================
    /**
     * 刷新页面状态 (免费可抽 vs 冷却中)
     */
    public refreshState() {
        const remainingMs = this.getRemainingCooldownMs();
        const isFree = remainingMs <= 0;

        // 提示文本切换
        if (this.descFreeNode) this.descFreeNode.active = isFree;
        if (this.descTimeNode) this.descTimeNode.active = !isFree;

        // 按钮组切换
        if (this.btnRandom) this.btnRandom.active = isFree;
        if (this.btnNoThanks1) this.btnNoThanks1.active = isFree;

        if (this.btnRetry) this.btnRetry.active = !isFree;
        if (this.btnNoThanks2) this.btnNoThanks2.active = !isFree;

        if (!isFree) {
            this.updateCountdownLabel();
        }
    }

    /**
     * 获取剩余冷却毫秒数
     */
    private getRemainingCooldownMs(): number {
        const lastTime = GameData.instance.lastSpinTimestamp;
        if (!lastTime) return 0;

        const elapsed = Date.now() - lastTime;
        const remaining = SPIN_COOLDOWN_MS - elapsed;
        return remaining > 0 ? remaining : 0;
    }

    /**
     * 更新倒计时显示文本 (格式 00:MM:SS)
     */
    private updateCountdownLabel() {
        if (!this.lblCountdown) return;

        const remainingMs = this.getRemainingCooldownMs();
        if (remainingMs <= 0) {
            this.refreshState();
            return;
        }

        const totalSeconds = Math.floor(remainingMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
        // 项目位图字体 numimage1.fnt 中使用大写字母 'A' 映射为冒号 ":"
        this.lblCountdown.string = `${pad(hours)}A${pad(minutes)}A${pad(seconds)}`;
    }

    // ======================================== 旋转抽奖交互 ========================================
    /**
     * 响应免费抽奖点击
     */
    private onBtnRandomClick() {
        Audio.play(AudioId.uiClick);
        if (this._isSpinning || this._adPlaying || this._isClosing) return;
        this.startSpin();
    }

    /**
     * 响应视频再抽一次点击
     */
    private onBtnRetryClick() {
        Audio.play(AudioId.uiClick);
        if (this._isSpinning || this._rewardOpen || this._adPlaying || this._isClosing) return;
        this._adPlaying = true;
        this.playRewardedVideo(() => {
            this._adPlaying = false;
            if (!this.isValid || this._isClosing || this._isSpinning || this._rewardOpen) return;
            this.startSpin(true);
        });
    }

    /** 仅成功完成激励视频后开放再次抽奖。 */
    private playRewardedVideo(onComplete: () => void) {
        GameSDK.inst.logEvent('readyStartAD', { value: 'spinPage' });
        GameSDK.inst.ShowADVideo('spinPage').then(() => {
            GameSDK.inst.logEvent('realEndAD', { value: 'spinPage' });
            onComplete();
        }).catch(() => {
            this._adPlaying = false;
        });
    }

    /**
     * 开始旋转抽奖
     * @param isRetry 是否是视频重试抽取
     */
    public startSpin(isRetry: boolean = false) {
        if (this._isSpinning || this._rewardOpen || !this.spinNode) return;
        this._isSpinning = true;

        // 随机选择中奖项 (0 ~ 7)
        const targetIndex = Math.floor(Math.random() * SPIN_PRIZES.length);
        const targetPrize = SPIN_PRIZES[targetIndex];

        // 禁用按钮防止重入
        this.setButtonsInteractive(false);

        // 扇区中心对齐指针时，转盘角度应为 22.5 + index * 45。
        // 必须从当前角度算还要顺时针转多少；每次都按初始位置减，第二次会正好停在分割线上。
        const prizeAngleOffset = 22.5 + targetIndex * 45;
        const current = ((this._currentAngle % 360) + 360) % 360;
        const clockwiseDelta = (current - prizeAngleOffset + 360) % 360;
        const extraRounds = 5 + Math.floor(Math.random() * 3); // 额外转 5~7 圈
        const startAngle = this._currentAngle;
        const targetAngle = startAngle - extraRounds * 360 - clockwiseDelta;

        // 指针轻微抖动动效
        this.playPointerShake(3.5);

        // 转盘旋转缓动动画 (先加速后平滑减速)
        const duration = 3.6;
        const dummy = { angle: startAngle };

        tween(dummy)
            .to(duration, { angle: targetAngle }, {
                easing: 'cubicOut',
                onUpdate: () => {
                    if (this.spinNode && this.spinNode.isValid) {
                        this.spinNode.setRotationFromEuler(0, 0, dummy.angle);
                    }
                }
            })
            .call(() => {
                this._currentAngle = ((targetAngle % 360) + 360) % 360;
                const landed = this.prizeUnderPointer(targetPrize);
                this.onSpinFinished(landed, isRetry);
            })
            .start();
    }

    /**
     * 指针随齿轮抖动微动效
     */
    private playPointerShake(duration: number) {
        if (!this.pointerNode) return;

        tween(this.pointerNode).stop();
        const originEuler = new Vec3(0, 0, 0);

        // 模拟转盘掠过扇区分隔时的轻微弹拨
        tween(this.pointerNode)
            .by(0.08, { eulerAngles: new Vec3(0, 0, 12) })
            .to(0.08, { eulerAngles: originEuler })
            .union()
            .repeat(Math.floor(duration / 0.16))
            .start();
    }

    /** 指针在正上方，取转盘上世界坐标最高的那一格，和画面上停住的奖品一致。 */
    private prizeUnderPointer(fallback: SpinPrizeItem): SpinPrizeItem {
        const children = this.spinNode?.children ?? [];
        let bestIndex = -1;
        let bestY = -Infinity;
        for (const child of children) {
            const match = /^SpinItem_(\d+)_/.exec(child.name);
            if (!match) continue;
            const y = child.worldPosition.y;
            if (y > bestY) {
                bestY = y;
                bestIndex = parseInt(match[1], 10);
            }
        }
        return SPIN_PRIZES[bestIndex] ?? fallback;
    }

    /**
     * 旋转结束后的奖励结算
     */
    private onSpinFinished(prize: SpinPrizeItem, isRetry: boolean) {
        this._isSpinning = false;
        this.setButtonsInteractive(true);

        // 只有免费转才开始冷却；看广告再转不改已有倒计时
        if (!isRetry) {
            GameData.instance.lastSpinTimestamp = Date.now();
            GameData.instance.saveData();
            GameData.event.emit(GameDataEvent.REWARD_STATE_CHANGED);
        }

        // 奖励在 RewardPage 点领取时才入账
        this.openRewardPage(prize);

        // 刷新界面状态进入冷却
        this.refreshState();

    }

    private openRewardPage(prize: SpinPrizeItem) {
        this._rewardOpen = true;
        RewardPage.show([{
            type: prize.type,
            count: prize.count,
            iconUuid: prize.iconUuid,
        }], undefined, () => {
            if (this.isValid) this._rewardOpen = false;
        });
    }

    private setButtonsInteractive(enabled: boolean) {
        const setBtn = (n: Node | null) => {
            if (!n || !n.isValid) return;
            const btn = n.getComponent(Button);
            if (btn) btn.interactable = enabled;
        };

        setBtn(this.btnRandom);
        setBtn(this.btnRetry);
        setBtn(this.btnNoThanks1);
        setBtn(this.btnNoThanks2);
        setBtn(this.btnClose);
    }

    // ======================================== 页面关闭与销毁 ========================================
    /**
     * 关闭转盘页面，平滑过渡并销毁
     */
    public close() {
        Audio.play(AudioId.uiClick);
        if (this._isClosing || this._isSpinning) return;
        this._isClosing = true;


        let uiOpacity = this.node.getComponent(UIOpacity);
        if (!uiOpacity) {
            uiOpacity = this.node.addComponent(UIOpacity);
        }

        // 淡出动画
        tween(uiOpacity)
            .to(0.2, { opacity: 0 })
            .start();

        if (this.spinBoxNode) {
            tween(this.spinBoxNode)
                .to(0.2, { scale: new Vec3(0.7, 0.7, 1) }, { easing: 'quadIn' })
                .call(() => {
                    this.destroyPage();
                })
                .start();
        } else {
            this.scheduleOnce(() => {
                this.destroyPage();
            }, 0.22);
        }
    }

    private destroyPage() {
        if (GameScene.instance && GameScene.instance.spinPageNode === this.node) {
            GameScene.instance.spinPageNode = null;
        }
        if (this.node && this.node.isValid) {
            this.node.destroy();
        }
    }
}

