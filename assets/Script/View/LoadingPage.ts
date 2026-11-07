import { GameSDK } from '../../sdk/GameSDK';
import { _decorator, Component, Label, ProgressBar, director, Prefab, instantiate } from 'cc';
import { GameScene } from '../Scene/GameScene';
import { GameMain } from '../Logic/GameMain';
import { FirstLevelGuide } from './FirstLevelGuide';
import { GameData } from '../Config/GameData';
import { Audio } from '../Tools/Audio/Audio';
import { BoomParticle } from '../Logic/BoomParticle';
import { BrokenParticle } from '../Logic/BrokenParticle';
import { LevelManager } from '../Logic/LevelManager';
import { GamePage } from './GamePage';

const { ccclass, property } = _decorator;

@ccclass('LoadingPage')
export class LoadingPage extends Component {
    // ======================================== 挂载变量 ========================================
    @property({ type: ProgressBar, tooltip: '加载进度条', group: { name: 'UI组件', id: '0' } })
    public progressBar: ProgressBar = null!;

    @property({ type: Label, tooltip: '加载进度文本', group: { name: 'UI组件', id: '0' } })
    public progressText: Label | null = null;

    @property({ type: Prefab, tooltip: 'GamePage 预制体（直接挂载 GamePage.prefab，实例化后将置于 bomUI）', group: { name: '预制体', id: '1' } })
    public gamePagePrefab: Prefab | null = null;

    // ======================================== 内部状态管理 ========================================
    private _startedAt = 0;
    private _visibleElapsed = 0;
    private readonly _minimumVisibleSeconds = 1;
    private _resProgress: number = 0;           // 阶段 1: 资源加载进度 (权重 0.30)
    private _gamePageProgress: number = 0;      // 阶段 2: 游戏页面载入进度 (权重 0.30)
    private _levelProgress: number = 0;         // 阶段 3: 关卡生成渲染进度 (权重 0.40)
    private _targetProgress: number = 0;        // 综合目标进度（0.0 ~ 1.0）
    private _displayProgress: number = 0;       // UI 平滑显示进度 (0.0 ~ 1.0)

    private _isLoadFinished: boolean = false;       // 阶段 1 资源是否加载完成
    private _isGamePageFinished: boolean = false;   // 阶段 2 页面是否实例化完成
    private _isLevelFinished: boolean = false;      // 阶段 3 关卡是否渲染完成
    private _isCompleted: boolean = false;          // 全部加载流程是否完成

    // ======================================== 生命周期 ========================================
    start() {
        this._startedAt = Date.now();
        this.initView();
        this.destroyTabPage();
        this.loadGameResources();
    }

    update(deltaTime: number) {
        this.updateProgress(deltaTime);
    }

    // ======================================== 流程封装函数 ========================================
    /**
     * 初始化视图状态与数据
     */
    private initView() {
        this._resProgress = 0;
        this._gamePageProgress = 0;
        this._levelProgress = 0;
        this._targetProgress = 0;
        this._displayProgress = 0;

        this._isLoadFinished = false;
        this._isGamePageFinished = false;
        this._isLevelFinished = false;
        this._isCompleted = false;

        this.progressText ??= this.progressBar?.node.getChildByName('text')?.getComponent(Label) ?? null;
        this.refreshProgressView();
    }

    /** 进度条与文本使用同一平滑进度；位图字体用 X 表示分隔符。 */
    private refreshProgressView() {
        if (this.progressBar) {
            this.progressBar.progress = this._displayProgress;
        }
        if (this.progressText) {
            const percent = Math.floor(Math.min(1, Math.max(0, this._displayProgress)) * 100);
            this.progressText.string = `${percent}X100`;
        }
    }

    /**
     * 销TabPage 大厅
     */
    private destroyTabPage() {
        if (GameScene.instance && GameScene.instance.tabPageNode && GameScene.instance.tabPageNode.isValid) {
            GameScene.instance.tabPageNode.destroy();
            GameScene.instance.tabPageNode = null;
        }
    }

    /**
     * 阶段 1：等待首页后台准备的对局必需资源（占总进度 30%）。
     */
    private loadGameResources() {
        const scene = GameScene.instance;
        if (!scene) return;
        // 利用加载页至少显示的 1 秒并行预热，不额外阻塞棋盘生成或进关。
        // 各项独立处理失败，其余加载继续；未完成的请求在进关后仍继续执行。
        const warmOptional = (name: string, task: Promise<void>) => {
            void task.catch(err => console.warn('[LoadingPage] Optional preload failed:', name, err));
        };
        warmOptional('explosion effects', BoomParticle.preload());
        warmOptional('broken effects', BrokenParticle.preload());
        warmOptional('game audio', Audio.preloadGame());

        scene.prepareGameResources(ratio => {
            if (!this.isValid) return;
            this._resProgress = ratio * 0.30;
            this._targetProgress = this._resProgress + this._gamePageProgress + this._levelProgress;
        }).then(() => {
            if (!this.isValid || this._isLoadFinished) return;
            this._resProgress = 0.30;
            this._isLoadFinished = true;
            this._targetProgress = this._resProgress + this._gamePageProgress + this._levelProgress;
            this.loadGamePage();
        }).catch(err => {
            if (!this.isValid) return;
            console.warn('[LoadingPage] Game resources failed:', err);
            scene.backToHome();
            scene.showTipRemind('Loading failed. Please try again.');
        });
    }

    /**
     * 阶段 2：实例化 GamePage 游戏主界面（占总进度 30%，挂载至 bomUI）。
     */
    private loadGamePage() {

        const oldPage = GameScene.instance?.gamePageNode;
        if (oldPage?.isValid) {
            this.onGamePageReady();
            return;
        }
        const pageStarted = Date.now();
        const bomUIParent = GameScene.instance ? GameScene.instance.getBomUIParent() : null;

        // 1. 优先使用当前 LoadingPage 上直接绑定的 gamePagePrefab
        if (this.gamePagePrefab && bomUIParent) {
            const gameNode = instantiate(this.gamePagePrefab);
            gameNode.setParent(bomUIParent);
            if (GameScene.instance) {
                GameScene.instance.gamePageNode = gameNode;
            }
            this.onGamePageReady();
        } else if (GameScene.instance) {
            // 2. 否则通过 GameScene 实例调度载入
            GameScene.instance.initGamePage(undefined, (node) => {
                console.info('[LoadTiming] GamePage ready', { ms: Date.now() - pageStarted });
                this.onGamePageReady();
            });
        } else {
            this.onGamePageReady();
        }
    }

    /**
     * 阶段 2 页面就绪回调：推进进度并开启阶3
     */
    private onGamePageReady() {
        this._gamePageProgress = 0.30;
        this._isGamePageFinished = true;
        this._targetProgress = this._resProgress + this._gamePageProgress + this._levelProgress;
        // 进入阶段 3: 关卡 3D 节点加载与渲
        this.loadGameLevel();
    }

    /**
     * 阶段 3：调用 GameMain 初始化并渲染关卡 3D 节点（占总进度 40%）。
     */
    private loadGameLevel() {

        const gameMain = GameMain.instance || director.getScene().getComponentInChildren(GameMain);

        if (gameMain) {
            const currentLevel = GameData.instance.currentLevel || gameMain.currentLevelId || 1;
            gameMain.currentLevelId = currentLevel;
            void gameMain.initLevelSystem(
                currentLevel,
                // 渲染进度回调
                (renderPercent: number) => {
                    this._levelProgress = renderPercent * 0.40;
                    this._targetProgress = this._resProgress + this._gamePageProgress + this._levelProgress;
                },
                // 渲染完成回调
                () => {
                    this._levelProgress = 0.40;
                    this._isLevelFinished = true;
                    this._targetProgress = 1.0;
                }
            ).catch(err => {
                if (!this.isValid) return;
                console.warn('[LoadingPage] Level initialization failed:', err);
                GameScene.instance?.backToHome();
                GameScene.instance?.showTipRemind('Loading failed. Please try again.');
            });
        } else {
            this._levelProgress = 0.40;
            this._isLevelFinished = true;
            this._targetProgress = 1.0;
        }
    }

    /**
     * 逐帧平滑刷新进度
     */
    private updateProgress(deltaTime: number) {
        this._visibleElapsed += deltaTime;
        // 资源很快就绪时也让进度持续走满至少 1 秒，避免提前到 100% 后停住。
        const visibleTarget = Math.min(this._targetProgress, this._visibleElapsed / this._minimumVisibleSeconds);
        // 平滑插值逼近综合目标进度 (速度 1.6/s)
        if (this._displayProgress < visibleTarget) {
            this._displayProgress = Math.min(visibleTarget, this._displayProgress + deltaTime * 1.6);
            this.refreshProgressView();
        }

        // 检测三大阶段全部完视觉进度条平滑达100%
        if (
            this._isLoadFinished &&
            this._isGamePageFinished &&
            this._isLevelFinished &&
            this._displayProgress >= 0.999 &&
            this._visibleElapsed >= this._minimumVisibleSeconds &&
            !this._isCompleted
        ) {
            this.onAllFinished();
        }
    }

    /**
     * 全部阶段完成：关闭并销LoadingPage，正式进入游
     */
    private onAllFinished() {
        console.info('[LoadTiming] Enter level complete', { ms: Date.now() - this._startedAt });
        this._isCompleted = true;
        const duration = Math.max(0, Date.now() - this._startedAt);
        GameSDK.inst.logEvent('loading_time', { duration_ms: duration,
            duration: duration < 3000 ? '0-3s' : duration < 5000 ? '3-5s' : duration < 10000 ? '5-10s' : '10s+', stage: 'level' });
        this._displayProgress = 1.0;
        this.refreshProgressView();

        // 销毁当LoadingPage 节点
        this.node.active = false;
        this.node.destroy();
        if (GameScene.instance) {
            GameScene.instance.loadingPageNode = null;
            const topUI = GameScene.instance.getTopUIParent();
            const guide = GameMain.instance?.getComponent(FirstLevelGuide);
            if (topUI && guide) guide.show(topUI);
            // 加载页已隐藏后才触发新机制说明，避免弹窗抢在进度完成前出现。
            const levelId = GameMain.instance?.currentLevelId;
            const level = levelId ? LevelManager.instance.getLevel(levelId) : null;
            if (level) GamePage.instance?.tryShowSpecialMapGuides(level.blocks);
        }
    }
}



