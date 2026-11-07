import { GameSDK } from '../../sdk/GameSDK';
import { _decorator, Component, Node, Camera, Prefab, instantiate, TextAsset, Material, MeshRenderer, Vec3, Rect, view, Input, input, EventTouch, geometry, PhysicsSystem, resources, Tween } from 'cc';
import { LevelManager, LevelData, LevelBlockData } from './LevelManager';
import { HexMath } from './HexMath';
import { HexBlock, BlockState } from './HexBlock';
import { HexGridManager } from './HexGridManager';
import { PropsManager } from './PropsManager';
import { BrokenParticle } from './BrokenParticle';
import { RotarySwitch } from './Special/RotarySwitch';
import { StopBlock } from './Special/StopBlock';
import { IceBlock } from './Special/IceBlock';
import { StoneBlock } from './Special/StoneBlock';
import { TntBlock } from './Special/TntBlock';
import { TurnBlock } from './Special/TurnBlock';
import { GearBlock } from './Special/GearBlock';
import { BrokenBlock } from './Special/BrokenBlock';
import { Telescopic } from './Special/Telescopic';
import { MysteryBlock } from './Special/MysteryBlock';
import { MultiLayerBlock } from './Special/MultiLayerBlock';
import { GoPauseBlock } from './Special/GoPauseBlock';
import { RocketBombBlock } from './Special/RocketBombBlock';
import { RandomTurnBlock } from './Special/RandomTurnBlock';
import { GamePage } from '../View/GamePage';
import { FirstLevelGuide } from '../View/FirstLevelGuide';
import { GameData } from '../Config/GameData';
import { GameScene } from '../Scene/GameScene';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

/**
 * 游戏核心状态机枚举
 */
export enum GameState {
    /** 准备或渲染中 */
    READY = 0,
    /** 正常游戏中 */
    PLAYING = 1,
    /** 关卡胜利结算中（防止重复结算） */
    VICTORY = 2,
    /** 关卡失败结算中（防止重复结算） */
    FAIL = 3,
    /** 暂停 */
    PAUSE = 4,
}

// ======================================== 游戏核心控制与渲染管理 ========================================
/**
 * 游戏主控制器组件
 * 负责场景渲染、关卡加载、触控拾取、方块翻滚调度、相机自适应与胜负结算。
 */
@ccclass('GameMain')
export class GameMain extends Component {
    // ======================================== 核心引用配置 ========================================
    @property({ type: Camera, tooltip: '主摄像机组件（用于 3D 自适应视野与射线拾取）', group: { name: '核心引用', id: '0' } })
    public mainCamera: Camera = null!;

    @property({ type: Node, tooltip: '关卡网格容器节点（用于挂载所有生成的六边形节点）', group: { name: '节点引用', id: '1' } })
    public gridContainer: Node = null!;

    @property({ type: Prefab, tooltip: '六边形方块预制体 (HexBlock.prefab，用于彩色方块)', group: { name: '预制体', id: '2' } })
    public hexBlockPrefab: Prefab = null!;

    @property({ type: Prefab, tooltip: '六边形底座专用预制体 (Floor.prefab)', group: { name: '预制体', id: '2' } })
    public floorPrefab: Prefab = null!;

    @property({ type: TextAsset, tooltip: '关卡 CSV 配置文件 (GameConfig.csv)', group: { name: '关卡配置', id: '3' } })
    public levelConfigCsv: TextAsset = null!;

    // ======================================== 核心材质映射配置 ========================================
    @property({ type: [Material], tooltip: '方向材质数组（索引 0~5 对应方向 1~6）', group: { name: '材质配置', id: '4' } })
    public colorMaterials: Material[] = [];

    @property({ type: Material, tooltip: '底座凹槽材质 (ColorFloor)', group: { name: '材质配置', id: '4' } })
    public floorMaterial: Material | null = null;

    // ======================================== 几何与动力学动画参数 ========================================
    @property({ tooltip: '六边形外接圆半径 (默认 0.35m)', group: { name: '布局参数', id: '5' } })
    public hexRadius: number = 0.35;

    @property({ tooltip: '每个槽位垂直堆叠的方块层数（默认 3 层）', group: { name: '堆叠参数', id: '6' } })
    public stackLayersPerSlot: number = 3;

    @property({ tooltip: '单层方块的高度（Y 轴偏移，默认 0.08m）', group: { name: '堆叠参数', id: '6' } })
    public layerHeight: number = 0.08;

    @property({ tooltip: '最底层方块的 Y 轴初始高度（默认 0.06m）', group: { name: '堆叠参数', id: '6' } })
    public blockBasePosY: number = 0.06;

    @property({ tooltip: '底座凹槽的 Y 轴高度（默认 0.0m）', group: { name: '堆叠参数', id: '6' } })
    public slotPosY: number = 0.0;

    @property({ tooltip: '方块模型的三维缩放（默认 1, 1, 1）', group: { name: '缩放参数', id: '7' } })
    public blockScale: Vec3 = new Vec3(1, 1, 1);

    @property({ tooltip: '底座凹槽的三维缩放（默认 1, 1, 1）', group: { name: '缩放参数', id: '7' } })
    public slotScale: Vec3 = new Vec3(1, 1, 1);

    @property({ tooltip: '单格 180° 翻滚耗时 (秒，默认 0.16s)', group: { name: '动画参数', id: '8' } })
    public rollStepDuration: number = 0.16;

    @property({ tooltip: '堆叠层之间启动翻滚的时间间隔（默认 0.04s）', group: { name: '动画参数', id: '8' } })
    public layerRollInterval: number = 0.04;

    // ======================================== 3D 自适应相机与视野参数 ========================================
    @property({ tooltip: '相机视场角 FOV（推荐 35°）', group: { name: '相机参数', id: '9' } })
    public cameraFov: number = 35;

    @property({ tooltip: '相机俯角角度 (70° 深度俯视视角，六边形极正，仅下边沿露立体厚度)', group: { name: '相机参数', id: '9' } })
    public cameraPitchAngle: number = 70;

    @property({ tooltip: '屏幕纵向对焦点偏移（用于避开顶部与底部 UI）', group: { name: '相机参数', id: '9' } })
    public cameraTargetOffsetZ: number = 0;

    // ======================================== 单例与内部状态管理 ========================================
    private static _instance: GameMain | null = null;
    public static get instance(): GameMain | null {
        return this._instance;
    }

    // ======================================== 运行时核心数据状态 ========================================
    @property({ tooltip: '当前关卡编号 ID', group: { name: '关卡配置', id: '3' } })
    public currentLevelId: number = 1;
    /** 全局唯一递增方块 ID 计数器 */
    public nextBlockId: number = 1;
    /** 关卡当前剩余可用操作步数 */
    public remainingSteps: number = 30;
    /** 本次关卡是否已经成功复活，重新开始关卡时重置。 */
    private _hasRevived: boolean = false;
    private _analyticsStartedAt = 0;
    private _analyticsPreviousLevel = 0;
    private _analyticsFinished = false;
    private _analyticsFrames = 0;
    private _analyticsFrameSeconds = 0;
    private _analyticsFpsReported = false;
    public get hasRevived(): boolean {
        return this._hasRevived;
    }

    /** 关卡几何中心与居中偏移坐标 */
    public currentCenterX: number = 0;
    public currentCenterZ: number = 0;

    /** 网格空间与逻辑管理器引用 */
    public hexGridManager: HexGridManager = null!;

    /** 道具管理器引用 */
    public propsManager: PropsManager = null!;

    /** 屏幕拾取射线对象复用 */
    private _ray: geometry.Ray = new geometry.Ray();

    /** 是否处于可操作的游戏状态 */
    public isPlaying: boolean = true;

    /** 当前游戏运行状态（用于状态机与防重锁） */
    public gameState: GameState = GameState.PLAYING;

    /** 当前场上激活的旋转连杆特殊机关列表 */
    private _rotarySwitches: RotarySwitch[] = [];

    /** 当前场上激活的计数冰封锁列表（Special_3_202） */
    private _iceBlocks: IceBlock[] = [];

    /** 当前场上激活的 4_StoneBlock 障碍石块列表 (Special_4_102) */
    private _obstacleBlocks: StoneBlock[] = [];

    /** 当前场上激活的 TNT 炸弹列表 (Special_5_201) */
    private _tntBlocks: TntBlock[] = [];

    /** 当前场上激活的导向转向板列表（Special_6_601~606） */
    private _redirectPads: TurnBlock[] = [];

    /** 当前场上激活的旋转锯齿粉碎机列表（Special_7_701） */
    private _sawBlocks: GearBlock[] = [];

    /** 当前场上激活的 8_BrokenBlock 易碎崩塌地块列表 (Special_8_801) */
    private _brokenBlocks: BrokenBlock[] = [];

    /** 当前场上激活的升降伸缩柱列表（Special_9_901） */
    private _telescopicBlocks: Telescopic[] = [];

    /** 当前场上激活的 10_MysteryBlock 神秘盲盒列表 (Special_10_1001) */
    private _mysteryBlocks: MysteryBlock[] = [];

    /** 当前场上激活的 11_MultiLayerBlock 多向层叠方块列表 (Special_11_1101) */
    private _multiLayerBlocks: MultiLayerBlock[] = [];

    /** 当前场上激活的 12_GoPauseBlock 前进撞击暂停方块列表 (Special_12_1201) */
    private _goPauseBlocks: GoPauseBlock[] = [];

    /** 当前场上激活的 15_RocketBombBlock 火箭炸药方块列表 (Special_15_1501) */
    private _rocketBombBlocks: RocketBombBlock[] = [];

    /** 当前场上激活的双向交替分流转向板列表（Special_17_1701） */
    private _randomTurnBlocks: RandomTurnBlock[] = [];

    // ======================================== 积分与连击系统 (Combo) ========================================
    /** 当前关卡累计得分 */
    public levelScore: number = 0;
    /** 当前连击次数 (>= 2 为连击状态) */
    public currentCombo: number = 0;
    /** 上一次消除方块的时间戳 (秒) */
    private _lastClearTime: number = 0;
    /** 连击有效倒计时 (秒，默认 5s) */
    public static readonly COMBO_DURATION: number = 5.0;
    /** 飞分批次自增序号 */
    private _nextFallScoreBatchId: number = 1;
    /** 已经生成过飞分的批次，避免同柱多块重复飞分 */
    private _spawnedFallScoreBatches: Set<string> = new Set();

    /** 动态加载的特殊机关与底座预制体缓存，键为预制体名称 */
    private _specialPrefabMap: Map<string, Prefab> = new Map();

    /**
     * 获取已动态加载的特殊机关预制体。
     * @param key 预制体文件名，例如 `Special_1_401`
     */
    public getSpecialPrefab(key: string): Prefab | null {
        return this._specialPrefabMap.get(key) || null;
    }

    private _specialPrefabTasks = new Map<string, Promise<void>>();

    /** 与 renderColoredBlocks 的类型分支保持一致；只取当前关需要的机关。 */
    public getLevelPrefabPaths(levelId: number): string[] {
        if (!this.levelConfigCsv || !LevelManager.instance.parseCsvAsset(this.levelConfigCsv)) {
            throw new Error('Level configuration unavailable');
        }
        const level = LevelManager.instance.getLevel(levelId);
        if (!level) throw new Error('Level unavailable: ' + levelId);
        const names = new Set<string>(['Floor']);
        const exact: Record<number, string> = {
            101: 'Special_2_101', 102: 'Special_4_102', 202: 'Special_3_202',
            301: 'Special_5_301', 701: 'Special_7_701', 801: 'Special_8_801',
            901: 'Special_9_901', 1001: 'Special_10_1001', 1101: 'Special_11_1101',
            1701: 'Special_17_1701',
        };
        for (const block of level.blocks) {
            const type = block.specialType !== undefined ? block.specialType : block.dir;
            let name = exact[type];
            if (type >= 401 && type <= 403) name = 'Special_1_401';
            else if (type >= 501 && type <= 503) name = 'Special_1_402';
            else if (type >= 601 && type <= 606) name = 'Special_6_601';
            else if (type >= 1201 && type <= 1206) name = 'Special_12_1201';
            else if (type >= 1501 && type <= 1506) name = 'Special_15_1501';
            if (name) names.add(name);
        }
        return Array.from(names, name => 'Main/Game/Map/' + name);
    }

    /** 大厅预热与进关共用逐资源任务；失败后允许重试。依赖由预制体自动带入。 */
    public preloadLevelPrefabs(levelId: number, onProgress?: (ratio: number) => void): Promise<void> {
        const paths = this.getLevelPrefabPaths(levelId);
        let finished = 0;
        onProgress?.(0);
        return Promise.all(paths.map(path => {
            const key = path.split('/').pop()!;
            let task = this._specialPrefabTasks.get(key);
            if (this._specialPrefabMap.has(key)) task = Promise.resolve();
            if (!task) {
                task = new Promise<void>((resolve, reject) => {
                    resources.load(path, Prefab, (err, prefab) => {
                        if (err || !prefab) { reject(err || new Error('Missing prefab: ' + path)); return; }
                        this._specialPrefabMap.set(key, prefab);
                        if (key === 'Floor' && !this.floorPrefab) this.floorPrefab = prefab;
                        resolve();
                    });
                }).catch(err => { this._specialPrefabTasks.delete(key); throw err; });
                this._specialPrefabTasks.set(key, task);
            }
            return task.then(() => { onProgress?.(++finished / paths.length); });
        })).then(() => {});
    }

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameMain._instance = this;
        (window as any).gameMain = this;
        (window as any).GameMain = GameMain;

        // 获取或自动挂HexGridManager 网格管理器组(双重保障)
        this.hexGridManager = this.getComponent(HexGridManager) || this.addComponent(HexGridManager);

        // 获取或自动挂PropsManager 道具管理组件 (双重保障)
        this.propsManager = this.getComponent(PropsManager) || this.addComponent(PropsManager);

        // 注册全局触控拾取监听
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);

        // 方块开始掉落时生成飞分
        HexBlock.onStartFalling = (block, worldPos) => {
            this.onBlockStartFalling(block, worldPos);
        };
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        if (HexBlock.onStartFalling) {
            HexBlock.onStartFalling = null;
        }

        if (GameMain._instance === this) {
            GameMain._instance = null;
        }
    }

    // ======================================== 关卡初始化与场景渲染 ========================================
    /**
     * 初始化关卡系统并渲染指定关卡
     * @param levelId 关卡编号 (默认为配置中currentLevelId)
     * @param onProgress 渲染进度回调 (0.0 ~ 1.0)
     * @param onComplete 渲染完成回调
     */
    public async initLevelSystem(levelId: number = this.currentLevelId, onProgress?: (progress: number) => void, onComplete?: () => void) {
        // 1. 解析关卡 CSV 配置文件
        if (this.levelConfigCsv) {
            LevelManager.instance.parseCsvAsset(this.levelConfigCsv);
        } else {
            if (onComplete) onComplete();
            return;
        }

        // 2. 只等待当前关需要的特殊预制体
        await this.preloadLevelPrefabs(levelId);

        // 3. 渲染指定关卡
        this.renderLevel(levelId, onProgress, onComplete);
    }

    /**
     * 销毁当前关卡的棋盘节点、逻辑数据和进行中的动画。
     * 返回首页与重开下一关前都走这里，避免方块残留在大厅背景上。
     */
    public clearBoard() {
        this.getComponent(FirstLevelGuide)?.hide();
        this.isPlaying = false;
        this.gameState = GameState.READY;
        this.unscheduleAllCallbacks();

        if (this.propsManager) {
            this.propsManager.forceIdle();
        }

        if (this.gridContainer && this.gridContainer.isValid) {
            this.stopNodeActivity(this.gridContainer);
            const children = this.gridContainer.children.slice();
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (child && child.isValid) child.destroy();
            }
            this.gridContainer.active = false;
        }

        if (this.hexGridManager) {
            this.hexGridManager.clearGrid();
        }

        this._rotarySwitches = [];
        this._iceBlocks = [];
        this._obstacleBlocks = [];
        this._tntBlocks = [];
        this._redirectPads = [];
        this._sawBlocks = [];
        this._brokenBlocks = [];
        this._telescopicBlocks = [];
        this._mysteryBlocks = [];
        this._multiLayerBlocks = [];
        this._goPauseBlocks = [];
        this._rocketBombBlocks = [];
        this._randomTurnBlocks = [];

        this.levelScore = 0;
        this.currentCombo = 0;
        this._lastClearTime = 0;
        this._spawnedFallScoreBatches.clear();
    }

    /** 停掉节点树上的补间和定时器，避免销毁当帧又生成新方块。 */
    private stopNodeActivity(node: Node) {
        Tween.stopAllByTarget(node);
        const comps = node.components;
        for (let i = 0; i < comps.length; i++) {
            comps[i].unscheduleAllCallbacks();
        }
        const children = node.children;
        for (let i = 0; i < children.length; i++) {
            this.stopNodeActivity(children[i]);
        }
    }

    /**
     * 渲染指定关卡的所有底座槽位与彩色方块
     * @param levelId 关卡编号 (1 ~ 500)
     * @param onProgress 渲染进度回调
     * @param onComplete 渲染完成回调
     */
    public renderLevel(levelId: number, onProgress?: (progress: number) => void, onComplete?: () => void) {
        // 下一关、跳关和重试也走资源就绪检查，不能依赖曾经整目录预载的缓存。
        const missing = this.getLevelPrefabPaths(levelId).some(path => !this._specialPrefabMap.has(path.split('/').pop()!));
        if (missing) {
            const scene = GameScene.instance;
            if (scene) {
                this.currentLevelId = levelId;
                GameData.instance.currentLevel = levelId;
                this.isPlaying = false;
                scene.startGame();
            } else {
                void this.initLevelSystem(levelId, onProgress, onComplete).catch(err => console.error('[LoadTiming] Level failed:', err));
            }
            return;
        }
        const renderStarted = Date.now();

        if (!this.hexBlockPrefab || !this.gridContainer) {
            if (onComplete) onComplete();
            return;
        }

        const levelData = LevelManager.instance.getLevel(levelId);
        if (!levelData) {
            if (onComplete) onComplete();
            return;
        }


        // 1. 清空旧网格节点与数据，再重新显示棋盘容器
        this.clearBoard();
        if (this.gridContainer && this.gridContainer.isValid) {
            this.gridContainer.active = true;
        }

        this.currentLevelId = levelId;
        GameData.instance.currentLevel = levelId;
        if (GamePage.instance) {
            GamePage.instance.updateLevelDisplay(levelId);
        }

        // 积分与连击状态重置 (本关得分从 0 开始)
        this.levelScore = 0;
        this.currentCombo = 0;
        this._lastClearTime = 0;
        this._spawnedFallScoreBatches.clear();
        this.unschedule(this._resetComboTimeout);
        if (GamePage.instance) {
            GamePage.instance.updateScoreDisplay(0);
            GamePage.instance.hideCombo();
        }

        this.remainingSteps = levelData.step;
        this._hasRevived = false;
        this.gameState = GameState.PLAYING;
        this.isPlaying = true;
        this.notifyStepsChanged();

        // 2. 计算关卡几何中心，确保棋盘居中
        const { centerX, centerZ, spanX, spanZ } = this.calculateLevelCenter(levelData);
        this.currentCenterX = centerX;
        this.currentCenterZ = centerZ;

        // 3. 自适应调整相机视距与安全留
        this.adjustCameraView(spanX, spanZ);

        // 4. 统计总渲染元素数
        const totalItems = levelData.slots.length + levelData.blocks.length * this.stackLayersPerSlot;
        let spawnedCount = 0;

        const reportProgress = () => {
            spawnedCount++;
            if (onProgress && totalItems > 0) {
                onProgress(Math.min(1.0, spawnedCount / totalItems));
            }
        };

        // 收集自带专属底座的机关槽位，避免重复生成普通底座；TNT 仍使用普通底座。
        const specialSlotSet = new Set<string>();
        const stopSlotSet = new Set<string>();
        levelData.blocks.forEach(b => {
            const rawType = (b.specialType !== undefined) ? b.specialType : b.dir;
            if (rawType === 101 || rawType === 401 || rawType === 402 || rawType === 403 || (rawType >= 601 && rawType <= 606) || rawType === 801 || rawType === 901 || rawType === 1101 || rawType === 1701) {
                specialSlotSet.add(`${b.r}_${b.c}`);
            }
            if (rawType === 101) {
                stopSlotSet.add(`${b.r}_${b.c}`);
            }
        });

        // 汇总所slots blocks 的底座槽位，确保每一个方块与 TNT 底下都有完整底座
        const allSlotCoordsMap = new Map<string, { r: number; c: number }>();
        levelData.slots.forEach(s => allSlotCoordsMap.set(`${s.r}_${s.c}`, { r: s.r, c: s.c }));
        levelData.blocks.forEach(b => {
            if (!allSlotCoordsMap.has(`${b.r}_${b.c}`)) {
                allSlotCoordsMap.set(`${b.r}_${b.c}`, { r: b.r, c: b.c });
            }
        });
        const combinedSlots = Array.from(allSlotCoordsMap.values());

        // 5. 渲染底座凹槽 (特殊自带底座机关槽位自动跳过普通底座，TNT正常生成底座)
        this.renderSlots(combinedSlots, specialSlotSet, stopSlotSet, centerX, centerZ, reportProgress);

        // 6. 渲染所有彩色方块与特殊机关
        this.renderColoredBlocks(levelData.blocks, centerX, centerZ, reportProgress);

        if (levelId === 1) {
            const firstLevelGuide = this.getComponent(FirstLevelGuide) || this.addComponent(FirstLevelGuide);
            firstLevelGuide.prepare(levelId, this.gridContainer, this.hexGridManager, this.mainCamera);
        }

        const entrance = this._analyticsPreviousLevel === levelId ? 'retry' : this._analyticsPreviousLevel ? 'next_level' : 'enter';
        this._analyticsPreviousLevel = levelId;
        this._analyticsStartedAt = Date.now();
        this._analyticsFinished = false;
        this._analyticsFrames = 0;
        this._analyticsFrameSeconds = 0;
        this._analyticsFpsReported = false;
        GameSDK.inst.logEvent('startLevel', { level: levelId, value: levelId, entrance });
        console.info('[LoadTiming] Board nodes ready', { levelId, ms: Date.now() - renderStarted });
        if (onComplete) {
            onComplete();
        }

        if (GamePage.instance && !GameScene.instance?.loadingPageNode?.isValid) {
            GamePage.instance.tryShowSpecialMapGuides(levelData.blocks);
        }
    }

    /**
     * 渲染关卡的所有灰色底座凹槽。
     */
    private renderSlots(
        slots: { r: number; c: number }[],
        specialSlotSet: Set<string>,
        stopSlotSet: Set<string>,
        centerX: number,
        centerZ: number,
        onItemSpawned?: () => void
    ) {
        const prefabToUse = this.floorPrefab || this.hexBlockPrefab;

        slots.forEach(slot => {
            // 注册到底座网格管理器中，用于出界下落判定
            if (this.hexGridManager) {
                this.hexGridManager.registerSlot(slot.r, slot.c);
            }

            // 特殊机关自带专属底座，无需重复生成普通灰色底座。
            if (specialSlotSet.has(`${slot.r}_${slot.c}`)) {
                // 如果101 停车位，预先生成普通底座作为备用并默认隐藏，供随旋转道具移走时显现
                if (stopSlotSet && stopSlotSet.has(`${slot.r}_${slot.c}`)) {
                    const worldPos = HexMath.hexToWorld(slot.r, slot.c, 0, this.hexRadius);
                    const slotNode = instantiate(prefabToUse);
                    slotNode.name = `Slot_${slot.r}_${slot.c}`;
                    slotNode.setParent(this.gridContainer);

                    slotNode.setPosition(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    slotNode.setRotationFromEuler(0, 0, 0);
                    slotNode.setScale(this.floorPrefab ? Vec3.ONE : this.slotScale);

                    const arrow = slotNode.getChildByName('Arrow');
                    if (arrow) {
                        arrow.active = false;
                    }

                    if (this.floorMaterial) {
                        const renderers = slotNode.getComponentsInChildren(MeshRenderer);
                        renderers.forEach(mr => mr.setMaterial(this.floorMaterial!, 0));
                    }

                    const hexBlockComp = slotNode.getComponent(HexBlock);
                    if (hexBlockComp) {
                        hexBlockComp.destroy();
                    }

                    slotNode.active = false; // 初始隐藏，槽位上StopBlock 呈现专属底座
                }

                if (onItemSpawned) onItemSpawned();
                return;
            }

            const worldPos = HexMath.hexToWorld(slot.r, slot.c, 0, this.hexRadius);
            const slotNode = instantiate(prefabToUse);
            slotNode.name = `Slot_${slot.r}_${slot.c}`;
            slotNode.setParent(this.gridContainer);

            // 居中偏移定位，Y 轴置slotPosY
            slotNode.setPosition(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
            slotNode.setRotationFromEuler(0, 0, 0);

            // 若使用新版专用底座预制体 Floor.prefab，使用自身标准比(1, 1, 1)，否则兼容旧slotScale
            slotNode.setScale(this.floorPrefab ? Vec3.ONE : this.slotScale);

            // 底座凹槽：隐藏可能存在的箭头子节(兼容旧版 HexBlock)
            const arrow = slotNode.getChildByName('Arrow');
            if (arrow) {
                arrow.active = false;
            }

            // 替换/应用底座专用材质 (ColorFloor)
            if (this.floorMaterial) {
                const renderers = slotNode.getComponentsInChildren(MeshRenderer);
                renderers.forEach(mr => mr.setMaterial(this.floorMaterial!, 0));
            }

            // 移除底座上的 HexBlock 组件，避免射线拾取将底座误识别为方块。
            const hexBlockComp = slotNode.getComponent(HexBlock);
            if (hexBlockComp) {
                hexBlockComp.destroy();
            }

            if (onItemSpawned) onItemSpawned();
        });
    }

    /**
     * 渲染所有上层彩色方块与特殊机关
     */
    private renderColoredBlocks(
        blocks: LevelBlockData[],
        centerX: number,
        centerZ: number,
        onItemSpawned?: () => void
    ) {
        let blockIdCounter = 1;
        this.nextBlockId = 1;

        // 收集所有独占槽位的特殊机关坐标 (101 停车 102 障碍石块, 301 TNT炸弹, 401~403 旋转转盘, 601~606 转向 701 旋转锯齿 801 易碎泥土地块, 901 升降伸缩 1101 多层方块)
        // 独占机关占据整个槽位，过滤同坐标下的普通彩色方块。
        const exclusiveSpecialSlotSet = new Set<string>();
        blocks.forEach(b => {
            const rawType = (b.specialType !== undefined) ? b.specialType : b.dir;
            if (rawType === 101 || rawType === 102 || rawType === 301 || (rawType >= 401 && rawType <= 403) || (rawType >= 501 && rawType <= 503) || (rawType >= 601 && rawType <= 606) || rawType === 701 || rawType === 801 || rawType === 901 || rawType === 1101 || (rawType >= 1201 && rawType <= 1206) || (rawType >= 1501 && rawType <= 1506) || rawType === 1701) {
                exclusiveSpecialSlotSet.add(`${b.r}_${b.c}`);
            }
        });

        // 保证基础彩色方块1001 神秘盲盒覆盖层之前生成，确保盲盒能准确获取并覆盖底层方块
        const spawnList = [...blocks].sort((a, b) => (a.specialType === 1001 ? 1 : 0) - (b.specialType === 1001 ? 1 : 0));

        spawnList.forEach((item) => {
            const rawType = (item.specialType !== undefined) ? item.specialType : item.dir;
            const isSpecial = (item.specialType !== undefined && item.specialType >= 100);

            // 如果该槽位已被独占机关占据，而当前项为普通彩色方-> 自动过滤跳过
            if (!isSpecial && exclusiveSpecialSlotSet.has(`${item.r}_${item.c}`)) {
                return;
            }

            // 旋转连杆机关判定01~403 (双端180°) 501~503 (三端120°)
            const isRotarySwitch = (rawType >= 401 && rawType <= 403) || (rawType >= 501 && rawType <= 503);

            if (isRotarySwitch) {
                const switchType = rawType;
                let switchPrefab: any = null;
                if (switchType >= 401 && switchType <= 403) {
                    // 401~403: 双端直连-> 加载 Special_1_401
                    switchPrefab = this.getSpecialPrefab('Special_1_401');
                } else if (switchType >= 501 && switchType <= 503) {
                    // 501~503: 三叉星型连杆 -> 加载 Special_1_402
                    switchPrefab = this.getSpecialPrefab('Special_1_402');
                }
                if (!switchPrefab) {
                    switchPrefab = this.getSpecialPrefab(`Special_1_${switchType}`) || this.getSpecialPrefab('Special_1_401') || this.hexBlockPrefab;
                }

                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const switchNode = instantiate(switchPrefab);
                switchNode.name = `RotarySwitch_${switchType}_${item.r}_${item.c}`;
                switchNode.setParent(this.gridContainer);

                const switchPos = new Vec3(worldPos.x - centerX, this.slotPosY + 0.02, worldPos.z - centerZ);
                switchNode.setPosition(switchPos);
                switchNode.setScale(Vec3.ONE);

                // 初始RotarySwitch 组件 (优先使用预制体挂载组件，缺失时自动补
                const rotaryComp = switchNode.getComponent(RotarySwitch) || switchNode.addComponent(RotarySwitch);
                rotaryComp.initSwitch({ r: item.r, c: item.c }, switchType);
                this._rotarySwitches.push(rotaryComp);

                if (this.hexGridManager) {
                    this.hexGridManager.registerSlot(item.r, item.c);
                    this.hexGridManager.registerObstacle(item.r, item.c);
                }

                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 101：P 停车/ 路线拦截机关 (StopBlock / Special_2_101)
            const isStopSlot = (rawType === 101);
            if (isStopSlot) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const stopPrefab = this.getSpecialPrefab('Special_2_101') || this.floorPrefab;
                if (stopPrefab) {
                    const stopNode = instantiate(stopPrefab);
                    stopNode.name = `StopBlock_${item.r}_${item.c}`;
                    stopNode.setParent(this.gridContainer);

                    const stopPos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    stopNode.setPosition(stopPos);
                    stopNode.setRotationFromEuler(0, 180, 0); // 旋转 180° 使字母 P 正向朝上对齐摄像机
                    stopNode.setScale(Vec3.ONE);

                    const stopComp = stopNode.getComponent(StopBlock) || stopNode.addComponent(StopBlock);
                    stopComp.initStopBlock(item.r, item.c);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerStopSlot(item.r, item.c, stopComp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 102：障碍石/ 障碍墙壁 (StoneBlock / Special_4_102)
            const isObstacleBlock = (rawType === 102);
            if (isObstacleBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const obsPrefab = this.getSpecialPrefab('Special_4_102') || this.floorPrefab;
                if (obsPrefab) {
                    const obsNode = instantiate(obsPrefab);
                    obsNode.name = `StoneBlock_${item.r}_${item.c}`;
                    obsNode.setParent(this.gridContainer);

                    const obsPos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    obsNode.setPosition(obsPos);
                    obsNode.setRotationFromEuler(0, 0, 0);
                    obsNode.setScale(Vec3.ONE);

                    const obsComp = obsNode.getComponent(StoneBlock) || obsNode.addComponent(StoneBlock);
                    obsComp.initStoneBlock(item.r, item.c);
                    this._obstacleBlocks.push(obsComp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerSlot(item.r, item.c);
                        this.hexGridManager.registerObstacle(item.r, item.c);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 202：计数冰封方(IceBlock / Special_3_202)
            const isIceBlock = (rawType === 202);
            if (isIceBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const icePrefab = this.getSpecialPrefab('Special_3_202');
                if (icePrefab) {
                    const iceNode = instantiate(icePrefab);
                    iceNode.name = `IceBlock_${item.r}_${item.c}`;
                    iceNode.setParent(this.gridContainer);

                    const icePos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    iceNode.setPosition(icePos);
                    iceNode.setScale(Vec3.ONE);

                    const iceComp = iceNode.getComponent(IceBlock) || iceNode.addComponent(IceBlock);
                    const underlyingBlocks = this.hexGridManager.getSlotBlocks(item.r, item.c) || [];
                    // 读取关卡配置的真实解冻计(202_16 中的 1602_11 中的 11)
                    const initialCount = (item.extraParam !== undefined && item.extraParam > 0) ? item.extraParam : 1;
                    iceComp.initIceBlock(item.r, item.c, initialCount, underlyingBlocks, this.hexGridManager);
                    this._iceBlocks.push(iceComp);

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 301：全方位 TNT 炸药(TntBlock / Special_5_301)
            const isTntBlock = (rawType === 301);
            if (isTntBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const tntPrefab = this.getSpecialPrefab('Special_5_301') || this.getSpecialPrefab('Special_5_201') || this.hexBlockPrefab;
                if (tntPrefab) {
                    const tntNode = instantiate(tntPrefab);
                    tntNode.name = `TntBlock_${item.r}_${item.c}`;
                    tntNode.setParent(this.gridContainer);

                    const tntPos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    tntNode.setPosition(tntPos);
                    tntNode.setRotationFromEuler(0, 0, 0);
                    tntNode.setScale(Vec3.ONE);

                    const tntComp = tntNode.getComponent(TntBlock) || tntNode.addComponent(TntBlock);
                    tntComp.initTnt(item.r, item.c);
                    this._tntBlocks.push(tntComp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerSlot(item.r, item.c);
                        this.hexGridManager.registerTnt(item.r, item.c, tntComp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 601~606：导向转向板 (TurnBlock / Special_6_601)
            const isRedirectPad = (rawType >= 601 && rawType <= 606);
            if (isRedirectPad) {
                const targetDir = rawType - 600; // 601->1, 602->2, 603->3, 604->4, 605->5, 606->6
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const padPrefab = this.getSpecialPrefab('Special_6_601') || this.floorPrefab;
                if (padPrefab) {
                    const padNode = instantiate(padPrefab);
                    padNode.name = `TurnBlock_${rawType}_${item.r}_${item.c}`;
                    padNode.setParent(this.gridContainer);

                    const padPos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    padNode.setPosition(padPos);
                    padNode.setScale(Vec3.ONE);

                    const padComp = padNode.getComponent(TurnBlock) || padNode.addComponent(TurnBlock);
                    padComp.initTurnBlock(item.r, item.c, targetDir);
                    this._redirectPads.push(padComp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerRedirectPad(item.r, item.c, padComp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 701：旋转锯齿轮/切碎(GearBlock / Special_7_701)
            const isSawBlock = (rawType === 701);
            if (isSawBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const sawPrefab = this.getSpecialPrefab('Special_7_701') || this.floorPrefab;
                if (sawPrefab) {
                    const sawNode = instantiate(sawPrefab);
                    sawNode.name = `GearBlock_${item.r}_${item.c}`;
                    sawNode.setParent(this.gridContainer);

                    const sawPos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    sawNode.setPosition(sawPos);
                    sawNode.setScale(Vec3.ONE);

                    const sawComp = sawNode.getComponent(GearBlock) || sawNode.addComponent(GearBlock);
                    sawComp.initGearBlock(item.r, item.c);
                    this._sawBlocks.push(sawComp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerSaw(item.r, item.c, sawComp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 801：易碎崩塌地深坑陷阱 (BrokenBlock / Special_8_801)
            const isBrokenBlock = (rawType === 801);
            if (isBrokenBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const brokenPrefab = this.getSpecialPrefab('Special_8_801') || this.floorPrefab;
                if (brokenPrefab) {
                    const brokenNode = instantiate(brokenPrefab);
                    brokenNode.name = `BrokenBlock_${item.r}_${item.c}`;
                    brokenNode.setParent(this.gridContainer);

                    const brokenPos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    brokenNode.setPosition(brokenPos);
                    brokenNode.setScale(Vec3.ONE);

                    const brokenComp = brokenNode.getComponent(BrokenBlock) || brokenNode.addComponent(BrokenBlock);
                    brokenComp.initBrokenBlock(item.r, item.c);
                    this._brokenBlocks.push(brokenComp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerBrokenBlock(item.r, item.c, brokenComp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 901：升降伸缩柱/路障机关 (Telescopic / Special_9_901)
            const isTelescopicBlock = (rawType === 901);
            if (isTelescopicBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const telePrefab = this.getSpecialPrefab('Special_9_901') || this.floorPrefab;
                if (telePrefab) {
                    const teleNode = instantiate(telePrefab);
                    teleNode.name = `Telescopic_${item.r}_${item.c}`;
                    teleNode.setParent(this.gridContainer);

                    const telePos = new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    teleNode.setPosition(telePos);
                    teleNode.setScale(Vec3.ONE);

                    // 表格extraParam: 0 表示初始缩回降下 或缺省表示初始升
                    const initialExtended = (item.extraParam === undefined || item.extraParam === 1);
                    const teleComp = teleNode.getComponent(Telescopic) || teleNode.addComponent(Telescopic);
                    teleComp.initTelescopic(item.r, item.c, initialExtended);
                    this._telescopicBlocks.push(teleComp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerTelescopic(item.r, item.c, teleComp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 1001：神秘盲/ 问号方块 (MysteryBlock / Special_10_1001)
            const isMysteryBlock = (rawType === 1001);
            if (isMysteryBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const mysteryPrefab = this.getSpecialPrefab('Special_10_1001') || this.floorPrefab;
                if (mysteryPrefab) {
                    const mysteryNode = instantiate(mysteryPrefab);
                    mysteryNode.name = `MysteryBlock_${item.r}_${item.c}`;
                    mysteryNode.setParent(this.gridContainer);

                    const topBlock = this.hexGridManager.getTopBlock(item.r, item.c);
                    // 扣除预制体内hx_1 自带0.18m 局部高度偏移，使其底座与方块堆叠顶面严丝合缝贴合，杜绝悬空浮空
                    const layerY = topBlock ? (topBlock.node.position.y - 0.18) : this.slotPosY;
                    const mysteryPos = new Vec3(worldPos.x - centerX, layerY, worldPos.z - centerZ);
                    mysteryNode.setPosition(mysteryPos);
                    mysteryNode.setRotationFromEuler(0, 180, 0); // 旋转 180° 使问号正向朝上对齐摄像机
                    mysteryNode.setScale(Vec3.ONE);

                    const mysteryComp = mysteryNode.getComponent(MysteryBlock) || mysteryNode.addComponent(MysteryBlock);
                    mysteryComp.initMysteryBlock(item.r, item.c, topBlock);
                    this._mysteryBlocks.push(mysteryComp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerMysteryBlock(item.r, item.c, mysteryComp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 1101：多向层叠生成井 (MultiLayerBlock / Special_11_1101)
            const isMultiLayerBlock = (rawType === 1101);
            if (isMultiLayerBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const subDirs = (item.subDirections && item.subDirections.length > 0) ? item.subDirections : [item.dir || 1];

                // 1. 生成专用底座预制Special_11_1101 (带有专属井口模型 hx_1_1, hx_2_1)
                const multiLayerPrefab = this.getSpecialPrefab('Special_11_1101') || this.floorPrefab;
                let multiLayerComp: MultiLayerBlock | null = null;
                if (multiLayerPrefab) {
                    const multiNode = instantiate(multiLayerPrefab);
                    multiNode.name = `MultiLayerBlock_${item.r}_${item.c}`;
                    multiNode.setParent(this.gridContainer);
                    multiNode.setPosition(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ);
                    multiNode.setRotationFromEuler(0, 0, 0); // 恢复标准角度，与模型默认朝向一致
                    multiNode.setScale(Vec3.ONE);

                    multiLayerComp = multiNode.getComponent(MultiLayerBlock) || multiNode.addComponent(MultiLayerBlock);
                    this._multiLayerBlocks.push(multiLayerComp);
                    if (this.hexGridManager) {
                        this.hexGridManager.registerMultiLayerBlock(item.r, item.c, multiLayerComp);
                    }
                }

                // 2. 初始化生成井，并自动生成首批 3 个方块。
                if (multiLayerComp) {
                    multiLayerComp.initMultiLayerBlock(item.r, item.c, subDirs, this.hexGridManager);
                }

                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 7. 处理 1201~1206 前进停止(GoPauseBlock)
            const isGoPauseBlock = (rawType >= 1201 && rawType <= 1206);
            if (isGoPauseBlock) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const goPausePrefab = this.getSpecialPrefab('Special_12_1201') || this.hexBlockPrefab;
                if (goPausePrefab) {
                    const node = instantiate(goPausePrefab);
                    const dir = (rawType >= 1201 && rawType <= 1206) ? (rawType - 1200) : item.dir;
                    node.name = `GoPauseBlock_${rawType}_${item.r}_${item.c}`;
                    node.setParent(this.gridContainer);
                    node.setPosition(new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ));
                    node.setScale(Vec3.ONE);
                    const comp = node.getComponent(GoPauseBlock) || node.addComponent(GoPauseBlock);
                    const mat = this.getMaterialForDir(dir);
                    comp.initGoPauseBlock(item.r, item.c, rawType, mat);
                    this._goPauseBlocks.push(comp);
                    if (this.hexGridManager) {
                        this.hexGridManager.registerSlot(item.r, item.c);
                        this.hexGridManager.registerObstacle(item.r, item.c);
                        this.hexGridManager.registerGoPauseBlock(item.r, item.c, comp);
                    }
                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 15_RocketBombBlock 火箭炸药方块判定501~1506 (特殊道具，撞击后受撞方块返回原位，火箭沿指定方向发射并遇阻爆
            const isRocketBomb = (rawType >= 1501 && rawType <= 1506);
            if (isRocketBomb) {
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const rocketPrefab = this.getSpecialPrefab('Special_15_1501') || this.hexBlockPrefab;
                if (rocketPrefab) {
                    const node = instantiate(rocketPrefab);
                    const dir = (rawType >= 1501 && rawType <= 1506) ? (rawType - 1500) : item.dir;
                    node.name = `RocketBomb_${rawType}_${item.r}_${item.c}`;
                    node.setParent(this.gridContainer);
                    node.setPosition(new Vec3(worldPos.x - centerX, this.slotPosY, worldPos.z - centerZ));
                    node.setScale(Vec3.ONE);
                    const comp = node.getComponent(RocketBombBlock) || node.addComponent(RocketBombBlock);
                    const mat = this.getMaterialForDir(dir);
                    comp.initRocketBomb(item.r, item.c, rawType, mat);
                    this._rocketBombBlocks.push(comp);
                    if (this.hexGridManager) {
                        this.hexGridManager.registerSlot(item.r, item.c);
                        this.hexGridManager.registerObstacle(item.r, item.c);
                        this.hexGridManager.registerRocketBomb(item.r, item.c, comp);
                    }
                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            // 特殊元素 1701：双向交替分流转向板 (RandomTurnBlock / Special_17_1701)
            const isRandomTurn = (rawType === 1701);
            if (isRandomTurn) {
                const subDirs = (item.subDirections && item.subDirections.length >= 2)
                    ? item.subDirections
                    : [(item.dir || 1), ((item.dir || 1) % 6) + 1];
                const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
                const turnPrefab = this.getSpecialPrefab('Special_17_1701') || this.getSpecialPrefab('Special_6_601') || this.floorPrefab;
                if (turnPrefab) {
                    const turnNode = instantiate(turnPrefab);
                    turnNode.name = `RandomTurn_${item.r}_${item.c}`;
                    turnNode.setParent(this.gridContainer);

                    // Special_17_1701 预制体内部网格有 -0.07 的局部下沉偏移，此处 Y 补偿 +0.07 使其与周围棋盘底座绝对齐
                    const turnPos = new Vec3(worldPos.x - centerX, this.slotPosY + 0.07, worldPos.z - centerZ);
                    turnNode.setPosition(turnPos);
                    turnNode.setScale(Vec3.ONE);

                    const comp = turnNode.getComponent(RandomTurnBlock) || turnNode.addComponent(RandomTurnBlock);
                    comp.initRandomTurnBlock(item.r, item.c, subDirs);
                    this._randomTurnBlocks.push(comp);

                    if (this.hexGridManager) {
                        this.hexGridManager.registerRedirectPad(item.r, item.c, comp);
                    }

                }
                if (onItemSpawned) onItemSpawned();
                return;
            }

            const worldPos = HexMath.hexToWorld(item.r, item.c, 0, this.hexRadius);
            const mat = this.getMaterialForDir(item.dir);

            // 每个槽位循环生成 stackLayersPerSlot (3) 层堆叠方块
            for (let layer = 0; layer < this.stackLayersPerSlot; layer++) {
                const blockNode = instantiate(this.hexBlockPrefab);
                const isTopLayer = (layer === this.stackLayersPerSlot - 1);
                blockNode.name = `Block_${item.r}_${item.c}_L${layer}_Dir${item.dir}`;
                blockNode.setParent(this.gridContainer);

                // 计算本层 Y 轴高(基础高度 + 层高偏移)
                const layerY = this.blockBasePosY + layer * this.layerHeight;
                const pos = new Vec3(worldPos.x - centerX, layerY, worldPos.z - centerZ);
                blockNode.setPosition(pos);
                blockNode.setScale(this.blockScale);

                // 获取 HexBlock 组件并初始化 (优先获取挂载组件，缺失时自动补全)
                const hexBlock = blockNode.getComponent(HexBlock) || blockNode.addComponent(HexBlock);
                hexBlock.initBlock(
                    blockIdCounter++,
                    { r: item.r, c: item.c, layer },
                    item.dir,
                    isTopLayer,
                    this.hexRadius,
                    mat
                );

                // 注册到网格堆叠栈
                if (this.hexGridManager) {
                    this.hexGridManager.registerBlock(hexBlock);
                }

                if (onItemSpawned) onItemSpawned();
            }
        });
    }

    /**
     * 根据方向/颜色 ID 获取对应材质
     * @param dir 方向索引 (1~6)
     */
    public getMaterialForDir(dir: number): Material | undefined {
        const index = dir - 1;
        if (this.colorMaterials && index >= 0 && index < this.colorMaterials.length) {
            return this.colorMaterials[index];
        }
        return undefined;
    }

    // ======================================== 触控输入与高精度拾取 ========================================
    /**
     * 屏幕触控结束事件响应
     */
    private onTouchEnd(event: EventTouch) {
        if (this.gameState !== GameState.PLAYING || !this.isPlaying || !this.mainCamera) return;

        const touchPos = event.getLocation();
        // 1. 生成从相机视口发出的 3D 射线
        this.mainCamera.screenPointToRay(touchPos.x, touchPos.y, this._ray);

        // 2. 道具模式拦截调度 (优先响应道具点击)
        if (this.propsManager && this.propsManager.isPropActive) {
            const targetSlot = this.pickTargetSlot(this._ray);
            if (targetSlot) {
                this.propsManager.handlePropPick(targetSlot.r, targetSlot.c);
            } else {
                this.propsManager.showInvalidPickTip();
            }
            return;
        }

        // 3. 优先检测：点击中心旋转转盘机关 (只有点击中心转盘才触发旋
        const targetSwitch = this.pickTargetRotarySwitch(this._ray);
        if (targetSwitch) {
            targetSwitch.triggerRotation();
            return;
        }

        // 4. 优先检测 TNT 炸弹机关，点击后立即引爆。
        const targetTnt = this.pickTargetTnt(this._ray);
        if (targetTnt) {
            targetTnt.triggerExplosion();
            return;
        }

        // 4.5 优先检测：点击 1001 神秘盲盒 (未解锁时抖动提示，必须消除相邻方块方可揭
        const targetMystery = this.pickTargetMysteryBlock(this._ray);
        if (targetMystery) {
            targetMystery.shake();
            return;
        }

        // 4.6 优先检测：点击 1201~1206 前进停止(GoPauseBlock)
        const targetGoPause = this.pickTargetGoPauseBlock(this._ray);
        if (targetGoPause) {
            targetGoPause.onClick();
            return;
        }

        // 4.7 优先检测：点击 1501~1506 火箭炸药方块 (RocketBombBlock)
        const targetRocketBomb = this.pickTargetRocketBomb(this._ray);
        if (targetRocketBomb) {
            targetRocketBomb.onClick();
            return;
        }

        // 5. 普通模式：高精度拾取目标方块。
        const targetBlock = this.pickTargetBlock(this._ray);
        if (!targetBlock) return;

        // 双重保障：如果该方块所在的槽位有未揭晓的神秘盲盒，不可直接发射
        const mysteryOnBlock = this.hexGridManager.getMysteryBlock(targetBlock.r, targetBlock.c);
        if (mysteryOnBlock && !mysteryOnBlock.isRevealed) {
            mysteryOnBlock.shake();
            return;
        }

        // 6. 执行方块点击交互
        this.handleBlockClick(targetBlock);
    }

    /**
     * 方块移动或消除后，揭晓其六个相邻槽位内尚未开启的神秘盲盒。
     * @param r 发生变化的槽位行号
     * @param c 发生变化的槽位列号
     */
    public triggerAdjacentMysteryBlocks(r: number, c: number) {
        if (!this.hexGridManager) return;
        const neighbors = HexMath.getAllNeighbors(r, c);
        neighbors.forEach(coord => {
            const mystery = this.hexGridManager.getMysteryBlock(coord.r, coord.c);
            if (mystery && !mystery.isRevealed) {
                mystery.reveal(() => {
                    this.hexGridManager.unregisterMysteryBlock(coord.r, coord.c);
                });
            }
        });
    }

    /**
     * 高精度拾取目1001 神秘盲盒方块 (优先物理射线碰撞 + 平面几何求交双重保障)
     */
    private pickTargetMysteryBlock(ray: geometry.Ray): MysteryBlock | null {
        if (!this._mysteryBlocks || this._mysteryBlocks.length === 0) return null;

        // 1. 物理射线拾取
        if (PhysicsSystem.instance && PhysicsSystem.instance.raycast(ray)) {
            const results = PhysicsSystem.instance.raycastResults;
            results.sort((a, b) => a.distance - b.distance);
            for (const res of results) {
                if (res.collider && res.collider.node) {
                    let currNode: Node | null = res.collider.node;
                    while (currNode) {
                        const mystery = currNode.getComponent(MysteryBlock);
                        if (mystery && !mystery.isRevealed) {
                            return mystery;
                        }
                        currNode = currNode.parent;
                    }
                }
            }
        }

        // 2. 射线与棋盘顶层平面几何求交检(Ray-Plane Intersection)
        if (Math.abs(ray.d.y) > 0.0001) {
            const topLayerY = this.blockBasePosY + (this.stackLayersPerSlot - 1) * this.layerHeight;
            const t = (topLayerY - ray.o.y) / ray.d.y;
            if (t > 0) {
                const hitX = ray.o.x + ray.d.x * t;
                const hitZ = ray.o.z + ray.d.z * t;

                let closestMystery: MysteryBlock | null = null;
                let minDist = this.hexRadius * 1.25;

                for (const mystery of this._mysteryBlocks) {
                    if (!mystery || mystery.isRevealed || !mystery.node || !mystery.node.isValid) continue;

                    const pos = mystery.node.getPosition();
                    const d = Math.hypot(hitX - pos.x, hitZ - pos.z);
                    if (d < minDist) {
                        minDist = d;
                        closestMystery = mystery;
                    }
                }
                if (closestMystery) {
                    return closestMystery;
                }
            }
        }

        return null;
    }

    /**
     * 高精度拾取目1201~1206 前进停止(GoPauseBlock)
     */
    private pickTargetGoPauseBlock(ray: geometry.Ray): GoPauseBlock | null {
        if (!this._goPauseBlocks || this._goPauseBlocks.length === 0) return null;

        // 1. 物理射线拾取
        if (PhysicsSystem.instance && PhysicsSystem.instance.raycast(ray)) {
            const results = PhysicsSystem.instance.raycastResults;
            results.sort((a, b) => a.distance - b.distance);
            for (const res of results) {
                if (res.collider && res.collider.node) {
                    let currNode: Node | null = res.collider.node;
                    while (currNode) {
                        const goPause = currNode.getComponent(GoPauseBlock);
                        if (goPause && !goPause.isDestroyed && !goPause.isMoving) {
                            return goPause;
                        }
                        const targetNode = currNode;
                        const found = this._goPauseBlocks.find(g => g.node === targetNode || targetNode.isChildOf(g.node));
                        if (found && !found.isDestroyed && !found.isMoving) {
                            return found;
                        }
                        currNode = currNode.parent;
                    }
                }
            }
        }

        // 2. 射线与底座水平面求交检(Ray-Plane Intersection)
        if (Math.abs(ray.d.y) > 0.0001) {
            const planeY = this.slotPosY + 0.1;
            const t = (planeY - ray.o.y) / ray.d.y;
            if (t > 0) {
                const hitX = ray.o.x + ray.d.x * t;
                const hitZ = ray.o.z + ray.d.z * t;

                let closestGoPause: GoPauseBlock | null = null;
                let minDist = this.hexRadius * 1.15;

                for (const goPause of this._goPauseBlocks) {
                    if (!goPause || goPause.isDestroyed || goPause.isMoving || !goPause.node || !goPause.node.isValid) continue;

                    const pos = goPause.node.worldPosition;
                    const d = Math.hypot(hitX - pos.x, hitZ - pos.z);
                    if (d < minDist) {
                        minDist = d;
                        closestGoPause = goPause;
                    }
                }
                if (closestGoPause) {
                    return closestGoPause;
                }
            }
        }

        return null;
    }

    /**
     * 高精度拾取目1501~1506 火箭炸药方块 (RocketBombBlock)
     */
    private pickTargetRocketBomb(ray: geometry.Ray): RocketBombBlock | null {
        if (!this._rocketBombBlocks || this._rocketBombBlocks.length === 0) return null;

        // 1. 物理射线拾取
        if (PhysicsSystem.instance && PhysicsSystem.instance.raycast(ray)) {
            const results = PhysicsSystem.instance.raycastResults;
            results.sort((a, b) => a.distance - b.distance);
            for (const res of results) {
                if (res.collider && res.collider.node) {
                    let currNode: Node | null = res.collider.node;
                    while (currNode) {
                        const rocketBomb = currNode.getComponent(RocketBombBlock);
                        if (rocketBomb && !rocketBomb.isDestroyed && !rocketBomb.isLaunched) {
                            return rocketBomb;
                        }
                        const targetNode = currNode;
                        const found = this._rocketBombBlocks.find(g => g.node === targetNode || targetNode.isChildOf(g.node));
                        if (found && !found.isDestroyed && !found.isLaunched) {
                            return found;
                        }
                        currNode = currNode.parent;
                    }
                }
            }
        }

        // 2. 射线与底座水平面求交检(Ray-Plane Intersection)
        if (Math.abs(ray.d.y) > 0.0001) {
            const planeY = this.slotPosY + 0.1;
            const t = (planeY - ray.o.y) / ray.d.y;
            if (t > 0) {
                const hitX = ray.o.x + ray.d.x * t;
                const hitZ = ray.o.z + ray.d.z * t;

                let closestBomb: RocketBombBlock | null = null;
                let minDist = this.hexRadius * 1.15;

                for (const bomb of this._rocketBombBlocks) {
                    if (!bomb || bomb.isDestroyed || bomb.isLaunched || !bomb.node || !bomb.node.isValid) continue;

                    const pos = bomb.node.worldPosition;
                    const d = Math.hypot(hitX - pos.x, hitZ - pos.z);
                    if (d < minDist) {
                        minDist = d;
                        closestBomb = bomb;
                    }
                }
                if (closestBomb) {
                    return closestBomb;
                }
            }
        }

        return null;
    }

    /**
     * 高精度拾取目TNT 炸药(物理射线 + 平面几何求交双重保障)
     */
    private pickTargetTnt(ray: geometry.Ray): TntBlock | null {
        if (!this._tntBlocks || this._tntBlocks.length === 0) return null;

        // 1. 物理射线拾取
        if (PhysicsSystem.instance && PhysicsSystem.instance.raycast(ray)) {
            const results = PhysicsSystem.instance.raycastResults;
            results.sort((a, b) => a.distance - b.distance);
            for (const res of results) {
                if (res.collider && res.collider.node) {
                    let currNode: Node | null = res.collider.node;
                    while (currNode) {
                        const tntComp = currNode.getComponent(TntBlock);
                        if (tntComp && !tntComp.isExploded) {
                            return tntComp;
                        }
                        const targetNode = currNode;
                        const found = this._tntBlocks.find(t => t.node === targetNode || targetNode.isChildOf(t.node));
                        if (found && !found.isExploded) {
                            return found;
                        }
                        currNode = currNode.parent;
                    }
                }
            }
        }

        // 2. 几何距离拾取 (平面求交检
        const hitPoint = new Vec3();
        const dist = -ray.o.y / ray.d.y;
        if (dist > 0) {
            hitPoint.set(
                ray.o.x + ray.d.x * dist,
                0,
                ray.o.z + ray.d.z * dist
            );

            let closestTnt: TntBlock | null = null;
            let minDist = this.hexRadius * 1.15;

            for (const tnt of this._tntBlocks) {
                if (tnt.isExploded || !tnt.node || !tnt.node.isValid) continue;

                const pos = tnt.node.getPosition();
                const d = Math.hypot(hitPoint.x - pos.x, hitPoint.z - pos.z);
                if (d < minDist) {
                    minDist = d;
                    closestTnt = tnt;
                }
            }
            return closestTnt;
        }

        return null;
    }

    /**
     * 高精度拾取目标旋转转盘机(优先物理碰撞 + 平面几何求交双重保障)
     */
    private pickTargetRotarySwitch(ray: geometry.Ray): RotarySwitch | null {
        if (!this._rotarySwitches || this._rotarySwitches.length === 0) return null;

        // 1. 物理射线拾取
        if (PhysicsSystem.instance && PhysicsSystem.instance.raycast(ray)) {
            const results = PhysicsSystem.instance.raycastResults;
            results.sort((a, b) => a.distance - b.distance);
            for (const res of results) {
                if (res.collider && res.collider.node) {
                    let currNode: Node | null = res.collider.node;
                    while (currNode) {
                        const switchComp = currNode.getComponent(RotarySwitch);
                        if (switchComp && !switchComp.isRotating) {
                            return switchComp;
                        }
                        const targetNode = currNode;
                        const found = this._rotarySwitches.find(s => s.node === targetNode || targetNode.isChildOf(s.node));
                        if (found && !found.isRotating) {
                            return found;
                        }
                        currNode = currNode.parent;
                    }
                }
            }
        }

        // 2. 几何求交：射线与转盘平面求交
        if (Math.abs(ray.d.y) > 0.0001) {
            const switchPlaneY = this.slotPosY + 0.1;
            const t = (switchPlaneY - ray.o.y) / ray.d.y;
            if (t > 0) {
                const hitX = ray.o.x + ray.d.x * t;
                const hitZ = ray.o.z + ray.d.z * t;
                const effectivePickRadius = this.hexRadius * 0.95;

                for (const sw of this._rotarySwitches) {
                    if (sw.isRotating) continue;
                    const worldPos = HexMath.hexToWorld(sw.centerR, sw.centerC, 0, this.hexRadius);
                    const swX = worldPos.x - this.currentCenterX;
                    const swZ = worldPos.z - this.currentCenterZ;

                    const dist2D = Math.sqrt((swX - hitX) ** 2 + (swZ - hitZ) ** 2);
                    if (dist2D <= effectivePickRadius) {
                        return sw;
                    }
                }
            }
        }

        return null;
    }

    /**
     * 判断指定坐标是否为旋转连杆机关中心底座 (核心机械机关，不可被爆炸波及销毁或注销障碍)
     * @param r 行号
     * @param c 列号
     */
    public isRotarySwitchCenter(r: number, c: number): boolean {
        return !!(this._rotarySwitches && this._rotarySwitches.some(sw => sw && sw.isValid && sw.centerR === r && sw.centerC === c));
    }

    /**
     * 获取指定坐标上的 102 障碍石块组件实例
     * @param r 行号
     * @param c 列号
     */
    public getStoneBlock(r: number, c: number): StoneBlock | null {
        if (!this._obstacleBlocks || this._obstacleBlocks.length === 0) return null;
        return this._obstacleBlocks.find(st => st && st.isValid && st.r === r && st.c === c) || null;
    }

    /**
     * 从场上障碍石块列表中注销并移除已摧毁的石块
     * @param stone 待移除的石块组件
     */
    public removeStoneBlock(stone: StoneBlock) {
        if (!this._obstacleBlocks) return;
        const idx = this._obstacleBlocks.indexOf(stone);
        if (idx !== -1) {
            this._obstacleBlocks.splice(idx, 1);
        }
    }

    /**
     * 拾取目标网格槽位坐标 (支持点击方块或直接点击无方块的底座槽
     */
    public pickTargetSlot(ray: geometry.Ray): { r: number; c: number } | null {
        // 1. 物理射线拾取：检测是否直接点中了 Slot_r_c 底座Block_r_c 方块
        if (PhysicsSystem.instance && PhysicsSystem.instance.raycast(ray)) {
            const results = PhysicsSystem.instance.raycastResults;
            results.sort((a, b) => a.distance - b.distance);
            for (const res of results) {
                if (res.collider && res.collider.node) {
                    let currNode: Node | null = res.collider.node;
                    while (currNode) {
                        // A. 命中底座 Slot_r_c (例如 Slot_8_6 -> r: 8, c: 6)
                        if (currNode.name && currNode.name.startsWith('Slot_')) {
                            const parts = currNode.name.split('_');
                            if (parts.length >= 3) {
                                const r = parseInt(parts[1], 10);
                                const c = parseInt(parts[2], 10);
                                return { r, c };
                            }
                        }

                        // B. 命中彩色方块 Block_r_c_...
                        const block = currNode.getComponent(HexBlock);
                        if (block && block.state === BlockState.IDLE) {
                            return { r: block.r, c: block.c };
                        }

                        currNode = currNode.parent;
                    }
                }
            }
        }

        if (!this.hexGridManager) return null;

        // 2. 射线与底座水平面 (Y = slotPosY) 精确求交 (Ray-Plane Intersection)
        if (Math.abs(ray.d.y) > 0.0001) {
            const t = (this.slotPosY - ray.o.y) / ray.d.y;
            if (t > 0) {
                const hitX = ray.o.x + ray.d.x * t;
                const hitZ = ray.o.z + ray.d.z * t;

                const allSlots = this.hexGridManager.getAllRegisteredSlots();
                let closestSlot: { r: number; c: number } | null = null;
                let min2DDistance = Infinity;
                const effectivePickRadius = this.hexRadius * 1.35;

                for (const slot of allSlots) {
                    const worldPos = HexMath.hexToWorld(slot.r, slot.c, 0, this.hexRadius);
                    const slotX = worldPos.x - this.currentCenterX;
                    const slotZ = worldPos.z - this.currentCenterZ;

                    const dx = slotX - hitX;
                    const dz = slotZ - hitZ;
                    const dist2D = Math.sqrt(dx * dx + dz * dz);

                    if (dist2D <= effectivePickRadius && dist2D < min2DDistance) {
                        min2DDistance = dist2D;
                        closestSlot = slot;
                    }
                }

                if (closestSlot) {
                    return closestSlot;
                }
            }
        }

        return null;
    }

    /**
     * 高精度拾取目标顶层方(射线与棋盘水平面精确求交 Ray-Plane Intersection + 物理碰撞双保
     */
    private pickTargetBlock(ray: geometry.Ray): HexBlock | null {
        if (!this.hexGridManager) return null;

        // 优先 1：使用标准物理碰撞射线检(必须是真实彩色方Block_ 开
        if (PhysicsSystem.instance && PhysicsSystem.instance.raycast(ray)) {
            const results = PhysicsSystem.instance.raycastResults;
            results.sort((a, b) => a.distance - b.distance);
            for (const res of results) {
                if (res.collider && res.collider.node) {
                    let currNode: Node | null = res.collider.node;
                    let block: HexBlock | null = null;
                    while (currNode && !block) {
                        if (currNode.name && currNode.name.startsWith('Block_')) {
                            block = currNode.getComponent(HexBlock);
                        }
                        currNode = currNode.parent;
                    }
                    if (block && block.state === BlockState.IDLE) {
                        return this.hexGridManager.getTopBlock(block.r, block.c) || block;
                    }
                }
            }
        }

        // 核心 2：射线与棋盘顶层平面 (Y = topLayerY) 精确求交 (Ray-Plane Intersection)
        if (Math.abs(ray.d.y) > 0.0001) {
            const topLayerY = this.blockBasePosY + (this.stackLayersPerSlot - 1) * this.layerHeight;
            const t = (topLayerY - ray.o.y) / ray.d.y;
            if (t > 0) {
                const hitX = ray.o.x + ray.d.x * t;
                const hitZ = ray.o.z + ray.d.z * t;

                const allTops = this.hexGridManager.getAllTopBlocks();
                let closestBlock: HexBlock | null = null;
                let min2DDistance = Infinity;
                const effectivePickRadius = this.hexRadius * 1.15;

                for (const block of allTops) {
                    if (!block || block.state !== BlockState.IDLE || !block.node || !block.node.isValid) continue;

                    const blockPos = block.node.worldPosition;
                    const dx = blockPos.x - hitX;
                    const dz = blockPos.z - hitZ;
                    const dist2D = Math.sqrt(dx * dx + dz * dz);

                    if (dist2D <= effectivePickRadius && dist2D < min2DDistance) {
                        min2DDistance = dist2D;
                        closestBlock = block;
                    }
                }

                if (closestBlock) {
                    return this.hexGridManager.getTopBlock(closestBlock.r, closestBlock.c) || closestBlock;
                }
            }
        }

        return null;
    }

    // ======================================== 核心交互与流水线消除调度 ========================================
    /**
     * 执行方块点击逻辑。
     * 路径畅通时整柱方块翻滚出界；受阻时撞击障碍后原路返回。
     */
    public handleBlockClick(block: HexBlock) {
        if (this.gameState !== GameState.PLAYING || !this.isPlaying || this.remainingSteps <= 0 || !block || block.state !== BlockState.IDLE || !this.hexGridManager) return;
        // 如果当前场上有任何旋转连杆正在执行旋转动画，锁定操作，避免正在飞行的方块与机械臂时空穿模
        if (this._rotarySwitches && this._rotarySwitches.some(sw => sw && sw.isValid && sw.isRotating)) {
            return;
        }

        // 必须为该槽位当前存活的最顶层方块
        const currentTop = this.hexGridManager.getTopBlock(block.r, block.c);
        if (currentTop !== block) return;
        Audio.play(AudioId.gameClick);

        // 路径阻挡与深度扫
        const pathInfo = this.hexGridManager.checkPathInfo(block);
        const willLeave = pathInfo.canFly
            || !!(pathInfo.isInterceptedByStopSlot && pathInfo.targetStopSlot && pathInfo.targetStopCoord)
            || !!(pathInfo.hitTnt && pathInfo.hitTnt.isValid && !pathInfo.hitTnt.isExploded)
            || !!(pathInfo.hitSaw && pathInfo.hitSaw.isValid);
        this.getComponent(FirstLevelGuide)?.onBlockSelected(block, willLeave);

        // 如果路径上有将被踩踏触发崩塌801 易碎地块，在整柱方块全部层级完全通过后精准触发崩塌沉
        if (pathInfo.brokenBlocksToCollapse && pathInfo.brokenBlocksToCollapse.length > 0) {
            const slotBlocksCount = this.hexGridManager.getSlotBlocks(block.r, block.c).length;
            const lastLayerDelay = Math.max(0, slotBlocksCount - 1) * this.layerRollInterval;
            pathInfo.brokenBlocksToCollapse.forEach(item => {
                const collapseDelaySec = lastLayerDelay + (item.steps + 0.1) * this.rollStepDuration;
                this.scheduleOnce(() => {
                    if (item.block && item.block.isValid && !item.block.isBroken) {
                        item.block.playCollapseAnim();
                    }
                }, collapseDelaySec);
            });
        }

        if (pathInfo.isInterceptedByStopSlot && pathInfo.targetStopSlot && pathInfo.targetStopCoord) {
            // ================= 拦截入库：方块翻滚并P 停车位停靠落=================

            this.consumeOneStep();
            Audio.play(AudioId.stoneRoll);

            const targetStopSlot = pathInfo.targetStopSlot;
            const targetStopCoord = pathInfo.targetStopCoord;
            const steps = pathInfo.stepsToStopSlot || 1;

            // 原槽位方块出(多层方块仅弹出顶层单层，普通方块整柱出
            const allBlocksInSlot = this.hexGridManager.popAllBlocksInSlot(block.r, block.c);
            const multiLayerStop = this.hexGridManager.getMultiLayerBlock(block.r, block.c);
            if (multiLayerStop) {
                multiLayerStop.onCurrentBatchLaunched();
            }
            this.triggerAdjacentMysteryBlocks(block.r, block.c);

            // 释放在原停车位的占用 (若之前已停在某停车位)
            const oldStopSlot = this.hexGridManager.getStopSlot(block.r, block.c);
            if (oldStopSlot) {
                allBlocksInSlot.forEach(b => oldStopSlot.releaseBlock(b));
            }

            // 计算目标停车位世界对齐位
            const worldPos = HexMath.hexToWorld(targetStopCoord.r, targetStopCoord.c, 0, this.hexRadius);

            let parkedCount = 0;
            allBlocksInSlot.forEach((b, index) => {
                const layerY = this.blockBasePosY + b.layer * this.layerHeight;
                const targetWorldPos = new Vec3(worldPos.x - this.currentCenterX, layerY, worldPos.z - this.currentCenterZ);
                const delaySec = (allBlocksInSlot.length - 1 - index) * this.layerRollInterval;

                b.playMoveToSlotAnim(targetStopCoord, targetWorldPos, steps, this.rollStepDuration, delaySec, () => {
                    targetStopSlot.parkBlock(b);
                    this.hexGridManager.registerBlock(b);
                    parkedCount++;
                    if (parkedCount >= allBlocksInSlot.length) {
                        this.checkGameStatus();
                    }
                }, pathInfo.segments);
            });
            return;
        }

        if (pathInfo.hitTnt && pathInfo.hitTnt.isValid && !pathInfo.hitTnt.isExploded) {
            // ================= 撞击 TNT 炸弹：向前翻滚撞TNT，引发剧烈爆炸并一同炸毁！ =================

            this.consumeOneStep();
            Audio.play(AudioId.stoneRoll);

            const targetTnt = pathInfo.hitTnt;
            const blockedSteps = pathInfo.blockedSteps || 0;
            // 撞击方块整柱出栈从网格移
            const allBlocksInSlot = this.hexGridManager.popAllBlocksInSlot(block.r, block.c);
            this.triggerAdjacentMysteryBlocks(block.r, block.c);

            let impactFlySpawned = false;
            allBlocksInSlot.forEach((b, index) => {
                const delaySec = (allBlocksInSlot.length - 1 - index) * this.layerRollInterval;
                b.playRollToImpactAndDestroyAnim(blockedSteps, this.rollStepDuration, delaySec, () => {
                    if (!impactFlySpawned && b.node && b.node.isValid) {
                        impactFlySpawned = true;
                        this.spawnShatterScoreFly(b.node.worldPosition.clone());
                    }
                    // 撞击到达 TNT 瞬间，引TNT
                    if (targetTnt && targetTnt.isValid && !targetTnt.isExploded) {
                        targetTnt.triggerExplosion();
                    }
                });
            });
            return;
        }

        if (pathInfo.hitRocketBomb && pathInfo.hitRocketBomb.isValid && !pathInfo.hitRocketBomb.isLaunched) {
            // ================= 撞击 1501~1506 火箭炸药方块：向前翻滚撞击到达火箭炸弹后，火箭炸弹被激活发射，传力方块原路返回原位 =================

            this.consumeOneStep();
            Audio.play(AudioId.stoneRoll);

            const targetBomb = pathInfo.hitRocketBomb;
            const stepsToBomb = pathInfo.stepsToRocketBomb ?? pathInfo.blockedSteps ?? 0;
            const allBlocksInSlot = this.hexGridManager.getSlotBlocks(block.r, block.c);
            let bombRollBackCount = 0;

            allBlocksInSlot.forEach((b, index) => {
                const delaySec = (allBlocksInSlot.length - 1 - index) * this.layerRollInterval;
                const isTopBlock = (index === allBlocksInSlot.length - 1);
                const onFinished = () => {
                    bombRollBackCount++;
                    if (bombRollBackCount >= allBlocksInSlot.length) {
                        this.checkGameStatus();
                    }
                };
                b.playBlockedRollAnim(
                    stepsToBomb,
                    this.rollStepDuration,
                    delaySec,
                    onFinished,
                    isTopBlock ? () => {
                        if (targetBomb && targetBomb.isValid && !targetBomb.isLaunched) {
                            targetBomb.launchAndExplode();
                        }
                    } : undefined,
                    pathInfo.segments
                );
            });
            return;
        }

        if (pathInfo.hitSaw && pathInfo.hitSaw.isValid) {
            // ================= 701 旋转锯齿轮切碎：向前翻滚切入锯齿轮，瞬间被切碎粉碎并消除=================

            this.consumeOneStep();
            Audio.play(AudioId.stoneRoll);

            const targetSaw = pathInfo.hitSaw;
            const stepsToSaw = pathInfo.stepsToSaw || 1;

            // 原槽位方块整柱出(生成井当前批3 个方块一起出
            const allBlocksInSlot = this.hexGridManager.popAllBlocksInSlot(block.r, block.c);
            const multiLayerSaw = this.hexGridManager.getMultiLayerBlock(block.r, block.c);
            if (multiLayerSaw) {
                multiLayerSaw.onCurrentBatchLaunched();
            }
            this.triggerAdjacentMysteryBlocks(block.r, block.c);

            // 若方块原停靠P 停车位，离开时释放该停车
            const oldStopSlot = this.hexGridManager.getStopSlot(block.r, block.c);
            if (oldStopSlot) {
                allBlocksInSlot.forEach(b => oldStopSlot.releaseBlock(b));
            }

            let finishedCount = 0;
            let shredFlySpawned = false;
            allBlocksInSlot.forEach((b, index) => {
                const delaySec = (allBlocksInSlot.length - 1 - index) * this.layerRollInterval;
                const onFinished = () => {
                    finishedCount++;
                    if (finishedCount >= allBlocksInSlot.length) {
                        this.notifyBlockCleared(allBlocksInSlot.length, shredFlySpawned);
                        this.checkGameStatus();
                    }
                };

                const onShredMoment = (worldPos: Vec3, color: any, dir?: number) => {
                    if (!shredFlySpawned) {
                        shredFlySpawned = true;
                        this.spawnShatterScoreFly(worldPos);
                    }
                    if (targetSaw && targetSaw.isValid) {
                        targetSaw.playShredFeedbackAnim();
                        targetSaw.playShredParticles(worldPos, color, dir);
                    }
                };

                b.playRollToShredAndDestroyAnim(
                    stepsToSaw,
                    this.rollStepDuration,
                    delaySec,
                    onShredMoment,
                    onFinished,
                    pathInfo.segments
                );
            });
            return;
        }

        if (pathInfo.canFly) {
            // ================= 路径畅通：整柱 3 个方块一起翻转飞出消=================

            // 扣减关卡剩余步数并实时通知 UI 刷新
            this.consumeOneStep();
            Audio.play(AudioId.stoneRoll);
            const dropDelay = Math.max(0.08, (pathInfo.exitSteps || 1) * this.rollStepDuration);
            this.scheduleOnce(() => Audio.play(AudioId.stoneDrop), dropDelay);

            // 若方块原停靠P 停车位，飞出时释放该停车
            const oldStopSlot = this.hexGridManager.getStopSlot(block.r, block.c);

            // 从网格数据中将该槽位的全部方块一次性出栈移(生成井当前批次整3 个方块一起出
            const allBlocksInSlot = this.hexGridManager.popAllBlocksInSlot(block.r, block.c);
            const multiLayerComp = this.hexGridManager.getMultiLayerBlock(block.r, block.c);
            if (multiLayerComp) {
                multiLayerComp.onCurrentBatchLaunched();
            }

            this.triggerAdjacentMysteryBlocks(block.r, block.c);

            if (oldStopSlot) {
                allBlocksInSlot.forEach(b => oldStopSlot.releaseBlock(b));
            }

            // 多米诺连环翻跟头：支持单段直飞或多段转向接力飞出
            this.prepareFallScoreBatch(allBlocksInSlot);
            let finishedCount = 0;
            allBlocksInSlot.forEach((b, index) => {
                const delaySec = (allBlocksInSlot.length - 1 - index) * this.layerRollInterval;
                const onFinished = () => {
                    finishedCount++;
                    if (finishedCount >= allBlocksInSlot.length) {
                        this.notifyBlockCleared(allBlocksInSlot.length, true);
                        this.checkGameStatus();
                    }
                };

                if (pathInfo.segments && pathInfo.segments.length > 0) {
                    b.playMultiSegmentFlyAnim(pathInfo.segments, this.rollStepDuration, delaySec, onFinished);
                } else {
                    b.playFlyAwayAnim(pathInfo.exitSteps, this.rollStepDuration, delaySec, onFinished);
                }
            });
        } else {
            // ================= 受到阻挡：向前翻滚至障碍物前撞击，然后原路翻滚退回初始槽=================

            // 严格扣步模式：点错受阻同样扣1 步并通知 UI 实时刷新
            this.consumeOneStep();
            Audio.play(AudioId.stoneBlock);

            const allBlocksInSlot = this.hexGridManager.getSlotBlocks(block.r, block.c);
            let finishedCount = 0;
            allBlocksInSlot.forEach((b, index) => {
                const delaySec = (allBlocksInSlot.length - 1 - index) * this.layerRollInterval;
                const onFinished = () => {
                    finishedCount++;
                    if (finishedCount >= allBlocksInSlot.length) {
                        // 撞击退回完成后检查是否步数耗尽导致失败
                        this.checkGameStatus();
                    }
                };
                b.playBlockedRollAnim(
                    pathInfo.blockedSteps,
                    this.rollStepDuration,
                    delaySec,
                    onFinished,
                    undefined,
                    pathInfo.segments
                );
            });
        }
    }

    /**
     * 由外部机关触发方块飞出消除，不消耗操作步数。
     * @param block 目标顶层方块
     * @param onFinished 飞出并清空槽位后的回调
     */
    public launchBlockFly(block: HexBlock, onFinished?: () => void) {
        if (!block || block.state !== BlockState.IDLE || !this.hexGridManager) {
            if (onFinished) onFinished();
            return;
        }

        const pathInfo = this.hexGridManager.checkPathInfo(block);
        if (!pathInfo.canFly) {
            block.playWobbleAnim();
            if (onFinished) onFinished();
            return;
        }

        Audio.play(AudioId.stoneRoll);
        const dropDelay = Math.max(0.08, (pathInfo.exitSteps || 1) * this.rollStepDuration);
        this.scheduleOnce(() => Audio.play(AudioId.stoneDrop), dropDelay);

        if (pathInfo.brokenBlocksToCollapse && pathInfo.brokenBlocksToCollapse.length > 0) {
            const slotBlocksCount = this.hexGridManager.getSlotBlocks(block.r, block.c).length;
            const lastLayerDelay = Math.max(0, slotBlocksCount - 1) * this.layerRollInterval;
            pathInfo.brokenBlocksToCollapse.forEach(item => {
                const collapseDelaySec = lastLayerDelay + (item.steps + 0.1) * this.rollStepDuration;
                this.scheduleOnce(() => {
                    if (item.block && item.block.isValid && !item.block.isBroken) {
                        item.block.playCollapseAnim();
                    }
                }, collapseDelaySec);
            });
        }

        const oldStopSlot = this.hexGridManager.getStopSlot(block.r, block.c);
        const allBlocksInSlot = this.hexGridManager.popAllBlocksInSlot(block.r, block.c);
        const multiLayerComp = this.hexGridManager.getMultiLayerBlock(block.r, block.c);
        if (multiLayerComp) {
            multiLayerComp.onCurrentBatchLaunched();
        }

        this.triggerAdjacentMysteryBlocks(block.r, block.c);

        if (oldStopSlot) {
            allBlocksInSlot.forEach(b => oldStopSlot.releaseBlock(b));
        }

        this.prepareFallScoreBatch(allBlocksInSlot);
        let finishedCount = 0;
        allBlocksInSlot.forEach((b, index) => {
            const delaySec = (allBlocksInSlot.length - 1 - index) * this.layerRollInterval;
            const onFlyDone = () => {
                finishedCount++;
                if (finishedCount >= allBlocksInSlot.length) {
                    this.notifyBlockCleared(allBlocksInSlot.length, true);
                    this.checkGameStatus();
                    if (onFinished) onFinished();
                }
            };

            if (pathInfo.segments && pathInfo.segments.length > 0) {
                b.playMultiSegmentFlyAnim(pathInfo.segments, this.rollStepDuration, delaySec, onFlyDone);
            } else {
                b.playFlyAwayAnim(pathInfo.exitSteps, this.rollStepDuration, delaySec, onFlyDone);
            }
        });
    }

    /**
     * 同步通知 UI 刷新当前剩余步数
     */
    public notifyStepsChanged() {
        if (GamePage.instance) {
            GamePage.instance.updateMovesDisplay(this.remainingSteps);
        }
    }

    /**
     * 响应玩家有效操作（每次消耗 1 步操作使方块移动/前移/消除）：全场冰封计数 -1
     */
    public notifyStepAction() {
        if (this._iceBlocks.length > 0) {
            this._iceBlocks.forEach(ice => {
                if (ice && !ice.isUnlocked) {
                    ice.onAnyBlockCleared();
                }
            });
            this._iceBlocks = this._iceBlocks.filter(ice => ice && !ice.isUnlocked);
        }
    }

    /**
     * 统一扣减步数方法：
     * 消耗 1 步操作，实时刷新 UI，并触发【方案 B】冰块计数倒数 -1
     */
    public consumeOneStep() {
        if (this.remainingSteps > 0) {
            this.remainingSteps--;
            this.notifyStepsChanged();
            this.notifyStepAction();
        }
    }

    /**
     * 给即将掉落飞出的整柱方块分配同一飞分批次。
     * 同柱只在第一块开始掉落时生成一次飞分。
     */
    public prepareFallScoreBatch(blocks: HexBlock[]): string {
        const key = `fall-${this._nextFallScoreBatchId++}`;
        blocks.forEach(b => {
            if (b) b.fallScoreBatchKey = key;
        });
        return key;
    }

    /**
     * HexBlock 到达出口时的回调：播放碎裂并按批次生成飞分。
     */
    public onBlockStartFalling(block: HexBlock, worldPos: Vec3) {
        // 方块隐藏前，在出口位置播放对应颜色的碎裂效果。
        if (block && this.gridContainer && this.gridContainer.isValid) {
            BrokenParticle.playAtWorldPos(worldPos, this.gridContainer, block.dir);
        }
        const key = (block && block.fallScoreBatchKey) ? block.fallScoreBatchKey : `block-${block ? block.blockId : 0}`;
        this.spawnFallScoreFly(worldPos, key);
    }

    /**
     * 在 3D 世界坐标处生成飞分，同一批次只生成一次。
     * 逻辑分立即入账，顶栏数字等飞分到达后再跳动。
     */
    public spawnFallScoreFly(worldPos: Vec3, batchKey: string): number {
        if (this._spawnedFallScoreBatches.has(batchKey)) {
            return 0;
        }
        this._spawnedFallScoreBatches.add(batchKey);

        const addScore = this.applyClearScore();
        const launched = GamePage.instance ? GamePage.instance.playScoreFly(worldPos, addScore) : false;
        if (!launched && GamePage.instance) {
            GamePage.instance.addDisplayedScore(addScore);
        }
        return addScore;
    }

    /**
     * 击碎 / 切碎 / 爆炸时生成飞分。从碎裂世界坐标起飞，每次独立一批。
     */
    public spawnShatterScoreFly(worldPos: Vec3): number {
        return this.spawnFallScoreFly(worldPos, `shatter-${this._nextFallScoreBatchId++}`);
    }

    /**
     * 结算一次消除的连击与逻辑得分，不直接改顶栏数字。
     */
    public applyClearScore(clearedCount: number = 1): number {
        if (clearedCount <= 0) clearedCount = 1;

        const now = Date.now() / 1000;
        let addScore = 10;

        if (this._lastClearTime > 0 && (now - this._lastClearTime) <= GameMain.COMBO_DURATION) {
            this.currentCombo += 1;
            addScore = (this.currentCombo + 1) * 10;
        } else {
            this.currentCombo = 0;
            addScore = 10;
        }
        this._lastClearTime = now;
        this.levelScore += addScore;
        Audio.playCombo(this.currentCombo);

        if (GamePage.instance) {
            if (this.currentCombo >= 1) {
                GamePage.instance.showCombo(this.currentCombo);
            } else {
                GamePage.instance.hideCombo();
            }
        }

        this.unschedule(this._resetComboTimeout);
        this.scheduleOnce(this._resetComboTimeout, GameMain.COMBO_DURATION);
        return addScore;
    }

    /**
     * 响应方块消除事件：
     * 1. 切换 901 升降伸缩柱翻转状态；
     * 2. 计算连击倍率并累加本关积分；
     * 3. 飞出掉落路径会把顶栏刷新推迟到飞分到达，其它消除路径立即刷新。
     * @param clearedCount 本次消除的方块数量 (默认 1)
     * @param skipScore 为 true 时表示得分已在掉落飞分时入账，这里只处理 901 翻转
     */
    public notifyBlockCleared(clearedCount: number = 1, skipScore: boolean = false) {
        if (clearedCount <= 0) clearedCount = 1;

        // 1. 通知所有 901 升降伸缩柱翻转状态 (每次消除交替升降)
        if (this._telescopicBlocks && this._telescopicBlocks.length > 0) {
            this._telescopicBlocks.forEach(tele => {
                if (tele && tele.isValid) {
                    tele.toggleState(true);
                }
            });
        }

        if (skipScore) {
            return;
        }

        const addScore = this.applyClearScore(clearedCount);
        if (GamePage.instance) {
            GamePage.instance.addDisplayedScore(addScore);
        }
    }

    /**
     * 重置连击状态
     */
    public resetCombo() {
        this.currentCombo = 0;
        this._lastClearTime = 0;
        this.unschedule(this._resetComboTimeout);
    }

    /**
     * 5s 连击超时自动中断回调
     */
    private _resetComboTimeout = () => {
        this.resetCombo();
        if (GamePage.instance) {
            GamePage.instance.hideCombo(true);
        }
    };

    update(dt: number) {
        // One sample per attempt; ignore suspended/background frame gaps.
        if (!this._analyticsFpsReported && this.isPlaying && this.gameState === GameState.PLAYING && dt > 0 && dt < 1) {
            this._analyticsFrames++;
            this._analyticsFrameSeconds += dt;
            if (this._analyticsFrameSeconds >= 10) {
                this._analyticsFpsReported = true;
                const fps = this._analyticsFrames / this._analyticsFrameSeconds;
                GameSDK.inst.logEvent('performance_fps', { level: this.currentLevelId,
                    fps_range: fps < 20 ? '0-19' : fps < 30 ? '20-29' : fps < 45 ? '30-44' : '45+', fps: Math.round(fps) });
            }
        }
        // 双重保障：帧循环检测 5s 连击超时，确保绝对自动隐藏
        if (this.currentCombo > 0 && this._lastClearTime > 0) {
            const now = Date.now() / 1000;
            if (now - this._lastClearTime >= GameMain.COMBO_DURATION) {
                this.resetCombo();
                if (GamePage.instance) {
                    GamePage.instance.hideCombo(true);
                }
            }
        }
    }

    /**
     * 检测当前场景中是否仍有方块或机关正在执行动画。
     */
    public hasActiveAnimations(): boolean {
        if (!this.gridContainer || !this.gridContainer.isValid) return false;

        // 1. 普通及特殊六边形方(检查是否仍有处于翻飞行动画中的方块)
        const allBlocks = this.gridContainer.getComponentsInChildren(HexBlock);
        const hasFlyingBlocks = allBlocks.some(b => b && b.isValid && b.node && b.node.isValid && b.state === BlockState.ANIMATING);
        if (hasFlyingBlocks) return true;

        // 2. GoPauseBlock (1201~1206 特殊方块)
        const allGoPause = this.gridContainer.getComponentsInChildren(GoPauseBlock);
        const hasMovingGoPause = allGoPause.some(gp => gp && gp.isValid && gp.isMoving);
        if (hasMovingGoPause) return true;

        // 3. 火箭炸弹 (1501~1506)
        const allRockets = this.gridContainer.getComponentsInChildren(RocketBombBlock);
        const hasActiveRockets = allRockets.some(rb => rb && rb.isValid && rb.isLaunched && !rb.isDestroyed);
        if (hasActiveRockets) return true;

        // 4. 旋转连杆 (501~506)
        if (this._rotarySwitches && this._rotarySwitches.length > 0) {
            const hasRotating = this._rotarySwitches.some(sw => sw && sw.isValid && sw.isRotating);
            if (hasRotating) return true;
        }

        return false;
    }

    /**
     * 检查关卡状态并进行胜负判定，状态锁可避免重复结算。
     */
    public checkGameStatus() {
        // 1. 核心防重锁：若当前不处于 PLAYING 状态（已判定过胜利或失败），直接拦截，绝不重复执行
        if (this.gameState !== GameState.PLAYING) return;
        if (!this.hexGridManager) return;

        const remaining = this.hexGridManager.getRemainingBlockCount();

        // 2. 优先判定胜利：场上方块全部清
        if (remaining === 0) {
            // 核心保障：检查场上是否仍有任何方块处于翻滚飞行动画中，必须等待最后一个方块完全走完并落出屏幕
            if (this.hasActiveAnimations()) {
                this.scheduleOnce(() => {
                    this.checkGameStatus();
                }, 0.2);
                return;
            }

            // 场上方块100% 全部翻滚并飞出界外下落完毕！
            this.gameState = GameState.VICTORY; // 立即上锁，后续方块飞消除回调全部拦截
            this.isPlaying = false;

            // 预留 0.5 秒清屏呼吸与观赏时间，让玩家看清棋盘清空，随后触handleVictory
            this.scheduleOnce(() => {
                this.handleVictory();
            }, 0.5);
            return;
        }

        // 3. 判定失败：场上仍有剩余方块，且可用步数已耗尽
        if (this.remainingSteps <= 0) {
            // 检查场上是否仍有方块在飞行动画中（可能正在完成最后消除，绝不草率判负
            if (this.hasActiveAnimations()) {
                this.scheduleOnce(() => {
                    this.checkGameStatus();
                }, 0.2);
                return;
            }

            // 场上方块均已静止，再次精确获取剩余方块数
            const finalRemaining = this.hexGridManager ? this.hexGridManager.getRemainingBlockCount() : remaining;
            if (finalRemaining === 0) {
                this.gameState = GameState.VICTORY;
                this.isPlaying = false;
                this.scheduleOnce(() => {
                    this.handleVictory();
                }, 0.5);
                return;
            }

            // 确认步数耗尽且场上仍有方块：判定失败 (0.5s 延时触发)
            this.gameState = GameState.FAIL;
            this.isPlaying = false;
            this.scheduleOnce(() => {
                this.handleFail();
            }, 0.5);
            return;
        }
    }

    /**
     * 关卡胜利处理函数 (单次防重执行)
     */
    private handleVictory() {
        if (this._analyticsFinished) return;
        this._analyticsFinished = true;
        this.reportLevelResult('victoryLevel');

        // 1. 数据中心进阶存档 (当前关卡已通关，下一关解锁并存盘)
        GameData.instance.passLevel();

        // 2. 派发全局通关事件 (UI 层监听展示通关动效、结算弹窗或返回主页)
        GameData.event.emit('GAME_VICTORY', this.currentLevelId);
    }

    /**
     * 关卡失败处理函数 (单次防重执行)
     */
    private handleFail() {
        GameSDK.inst.logEvent('levelBlocked', this.levelAnalyticsData());

        // 派发全局失败事件 (UI 层监听弹出复活加步数或重新开始弹
        GameData.event.emit('GAME_FAIL', this.currentLevelId);
    }

    /**
     * 增加步数并恢复游戏状态。
     * @param addedSteps 增加的步数，默认 5 步
     */
    private levelAnalyticsData() {
        return { level: this.currentLevelId, value: this.currentLevelId,
            duration_ms: Math.max(0, Date.now() - this._analyticsStartedAt),
            remaining_moves: this.remainingSteps, revive_count: this._hasRevived ? 1 : 0 };
    }

    private reportLevelResult(event: string): void {
        GameSDK.inst.logEvent(event, this.levelAnalyticsData());
    }

    public reportFinalFailure(): void {
        if (this._analyticsFinished || !this._analyticsStartedAt) return;
        this._analyticsFinished = true;
        this.reportLevelResult('failLevel');
    }

    public reviveGame(addedSteps: number = 5) {
        if (this._hasRevived || this.gameState !== GameState.FAIL || addedSteps <= 0) return;
        this._hasRevived = true;
        GameSDK.inst.logEvent("reviveLevel", { level: this.currentLevelId, added_moves: addedSteps });
        this.remainingSteps += addedSteps;
        this.gameState = GameState.PLAYING;
        this.isPlaying = true;
        this.notifyStepsChanged();
    }

    // ======================================== 几何计算与相机智能自适应 ========================================
    /**
     * 计算关卡几何中心与 X/Z 轴总跨度。
     */
    private calculateLevelCenter(levelData: LevelData): { centerX: number; centerZ: number; spanX: number; spanZ: number } {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const allCoords = [...levelData.slots];
        if (allCoords.length === 0) {
            levelData.blocks.forEach(b => allCoords.push({ r: b.r, c: b.c }));
        }

        allCoords.forEach(coord => {
            const p = HexMath.hexToWorld(coord.r, coord.c, 0, this.hexRadius);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z);
            maxZ = Math.max(maxZ, p.z);
        });

        // 加上单块六边形的自身半径边界
        const hexW = this.hexRadius * 2;
        const hexH = Math.sqrt(3) * this.hexRadius;
        const spanX = (maxX - minX) + hexW;
        const spanZ = (maxZ - minZ) + hexH;

        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;

        return { centerX, centerZ, spanX, spanZ };
    }

    /**
     * 根据关卡尺寸调整相机视野并保持画面居中。
     * @param spanX 关卡横向总跨度
     * @param spanZ 关卡纵向总跨度
     */
    private adjustCameraView(spanX: number, spanZ: number) {
        if (!this.mainCamera) return;

        // 1. 获取当前屏幕/视口宽高
        const visibleSize = view.getVisibleSize();
        const boardRange = GamePage.instance?.getBoardVerticalRange();
        // 背景与棋盘共用相机，保持全屏视口，不能裁切渲染区域。
        this.mainCamera.rect = new Rect(0, 0, 1, 1);
        const aspect = visibleSize.height > 0 ? visibleSize.width / visibleSize.height : 0.5625;

        // 2. 摄像机俯仰角FOV
        const pitchAngleRad = this.cameraPitchAngle * (Math.PI / 180);
        const fovRad = this.cameraFov * (Math.PI / 180);
        const halfFovV = fovRad / 2;

        // 3. 计算俯视投影下关卡在屏幕平面的实际宽高。
        const effectiveHeight = spanZ * Math.sin(pitchAngleRad) + 0.35;
        const effectiveWidth = spanX;

        // 4. 计算垂直与水平方向刚好容纳关卡所需的基础视距
        const distV = (effectiveHeight / 2) / Math.tan(halfFovV);
        const distH = (effectiveWidth / 2) / (Math.tan(halfFovV) * aspect);
        const rawDist = Math.max(distV, distH);

        // 5. 动态平滑自适应留白系数 (Dynamic Non-linear Padding)
        const t = Math.min(1.0, Math.max(0.0, (rawDist - 2.0) / 3.8));
        const dynamicPadding = 1.95 - t * 0.70;

        const viewDistance = rawDist * dynamicPadding;

        // 6. 根据几何关系推导相机 Y/Z 坐标，保证画面居中。
        const camHeight = viewDistance * Math.sin(pitchAngleRad);
        const camZ = (camHeight / Math.tan(pitchAngleRad)) + this.cameraTargetOffsetZ;

        this.mainCamera.node.setPosition(0, camHeight, camZ);
        this.mainCamera.node.setRotationFromEuler(-this.cameraPitchAngle, 0, 0);
        this.mainCamera.fov = this.cameraFov;
        if (boardRange) {
            const targetCenter = boardRange.bottom + boardRange.height / 2;
            // 沿相机上方向平移，使棋盘投影落到可用区域中心，保留全屏背景。
            const shift = -(targetCenter - 0.5) * 2 * viewDistance * Math.tan(halfFovV);
            const cameraUp = Vec3.transformQuat(new Vec3(), new Vec3(0, 1, 0), this.mainCamera.node.rotation);
            const position = this.mainCamera.node.position.clone();
            Vec3.scaleAndAdd(position, position, cameraUp, shift);
            this.mainCamera.node.setPosition(position);
        }

    }
}
