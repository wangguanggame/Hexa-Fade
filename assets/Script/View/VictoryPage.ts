import { _decorator, Component, Node, Label, Button, tween, Vec3, UIOpacity, director, sp } from 'cc';
import { GameData } from '../Config/GameData';
import { GameMain } from '../Logic/GameMain';
import { GamePage } from './GamePage';
import { GameScene } from '../Scene/GameScene';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { GameSDK } from '../../sdk/GameSDK';
import { SignPage } from './SignPage';
import { SpinPage } from './SpinPage';

const { ccclass, property } = _decorator;

/**
 * 胜利通关结算界面控制器 (VictoryPage)
 * 展示通关徽章、奖杯、得分统计、金币与星星奖励，并引导进入下一关
 */
@ccclass('VictoryPage')
export class VictoryPage extends Component {
    // ======================================== 节点与组件引用 ========================================
    @property({ type: Node, tooltip: '黑色半透明遮罩节点 (用于拦截底层点击与渐入)', group: { name: '容器节点', id: '0' } })
    public maskNode: Node = null!;

    @property({ type: Node, tooltip: '弹窗主内容容器节点 (用于播放淡入动效)', group: { name: '容器节点', id: '0' } })
    public contentNode: Node = null!;

    @property({ type: Node, tooltip: '奖杯节点 (用于呼吸与微动效)', group: { name: '容器节点', id: '0' } })
    public trophyNode: Node | null = null;

    @property({ type: Label, tooltip: '关卡标题文本组件 (Level X)', group: { name: 'UI文本', id: '1' } })
    public lblLevel: Label | null = null;

    @property({ type: Label, tooltip: '本关得分文本组件 (Score 数值)', group: { name: 'UI文本', id: '1' } })
    public lblScore: Label | null = null;

    @property({ type: Label, tooltip: '获得金币文本组件 (+50)', group: { name: 'UI文本', id: '1' } })
    public lblCoin: Label | null = null;

    @property({ type: Label, tooltip: '获得星星文本组件 (+1)', group: { name: 'UI文本', id: '1' } })
    public lblStar: Label | null = null;

    @property({ type: Button, tooltip: '下一关按钮组件 (btnNext)', group: { name: '交互按钮', id: '2' } })
    public btnNext: Button | null = null;

    @property({ type: Label, tooltip: '下一关按钮文本组件 (LEVEL X+1)', group: { name: '交互按钮', id: '2' } })
    public lblBtnLevel: Label | null = null;

    // ======================================== 运行时数据与回调 ========================================
    private _levelId: number = 1;
    private _score: number = 1250;
    private _coinReward: number = 50;
    private _starReward: number = 1;
    private _onNextCallback: (() => void) | null = null;
    private _isClosing: boolean = false;
    private _isShown: boolean = false;
    private _scoreSettled: boolean = false;

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameSDK.inst.logEvent('showPage', { value: 'victoryPage', level: GameMain.instance?.currentLevelId ?? Math.max(1, GameData.instance.currentLevel - 1) });
        this.autoFindNodes();
        this.setTitleVisible(false);
        this.bindEvents();
    }

    start() {
        // 如果外部未显式调用 show()，则根据当前数据自动播放入场动效并初始化展示
        if (!this._isClosing && !this._isShown) {
            const currentLevel = GameData.instance ? GameData.instance.currentLevel : 1;
            // 刚通过的关卡为 currentLevel - 1 (若刚刚通过则 passLevel 已 +1)
            const completedLevel = Math.max(1, currentLevel > 1 ? currentLevel - 1 : 1);
            this.show(completedLevel, this._score, this._coinReward, this._starReward);
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
        if (!this.trophyNode && this.contentNode) {
            this.trophyNode = this.contentNode.getChildByName('Trophy');
        }
        if (!this.lblLevel && this.contentNode) {
            const lvlNode = this.contentNode.getChildByPath('LevelBadge/lblLevel') || this.contentNode.getChildByName('lblLevel');
            if (lvlNode) this.lblLevel = lvlNode.getComponent(Label);
        }
        if (!this.lblScore && this.contentNode) {
            const scoreNode = this.contentNode.getChildByPath('Card/lblScore') || this.contentNode.getChildByName('lblScore');
            if (scoreNode) this.lblScore = scoreNode.getComponent(Label);
        }
        if (!this.lblCoin && this.contentNode) {
            const coinNode = this.contentNode.getChildByPath('RewardCoins/lblCoin') || this.contentNode.getChildByName('lblCoin');
            if (coinNode) this.lblCoin = coinNode.getComponent(Label);
        }
        if (!this.lblStar && this.contentNode) {
            const starNode = this.contentNode.getChildByPath('RewardStar/lblStar') || this.contentNode.getChildByName('lblStar');
            if (starNode) this.lblStar = starNode.getComponent(Label);
        }
        if (!this.btnNext && this.contentNode) {
            const btnNode = this.contentNode.getChildByName('btnNext');
            if (btnNode) this.btnNext = btnNode.getComponent(Button);
        }
        if (!this.lblBtnLevel && this.btnNext) {
            const btnLblNode = this.btnNext.node.getChildByName('lblBtnLevel') || this.btnNext.node.getChildByName('Label');
            if (btnLblNode) this.lblBtnLevel = btnLblNode.getComponent(Label);
        }
    }

    private bindEvents() {
        if (this.btnNext) {
            this.btnNext.node.off(Button.EventType.CLICK, this.onBtnNextClick, this);
            this.btnNext.node.on(Button.EventType.CLICK, this.onBtnNextClick, this);
        }
        if (this.maskNode) {
            this.maskNode.on(Node.EventType.TOUCH_START, (e) => {
                e.propagationStopped = true;
            }, this);
        }
    }

    // ======================================== 界面展示与数据填充 ========================================
    /**
     * 弹出显示胜利结算界面
     * @param completedLevelId 刚通关的关卡ID
     * @param score 本关获得得分 (默认 1250)
     * @param coinReward 金币奖励 (默认 50)
     * @param starReward 星星奖励 (默认 1)
     * @param onNext 点击下一关的回调
     */
    public show(completedLevelId: number, score: number = 1250, coinReward: number = 50, starReward: number = 1, onNext?: () => void) {
        Audio.play(AudioId.victory);
        if (!this._isShown) this._sessionRound = ++VictoryPage._sessionRounds;
        this._isShown = true;
        this._levelId = completedLevelId;
        this._score = score;
        this._coinReward = coinReward;
        this._starReward = starReward;
        if (onNext) this._onNextCallback = onNext;

        // 进入结算时一次性发放奖励并上传累计星星。
        if (!this._scoreSettled) {
            this._scoreSettled = true;
            GameData.instance.addScore(this._score);
            GameData.instance.addCoin(this._coinReward);
            GameData.instance.addStar(this._starReward);
            if (GameData.sdkReady) {
                void GameSDK.inst.saveRankingScore(GameData.instance.totalStar)
                    .catch(err => console.warn('[Ranking] Failed to upload stars:', err));
                const tm = GameData.instance.currentTournament;
                if (tm?.leaderboardKey && tm?.tournamentKey) {
                    // 提交本场锦标赛累计星星，适配后台保留最高成绩的规则。
                    const tournamentStars = GameData.instance.addTournamentStars(this._starReward);
                    void GameSDK.inst.saveTournamentScore(tm.leaderboardKey, tm.tournamentKey, tournamentStars, 3, 10, 10)
                        .catch(err => console.warn('[Tournament] Failed to upload stars:', err));
                }
            }
        }

        const nextLevelId = completedLevelId + 1;

        // 1. 关卡文本 (使用项目统一位图字体 numimage1，'L' 即代表完整的 'LEVEL ')
        if (this.lblLevel) {
            if (this.lblLevel.font) {
                this.lblLevel.string = `L${this._levelId}`;
            } else {
                this.lblLevel.string = `LEVEL ${this._levelId}`;
            }
        }

        // 2. 得分文本 (1250)
        if (this.lblScore) {
            this.lblScore.string = `${this._score}`;
        }

        // 3. 奖励数值文本 (+50, +1)
        if (this.lblCoin) {
            this.lblCoin.string = `+${this._coinReward}`;
        }
        if (this.lblStar) {
            this.lblStar.string = `+${this._starReward}`;
        }

        // 4. 下一关按钮文本 (numimage1.fnt 中 'L' 绘制为 'LEVEL ')
        if (this.lblBtnLevel) {
            if (this.lblBtnLevel.font) {
                this.lblBtnLevel.string = `L${nextLevelId}`;
            } else {
                this.lblBtnLevel.string = `LEVEL ${nextLevelId}`;
            }
        }

        // 每次启动只在第一局提示签到、第二局提示免费转盘。
        this.setNextLocked(this.hasFreePopup());
        this.unschedule(this.showDailyPopup);
        this.unschedule(this.waitForDailyPopupClose);
        if (this._nextLocked) this.scheduleOnce(this.showDailyPopup, 2.5);
        this.playEnterAnimation();
    }

    private static _sessionRounds = 0;
    private _sessionRound = 0;
    private _nextLocked = false;

    private hasFreePopup(): boolean {
        return (this._sessionRound === 1 && SignPage.canClaimToday())
            || (this._sessionRound === 2 && SpinPage.hasFreeSpin());
    }

    private setNextLocked(locked: boolean): void {
        this._nextLocked = locked;
        if (this.btnNext) this.btnNext.interactable = !locked;
    }

    private showDailyPopup(): void {
        if (this._isClosing || !this.node.activeInHierarchy) return;
        const parent = GameScene.instance?.getTopUIParent();
        if (this._sessionRound === 1 && SignPage.canClaimToday()) SignPage.show(parent);
        if (this._sessionRound === 2 && SpinPage.hasFreeSpin()) SpinPage.show(parent);
        this.waitForDailyPopupClose();
        if (this._nextLocked) this.schedule(this.waitForDailyPopupClose, 0.1);
    }

    private waitForDailyPopupClose(): void {
        if (SignPage.isShowingOrOpening() || SpinPage.isShowingOrOpening()) return;
        this.unschedule(this.waitForDailyPopupClose);
        this.setNextLocked(false);
    }

    private setTitleVisible(visible: boolean) {
        const titleNode = this.contentNode?.getChildByName('title');
        if (titleNode) titleNode.active = visible;
    }

    private playTitleAnimation() {
        const titleNode = this.contentNode?.getChildByName('title');
        const title = titleNode?.getComponent(sp.Skeleton);
        if (!title) {
            return;
        }

        // 先监听再激活；open 完整结束后才切 loop，避免排队混合提前替换轨道。
        let openingFinished = false;
        title.setCompleteListener((entry) => {
            if (openingFinished || entry.animation?.name !== 'open') return;
            openingFinished = true;
            if (!this.isValid || this._isClosing || !this.node.activeInHierarchy) return;
            title.setAnimation(0, 'loop', true);
        });
        titleNode.active = true;
        const opening = title.setAnimation(0, 'open', false);
        if (!opening) {
            openingFinished = true;
        }
    }

    /**
     * 播放入场淡入动画
     */
    private playEnterAnimation() {
        if (!this.contentNode) {
            this.playTitleAnimation();
            return;
        }
        this.setTitleVisible(false);

        // 遮罩渐显
        if (this.maskNode) {
            let opacity = this.maskNode.getComponent(UIOpacity);
            if (!opacity) opacity = this.maskNode.addComponent(UIOpacity);
            opacity.opacity = 0;
            tween(opacity)
                .to(0.25, { opacity: 230 })
                .start();
        }

        // 内容保持原始大小，仅淡入
        this.contentNode.setScale(new Vec3(1, 1, 1));
        let contentOpacity = this.contentNode.getComponent(UIOpacity);
        if (!contentOpacity) contentOpacity = this.contentNode.addComponent(UIOpacity);
        contentOpacity.opacity = 0;

        tween(contentOpacity)
            .to(0.2, { opacity: 255 })
            .call(() => {
                this.playTitleAnimation();
                this.playTrophyBreath();
            })
            .start();
    }

    /**
     * 奖杯轻微呼吸/悬浮循环动画
     */
    private playTrophyBreath() {
        if (!this.trophyNode || !this.trophyNode.isValid) return;

        const baseScale = new Vec3(1, 1, 1);
        const breathScale = new Vec3(1.03, 1.03, 1);

        tween(this.trophyNode)
            .repeatForever(
                tween(this.trophyNode)
                    .to(1.2, { scale: breathScale }, { easing: 'sineInOut' })
                    .to(1.2, { scale: baseScale }, { easing: 'sineInOut' })
            )
            .start();
    }

    // ======================================== 下一关按钮交互 ========================================
    /**
     * 点击下一关按钮
     */
    public onBtnNextClick() {
        if (this._nextLocked || this._isClosing) return;
        Audio.play(AudioId.uiClick);
        if (this._isClosing) return;
        this._isClosing = true;


        // 2. 按钮点击弹性缩放反馈
        if (this.btnNext) {
            tween(this.btnNext.node)
                .to(0.08, { scale: new Vec3(0.92, 0.92, 1) })
                .to(0.08, { scale: new Vec3(1.0, 1.0, 1) })
                .start();
        }

        // 3. 延时播放关闭动效。刚解锁藏品时回首页演出，否则进入下一关。
        this.scheduleOnce(() => {
            this.playExitAnimation(() => {
                if (this.shouldReturnHomeForUnlock()) {
                    this.returnHomeForUnlock();
                    return;
                }
                this.goToNextLevel();
            });
        }, 0.15);
    }

    /**
     * 播放退出动画
     */
    private playExitAnimation(onFinished: () => void) {
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
            onFinished();
        }, 0.22);
    }

    /** 主线刚好打满一件藏品时，不进下一关，回首页走解锁演出。 */
    private shouldReturnHomeForUnlock(): boolean {
        const data = GameData.instance;
        return !!data && !data.isJoinTournament && data.hasPendingCollectionUnlock();
    }

    private returnHomeForUnlock() {
        GameScene.instance?.backToHome();
    }

    /**
     * 执行进入下一关流程
     */
    private goToNextLevel() {
        // 如果外部提供了自定义跳转回调，优先执行
        if (this._onNextCallback) {
            this._onNextCallback();
            this.node.destroy();
            return;
        }

        const nextLevel = GameData.instance ? GameData.instance.currentLevel : (this._levelId + 1);

        // 无论资源是否已缓存，结算后进入下一关都显示进关加载页。
        const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
        if (gameMain) {
            gameMain.currentLevelId = nextLevel;
            gameMain.isPlaying = false;
        }
        GameScene.instance?.startGame();

        // 销毁结算界面
        this.node.destroy();
    }
}
