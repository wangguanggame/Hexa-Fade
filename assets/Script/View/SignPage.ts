import {
    _decorator, Color, Component, instantiate, Label, Layout, Node,
    Prefab, resources, Sprite, SpriteFrame, tween, UIOpacity, Vec3,
} from 'cc';
import { GameScene } from '../Scene/GameScene';
import { Remind } from '../Tools/Remind/Remind';
import { RewardPage, RewardEntry } from './RewardPage';
import { LoadingWaiting } from './LoadingWaiting';
import { GameSDK } from '../../sdk/GameSDK';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { GameData, GameDataEvent } from '../Config/GameData';

const { ccclass, property } = _decorator;

type RewardType = 'COIN' | 'MOVE' | 'HAMMER' | 'DRILL' | 'TNT';

interface SignReward {
    type: RewardType;
    count: number;
}

interface SignSave {
    claimedCount: number;
    lastClaimDate: string;
    resetVersion: number;
}

const SMALL_PREFAB = 'Other/View/SignSmallItem';
const BIG_PREFAB = 'Other/View/SignBigItem';

/** 第 6 天是 TNT（望远镜造型），第 7 天顺序为加步、锤子、TNT、电钻。 */
const DAY_REWARDS: ReadonlyArray<ReadonlyArray<SignReward>> = [
    [{ type: 'COIN', count: 100 }],
    [{ type: 'COIN', count: 200 }],
    [{ type: 'MOVE', count: 2 }],
    [{ type: 'COIN', count: 400 }],
    [{ type: 'HAMMER', count: 2 }],
    [{ type: 'TNT', count: 2 }],
    [
        { type: 'MOVE', count: 3 },
        { type: 'HAMMER', count: 3 },
        { type: 'TNT', count: 3 },
        { type: 'DRILL', count: 3 },
    ],
];

/** 改这个数字会清空本地签到进度，方便重新从第 1 天测试。 */
const SIGN_RESET_VERSION = 2;

const SLOT_X = [-360, -120, 120, 360];
const ROW_Y = [185, -185];
const BIG_X = 240;

function twoDigits(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

function dateKey(date: Date): string {
    const month = twoDigits(date.getMonth() + 1);
    const day = twoDigits(date.getDate());
    return `${date.getFullYear()}-${month}-${day}`;
}

function yesterdayKey(): string {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return dateKey(date);
}

/**
 * 七日签到页。Daily 入口打开，每天可领一次，看视频按钮发双倍。
 */
@ccclass('SignPage')
export class SignPage extends Component {
    private static _current: Node | null = null;

    @property({ type: SpriteFrame, tooltip: '金币图标', group: { name: '奖励图标', id: '1' } })
    public coinIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '加步图标', group: { name: '奖励图标', id: '1' } })
    public moveIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '锤子图标', group: { name: '奖励图标', id: '1' } })
    public hammerIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '电钻图标', group: { name: '奖励图标', id: '1' } })
    public drillIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'TNT 图标', group: { name: '奖励图标', id: '1' } })
    public tntIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'DAY1', group: { name: '天数标题', id: '2' } })
    public dayTitle1: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'DAY2', group: { name: '天数标题', id: '2' } })
    public dayTitle2: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'DAY3', group: { name: '天数标题', id: '2' } })
    public dayTitle3: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'DAY4', group: { name: '天数标题', id: '2' } })
    public dayTitle4: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'DAY5', group: { name: '天数标题', id: '2' } })
    public dayTitle5: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'DAY6', group: { name: '天数标题', id: '2' } })
    public dayTitle6: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'DAY7', group: { name: '天数标题', id: '2' } })
    public dayTitle7: SpriteFrame | null = null;

    private _mask: Node | null = null;
    private _frame: Node | null = null;
    private _content: Node | null = null;
    private _btnClaim: Node | null = null;
    private _btnDouble: Node | null = null;
    private _btnClose: Node | null = null;
    private _items: Node[] = [];
    private _save: SignSave = { claimedCount: 0, lastClaimDate: '', resetVersion: 0 };
    private _canClaim = false;
    private _claiming = false;
    private _isClosing = false;
    private _built = false;
    private _holdsLoading = false;
    private _openSettled = false;
    private static _opening = false;

    /** 今天还没签到。签到版本号变了打开页面会清档，同样算可领。 */
    public static canClaimToday(): boolean {
        const data = GameData.instance;
        return data.signResetVersion !== SIGN_RESET_VERSION || data.signLastClaimDate !== dateKey(new Date());
    }

    public static isShowingOrOpening(): boolean {
        return this._opening || !!this._current?.isValid;
    }

    public static show(parent?: Node): void {
        if (this._current && this._current.isValid) return;
        if (this._opening) return;

        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            return;
        }

        this._opening = true;
        LoadingWaiting.acquire(targetParent, () => {
            resources.load('Other/View/SignPage', Prefab, (error, prefab) => {
                const abort = () => {
                    this._opening = false;
                    LoadingWaiting.release();
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
                const page = node.getComponent(SignPage) || node.addComponent(SignPage);
                page.markLoadingHeld();
                node.setParent(targetParent);
                node.setSiblingIndex(targetParent.children.length - 1);
                LoadingWaiting.raise();
                this._current = node;
                this._opening = false;
            });
        });
    }

    /** 这次打开占用了等待遮罩，实例化结束后由页面自己关掉。 */
    public markLoadingHeld(): void {
        this._holdsLoading = true;
    }

    onLoad(): void {
        GameSDK.inst.logEvent('showPage', { value: 'signPage' });
        this._mask = this.node.getChildByName('Mask');
        this._frame = this.node.getChildByName('Frame');
        this._content = this._frame ? this._frame.getChildByName('DayGrid') : null;
        this._btnDouble = this._frame ? this._frame.getChildByName('BtnClaimX2') : null;
        this._btnClaim = this._frame ? this._frame.getChildByName('BtnClaim') : null;
        this._btnClose = this._frame?.getChildByName('BtnClose') || this.node.getChildByName('BtnClose');

        const layout = this._content ? this._content.getComponent(Layout) : null;
        if (layout) layout.enabled = false;
        if (this._content) this._content.active = false;

        this.attachChromeToFrame();
        if (this._frame) this._frame.setScale(new Vec3(0, 0, 1));
        if (this._mask) {
            const maskOpacity = this._mask.getComponent(UIOpacity) || this._mask.addComponent(UIOpacity);
            maskOpacity.opacity = 0;
        }

        this.bindButtons();
        this._save = this.loadSave();
    }

    start(): void {
        this.buildItems();
    }

    onDestroy(): void {
        this.unbindButtons();
        this.finishOpen(false);
        if (SignPage._current === this.node) SignPage._current = null;
    }

    /** 子项实例化结束：先播进场，再关掉等待遮罩。 */
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

    private bindButtons(): void {
        if (this._btnClose) this._btnClose.on(Node.EventType.TOUCH_END, this.close, this);
        if (this._btnClaim) this._btnClaim.on(Node.EventType.TOUCH_END, this.onClaim, this);
        if (this._btnDouble) this._btnDouble.on(Node.EventType.TOUCH_END, this.onClaimDouble, this);
    }

    private unbindButtons(): void {
        if (this._btnClose && this._btnClose.isValid) this._btnClose.off(Node.EventType.TOUCH_END, this.close, this);
        if (this._btnClaim && this._btnClaim.isValid) this._btnClaim.off(Node.EventType.TOUCH_END, this.onClaim, this);
        if (this._btnDouble && this._btnDouble.isValid) this._btnDouble.off(Node.EventType.TOUCH_END, this.onClaimDouble, this);
    }

    private iconOf(type: RewardType): SpriteFrame | null {
        switch (type) {
            case 'COIN': return this.coinIcon;
            case 'MOVE': return this.moveIcon;
            case 'HAMMER': return this.hammerIcon;
            case 'DRILL': return this.drillIcon;
            case 'TNT': return this.tntIcon;
            default: return null;
        }
    }

    private dayTitleOf(day: number): SpriteFrame | null {
        const titles = [
            this.dayTitle1, this.dayTitle2, this.dayTitle3, this.dayTitle4,
            this.dayTitle5, this.dayTitle6, this.dayTitle7,
        ];
        return titles[day] || null;
    }

    private buildItems(): void {
        if (!this._content || !this._content.isValid) {
            this.finishOpen(true);
            return;
        }
        resources.load(SMALL_PREFAB, Prefab, (smallError, smallPrefab) => {
                if (!this.node || !this.node.isValid) return;
                if (smallError || !smallPrefab) {
                    this.finishOpen(true);
                    return;
                }
                resources.load(BIG_PREFAB, Prefab, (bigError, bigPrefab) => {
                    if (!this.node || !this.node.isValid) return;
                    if (bigError || !bigPrefab || !this._content || !this._content.isValid) {
                        this.finishOpen(true);
                        return;
                    }
                    if (this._built) {
                        this.finishOpen(true);
                        return;
                    }
                    this._built = true;

                    for (let day = 0; day < 6; day++) {
                        const item = instantiate(smallPrefab);
                        item.setParent(this._content);
                        const col = day % 4;
                        const row = day < 4 ? 0 : 1;
                        item.setPosition(SLOT_X[col], ROW_Y[row], 0);
                        this.setupSmallItem(item, day);
                        this._items.push(item);
                    }

                    const big = instantiate(bigPrefab);
                    big.setParent(this._content);
                    big.setPosition(BIG_X, ROW_Y[1], 0);
                    this.setupBigItem(big);
                    this._items.push(big);
                    this.refreshItems();
                    this._content.active = true;
                    this.finishOpen(true);
                });
            });
    }

    private setupSmallItem(item: Node, day: number): void {
        const reward = DAY_REWARDS[day][0];
        this.setDayTitle(item, day);
        this.applySprite(this.spriteOf(item.getChildByName('Icon')), this.iconOf(reward.type));
        const count = item.getChildByName('Count');
        const label = count ? count.getComponent(Label) : null;
        if (label) label.string = `*${reward.count}`;
        const selected = item.getChildByName('Selected');
        if (selected) selected.active = false;
        const finish = item.getChildByName('Finish');
        if (finish) finish.active = false;
    }

    private setupBigItem(item: Node): void {
        this.setDayTitle(item, 6);
        const rewards = DAY_REWARDS[6];
        for (let i = 0; i < rewards.length; i++) {
            const reward = rewards[i];
            this.applySprite(this.spriteOf(item.getChildByName(`icon${i + 1}`)), this.iconOf(reward.type));
            const text = item.getChildByName(`text${i + 1}`);
            const label = text ? text.getComponent(Label) : null;
            if (label) label.string = `*${reward.count}`;
        }
        const selected = item.getChildByName('Selected');
        if (selected) selected.active = false;
        const finish = item.getChildByName('Finish');
        if (finish) finish.active = false;
    }

    private setDayTitle(item: Node, day: number): void {
        let title: Node | null = null;
        for (let i = 0; i < item.children.length; i++) {
            const child = item.children[i];
            if (child.name !== 'DayTitle') continue;
            if (!title) title = child;
            else child.active = false;
        }
        if (!title) return;
        title.active = true;
        this.applySprite(this.spriteOf(title), this.dayTitleOf(day));
    }

    private refreshItems(): void {
        const today = dateKey(new Date());
        const todayClaimed = this._save.lastClaimDate === today;
        const nextDay = this._save.claimedCount % DAY_REWARDS.length;
        this._canClaim = !todayClaimed;

        this._items.forEach((item, day) => {
            const claimed = day < nextDay;
            const selected = item.getChildByName('Selected');
            if (selected) selected.active = day === nextDay;

            const bg = item.getComponent(Sprite);
            if (bg) bg.color = claimed ? new Color(150, 140, 180, 255) : Color.WHITE;
            this.setCheck(item, claimed);
        });
    }

    private setCheck(item: Node, claimed: boolean): void {
        const mark = item.getChildByName('Finish');
        if (mark) mark.active = claimed;
    }

    private onClaim(): void {
        Audio.play(AudioId.uiClick);
        if (!this.beginClaim()) return;
        this.openRewardPage(1);
    }

    private onClaimDouble(): void {
        Audio.play(AudioId.uiClick);
        if (!this.beginClaim()) return;
        this.playRewardedVideo(() => {
            if (!this.isValid || this._isClosing) {
                this._claiming = false;
                return;
            }
            this.openRewardPage(2);
        });
    }

    /** 今天还没领，并且没有另一笔领取进行中。 */
    private beginClaim(): boolean {
        if (!this._canClaim || this._claiming) {
            if (!this._canClaim) Remind.showTipRemind('You can claim your reward tomorrow.');
            return false;
        }
        this._claiming = true;
        Audio.play(AudioId.sign);
        return true;
    }

    /** 仅成功完成激励视频后发放双倍签到奖励。 */
    private playRewardedVideo(onComplete: () => void): void {
        GameSDK.inst.logEvent('readyStartAD', { value: 'signPage' });
        GameSDK.inst.ShowADVideo('signPage').then(() => {
            GameSDK.inst.logEvent('realEndAD', { value: 'signPage' });
            onComplete();
        }).catch(() => {
            this._claiming = false;
        });
    }

    private openRewardPage(multiplier: number): void {
        if (!this._canClaim || this._isClosing) {
            this._claiming = false;
            return;
        }
        const day = this._save.claimedCount % DAY_REWARDS.length;
        const rewards = DAY_REWARDS[day];
        if (!rewards) {
            this._claiming = false;
            return;
        }

        this._claiming = true;
        const entries: RewardEntry[] = rewards.map(reward => ({
            type: reward.type,
            count: reward.count * multiplier,
            icon: this.iconOf(reward.type),
        }));
        RewardPage.show(entries, undefined, () => {
            this._claiming = false;
            const nextCount = day + 1;
            this._save.claimedCount = nextCount >= DAY_REWARDS.length ? 0 : nextCount;
            this._save.lastClaimDate = dateKey(new Date());
            this.saveState();
            if (this.isValid) this.close();
        });
    }

    private loadSave(): SignSave {
        const today = dateKey(new Date());
        const yesterday = yesterdayKey();
        const data = GameData.instance;
        let save: SignSave = {
            claimedCount: data.signClaimedCount,
            lastClaimDate: data.signLastClaimDate,
            resetVersion: data.signResetVersion,
        };

        const cycleFinished = save.claimedCount >= DAY_REWARDS.length;
        if (cycleFinished) save.claimedCount = save.claimedCount % DAY_REWARDS.length;

        const resetForTest = save.resetVersion !== SIGN_RESET_VERSION;
        const missed = !!save.lastClaimDate && save.lastClaimDate !== today && save.lastClaimDate !== yesterday;
        if (resetForTest || missed) {
            save = { claimedCount: 0, lastClaimDate: '', resetVersion: SIGN_RESET_VERSION };
            this.saveSignData(save);
        } else if (cycleFinished) {
            save.resetVersion = SIGN_RESET_VERSION;
            this.saveSignData(save);
        }
        return save;
    }

    private saveState(): void {
        this.saveSignData(this._save);
    }

    private saveSignData(save: SignSave): void {
        const data = GameData.instance;
        data.signClaimedCount = save.claimedCount;
        data.signLastClaimDate = save.lastClaimDate;
        data.signResetVersion = save.resetVersion;
        data.saveData();
        GameData.event.emit(GameDataEvent.REWARD_STATE_CHANGED);
    }

    private spriteOf(node: Node | null): Sprite | null {
        return node ? node.getComponent(Sprite) : null;
    }

    private applySprite(sprite: Sprite | null, frame: SpriteFrame | null): void {
        if (!sprite || !frame) return;
        sprite.spriteFrame = frame;
    }

    /** 标题挂到面板上一起缩放。关闭按钮留在预制体里的屏幕右上角，不要挂进面板。 */
    private attachChromeToFrame(): void {
        if (!this._frame) return;
        const title = this.node.getChildByName('Title');
        if (title && title.parent !== this._frame) title.setParent(this._frame, true);
    }

    private playEnterAnimation(): void {
        if (this._mask) {
            const maskOpacity = this._mask.getComponent(UIOpacity) || this._mask.addComponent(UIOpacity);
            maskOpacity.opacity = this._holdsLoading ? LoadingWaiting.coverOpacity(this._mask) : 0;
            tween(maskOpacity).to(0.2, { opacity: 230 }).start();
        }
        if (!this._frame) return;
        this._frame.setScale(new Vec3(0.2, 0.2, 1));
        tween(this._frame)
            .to(0.28, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'cubicOut' })
            .to(0.1, { scale: Vec3.ONE }, { easing: 'quadOut' })
            .start();
    }

    private close(): void {
        Audio.play(AudioId.uiClick);
        if (this._isClosing || !this.node || !this.node.isValid) return;
        this._isClosing = true;

        if (this._frame && this._frame.isValid) {
            tween(this._frame)
                .to(0.18, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'quadIn' })
                .start();
        }
        if (this._mask && this._mask.isValid) {
            const maskOpacity = this._mask.getComponent(UIOpacity);
            if (maskOpacity) tween(maskOpacity).to(0.18, { opacity: 0 }).start();
        }

        this.scheduleOnce(() => {
            if (SignPage._current === this.node) SignPage._current = null;
            if (this.node && this.node.isValid) this.node.destroy();
        }, 0.2);
    }
}
