import { _decorator, Component, ProgressBar, director, resources, game, assetManager, Prefab, TextAsset } from 'cc';
import { LevelManager } from '../Logic/LevelManager';
import { ScreenAdapter } from '../Tools/ScreenAdapter/ScreenAdapter';
import { GameSDK } from '../../sdk/GameSDK';
import { NezpKit } from '../nezpFB/nezp/NezpKit';
import { Audio } from '../Tools/Audio/Audio';
import { GameData } from '../Config/GameData';

const { ccclass, property } = _decorator;

@ccclass('HomeScene')
export class HomeScene extends Component {
    // ======================================== 挂载变量 ========================================
    @property({ type: ProgressBar, tooltip: '加载进度条组件（可选）', group: { name: 'UI组件', id: '0' } })
    public progressBar: ProgressBar | null = null;

    @property({ tooltip: '目标主游戏场景名称', group: { name: '场景配置', id: '1' } })
    public targetSceneName: string = 'GameScene';

    @property({ tooltip: '加载完成后是否自动跳转到游戏场景', group: { name: '场景配置', id: '1' } })
    public autoEnterGame: boolean = true;

    // 加载状态与进度管理
    private _resLoadState: boolean = false;      // 资源是否加载完成
    private _resLoadProgress: number = 0;        // 资源加载进度 (权重 0.8)
    private _sceneLoadState: boolean = false;    // 场景是否预加载完成
    private _sceneLoadProgress: number = 0;      // 场景预加载进度（权重 0.2）
    private _sdkInitState: boolean = false;       // 平台 SDK 是否初始化结束
    private _allLoadState: boolean = false;      // 整体加载是否完成
    private _loadingStartTime: number = 0;       // 记录启动耗时
    private _displayProgress: number = 0;        // UI 平滑显示进度 (0.0 ~ 1.0)

    onLoad() {
        try {
            NezpKit.inst.init({ enableLog: false });
        } catch (e) {
        }

        // 启动时立即执行全局屏幕分辨率动态自适应，并监听窗口/尺寸变化
        ScreenAdapter.initGlobalListener();
    }

    start() {
        this.initStartTime();
        this.gameDefaultDeploy();
        this.initGameSDK();
        this.startPreloadScene();
        this.loadMainResources();
        Audio.preloadHome();
    }

    private initGameSDK() {
        GameSDK.inst.init().then(() => {
            GameData.sdkReady = true;
            void GameData.instance;
            console.info('[LoadTiming] SDK ready', { ms: Date.now() - this._loadingStartTime });
            this._sdkInitState = true;
        }).catch((err) => {
            console.error('[HomeScene] GameSDK init failed:', err);
            GameData.sdkReady = false;
            void GameData.instance;
            this._sdkInitState = true;
        });
    }

    update(deltaTime: number) {
        this.updateProgress(deltaTime);
    }

    // ======================================== 内部封装函数 ========================================
    /**
     * 记录启动时间
     */
    private initStartTime() {
        this._loadingStartTime = Date.now();
    }

    /**
     * 引擎全局配置与下载并发优(对齐 CarMatch 架构)
     */
    private gameDefaultDeploy() {
        game.frameRate = 61;
        assetManager.downloader.maxConcurrency = 8;
        assetManager.downloader.maxRequestsPerFrame = 8;
    }

    /**
     * 流程 1：预加载 GameScene 游戏场景（占总进度 20%）。
     */
    private startPreloadScene() {
        director.preloadScene(
            this.targetSceneName,
            (completedCount: number, totalCount: number) => {
                if (totalCount > 0) {
                    const val = (completedCount / totalCount) * 0.2;
                    if (val > this._sceneLoadProgress) {
                        this._sceneLoadProgress = val;
                    }
                }
            },
            (error: Error | null) => {
                if (error) console.warn('[HomeScene] GameScene preload failed:', error);
                this._sceneLoadState = true;
            }
        );
    }

    /**
     * 流程 2：预加载关键资源（占总进度 80%）。
     * 预加载 resources/Public 和 resources/Home 资源目录。
     */
    private loadMainResources() {
        let publicLoaded = false;
        let homeLoaded = false;
        let publicProgress = 0;
        let homeProgress = 0;

        const updateResProgress = () => {
            const currentProgress = ((publicProgress + homeProgress) / 2) * 0.8;
            if (currentProgress > this._resLoadProgress) {
                this._resLoadProgress = currentProgress;
            }
            if (publicLoaded && homeLoaded) {
                this._resLoadState = true;
            }
        };

        // 1. 预加载 resources/Public 目录。
        resources.loadDir(
            'Public',
            (finished: number, total: number) => {
                if (total > 0) {
                    publicProgress = finished / total;
                    updateResProgress();
                }
            },
            (err: Error | null, assets: any[]) => {
                if (err) console.warn('[HomeScene] Load Public failed:', err);
                publicProgress = 1.0;
                publicLoaded = true;
                updateResProgress();
            }
        );

        // 2. 预加载 resources/Home 目录。
        resources.loadDir(
            'Main/Home',
            (finished: number, total: number) => {
                if (total > 0) {
                    homeProgress = finished / total;
                    updateResProgress();
                }
            },
            (err: Error | null, assets: any[]) => {
                if (err) console.warn('[HomeScene] Load Main/Home failed:', err);
                homeProgress = 1.0;
                homeLoaded = true;
                updateResProgress();
            }
        );
    }

    /**
     * 逐帧平滑更新加载进度。
     */
    private updateProgress(deltaTime: number) {
        if (this._allLoadState) return;

        // 1. 获取底层真实加载目标进度 (0.0 ~ 1.0)
        const targetProgress = Math.min(this._sdkInitState ? 1.0 : 0.99, this._resLoadProgress + this._sceneLoadProgress);

        // 2. 平滑逼近目标
        if (this._displayProgress < targetProgress) {
            this._displayProgress = Math.min(targetProgress, this._displayProgress + deltaTime * 1.6);
        }

        // 3. 刷新 UI 进度
        if (this.progressBar) {
            this.progressBar.progress = this._displayProgress;
        }

        // 4. 检查是否全部加载完
        if (this._resLoadState && this._sceneLoadState && this._sdkInitState && this._displayProgress >= 0.999) {
            this.onAllLoadFinished();
        }
    }

    /**
     * 启动加载全部就绪
     */
    private onAllLoadFinished() {
        this._allLoadState = true;
        if (this.progressBar) {
            this.progressBar.progress = 1.0;
        }

        console.info('[LoadTiming] Startup ready', { ms: Date.now() - this._loadingStartTime });
        const durationSec = ((Date.now() - this._loadingStartTime) / 1000).toFixed(2);

        if (this.autoEnterGame) {
            this.enterGameScene();
        }
    }

    /**
     * 切换进入主游戏场景。
     */
    public enterGameScene() {
        director.loadScene(this.targetSceneName, () => {
        });
    }
}
