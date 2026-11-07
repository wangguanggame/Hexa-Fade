import { _decorator, Component, Node, Prefab, instantiate, resources, director } from 'cc';
import { GameMain } from '../Logic/GameMain';
import { GameData, GameDataEvent } from '../Config/GameData';
import { VictoryPage } from '../View/VictoryPage';
import { RevivePage } from '../View/RevivePage';
import { FailPage } from '../View/FailPage';
import { SpinPage } from '../View/SpinPage';
import { ChampionshipPage } from '../View/ChampionshipPage';
import { ScreenAdapter } from '../Tools/ScreenAdapter/ScreenAdapter';
import { Remind } from '../Tools/Remind/Remind';
import { NezpKit } from '../nezpFB/nezp/NezpKit';
import { Audio } from '../Tools/Audio/Audio';
import { GameSDK } from '../../sdk/GameSDK';
import { LoadingWaiting } from '../View/LoadingWaiting';
import { FirstLevelGuide } from '../View/FirstLevelGuide';
import { LevelRewardPage } from '../View/LevelRewardPage';

const { ccclass, property } = _decorator;

// ======================================== 游戏主场景管理器 ========================================
/**
 * 游戏场景总控管理器（GameScene）。
 * 负责整个 UI 层级树的管理与切换调度：
 * - bomUI：挂载 TabPage、HomePage、GamePage 等主业务页面。
 * - topUI：挂载 LoadingPage、弹窗、顶层遮罩与转场动效。
 */
@ccclass('GameScene')
export class GameScene extends Component {
    // ======================================== 单例模式 ========================================
    private static _instance: GameScene | null = null;
    public static get instance(): GameScene | null {
        return this._instance;
    }

    // ======================================== UI 层级容器引用 ========================================
    @property({ type: Node, tooltip: '底层 UI 容器节点（挂载 TabPage、HomePage 和 GamePage）', group: { name: '层级容器', id: '0' } })
    public bomUI: Node = null!;

    @property({ type: Node, tooltip: '顶层 UI 容器节点（挂载 LoadingPage 和弹窗）', group: { name: '层级容器', id: '0' } })
    public topUI: Node = null!;

    // ======================================== 预制体绑定引用 ========================================
    private tabPagePrefab: Prefab | null = null;

    private homePagePrefab: Prefab | null = null;

    private loadingPagePrefab: Prefab | null = null;

    private gamePagePrefab: Prefab | null = null;

    private _gameResourcesTasks = new Map<number, Promise<void>>();
    private _gameResourceProgress = new Map<number, number[]>();
    private _gameProgressListeners = new Map<number, Set<(ratio: number) => void>>();

    /** 按关共享加载任务，避免下一关误用上一关的“已完成”状态。 */
    public prepareGameResources(onProgress?: (ratio: number) => void): Promise<void> {
        const levelId = GameData.instance.currentLevel || 1;
        const main = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
        if (!main) return Promise.reject(new Error('GameMain unavailable'));
        if (!this._gameResourceProgress.has(levelId)) this._gameResourceProgress.set(levelId, [0, 0]);
        if (!this._gameProgressListeners.has(levelId)) this._gameProgressListeners.set(levelId, new Set());
        const progress = this._gameResourceProgress.get(levelId)!;
        const listeners = this._gameProgressListeners.get(levelId)!;
        if (onProgress) { listeners.add(onProgress); onProgress((progress[0] + progress[1]) / 2); }
        const report = (index: number, ratio: number) => {
            progress[index] = Math.max(progress[index], Math.min(1, ratio));
            listeners.forEach(listener => listener((progress[0] + progress[1]) / 2));
        };
        let task = this._gameResourcesTasks.get(levelId);
        if (!task) {
            const started = Date.now();
            // 延迟到微任务，让同步配置异常也能进入失败处理。
            task = Promise.resolve().then(() => Promise.all([
                new Promise<void>((resolve, reject) => {
                    if (this.gamePagePrefab) { report(0, 1); resolve(); return; }
                    resources.load('Main/Game/View/GamePage', Prefab, (finished, total) => {
                        if (total > 0) report(0, finished / total);
                    }, (err, prefab) => {
                        if (err || !prefab) { reject(err || new Error('GamePage missing')); return; }
                        this.gamePagePrefab = prefab;
                        report(0, 1);
                        resolve();
                    });
                }),
                main.preloadLevelPrefabs(levelId, ratio => report(1, ratio)),
            ])).then(() => {
                console.info('[LoadTiming] Level resources ready', { levelId, ms: Date.now() - started });
            }).catch(err => {
                this._gameResourcesTasks.delete(levelId);
                progress[0] = progress[1] = 0;
                throw err;
            });
            this._gameResourcesTasks.set(levelId, task);
        }
        return task.finally(() => { if (onProgress) listeners.delete(onProgress); });
    }

    /** 首页已显示后准备对局，避免增加首页首次显示的等待。 */
    public warmUpGameResources(): void {
        if (GameData.instance.currentLevel === 1 && !GameData.instance.hasSeenFirstLevelGuide) {
            void FirstLevelGuide.preloadFrames().catch(err => console.warn('[GameScene] Guide preload failed:', err));
        }
        void this.prepareGameResources().catch(err => console.warn('[GameScene] Game preload failed:', err));
        void Audio.preloadGame().catch(err => console.warn('[GameScene] Audio preload failed:', err));
    }

    /** 弹窗首次加载显示等待页，页面创建完成或加载失败都释放。 */
    private loadPopupPrefab(path: string, parent: Node, onReady: (prefab: Prefab) => void): void {
        if (!this.isValid || !parent.isValid) return;
        const cached = resources.get(path, Prefab);
        if (cached) {
            onReady(cached);
            return;
        }
        LoadingWaiting.acquire(parent, () => {
            if (!this.isValid || !parent.isValid) {
                LoadingWaiting.release();
                return;
            }
            resources.load(path, Prefab, (err, prefab) => {
                try {
                    if (!this.isValid || !parent.isValid) return;
                    if (err || !prefab) {
                        console.warn('[GameScene] Popup load failed:', path, err);
                        this.showTipRemind('Loading failed. Please try again.');
                        return;
                    }
                    onReady(prefab);
                } finally {
                    LoadingWaiting.release();
                }
            });
        });
    }

    private victoryPagePrefab: Prefab | null = null;

    private revivePagePrefab: Prefab | null = null;

    private failMovesPagePrefab: Prefab | null = null;

    private failTilesPagePrefab: Prefab | null = null;

    private spinPagePrefab: Prefab | null = null;

    // ======================================== 页面节点实例缓存 ========================================
    /** 实例化的 TabPage 节点实例 */
    public tabPageNode: Node | null = null;
    /** 实例化的 HomePage 节点实例 */
    public homePageNode: Node | null = null;
    /** 实例化的 LoadingPage 节点实例 */
    public loadingPageNode: Node | null = null;
    /** 实例化的 GamePage 节点实例 */
    public gamePageNode: Node | null = null;
    /** 实例化的 VictoryPage 节点实例 */
    public victoryPageNode: Node | null = null;
    /** 实例化的 RevivePage 节点实例 */
    public revivePageNode: Node | null = null;
    /** 实例化的 FailPage 节点实例 */
    public failPageNode: Node | null = null;
    /** 实例化的 SpinPage 节点实例 */
    public spinPageNode: Node | null = null;

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameScene._instance = this;

        // 初始化 NezpKit
        try {
            NezpKit.inst.init({ enableLog: false });
        } catch (e) {
        }

        // 根据宽高比切换适配策略，并监听窗口尺寸变化。
        ScreenAdapter.initGlobalListener();

        // Inspector 未绑定时，按节点名称自动查找层级容器。
        if (!this.bomUI) {
            this.bomUI = this.node.getChildByName('bomUI')!;
        }
        if (!this.topUI) {
            this.topUI = this.node.getChildByName('topUI')!;
        }

        Audio.boot();

        // 监听全局通关和失败事件。
        GameData.event.on('GAME_VICTORY', this.onGameVictory, this);
        GameData.event.on('GAME_FAIL', this.onGameFail, this);
        GameData.event.on(GameDataEvent.REMOVE_ADS_CHANGED, this.onRemoveAdsChanged, this);
    }

    onDestroy() {
        GameData.event.off('GAME_VICTORY', this.onGameVictory, this);
        GameData.event.off('GAME_FAIL', this.onGameFail, this);
        GameData.event.off(GameDataEvent.REMOVE_ADS_CHANGED, this.onRemoveAdsChanged, this);

        if (GameScene._instance === this) {
            GameScene._instance = null;
        }
    }

    private onRemoveAdsChanged(removed: boolean): void {
        if (removed) GameSDK.inst.HideADBanner();
    }

    start() {
        void GameSDK.inst.ShowADBanner();
        // 进入场景默认初始TabPage 大厅(挂载bomUI)
        this.initTabPage();
    }

    // ======================================== 层级获取辅助方法 ========================================
    /**
     * 获取底层 UI 容器 (bomUI)
     */
    public getBomUIParent(): Node {
        if (this.bomUI && this.bomUI.isValid) return this.bomUI;
        const found = this.node.getChildByName('bomUI');
        if (found) {
            this.bomUI = found;
            return found;
        }
        return this.node;
    }

    /**
     * 获取顶层 UI 容器 (topUI)
     */
    public getTopUIParent(): Node {
        if (this.topUI && this.topUI.isValid) return this.topUI;
        const found = this.node.getChildByName('topUI');
        if (found) {
            this.topUI = found;
            return found;
        }
        return this.node;
    }

    /**
     * 弹出全局提示浮窗 (对齐 4095_SniperZone showTipRemind 接口)
     */
    public showTipRemind(text: string, fontSize?: number, duration?: number) {
        Remind.showTipRemind(text, fontSize, duration, this.getTopUIParent());
    }

    // ======================================== 实例化 TabPage（父级: bomUI） ========================================
    /**
     * 初始化并实例化 TabPage，默认挂载到 bomUI。
     * @param doParent 可选的挂载父节点
     * @param callback 实例化完成回调
     */
    public initTabPage(doParent?: Node, callback?: (node: Node) => void) {
        if (this.tabPageNode && this.tabPageNode.isValid) {
            this.tabPageNode.destroy();
            this.tabPageNode = null;
        }

        const targetParent = doParent || this.getBomUIParent();

        // 1. 若属性检查器已直接绑Prefab
        if (this.tabPagePrefab) {
            this.tabPageNode = instantiate(this.tabPagePrefab);
            this.tabPageNode.setParent(targetParent);
            if (callback) callback(this.tabPageNode);
        } else {
            // 2. 否则从 resources/Home/View/TabPage 动态加载。
            resources.load('Main/Home/View/TabPage', Prefab, (err, prefab) => {
                if (err || !prefab) {
                    return;
                }
                this.tabPageNode = instantiate(prefab);
                this.tabPageNode.setParent(targetParent);
                if (callback) callback(this.tabPageNode);
            });
        }
    }

    // ======================================== 实例化 HomePage（父级: bomUI） ========================================
    /**
     * 初始化并实例化 HomePage，默认挂载到 bomUI。
     * @param doParent 可选的挂载父节点
     * @param callback 实例化完成回调
     */
    public initHomePage(doParent?: Node, callback?: (node: Node) => void) {
        if (this.homePageNode && this.homePageNode.isValid) {
            this.homePageNode.destroy();
            this.homePageNode = null;
        }

        const targetParent = doParent || this.getBomUIParent();

        // 1. 若属性检查器已直接绑Prefab
        if (this.homePagePrefab) {
            this.homePageNode = instantiate(this.homePagePrefab);
            this.homePageNode.setParent(targetParent);
            if (callback) callback(this.homePageNode);
        } else {
            // 2. 否则从 resources/Home/View/HomePage 动态加载。
            resources.load('Main/Home/View/HomePage', Prefab, (err, prefab) => {
                if (err || !prefab) {
                    return;
                }
                this.homePageNode = instantiate(prefab);
                this.homePageNode.setParent(targetParent);
                if (callback) callback(this.homePageNode);
            });
        }
    }

    // ======================================== 实例化 GamePage（父级: bomUI） ========================================
    /**
     * 初始化并实例化 GamePage，默认挂载到 bomUI。
     * @param doParent 可选的挂载父节点
     * @param callback 实例化完成回调
     */
    public initGamePage(doParent?: Node, callback?: (node: Node) => void) {
        if (this.gamePageNode && this.gamePageNode.isValid) {
            this.gamePageNode.destroy();
            this.gamePageNode = null;
        }

        const targetParent = doParent || this.getBomUIParent();

        // 1. 若属性检查器已直接绑Prefab
        if (this.gamePagePrefab) {
            this.gamePageNode = instantiate(this.gamePagePrefab);
            this.gamePageNode.setParent(targetParent);
            if (callback) callback(this.gamePageNode);
        } else {
            // 2. 否则从 resources/Game/View/GamePage 动态加载。
            resources.load('Main/Game/View/GamePage', Prefab, (err, prefab) => {
                if (err || !prefab) {
                    return;
                }
                this.gamePageNode = instantiate(prefab);
                this.gamePageNode.setParent(targetParent);
                if (callback) callback(this.gamePageNode);
            });
        }
    }

    // ======================================== 实例化 LoadingPage（父级: topUI） ========================================
    /**
     * 初始化并实例化 LoadingPage，默认挂载到 topUI。
     * @param doParent 可选的挂载父节点
     * @param callback 实例化完成回调
     */
    public initLoadingPage(doParent?: Node, callback?: (node: Node) => void) {
        if (this.loadingPageNode && this.loadingPageNode.isValid) {
            this.loadingPageNode.destroy();
            this.loadingPageNode = null;
        }

        const targetParent = doParent || this.getTopUIParent();

        // 1. 若属性检查器已直接绑Prefab
        if (this.loadingPagePrefab) {
            this.loadingPageNode = instantiate(this.loadingPagePrefab);
            this.loadingPageNode.setParent(targetParent);
            if (callback) callback(this.loadingPageNode);
        } else {
            // 2. 否则从 resources/Public/View/LoadingPage 动态加载。
            resources.load('Public/View/LoadingPage', Prefab, (err, prefab) => {
                if (err || !prefab) {
                    return;
                }
                this.loadingPageNode = instantiate(prefab);
                this.loadingPageNode.setParent(targetParent);
                if (callback) callback(this.loadingPageNode);
            });
        }
    }

    // ======================================== 实例化 VictoryPage（父级: topUI） ========================================
    /**
     * 初始化并弹出 VictoryPage 胜利结算页面 (挂载topUI)
     * @param completedLevelId 通关关卡ID
     * @param score 本关得分
     * @param doParent 可选的挂载父节点，默认挂载到 topUI
     * @param callback 实例化完成回调
     */
    public initVictoryPage(completedLevelId?: number, score?: number, doParent?: Node, callback?: (node: Node) => void) {
        if (this.victoryPageNode && this.victoryPageNode.isValid) {
            this.victoryPageNode.destroy();
            this.victoryPageNode = null;
        }

        const targetParent = doParent || this.getTopUIParent();

        const onNodeReady = (node: Node) => {
            this.victoryPageNode = node;
            let vp = node.getComponent(VictoryPage);
            if (!vp) {
                vp = node.addComponent(VictoryPage);
            }
            if (completedLevelId !== undefined) {
                const finalScore = score !== undefined ? score : (GameMain.instance ? GameMain.instance.levelScore : 0);
                vp.show(completedLevelId, finalScore);
            }
            if (callback) callback(node);
        };

        if (this.victoryPagePrefab) {
            const node = instantiate(this.victoryPagePrefab);
            node.setParent(targetParent);
            onNodeReady(node);
        } else {
            this.loadPopupPrefab('Main/Game/View/VictoryPage', targetParent, (prefab) => {
                const node = instantiate(prefab);
                node.setParent(targetParent);
                onNodeReady(node);
            });
        }
    }

    /**
     * 响应通关胜利事件
     * @param completedLevelId 通关的关卡ID
     */
    private onGameVictory(completedLevelId: number) {
        const score = GameMain.instance ? GameMain.instance.levelScore : 0;
        GameSDK.inst.ShowADChaping('victoryPage').then(() => {
            if (!this.isValid) return;
            const showVictory = () => {
                if (this.isValid) this.initVictoryPage(completedLevelId, score);
            };
            if (LevelRewardPage.hasClaimable()) {
                LevelRewardPage.show(this.getTopUIParent(), showVictory);
            } else {
                showVictory();
            }
        });
    }

    // ======================================== 实例化 RevivePage（父级: topUI） ========================================
    /**
     * 初始化并弹出 RevivePage 复活加步数弹(挂载topUI)
     */
    public initRevivePage(movesToAdd: number = 5, coinPrice: number = 300, doParent?: Node, callback?: (node: Node) => void) {
        if (this.revivePageNode && this.revivePageNode.isValid) {
            this.revivePageNode.destroy();
            this.revivePageNode = null;
        }

        const targetParent = doParent || this.getTopUIParent();

        const onNodeReady = (node: Node) => {
            this.revivePageNode = node;
            let rp = node.getComponent(RevivePage);
            if (!rp) {
                rp = node.addComponent(RevivePage);
            }
            rp.show(movesToAdd, coinPrice);
            if (callback) callback(node);
        };

        if (this.revivePagePrefab) {
            const node = instantiate(this.revivePagePrefab);
            node.setParent(targetParent);
            onNodeReady(node);
        } else {
            this.loadPopupPrefab('Main/Game/View/RevivePage', targetParent, (prefab) => {
                const node = instantiate(prefab);
                node.setParent(targetParent);
                onNodeReady(node);
            });
        }
    }

    // ======================================== 实例化 FailPage（父级: topUI） ========================================
    /**
     * 初始化并弹出 FailPage 关卡失败弹窗 (挂载topUI)
     * @param failType 失败类型NO_MOVES' (步数耗尽) 'NO_TILES' (无方块可移动)
     */
    public initFailPage(failType: 'NO_MOVES' | 'NO_TILES' = 'NO_MOVES', doParent?: Node, callback?: (node: Node) => void) {
        GameMain.instance?.reportFinalFailure();
        if (this.failPageNode && this.failPageNode.isValid) {
            this.failPageNode.destroy();
            this.failPageNode = null;
        }

        const targetParent = doParent || this.getTopUIParent();
        const isTilesBlocked = failType === 'NO_TILES';
        const prefabToUse = isTilesBlocked ? this.failTilesPagePrefab : this.failMovesPagePrefab;
        const prefabPath = isTilesBlocked ? 'Main/Game/View/FailTilesPage' : 'Main/Game/View/FailMovesPage';

        const onNodeReady = (node: Node) => {
            this.failPageNode = node;
            let fp = node.getComponent(FailPage);
            if (!fp) {
                fp = node.addComponent(FailPage);
            }
            fp.show();
            if (callback) callback(node);
        };

        if (prefabToUse) {
            const node = instantiate(prefabToUse);
            node.setParent(targetParent);
            onNodeReady(node);
        } else {
            this.loadPopupPrefab(prefabPath, targetParent, (prefab) => {
                const node = instantiate(prefab);
                node.setParent(targetParent);
                onNodeReady(node);
            });
        }
    }

    /**
     * 响应关卡失败事件
     */
    private onGameFail(levelId: number) {
        if (GameMain.instance?.hasRevived) {
            this.initFailPage('NO_MOVES');
            return;
        }
        GameSDK.inst.ShowADChaping('revivePage').then(() => {
            if (!this.isValid) return;
            this.initRevivePage(5, 300);
        });
    }

    // ======================================== 实例化 SpinPage（父级: topUI） ========================================
    /**
     * 初始化并弹出 SpinPage 幸运转盘页面 (挂载 topUI)
     * @param doParent 可选的挂载父节点，默认挂载到 topUI
     * @param callback 实例化完成回调
     */
    public initSpinPage(doParent?: Node, callback?: (node: Node) => void) {
        if (this.spinPageNode && this.spinPageNode.isValid) {
            if (callback) callback(this.spinPageNode);
            return;
        }

        SpinPage.show(doParent, (page) => {
            if (callback) callback(page.node);
        });
    }

    // ======================================== 实例化 ChampionshipPage（锦标赛） ========================================
    /**
     * 初始化并弹出 ChampionshipPage 锦标赛页面
     */
    public initChampionshipPage(doParent?: Node) {
        ChampionshipPage.show(doParent || this.getTopUIParent());
    }

    // ======================================== 业务流程快速调========================================
    /**
     * 响应开始游戏指令：弹出 LoadingPage (LoadingPage 内部流水线执行销TabPage -> 载入 Game 资源 -> 打开 GamePage)
     */
    public startGame() {
        if (this.loadingPageNode?.isValid) return;
        this.initLoadingPage();
    }

    /**
     * 响应从游戏关卡返回大厅主页的指令。
     */
    public backToHome() {

        // 重置锦标赛状态
        if (GameData.instance) {
            GameData.instance.isJoinTournament = false;
            GameData.instance.currentTournament = null;
        }

        // GameMain 挂在场景根的 GameManager 上，与 Canvas 上的 GameScene 是同级，不能从本节点向下找。
        const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
        gameMain?.clearBoard();

        this.destroyPageNode(this.gamePageNode);
        this.gamePageNode = null;
        this.destroyPageNode(this.loadingPageNode);
        this.loadingPageNode = null;
        this.destroyPageNode(this.victoryPageNode);
        this.victoryPageNode = null;
        this.destroyPageNode(this.revivePageNode);
        this.revivePageNode = null;
        this.destroyPageNode(this.failPageNode);
        this.failPageNode = null;

        this.initTabPage();
    }

    private destroyPageNode(node: Node | null) {
        if (node && node.isValid) node.destroy();
    }
}
