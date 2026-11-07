import {
    _decorator, Component, instantiate, Label, Node, Prefab, resources, Sprite, tween, UIOpacity, Vec3,
} from 'cc';
import { GameScene } from '../Scene/GameScene';
import { LoadingWaiting } from './LoadingWaiting';
import { RewardPage } from './RewardPage';
import { GameSDK } from '../../sdk/GameSDK';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

const PREFAB_PATH = 'Other/View/AdGetCoinsPage';
const AD_ENTRY = 'adGetCoins';

/**
 * 看广告领金币。首页金币栏加号打开，看完激励视频发放 coinReward。
 */
@ccclass('AdGetCoinsPage')
export class AdGetCoinsPage extends Component {
    private static _current: Node | null = null;
    private static _opening = false;

    @property({ type: Node, tooltip: '黑色蒙层', group: { name: '页面节点', id: '0' } })
    public mask: Node | null = null;

    @property({ type: Node, tooltip: '面板', group: { name: '页面节点', id: '0' } })
    public frame: Node | null = null;

    @property({ type: Node, tooltip: '看广告领取按钮 (Frame/BtnFree)', group: { name: '页面节点', id: '0' } })
    public btnFree: Node | null = null;

    @property({ type: Node, tooltip: '关闭按钮', group: { name: '页面节点', id: '0' } })
    public btnClose: Node | null = null;

    @property({ type: Node, tooltip: '金币数量文本 (Frame/text，如 *100)', group: { name: '页面节点', id: '0' } })
    public lblCount: Node | null = null;

    @property({ type: Node, tooltip: '金币图标 (Frame/Coins)，领取时带进奖励页', group: { name: '页面节点', id: '0' } })
    public iconCoin: Node | null = null;

    @property({ tooltip: '看完广告获得的金币', group: { name: '奖励', id: '1' } })
    public coinReward: number = 100;

    private _countLabel: Label | null = null;
    private _claiming = false;
    private _isClosing = false;
    private _holdsLoading = false;
    private _openSettled = false;

    public static show(parent?: Node): void {
        if (this._current && this._current.isValid) return;
        if (this._opening) return;

        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            return;
        }

        this._opening = true;
        LoadingWaiting.acquire(targetParent, () => {
            resources.load(PREFAB_PATH, Prefab, (error, prefab) => {
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
                const page = node.getComponent(AdGetCoinsPage) || node.addComponent(AdGetCoinsPage);
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
        GameSDK.inst.logEvent('showPage', { value: 'adGetCoinsPage' });
        this.resolveMounts();
        this._countLabel = this.lblCount?.getComponent(Label) || null;
        if (this._countLabel) this._countLabel.string = `*${this.coinReward}`;

        if (this.frame) this.frame.setScale(new Vec3(0, 0, 1));
        if (this.mask) {
            const maskOpacity = this.mask.getComponent(UIOpacity) || this.mask.addComponent(UIOpacity);
            maskOpacity.opacity = 0;
        }

        this.bindButtons();
    }

    start(): void {
        this.finishOpen(true);
    }

    onDestroy(): void {
        this.unbindButtons();
        this.finishOpen(false);
        if (AdGetCoinsPage._current === this.node) AdGetCoinsPage._current = null;
    }

    /** 检查器没拖时，按节点名补上。 */
    private resolveMounts(): void {
        if (!this.mask) this.mask = this.node.getChildByName('Mask');
        if (!this.frame) this.frame = this.node.getChildByName('Frame');
        if (!this.btnFree) this.btnFree = this.frame?.getChildByName('BtnFree') || null;
        if (!this.btnClose) this.btnClose = this.frame?.getChildByName('BtnClose') || null;
        if (!this.lblCount) this.lblCount = this.frame?.getChildByName('text') || null;
        if (!this.iconCoin) this.iconCoin = this.frame?.getChildByName('Coins') || null;
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

    private bindButtons(): void {
        if (this.mask) this.mask.on(Node.EventType.TOUCH_END, this.onCloseClick, this);
        if (this.btnClose) this.btnClose.on(Node.EventType.TOUCH_END, this.onCloseClick, this);
        if (this.btnFree) this.btnFree.on(Node.EventType.TOUCH_END, this.onFreeClick, this);
    }

    private unbindButtons(): void {
        if (this.mask && this.mask.isValid) this.mask.off(Node.EventType.TOUCH_END, this.onCloseClick, this);
        if (this.btnClose && this.btnClose.isValid) this.btnClose.off(Node.EventType.TOUCH_END, this.onCloseClick, this);
        if (this.btnFree && this.btnFree.isValid) this.btnFree.off(Node.EventType.TOUCH_END, this.onFreeClick, this);
    }

    /** 看完激励视频再发金币。编辑器里没有广告时按看完处理。 */
    private onCloseClick(): void {
        Audio.play(AudioId.uiClick);
        this.close();
    }

    private onFreeClick(): void {
        Audio.play(AudioId.uiClick);
        if (this._claiming || this._isClosing) return;
        this._claiming = true;

        GameSDK.inst.logEvent('readyStartAD', { value: AD_ENTRY });
        GameSDK.inst.ShowADVideo(AD_ENTRY).then(() => {
            GameSDK.inst.logEvent('realEndAD', { value: AD_ENTRY });
            this.grantCoins();
        }).catch(() => {
            this._claiming = false;
        });
    }

    /** 看完广告后打开正式奖励页，由奖励页发放金币。 */
    private grantCoins(): void {
        if (!this.isValid || this._isClosing) {
            this._claiming = false;
            return;
        }
        const amount = this.coinReward > 0 ? this.coinReward : 100;
        const icon = this.iconCoin?.getComponent(Sprite)?.spriteFrame || null;
        RewardPage.show([{ type: 'COIN', count: amount, icon }], undefined, () => {
            this._claiming = false;
        });
        this.close();
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
        if (this._isClosing || !this.node || !this.node.isValid) return;
        this._isClosing = true;

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
            if (AdGetCoinsPage._current === this.node) AdGetCoinsPage._current = null;
            if (this.node && this.node.isValid) this.node.destroy();
        }, 0.2);
    }
}
