import { _decorator, Component, Node, Button, Label, tween, Vec3, UIOpacity, director } from 'cc';
import { GameData } from '../Config/GameData';
import { GameMain } from '../Logic/GameMain';
import { GamePage } from './GamePage';
import { GameScene } from '../Scene/GameScene';
import { Remind } from '../Tools/Remind/Remind';
import { GameSDK } from '../../sdk/GameSDK';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

/**
 * 复活/加步数弹窗控制器 (RevivePage)
 * 提供金币购买 +5 步和观看广告免费 +5 步两种复活通道；
 * 点击关闭按钮 (X) 则关闭本弹窗并触发最终失败结算界面。
 */
@ccclass('RevivePage')
export class RevivePage extends Component {
    // ======================================== 节点与组件引用 ========================================
    @property({ type: Node, tooltip: '黑色半透明遮罩节点 (用于拦截底层点击与渐入)', group: { name: '容器节点', id: '0' } })
    public maskNode: Node = null!;

    @property({ type: Node, tooltip: '弹窗主内容容器节点 (用于播放弹出弹性缩放动效)', group: { name: '容器节点', id: '0' } })
    public contentNode: Node = null!;

    @property({ type: Button, tooltip: '关闭按钮 (X)', group: { name: '交互按钮', id: '1' } })
    public btnClose: Button | null = null;

    @property({ type: Button, tooltip: '金币购买步数按钮', group: { name: '交互按钮', id: '1' } })
    public btnCoin: Button | null = null;

    @property({ type: Button, tooltip: '看视频免费复活按钮', group: { name: '交互按钮', id: '1' } })
    public btnFree: Button | null = null;

    @property({ type: Label, tooltip: '金币价格文本组件 (如 300)', group: { name: 'UI文本', id: '2' } })
    public lblPrice: Label | null = null;

    // ======================================== 运行时数据与回调 ========================================
    private _movesToAdd: number = 5;
    private _coinPrice: number = 300;
    private _isClosing: boolean = false;
    private _isShown: boolean = false;
    private _adPlaying: boolean = false;
    private _onCloseCallback: (() => void) | null = null;

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameSDK.inst.logEvent('showPage', { value: 'revivePage' });
        this.autoFindNodes();
        this.bindEvents();
    }

    start() {
        if (!this._isClosing && !this._isShown) {
            this.show(this._movesToAdd, this._coinPrice);
        }
    }

    // ======================================== 自动绑定与节点查找 ========================================
    private autoFindNodes() {
        if (!this.maskNode) {
            this.maskNode = this.node.getChildByName('Mask') || this.node.getChildByName('mask')!;
        }
        if (!this.contentNode) {
            this.contentNode = this.node.getChildByName('Content') || this.node.getChildByName('content') || this.node;
        }
        if (!this.btnClose && this.contentNode) {
            // BtnClose 与 Content 同级，优先从页面根节点查找，兼容旧版嵌套结构。
            const node = this.node.getChildByName('BtnClose') || this.node.getChildByName('btnClose') ||
                this.contentNode.getChildByName('BtnClose') || this.contentNode.getChildByName('btnClose');
            if (node) this.btnClose = node.getComponent(Button);
        }
        if (!this.btnCoin && this.contentNode) {
            const node = this.contentNode.getChildByName('BtnCoin') || this.contentNode.getChildByName('btnCoin');
            if (node) this.btnCoin = node.getComponent(Button);
        }
        if (!this.btnFree && this.contentNode) {
            const node = this.contentNode.getChildByName('BtnFree') || this.contentNode.getChildByName('btnFree');
            if (node) this.btnFree = node.getComponent(Button);
        }
        if (!this.lblPrice && this.btnCoin) {
            const node = this.btnCoin.node.getChildByName('lblPrice') || this.btnCoin.node.getChildByName('Label');
            if (node) this.lblPrice = node.getComponent(Label);
        }
    }

    private bindEvents() {
        if (this.btnClose) {
            this.btnClose.node.off(Button.EventType.CLICK, this.onBtnCloseClick, this);
            this.btnClose.node.on(Button.EventType.CLICK, this.onBtnCloseClick, this);
        }
        if (this.btnCoin) {
            this.btnCoin.node.off(Button.EventType.CLICK, this.onBtnCoinClick, this);
            this.btnCoin.node.on(Button.EventType.CLICK, this.onBtnCoinClick, this);
        }
        if (this.btnFree) {
            this.btnFree.node.off(Button.EventType.CLICK, this.onBtnFreeClick, this);
            this.btnFree.node.on(Button.EventType.CLICK, this.onBtnFreeClick, this);
        }
        if (this.maskNode) {
            this.maskNode.on(Node.EventType.TOUCH_START, (e) => {
                e.propagationStopped = true;
            }, this);
        }
    }

    // ======================================== 展示与动效 ========================================
    /**
     * 弹出复活弹窗
     */
    public show(movesToAdd: number = 5, coinPrice: number = 300, onCloseCallback?: () => void) {
        this._isShown = true;
        this._movesToAdd = movesToAdd;
        this._coinPrice = coinPrice;
        this._onCloseCallback = onCloseCallback || null;

        if (this.lblPrice) {
            this.lblPrice.string = `${coinPrice}`;
        }

        this.playEnterAnimation();
    }

    private playEnterAnimation() {
        if (this.maskNode) {
            let opacity = this.maskNode.getComponent(UIOpacity);
            if (!opacity) opacity = this.maskNode.addComponent(UIOpacity);
            opacity.opacity = 0;
            tween(opacity)
                .to(0.25, { opacity: 230 })
                .start();
        }

        if (!this.contentNode) return;

        this.contentNode.setScale(new Vec3(0.2, 0.2, 1));
        let contentOpacity = this.contentNode.getComponent(UIOpacity);
        if (!contentOpacity) contentOpacity = this.contentNode.addComponent(UIOpacity);
        contentOpacity.opacity = 0;

        tween(contentOpacity)
            .to(0.2, { opacity: 255 })
            .start();

        tween(this.contentNode)
            .to(0.35, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'cubicOut' })
            .to(0.15, { scale: new Vec3(0.98, 0.98, 1) }, { easing: 'quadInOut' })
            .to(0.12, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'quadOut' })
            .start();
    }

    private close(onFinished?: () => void) {
        if (this._isClosing) return;
        this._isClosing = true;

        if (this.contentNode) {
            tween(this.contentNode)
                .to(0.2, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'backIn' })
                .start();

            const op = this.contentNode.getComponent(UIOpacity);
            if (op) {
                tween(op).to(0.2, { opacity: 0 }).start();
            }
        }

        if (this.maskNode) {
            const maskOp = this.maskNode.getComponent(UIOpacity);
            if (maskOp) {
                tween(maskOp).to(0.2, { opacity: 0 }).start();
            }
        }

        this.scheduleOnce(() => {
            if (onFinished) onFinished();
            this.node.destroy();
        }, 0.22);
    }

    // ======================================== 交互逻辑 ========================================
    /**
     * 点击金币购买步数
     */
     public onBtnCoinClick() {
        Audio.play(AudioId.uiClick);
        if (this._isClosing) return;

        const currentCoin = GameData.instance ? GameData.instance.totalCoin : 0;
        if (currentCoin < this._coinPrice) {
            // 弹出金币不足提示
            Remind.showTipRemind('Not enough coins!');
            // 按钮晃动反馈
            if (this.btnCoin) {
                tween(this.btnCoin.node)
                    .by(0.05, { position: new Vec3(10, 0, 0) })
                    .by(0.1, { position: new Vec3(-20, 0, 0) })
                    .by(0.05, { position: new Vec3(10, 0, 0) })
                    .start();
            }
            return;
        }

        GameData.instance.useCoin(this._coinPrice);

        // 按钮点击反馈
        if (this.btnCoin) {
            tween(this.btnCoin.node)
                .to(0.08, { scale: new Vec3(0.92, 0.92, 1) })
                .to(0.08, { scale: new Vec3(1.0, 1.0, 1) })
                .start();
        }

        // 弹出复活成功提示
        Remind.showTipRemind(`+${this._movesToAdd} Moves Added!`);

        this.close(() => {
            const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
            if (gameMain) {
                gameMain.reviveGame(this._movesToAdd);
            }
        });
    }

    /**
     * 点击看视频免费复活
     */
    public onBtnFreeClick() {
        Audio.play(AudioId.uiClick);
        if (this._isClosing || this._adPlaying) return;
        this._adPlaying = true;

        this.playRewardedVideo(() => {
            this._adPlaying = false;
            if (!this.isValid || this._isClosing) return;


            if (this.btnFree) {
                tween(this.btnFree.node)
                    .to(0.08, { scale: new Vec3(0.92, 0.92, 1) })
                    .to(0.08, { scale: new Vec3(1.0, 1.0, 1) })
                    .start();
            }

            Remind.showTipRemind(`+${this._movesToAdd} Moves Added!`);

            this.close(() => {
                const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
                if (gameMain) {
                    gameMain.reviveGame(this._movesToAdd);
                }
            });
        });
    }

    /** 仅成功完成激励视频后免费复活。 */
    private playRewardedVideo(onComplete: () => void): void {
        GameSDK.inst.logEvent('readyStartAD', { value: 'revivePage' });
        GameSDK.inst.ShowADVideo('revivePage').then(() => {
            GameSDK.inst.logEvent('realEndAD', { value: 'revivePage' });
            onComplete();
        }).catch(() => {
            this._adPlaying = false;
        });
    }

    /**
     * 点击关闭按钮 (X)，放弃复活并转入最终失败结算
     */
    public onBtnCloseClick() {
        Audio.play(AudioId.uiClick);
        if (this._isClosing) return;


        this.close(() => {
            if (this._onCloseCallback) {
                this._onCloseCallback();
            } else {
                // 默认调用 GameScene 打开失败弹窗
                const scene = GameScene.instance || director.getScene()?.getComponentInChildren(GameScene);
                if (scene && typeof (scene as any).initFailPage === 'function') {
                    GameSDK.inst.ShowADChaping('failPage').then(() => {
                        if (!scene.isValid) return;
                        (scene as any).initFailPage('NO_MOVES');
                    });
                }
            }
        });
    }
}
