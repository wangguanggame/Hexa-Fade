import { _decorator, Component, Node, Button, Label, tween, Vec3, UIOpacity, director } from 'cc';
import { GameData } from '../Config/GameData';
import { GameMain } from '../Logic/GameMain';
import { GamePage } from './GamePage';
import { Remind } from '../Tools/Remind/Remind';
import { GameSDK } from '../../sdk/GameSDK';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

/**
 * 关卡失败结算界面控制器 (FailPage)
 * 适用于步数耗尽（FailMovesPage）与无方块可移动（FailTilesPage）两种失败场景；
 * 提供看视频跳过关卡（SKIP）以及重新挑战本关（RETRY）两项核心操作。
 */
@ccclass('FailPage')
export class FailPage extends Component {
    // ======================================== 节点与组件引用 ========================================
    @property({ type: Node, tooltip: '黑色半透明遮罩节点 (用于拦截底层点击与渐入)', group: { name: '容器节点', id: '0' } })
    public maskNode: Node = null!;

    @property({ type: Node, tooltip: '弹窗主内容容器节点 (用于播放弹出弹性缩放动效)', group: { name: '容器节点', id: '0' } })
    public contentNode: Node = null!;

    @property({ type: Button, tooltip: '跳过关卡按钮 (SKIP)', group: { name: '交互按钮', id: '1' } })
    public btnSkip: Button | null = null;

    @property({ type: Button, tooltip: '重新开始按钮 (RETRY)', group: { name: '交互按钮', id: '1' } })
    public btnRetry: Button | null = null;

    // ======================================== 运行时数据与回调 ========================================
    private _isClosing: boolean = false;
    private _isShown: boolean = false;
    private _scoreSettled: boolean = false;
    private _adPlaying: boolean = false;
    private _onRetryCallback: (() => void) | null = null;
    private _onSkipCallback: (() => void) | null = null;

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameSDK.inst.logEvent('showPage', { value: 'failPage' });
        this.autoFindNodes();
        this.bindEvents();
    }

    start() {
        if (!this._isClosing && !this._isShown) {
            this.show();
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
        if (!this.btnSkip && this.contentNode) {
            const node = this.contentNode.getChildByName('BtnSkip') || this.contentNode.getChildByName('btnSkip');
            if (node) this.btnSkip = node.getComponent(Button);
        }
        if (!this.btnRetry && this.contentNode) {
            const node = this.contentNode.getChildByName('BtnRetry') || this.contentNode.getChildByName('btnRetry');
            if (node) this.btnRetry = node.getComponent(Button);
        }
    }

    private bindEvents() {
        if (this.btnSkip) {
            this.btnSkip.node.off(Button.EventType.CLICK, this.onBtnSkipClick, this);
            this.btnSkip.node.on(Button.EventType.CLICK, this.onBtnSkipClick, this);
        }
        if (this.btnRetry) {
            this.btnRetry.node.off(Button.EventType.CLICK, this.onBtnRetryClick, this);
            this.btnRetry.node.on(Button.EventType.CLICK, this.onBtnRetryClick, this);
        }
        if (this.maskNode) {
            this.maskNode.on(Node.EventType.TOUCH_START, (e) => {
                e.propagationStopped = true;
            }, this);
        }
    }

    // ======================================== 展示与动效 ========================================
    /**
     * 打开失败结算界面
     */
    public show(onRetry?: () => void, onSkip?: () => void) {
        this._isShown = true;
        this._onRetryCallback = onRetry || null;
        this._onSkipCallback = onSkip || null;

        // 复活弹窗不结算；只有最终失败页面累计本局分数，且只累计一次。
        if (!this._scoreSettled) {
            this._scoreSettled = true;
            GameData.instance.addScore(GameMain.instance?.levelScore || 0);
            if (GameData.sdkReady) {
                void GameSDK.inst.saveRankingScore(GameData.instance.totalStar).catch(() => {});
            }
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
     * 点击重新挑战 (RETRY)
     */
    public onBtnRetryClick() {
        Audio.play(AudioId.uiClick);
        if (this._isClosing) return;


        if (this.btnRetry) {
            tween(this.btnRetry.node)
                .to(0.08, { scale: new Vec3(0.92, 0.92, 1) })
                .to(0.08, { scale: new Vec3(1.0, 1.0, 1) })
                .start();
        }

        this.close(() => {
            if (this._onRetryCallback) {
                this._onRetryCallback();
                return;
            }

            const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
            if (gameMain) {
                const currentLevel = gameMain.currentLevelId || (GameData.instance ? GameData.instance.currentLevel : 1);
                gameMain.renderLevel(currentLevel);
            }
            if (GamePage.instance) {
                GamePage.instance.updateMovesDisplay();
            }
        });
    }

    /**
     * 点击跳过关卡 (SKIP)
     */
    public onBtnSkipClick() {
        Audio.play(AudioId.uiClick);
        if (this._isClosing || this._adPlaying) return;
        this._adPlaying = true;

        this.playRewardedVideo(() => {
            this._adPlaying = false;
            if (!this.isValid || this._isClosing) return;


            if (this.btnSkip) {
                tween(this.btnSkip.node)
                    .to(0.08, { scale: new Vec3(0.92, 0.92, 1) })
                    .to(0.08, { scale: new Vec3(1.0, 1.0, 1) })
                    .start();
            }

            Remind.showTipRemind('Level Skipped!');

            this.close(() => {
                if (this._onSkipCallback) {
                    this._onSkipCallback();
                    return;
                }

                if (GameData.instance) {
                    GameData.instance.passLevel();
                }

                const nextLevel = GameData.instance ? GameData.instance.currentLevel : 1;
                const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
                if (gameMain) {
                    gameMain.currentLevelId = nextLevel;
                    gameMain.renderLevel(nextLevel);
                }
                if (GamePage.instance) {
                    GamePage.instance.updateLevelDisplay(nextLevel);
                    GamePage.instance.updateMovesDisplay();
                }
            });
        });
    }

    /** 仅成功完成激励视频后跳关。 */
    private playRewardedVideo(onComplete: () => void): void {
        GameSDK.inst.logEvent('readyStartAD', { value: 'failPage' });
        GameSDK.inst.ShowADVideo('failPage').then(() => {
            GameSDK.inst.logEvent('realEndAD', { value: 'failPage' });
            onComplete();
        }).catch(() => {
            this._adPlaying = false;
        });
    }
}
