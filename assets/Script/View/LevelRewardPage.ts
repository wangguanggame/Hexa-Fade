import { GameSDK } from '../../sdk/GameSDK';
import {
    _decorator, Component, instantiate, Label, Node,
    Prefab, resources, Sprite, SpriteFrame, tween, Tween, UIOpacity, Vec3,
} from 'cc';
import { GameData } from '../Config/GameData';
import { GameScene } from '../Scene/GameScene';
import { Remind } from '../Tools/Remind/Remind';
import { LoadingWaiting } from './LoadingWaiting';
import { RewardEntry, RewardKind, RewardPage } from './RewardPage';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

interface LevelReward {
    type: RewardKind;
    count: number;
}

/** 和预制体里 Card0~Card8、Gold 的图标、数量一致。 */
const STEPS: ReadonlyArray<ReadonlyArray<LevelReward>> = [
    [{ type: 'COIN', count: 10 }],
    [{ type: 'MOVE', count: 1 }],
    [{ type: 'HAMMER', count: 1 }],
    [{ type: 'TNT', count: 1 }],
    [{ type: 'COIN', count: 50 }],
    [{ type: 'MOVE', count: 2 }],
    [{ type: 'HAMMER', count: 2 }],
    [{ type: 'DRILL', count: 2 }],
    [{ type: 'COIN', count: 100 }],
    [
        { type: 'COIN', count: 200 },
        { type: 'TNT', count: 1 },
        { type: 'HAMMER', count: 1 },
        { type: 'DRILL', count: 1 },
    ],
];

interface RewardSlot {
    root: Node;
    mark: Node | null;
    /** 可领取提示（红色感叹号）。 */
    remind: Node | null;
    icons: Array<SpriteFrame | null>;
}

/**
 * 关卡奖励页。布局在 LevelRewardPage 预制体里。
 * 按各档通关间隔解锁下一档，点当前档领取；24 小时后整条进度重置。
 */
@ccclass('LevelRewardPage')
export class LevelRewardPage extends Component {
    private static _current: Node | null = null;
    private static _opening = false;

    @property({ type: Node, tooltip: '黑色蒙层', group: { name: '页面节点', id: '0' } })
    public mask: Node | null = null;

    @property({ type: Node, tooltip: '面板', group: { name: '页面节点', id: '0' } })
    public frame: Node | null = null;

    @property({ type: Node, tooltip: '关闭按钮', group: { name: '页面节点', id: '0' } })
    public btnClose: Node | null = null;

    @property({ type: Node, tooltip: '倒计时文本 Timer/time', group: { name: '文本', id: '1' } })
    public lblTime: Node | null = null;

    @property({ type: Node, tooltip: '还差几关的数字 Hint/num', group: { name: '文本', id: '1' } })
    public lblNeed: Node | null = null;

    @property({ type: Node, tooltip: '第 1 档', group: { name: '奖励格', id: '2' } })
    public card0: Node | null = null;

    @property({ type: Node, tooltip: '第 2 档', group: { name: '奖励格', id: '2' } })
    public card1: Node | null = null;

    @property({ type: Node, tooltip: '第 3 档', group: { name: '奖励格', id: '2' } })
    public card2: Node | null = null;

    @property({ type: Node, tooltip: '第 4 档', group: { name: '奖励格', id: '2' } })
    public card3: Node | null = null;

    @property({ type: Node, tooltip: '第 5 档', group: { name: '奖励格', id: '2' } })
    public card4: Node | null = null;

    @property({ type: Node, tooltip: '第 6 档', group: { name: '奖励格', id: '2' } })
    public card5: Node | null = null;

    @property({ type: Node, tooltip: '第 7 档', group: { name: '奖励格', id: '2' } })
    public card6: Node | null = null;

    @property({ type: Node, tooltip: '第 8 档', group: { name: '奖励格', id: '2' } })
    public card7: Node | null = null;

    @property({ type: Node, tooltip: '第 9 档', group: { name: '奖励格', id: '2' } })
    public card8: Node | null = null;

    @property({ type: Node, tooltip: '底部大奖', group: { name: '奖励格', id: '2' } })
    public gold: Node | null = null;

    private _timeLabel: Label | null = null;
    private _needLabel: Label | null = null;
    private _slots: Array<RewardSlot | null> = [];
    private _claiming = false;
    private _isClosing = false;
    private _holdsLoading = false;
    private _openSettled = false;
    private _viewReady = false;
    private _onClosed?: () => void;

    /** 本周期内有已通关但还没领的档位。 */
    public static hasClaimable(): boolean {
        const data = GameData.instance;
        if (data.levelRewardCycleEnd <= Date.now()) return false;
        return data.levelRewardClaimed < data.levelRewardUnlocked && data.levelRewardClaimed < STEPS.length;
    }

    public static show(parent?: Node, onClosed?: () => void): void {
        if (this._current && this._current.isValid) {
            const page = this._current.getComponent(LevelRewardPage);
            if (page && onClosed) page._onClosed = onClosed;
            return;
        }
        if (this._opening) {
            onClosed?.();
            return;
        }

        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            onClosed?.();
            return;
        }

        this._opening = true;
        LoadingWaiting.acquire(targetParent, () => {
            resources.load('Other/View/LevelRewardPage', Prefab, (error, prefab) => {
                const abort = () => {
                    this._opening = false;
                    LoadingWaiting.release();
                    onClosed?.();
                };
                if (error || !prefab) {
                    abort();
                    return;
                }
                if (!targetParent.isValid || (this._current && this._current.isValid)) {
                    abort();
                    return;
                }

                const node = instantiate(prefab);
                const page = node.getComponent(LevelRewardPage) || node.addComponent(LevelRewardPage);
                page._onClosed = onClosed;
                page.markLoadingHeld();
                node.setParent(targetParent);
                node.setSiblingIndex(targetParent.children.length - 1);
                LoadingWaiting.raise();
                this._current = node;
                this._opening = false;
            });
        });
    }

    public markLoadingHeld(): void {
        this._holdsLoading = true;
    }

    onLoad(): void {
        GameSDK.inst.logEvent('showPage', { value: 'levelRewardPage' });
        this.resolveMounts();
        this._timeLabel = this.lblTime?.getComponent(Label) || null;
        this._needLabel = this.lblNeed?.getComponent(Label) || null;

        this.bindSlots();
        this.refreshView();

        if (this.frame) this.frame.setScale(new Vec3(0, 0, 1));
        if (this.mask) {
            const maskOpacity = this.mask.getComponent(UIOpacity) || this.mask.addComponent(UIOpacity);
            maskOpacity.opacity = 0;
        }
        if (this.btnClose) this.btnClose.on(Node.EventType.TOUCH_END, this.close, this);
    }

    /** 检查器没拖时，按节点名补上。 */
    private resolveMounts(): void {
        if (!this.mask) this.mask = this.node.getChildByName('Mask');
        if (!this.frame) this.frame = this.node.getChildByName('Frame');
        if (!this.btnClose) this.btnClose = this.frame?.getChildByName('BtnClose') || this.node.getChildByName('BtnClose');
        if (!this.lblTime) this.lblTime = this.frame?.getChildByPath('Timer/time') || null;
        if (!this.lblNeed) this.lblNeed = this.frame?.getChildByPath('Hint/num') || null;

        const cards = [this.card0, this.card1, this.card2, this.card3, this.card4, this.card5, this.card6, this.card7, this.card8];
        for (let i = 0; i < cards.length; i++) {
            if (cards[i]) continue;
            this.setCard(i, this.frame?.getChildByName('Card' + i) || null);
        }
        if (!this.gold) this.gold = this.frame?.getChildByName('Gold') || null;
    }

    private cardAt(index: number): Node | null {
        const cards = [this.card0, this.card1, this.card2, this.card3, this.card4, this.card5, this.card6, this.card7, this.card8];
        return cards[index] || null;
    }

    private setCard(index: number, node: Node | null): void {
        if (index === 0) this.card0 = node;
        else if (index === 1) this.card1 = node;
        else if (index === 2) this.card2 = node;
        else if (index === 3) this.card3 = node;
        else if (index === 4) this.card4 = node;
        else if (index === 5) this.card5 = node;
        else if (index === 6) this.card6 = node;
        else if (index === 7) this.card7 = node;
        else if (index === 8) this.card8 = node;
    }

    start(): void {
        this.schedule(this.tickTimer, 1);
        this.finishOpen(true);
    }

    onDestroy(): void {
        this.unschedule(this.tickTimer);
        this.stopPulses();
        this.unbindSlots();
        this.finishOpen(false);
        if (this.btnClose && this.btnClose.isValid) {
            this.btnClose.off(Node.EventType.TOUCH_END, this.close, this);
        }
        if (LevelRewardPage._current === this.node) LevelRewardPage._current = null;
        const onClosed = this._onClosed;
        this._onClosed = undefined;
        onClosed?.();
    }

    private bindSlots(): void {
        for (let i = 0; i < 9; i++) {
            const root = this.cardAt(i);
            if (!root) continue;
            const rewards = STEPS[i];
            this.applyCount(root.getChildByName('Count'), rewards[0].count);
            this._slots[i] = {
                root,
                mark: root.getChildByName('Finish'),
                remind: root.getChildByName('remind'),
                icons: [this.frameOf(root.getChildByName('Icon'))],
            };
            root.on(Node.EventType.TOUCH_END, () => this.onTapStep(i), this);
        }

        const gold = this.gold;
        if (!gold) return;
        const icons: Array<SpriteFrame | null> = [];
        const goldRewards = STEPS[9];
        for (let i = 0; i < goldRewards.length; i++) {
            icons.push(this.frameOf(gold.getChildByName('Icon' + i)));
            this.applyCount(gold.getChildByName('Count' + i), goldRewards[i].count);
        }
        this._slots[9] = { root: gold, mark: gold.getChildByName('Finish'), remind: gold.getChildByName('remind'), icons };
        gold.on(Node.EventType.TOUCH_END, () => this.onTapStep(9), this);
    }

    private unbindSlots(): void {
        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (!slot || !slot.root.isValid) continue;
            slot.root.off(Node.EventType.TOUCH_END);
        }
    }

    private frameOf(node: Node | null): SpriteFrame | null {
        return node?.getComponent(Sprite)?.spriteFrame || null;
    }

    private finishOpen(playAnim: boolean): void {
        if (this._openSettled) return;
        this._openSettled = true;
        if (playAnim && this.node && this.node.isValid) this.playEnterAnimation();
        if (this._holdsLoading) {
            this._holdsLoading = false;
            LoadingWaiting.release();
        }
    }

    private refreshView(): void {
        const data = GameData.instance;
        data.ensureLevelRewardCycle();
        const claimed = data.levelRewardClaimed;
        const passed = data.levelRewardPassed;
        const unlocked = data.levelRewardUnlocked;
        this.stopPulses();

        const animate = this._viewReady;
        for (let i = 0; i < STEPS.length; i++) {
            const slot = this._slots[i];
            if (!slot || !slot.root.isValid) continue;
            this.setFinish(slot.mark, i < claimed, animate);
            slot.root.setScale(1, 1, 1);
            const claimable = i === claimed && claimed < unlocked;
            if (slot.remind?.isValid) slot.remind.active = claimable;
            if (claimable) {
                tween(slot.root)
                    .repeatForever(
                        tween(slot.root)
                            .to(0.55, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                            .to(0.55, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
                    )
                    .start();
            }
        }

        if (this._needLabel) {
            const need = claimed >= STEPS.length ? 0 : Math.max(0, GameData.levelRewardThreshold(claimed + 1) - passed);
            this._needLabel.string = String(need);
        }
        this.updateTimeText();
        this._viewReady = true;
    }

    /** 已领取才显示 Finish。遮罩别缩放，只让勾对准图标弹出。 */
    private setFinish(mark: Node | null, show: boolean, animate: boolean): void {
        if (!mark || !mark.isValid) return;
        const icon = mark.getChildByName('icon');
        if (icon?.isValid) Tween.stopAllByTarget(icon);
        if (!show) {
            mark.active = false;
            return;
        }
        const appear = animate && !mark.active;
        mark.active = true;
        if (!icon?.isValid) return;
        icon.setPosition(0, 20, 0);
        if (!appear) {
            icon.setScale(1, 1, 1);
            return;
        }
        icon.setScale(0.3, 0.3, 1);
        tween(icon).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    }

    private applyCount(node: Node | null, count: number): void {
        const label = node?.getComponent(Label);
        if (label) label.string = `*${count}`;
    }

    private stopPulses(): void {
        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (!slot || !slot.root || !slot.root.isValid) continue;
            Tween.stopAllByTarget(slot.root);
            if (slot.mark && slot.mark.isValid) Tween.stopAllByTarget(slot.mark);
        }
    }

    private onTapStep(index: number): void {
        Audio.play(AudioId.uiClick);
        if (this._claiming || this._isClosing) return;
        const data = GameData.instance;
        data.ensureLevelRewardCycle();

        if (index < data.levelRewardClaimed) {
            Remind.showTipRemind('Already claimed.');
            return;
        }
        if (data.levelRewardClaimed >= STEPS.length) {
            Remind.showTipRemind('All rewards claimed.');
            return;
        }
        if (index !== data.levelRewardClaimed || data.levelRewardUnlocked <= data.levelRewardClaimed) {
            if (data.levelRewardUnlocked > data.levelRewardClaimed) {
                Remind.showTipRemind('Claim the next available reward first.');
            } else {
                const need = Math.max(1, GameData.levelRewardThreshold(data.levelRewardClaimed + 1) - data.levelRewardPassed);
                Remind.showTipRemind(`Pass ${need} more level${need > 1 ? 's' : ''}.`);
            }
            return;
        }

        const rewards = STEPS[index];
        const slot = this._slots[index];
        if (!rewards || !slot) return;

        this._claiming = true;
        const entries: RewardEntry[] = [];
        for (let i = 0; i < rewards.length; i++) {
            const reward = rewards[i];
            entries.push({
                type: reward.type,
                count: reward.count,
                icon: slot.icons[i] || null,
            });
        }
        RewardPage.show(entries, undefined, () => {
            this._claiming = false;
            GameData.instance.claimNextLevelReward();
            if (this.isValid) this.close();
        });
    }

    private tickTimer(): void {
        if (!this.node || !this.node.isValid) return;
        const data = GameData.instance;
        const before = data.levelRewardCycleEnd;
        const reset = data.ensureLevelRewardCycle();
        if (reset || data.levelRewardCycleEnd !== before) {
            this.refreshView();
            return;
        }
        this.updateTimeText();
    }

    private updateTimeText(): void {
        if (!this._timeLabel) return;
        const remain = Math.max(0, GameData.instance.levelRewardCycleEnd - Date.now());
        const totalSec = Math.floor(remain / 1000);
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        // numimage1：T 是时钟，H 是 h，M 是 m
        this._timeLabel.string = `T${hours}H${minutes}M`;
    }

    private playEnterAnimation(): void {
        if (this.mask && this.mask.isValid) {
            const maskOpacity = this.mask.getComponent(UIOpacity) || this.mask.addComponent(UIOpacity);
            maskOpacity.opacity = this._holdsLoading ? LoadingWaiting.coverOpacity(this.mask) : 0;
            tween(maskOpacity).to(0.2, { opacity: 230 }).start();
        }
        if (!this.frame || !this.frame.isValid) return;
        this.frame.setScale(new Vec3(0.2, 0.2, 1));
        tween(this.frame)
            .to(0.28, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'cubicOut' })
            .to(0.1, { scale: Vec3.ONE }, { easing: 'quadOut' })
            .start();
    }

    private close(): void {
        Audio.play(AudioId.uiClick);
        if (this._isClosing || this._claiming || !this.node || !this.node.isValid) return;
        this._isClosing = true;
        this.stopPulses();

        if (this.frame && this.frame.isValid) {
            tween(this.frame)
                .to(0.18, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'quadIn' })
                .start();
        }
        if (this.mask && this.mask.isValid) {
            const maskOpacity = this.mask.getComponent(UIOpacity);
            if (maskOpacity) tween(maskOpacity).to(0.18, { opacity: 0 }).start();
        }

        this.scheduleOnce(() => {
            if (LevelRewardPage._current === this.node) LevelRewardPage._current = null;
            if (this.node && this.node.isValid) this.node.destroy();
        }, 0.2);
    }
}
