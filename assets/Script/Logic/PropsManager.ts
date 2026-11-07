import { _decorator, Component, Node, Prefab, instantiate, resources, Vec3, tween, Tween, Quat, Camera } from 'cc';
import { HexMath, HexCoord } from './HexMath';
import { HexGridManager } from './HexGridManager';
import { HexBlock, BlockState } from './HexBlock';
import { GameMain } from './GameMain';
import { GameData } from '../Config/GameData';
import { Remind } from '../Tools/Remind/Remind';
import { BoomParticle } from './BoomParticle';
import { BrokenParticle } from './BrokenParticle';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

// ======================================== 道具类型枚举 ========================================
export enum PropType {
    NONE = 0,
    HAMMER = 1,     // 锤子 (敲碎整堆方块)
    DRILL = 2,      // 电钻 (拆除空底座)
    TNT = 3,        // 炸弹 (消除周围 7 格)
    ADD_MOVES = 4   // 加步数 (即时 + 步数)
}

// ======================================== 3D 道具与技能管理器 ========================================
/**
 * 道具系统主控制器
 * 负责道具激活状态流转、3D 道具模型实例化、打击与爆炸动力学动画、以及数据网格范围消除与结算
 */
@ccclass('PropsManager')
export class PropsManager extends Component {
    // ======================================== 单例模式 ========================================
    private static _instance: PropsManager | null = null;
    public static get instance(): PropsManager | null {
        return this._instance;
    }

    // ======================================== 预制体资源路径与内部缓存 (纯代码动态加载，不走挂载变量) ========================================
    /** 道具 Prefab 在 resources 目录下的相对路径映射表 */
    public static readonly PREFAB_PATHS = {
        TNT: 'Main/Game/Map/Props_Tnt',
        HAMMER: 'Main/Game/Map/Props_Hammer',
        DRILL: 'Main/Game/Map/Props_Drill',
        CROSSHAIR: 'Main/Game/Map/Props_Crosshair',
    };

    /** 预制体实例内存缓存 Map: key = 相对路径, value = Prefab */
    private _prefabCache: Map<string, Prefab> = new Map();

    // ======================================== 状态管理 ========================================
    /** 当前选中的道具类型 */
    private _currentProp: PropType = PropType.NONE;
    /** 是否正在播放道具动画中 (期间禁止重复操作) */
    private _isExecutingAnim: boolean = false;
    /** 当前棋盘上批量生成的准星节点列表 */
    private _crosshairNodes: Node[] = [];

    /** 获取当前激活的道具类型 */
    public get currentProp(): PropType {
        return this._currentProp;
    }

    /** 当前是否处于道具瞄准模式 */
    public get isPropActive(): boolean {
        return this._currentProp !== PropType.NONE;
    }

    /** 是否正在播放道具攻击动画 */
    public get isExecutingAnim(): boolean {
        return this._isExecutingAnim;
    }

    // ======================================== 生命周期 ========================================
    onLoad() {
        PropsManager._instance = this;
        this.preloadAllPropPrefabs();
    }

    onDestroy() {
        this.clearCrosshairs();
        this._prefabCache.clear();
        this._currentProp = PropType.NONE;
        this.notifyPropChanged();
        if (PropsManager._instance === this) {
            PropsManager._instance = null;
        }
    }

    /**
     * 预加载所有道具 Prefab 至内存缓存
     */
    private preloadAllPropPrefabs() {
        const paths = [
            PropsManager.PREFAB_PATHS.TNT,
            PropsManager.PREFAB_PATHS.HAMMER,
            PropsManager.PREFAB_PATHS.DRILL,
            PropsManager.PREFAB_PATHS.CROSSHAIR,
        ];
        paths.forEach(path => {
            resources.load(path, Prefab, (err, prefab) => {
                if (!err && prefab) {
                    this._prefabCache.set(path, prefab);
                }
            });
        });
    }

    /**
     * 获取指定道具预制体 (优先读缓存，若无则即时加载)
     * @param path resources 下相对路径
     * @param callback 成功回调
     */
    public getOrLoadPrefab(path: string, callback: (prefab: Prefab) => void) {
        const cached = this._prefabCache.get(path);
        if (cached) {
            callback(cached);
            return;
        }

        resources.load(path, Prefab, (err, prefab) => {
            if (!err && prefab) {
                this._prefabCache.set(path, prefab);
                callback(prefab);
            }
        });
    }

    /** 道具激活/切换状态变更监听回调 */
    public static onPropActiveChanged: ((prop: PropType) => void) | null = null;

    /**
     * 通知道具激活状态变更，同步刷新外部 UI
     */
    public notifyPropChanged() {
        try {
            if (PropsManager.onPropActiveChanged) {
                PropsManager.onPropActiveChanged(this._currentProp);
            }
        } catch (e) {
        }
    }

    // ======================================== 道具选择与状态流转 ========================================
    /**
     * 切换道具激活状态 (点击已选中的道具则取消)
     * @param type 道具类型
     */
    public toggleProp(type: PropType) {
        if (this._isExecutingAnim) return;

        if (this._currentProp === type) {
            this.cancelProp();
        } else {
            this.selectProp(type);
        }
    }

    /**
     * 选择并激活指定道具
     * @param type 道具类型
     */
    public selectProp(type: PropType) {
        if (this._isExecutingAnim) return;

        const propName = PropType[type];
        if (GameData.instance.getPropCount(propName) <= 0) {
            Remind.showTipRemind('Not enough props!');
            this.cancelProp();
            return;
        }

        this._currentProp = type;
        this.notifyPropChanged();

        // 根据激活的道具类型批量生成对应的准星提示
        if (type === PropType.DRILL || type === PropType.TNT) {
            this.showEmptySlotCrosshairs();
        } else if (type === PropType.HAMMER) {
            this.showColoredBlockCrosshairs();
        } else {
            this.clearCrosshairs();
        }
    }

    /**
     * 取消当前道具模式，恢复普通消除状态
     */
    public cancelProp() {
        if (this._isExecutingAnim) return;
        this._currentProp = PropType.NONE;
        this.clearCrosshairs();
        this.notifyPropChanged();
    }

    /** 离开关卡时强制退出道具，避免瞄准准星和攻击动画留在棋盘上。 */
    public forceIdle() {
        this._isExecutingAnim = false;
        this._currentProp = PropType.NONE;
        this._crosshairNodes = [];
        this.notifyPropChanged();
    }

    // ======================================== 3D 拾取与拦截调度 ========================================
    /**
     * 响应 3D 棋盘触控拾取
     * @param r 目标槽位行号
     * @param c 目标槽位列号
     * @returns 是否成功消费并执行道具逻辑
     */
    public handlePropPick(r: number, c: number): boolean {
        if (this._isExecutingAnim || this._currentProp === PropType.NONE) {
            return false;
        }

        const gridMgr = HexGridManager.instance;
        if (!gridMgr) return false;

        switch (this._currentProp) {
            case PropType.TNT:
                // 炸弹规则：只能放置在纯净无颜色的普通空格子上，特殊机关底座或有色方块不可放置
                if (!gridMgr.isPureEmptySlot(r, c)) {
                    Remind.showTipRemind('Place on an empty slot!');
                    return false;
                }
                this.executeTnt(r, c);
                return true;

            case PropType.HAMMER:
                // 锤子规则：敲碎整堆方块，只能点击有彩色方块的槽位
                const targetTopBlock = gridMgr.getTopBlock(r, c);
                if (!targetTopBlock) {
                    Remind.showTipRemind('Select a block to smash!');
                    return false;
                }
                Audio.play(AudioId.propHammer);
                this.executeHammer(r, c);
                return true;

            case PropType.DRILL:
                // 电钻规则：拆除纯净无方块的普通底座，不能拆除包含特殊机关道具或有方块的槽位
                if (!gridMgr.isPureEmptySlot(r, c)) {
                    Remind.showTipRemind('Select an empty slot to remove!');
                    return false;
                }
                Audio.play(AudioId.propSaw);
                this.executeDrill(r, c);
                return true;

            default:
                return false;
        }
    }

    /**
     * 当道具处于激活状态、点击了未命中任何有效底座槽位时的通用英文提示
     */
    public showInvalidPickTip() {
        if (this._isExecutingAnim) return;
        switch (this._currentProp) {
            case PropType.TNT:
                Remind.showTipRemind('Place on an empty slot!');
                break;
            case PropType.HAMMER:
                Remind.showTipRemind('Select a block to smash!');
                break;
            case PropType.DRILL:
                Remind.showTipRemind('Select an empty slot to remove!');
                break;
        }
    }

    // ======================================== 💣 炸弹 (TNT) 核心 3D 表现与范围消除 ========================================
    /**
     * 执行炸弹 (TNT) 道具：
     * 1. 阶段 1: 在选定的无颜色空格子上实例化并放置 3D TNT 模型；
     * 2. 阶段 2: 延迟片刻引信微震 (0.35s)；
     * 3. 阶段 3: TNT 爆炸销毁，晃动屏幕；
     * 4. 阶段 4: 周围相邻 6 个方向的颜色块直接隐藏消除 (后续扩展破碎粒子)；
     * 5. 阶段 5: 关卡状态更新与胜负检测，重置道具交互状态。
     * @param targetR 目标行号 (必须为空格子)
     * @param targetC 目标列号 (必须为空格子)
     * @param onComplete 完成回调
     */
    public executeTnt(targetR: number, targetC: number, onComplete?: () => void) {
        if (this._isExecutingAnim) return;
        this._isExecutingAnim = true;

        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) {
            this._isExecutingAnim = false;
            return;
        }

        this.clearCrosshairs();
        GameData.instance.useProp('TNT');

        // 1. 获取目标槽位世界坐标 (对齐棋盘几何中心偏移)
        const radius = gameMain.hexRadius;
        const worldPos = HexMath.hexToWorld(targetR, targetC, 0, radius);
        const centerPos = new Vec3(
            worldPos.x - gameMain.currentCenterX,
            gameMain.blockBasePosY + 0.05,
            worldPos.z - gameMain.currentCenterZ
        );

        // 2. 实例化 TNT 节点并放置在没有颜色的格子上
        const spawnTntNode = (prefab: Prefab) => {
            const tntNode = instantiate(prefab);
            tntNode.name = `Prop_TNT_${targetR}_${targetC}`;
            tntNode.setParent(gameMain.gridContainer);


            // 直接放置在空格子中心 (scale 为 1，无额外高度偏移)
            tntNode.setPosition(centerPos);
            tntNode.setScale(new Vec3(1, 1, 1));

            // ================= 阶段 1: 引信微震脉冲 (0.45s) =================
            this.playTntChargeAnim(tntNode, () => {
                // ================= 阶段 2: 爆炸、晃屏、周围 6 方向颜色块消失 =================
                this.triggerTntExplosion(tntNode, targetR, targetC, onComplete);
            });
        };

        // 统一使用纯代码动态缓存加载
        this.getOrLoadPrefab(PropsManager.PREFAB_PATHS.TNT, (prefab) => {
            spawnTntNode(prefab);
        });
    }

    /**
     * 播放 TNT 引信点燃蓄力脉冲动画 (纯多段缩放呼吸微震，递进加速蓄力)
     * @param tntNode TNT 模型节点
     * @param onComplete 蓄力完成回调
     */
    private playTntChargeAnim(tntNode: Node, onComplete: () => void) {
        const s1 = new Vec3(1, 1, 1);
        const s2 = new Vec3(1.12, 1.12, 1.12);
        const s3 = new Vec3(1.22, 1.22, 1.22);
        const s4 = new Vec3(1.32, 1.32, 1.32);

        // 纯缩放脉冲 (节奏递进，干净利落)
        tween(tntNode)
            // 第 1 阶段：轻微吸气微震 (0.24s)
            .to(0.12, { scale: s2 }, { easing: 'quadOut' })
            .to(0.12, { scale: s1 }, { easing: 'quadIn' })
            // 第 2 阶段：中等幅度微膨胀 (0.22s)
            .to(0.11, { scale: s3 }, { easing: 'quadOut' })
            .to(0.11, { scale: s1 }, { easing: 'quadIn' })
            // 第 3 阶段：急促膨胀微抖 (0.18s)
            .to(0.09, { scale: s4 }, { easing: 'quadOut' })
            .to(0.09, { scale: s1 }, { easing: 'quadIn' })
            // 第 4 阶段：临爆高频脉冲 (0.16s)
            .to(0.08, { scale: s4 }, { easing: 'quadOut' })
            .to(0.08, { scale: s1 }, { easing: 'quadIn' })
            .call(() => {
                if (onComplete) onComplete();
            })
            .start();
    }

    /**
     * 触发 TNT 爆炸：晃动屏幕并使周围相邻 6 个方向的颜色块直接隐藏消除
     * @param tntNode TNT 模型节点
     * @param centerR 中心槽位行号
     * @param centerC 中心槽位列号
     * @param onComplete 完成回调
     */
    private triggerTntExplosion(
        tntNode: Node,
        centerR: number,
        centerC: number,
        onComplete?: () => void
    ) {
        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) return;

        Audio.play(AudioId.propBomb);

        // 1. TNT 自身剧烈放大并销毁
        tween(tntNode)
            .to(0.1, { scale: new Vec3(1.35, 1.35, 1.35) }, { easing: 'quadOut' })
            .call(() => {
                if (tntNode && tntNode.isValid) {
                    tntNode.destroy();
                }
            })
            .start();

        // 2. 晃动屏幕 (高冲击力相机震动)
        if (gameMain.mainCamera) {
            this.shakeCamera(gameMain.mainCamera.node, 0.38, 0.28);
        }

        // 3. 获取周围相邻 6 个方向的槽位坐标
        const neighborCoords = HexMath.getAllNeighbors(centerR, centerC);
        const worldCenter = HexMath.hexToWorld(centerR, centerC, 0, gameMain.hexRadius);
        const particlePosition = new Vec3(
            worldCenter.x - gameMain.currentCenterX,
            gameMain.blockBasePosY + 0.05,
            worldCenter.z - gameMain.currentCenterZ
        );
        BoomParticle.play('boom', gameMain.gridContainer, particlePosition);
        BoomParticle.play('piece', gameMain.gridContainer, particlePosition);
        BoomParticle.play('trail', gameMain.gridContainer, particlePosition, 1.2);

        // 4. 周围相邻 6 个方向上的颜色块、冰块与地图 TNT 连环引爆
        let eliminatedCount = 0;
        let spawnedShatterFly = false;
        neighborCoords.forEach(coord => {
            // 4.1 检查相邻槽位是否有地图 TNT -> 连环引爆！
            const neighborTnt = gridMgr.getTnt(coord.r, coord.c);
            if (neighborTnt && neighborTnt.node && neighborTnt.node.isValid && !neighborTnt.isExploded) {
                neighborTnt.scheduleOnce(() => {
                    if (neighborTnt.node && neighborTnt.node.isValid && !neighborTnt.isExploded) {
                        neighborTnt.triggerExplosion(true);
                    }
                }, 0.06);
            }

            // 4.2 清除可能存在的普通方块：每个被炸掉的槽位各自飞分
            const poppedBlocks = gridMgr.popAllBlocksInSlot(coord.r, coord.c);
            let slotFlyPos: Vec3 | null = null;
            poppedBlocks.forEach(b => {
                if (b && b.node && b.node.isValid) {
                    if (!slotFlyPos) slotFlyPos = b.node.worldPosition.clone();
                    BrokenParticle.play(b, gameMain.gridContainer);
                    b.state = BlockState.DESTROYED;
                    b.node.active = false;
                    b.node.destroy();
                    eliminatedCount++;
                }
            });
            if (slotFlyPos) {
                gameMain.spawnShatterScoreFly(slotFlyPos);
                spawnedShatterFly = true;
            }

            // 4.3 障碍物处理：
            const isRotaryCenter = gameMain.isRotarySwitchCenter(coord.r, coord.c);
            if (!isRotaryCenter) {
                // 如果是 102 障碍石块，执行炸碎销毁并移除障碍打通道路
                const stone = gameMain.getStoneBlock(coord.r, coord.c);
                if (stone) {
                    stone.destroyStone();
                    gameMain.removeStoneBlock(stone);
                }
                gridMgr.unregisterObstacle(coord.r, coord.c);
            }
        });

        // 4.4 检查场上的冰块并同步破冰
        if (gameMain && (gameMain as any)._iceBlocks) {
            const iceBlocks: any[] = (gameMain as any)._iceBlocks;
            iceBlocks.forEach(ice => {
                if (ice && !ice.isUnlocked) {
                    const isNeighbor = neighborCoords.some(nc => nc.r === ice.r && nc.c === ice.c);
                    if (isNeighbor) {
                        ice.breakIce();
                    }
                }
            });
        }

        if (eliminatedCount > 0) {
            gameMain.notifyBlockCleared(eliminatedCount, spawnedShatterFly);
        }

        // 5. 结算与复位
        this.finishPropAction(onComplete);
    }

    // ======================================== 🔨 锤子 (Hammer) 核心 3D 表现与整堆敲碎 ========================================
    /**
     * 执行锤子 (Hammer) 道具：
     * 1. 阶段 1: 在目标方块右下方生成 3D 锤子，沿 135 度方向后仰 30 度蓄力；
     * 2. 阶段 2: 极速顺势往左上方下砸重击 (-90度, 0.14s)；
     * 3. 阶段 3: 锤头正中砸下方块中心，相机震动，该槽位整堆方块全部出栈消除；
     * 4. 阶段 4: 锤子轻微反弹后极速缩小淡出销毁；
     * 5. 阶段 5: 关卡状态检测与胜负判定，重置道具交互状态。
     * @param targetR 目标行号
     * @param targetC 目标列号
     * @param onComplete 完成回调
     */
    public executeHammer(targetR: number, targetC: number, onComplete?: () => void) {
        if (this._isExecutingAnim) return;
        this._isExecutingAnim = true;

        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) {
            this._isExecutingAnim = false;
            return;
        }

        const topBlock = gridMgr.getTopBlock(targetR, targetC);
        if (!topBlock || !topBlock.node || !topBlock.node.isValid) {
            this._isExecutingAnim = false;
            return;
        }

        this.clearCrosshairs();
        GameData.instance.useProp('HAMMER');

        // 1. 获取目标方块局部世界坐标与右下方手柄侧向杠杆偏移量 (沿 45 度斜对角线)
        const blockPos = topBlock.node.position;
        const handleOffset = 0.36; // 锤柄长度
        const diagOffset = handleOffset * Math.cos(Math.PI / 4); // 约 0.255，右下方 (+X, +Z) 偏移
        const targetPos = new Vec3(blockPos.x + diagOffset, blockPos.y + 0.06, blockPos.z + diagOffset);
        const chargePos = new Vec3(blockPos.x + diagOffset, blockPos.y + 0.16, blockPos.z + diagOffset);
        const spawnPos = new Vec3(blockPos.x + diagOffset, blockPos.y + 0.10, blockPos.z + diagOffset);

        // 2. 实例化锤子节点并执行从右下方往左上方的 3D 挥砸动画
        const spawnHammerNode = (prefab: Prefab) => {
            const hammerNode = instantiate(prefab);
            hammerNode.name = `Prop_Hammer_${targetR}_${targetC}`;
            hammerNode.setParent(gameMain.gridContainer);

            // 初始自然立于方块右下方 (Y 轴转向 135 度，瞄准左上方)
            hammerNode.setPosition(spawnPos);
            hammerNode.setRotationFromEuler(0, 135, 0);
            hammerNode.setScale(new Vec3(1, 1, 1));

            // ================= 阶段 1: 右下方后仰抬起至 30 度蓄力 (0.18s) =================
            tween(hammerNode)
                .to(0.18, {
                    position: chargePos,
                    eulerAngles: new Vec3(0, 135, 30)
                }, { easing: 'quadOut' })
                // ================= 阶段 2: 极速往左上方顺势下砸重击 (-90度, 0.14s) =================
                .to(0.14, {
                    position: targetPos,
                    eulerAngles: new Vec3(0, 135, -90)
                }, { easing: 'quadIn' })
                .call(() => {
                    // ================= 阶段 3: 命中敲碎整堆方块与强烈震屏 =================
                    if (gameMain.mainCamera) {
                        this.shakeCamera(gameMain.mainCamera.node, 0.22, 0.18);
                    }

                    // 弹出并销毁该槽位的一整堆方块 (全部层级)
                    const poppedBlocks = gridMgr.popAllBlocksInSlot(targetR, targetC);
                    let eliminatedCount = 0;
                    let shatterFlyPos: Vec3 | null = null;
                    poppedBlocks.forEach(b => {
                        if (b && b.node && b.node.isValid) {
                            if (!shatterFlyPos) shatterFlyPos = b.node.worldPosition.clone();
                            BrokenParticle.play(b, gameMain.gridContainer);
                            b.state = BlockState.DESTROYED;
                            // 直接隐藏销毁 (后续接入碎石粒子)
                            b.node.active = false;
                            b.node.destroy();
                            eliminatedCount++;
                        }
                    });

                    // 1. 若方块停靠在 P 停车位上，必须立即释放该停车位的占用
                    const stopSlot = gridMgr.getStopSlot(targetR, targetC);
                    if (stopSlot) {
                        poppedBlocks.forEach(b => stopSlot.releaseBlock(b));
                    }

                    // 2. 若该槽位是 1101 多层生成井，通知生成井当前批次方块已清除，正常升起下一批次
                    const multiLayerComp = gridMgr.getMultiLayerBlock(targetR, targetC);
                    if (multiLayerComp) {
                        multiLayerComp.onCurrentBatchLaunched();
                    }

                    // 3. 联动解锁周围相邻的 1001 神秘盲盒
                    gameMain.triggerAdjacentMysteryBlocks(targetR, targetC);

                    // 4. 刷新关卡消除计数 (同步驱动 901 伸缩柱翻转等)，飞分从碎裂点起飞
                    if (eliminatedCount > 0) {
                        if (shatterFlyPos) {
                            gameMain.spawnShatterScoreFly(shatterFlyPos);
                            gameMain.notifyBlockCleared(eliminatedCount, true);
                        } else {
                            gameMain.notifyBlockCleared(eliminatedCount);
                        }
                    }

                    // ================= 阶段 4: 锤子反弹与缩小退场 (0.15s) =================
                    const reboundPos = new Vec3(targetPos.x, targetPos.y + 0.18, targetPos.z);
                    tween(hammerNode)
                        .to(0.15, {
                            position: reboundPos,
                            eulerAngles: new Vec3(0, 135, -45),
                            scale: new Vec3(0.01, 0.01, 0.01)
                        }, { easing: 'quadOut' })
                        .call(() => {
                            if (hammerNode && hammerNode.isValid) {
                                hammerNode.destroy();
                            }
                            // ================= 阶段 5: 结算与复位 =================
                            this.finishPropAction(onComplete);
                        })
                        .start();
                })
                .start();
        };

        // 统一使用纯代码动态缓存加载
        this.getOrLoadPrefab(PropsManager.PREFAB_PATHS.HAMMER, (prefab) => {
            spawnHammerNode(prefab);
        });
    }

    // ======================================== ➕ 加步数 (Add Moves) 即时生效 ========================================
    /**
     * 执行加步数道具 (+5 步，全局即时生效，无需 3D 瞄准拾取)
     * @param addCount 增加的步数 (默认 5)
     */
    public executeAddMoves(addCount: number = 5): boolean {
        const gameMain = GameMain.instance;
        if (!gameMain || !gameMain.isPlaying) return false;

        if (GameData.instance.getPropCount('ADD_MOVES') <= 0) {
            Remind.showTipRemind('Not enough props!');
            return false;
        }

        GameData.instance.useProp('ADD_MOVES');
        Audio.play(AudioId.propStep);

        gameMain.remainingSteps += addCount;
        // 兼容 Creator 增量编译缓存：运行时 GameMain 实例提供该方法。
        (gameMain as any).notifyStepsChanged();

        // 弹出使用加步数道具的浮窗提示
        Remind.showTipRemind(`+${addCount} Moves Added!`);
        return true;
    }

    // ======================================== 🎯 准星瞄准辅助提示 (Crosshair) ========================================
    /**
     * 在棋盘上所有无方块的空格子底座表面批量生成 3D 准星提示
     */
    public showEmptySlotCrosshairs() {
        this.clearCrosshairs();

        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) return;

        const allSlots = gridMgr.getAllRegisteredSlots();
        const emptySlots = allSlots.filter(s => gridMgr.isPureEmptySlot(s.r, s.c));
        if (emptySlots.length === 0) return;

        this.getOrLoadPrefab(PropsManager.PREFAB_PATHS.CROSSHAIR, (prefab) => {
            if (!this.isPropActive) return;

            emptySlots.forEach(slot => {
                const slotNode = gameMain.gridContainer.getChildByName(`Slot_${slot.r}_${slot.c}`);
                let posX = 0, posZ = 0;
                if (slotNode) {
                    posX = slotNode.position.x;
                    posZ = slotNode.position.z;
                } else {
                    const worldPos = HexMath.hexToWorld(slot.r, slot.c, 0, gameMain.hexRadius);
                    posX = worldPos.x - gameMain.currentCenterX;
                    posZ = worldPos.z - gameMain.currentCenterZ;
                }

                // 贴合底座凹槽表面 (新版 Floor.prefab 内胆 t 位于 local Y=0.096，故高度偏移为 0.105)，避免被底座穿模遮挡
                // 准星模型 (Props_Crosshair.fbx) 自身带有 -0.24 的几何偏心，需固定增加 +0.24 的 Z 轴补偿使其对准格子中心
                const crosshairYOffset = gameMain.floorPrefab ? 0.105 : 0.04;
                const crosshairZOffset = 0.24;
                const centerPos = new Vec3(posX, gameMain.slotPosY + crosshairYOffset, posZ + crosshairZOffset);

                const crosshairNode = instantiate(prefab);
                crosshairNode.name = `Crosshair_${slot.r}_${slot.c}`;
                crosshairNode.setParent(gameMain.gridContainer);
                crosshairNode.setPosition(centerPos);
                crosshairNode.setScale(new Vec3(1, 1, 1));

                // 细腻微动呼吸动画 (0.9s 一个完整周期)
                tween(crosshairNode)
                    .repeatForever(
                        tween()
                            .to(0.45, { scale: new Vec3(1.06, 1.06, 1.06) }, { easing: 'sineInOut' })
                            .to(0.45, { scale: new Vec3(0.96, 0.96, 0.96) }, { easing: 'sineInOut' })
                    )
                    .start();

                this._crosshairNodes.push(crosshairNode);
            });
        });
    }

    /**
     * 在棋盘上所有有彩色方块的槽位最顶层方块表面批量生成 3D 准星提示 (用于锤子等道具)
     */
    public showColoredBlockCrosshairs() {
        this.clearCrosshairs();

        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) return;

        const allSlots = gridMgr.getAllRegisteredSlots();
        const occupiedSlots = allSlots.filter(s => gridMgr.getSlotBlocks(s.r, s.c).length > 0);
        if (occupiedSlots.length === 0) return;

        this.getOrLoadPrefab(PropsManager.PREFAB_PATHS.CROSSHAIR, (prefab) => {
            if (!this.isPropActive || this._currentProp !== PropType.HAMMER) return;

            occupiedSlots.forEach(slot => {
                const topBlock = gridMgr.getTopBlock(slot.r, slot.c);
                if (!topBlock || !topBlock.node || !topBlock.node.isValid) return;

                const blockPos = topBlock.node.position;
                // 贴合最顶层方块表面 (方块中心 Y + 0.045)，加上 Z 轴修正
                const crosshairZOffset = 0.24;
                const centerPos = new Vec3(blockPos.x, blockPos.y + 0.045, blockPos.z + crosshairZOffset);

                const crosshairNode = instantiate(prefab);
                crosshairNode.name = `Crosshair_${slot.r}_${slot.c}`;
                crosshairNode.setParent(gameMain.gridContainer);
                crosshairNode.setPosition(centerPos);
                crosshairNode.setScale(new Vec3(1, 1, 1));

                // 细腻微动呼吸动画 (0.9s 一个完整周期)
                tween(crosshairNode)
                    .repeatForever(
                        tween()
                            .to(0.45, { scale: new Vec3(1.06, 1.06, 1.06) }, { easing: 'sineInOut' })
                            .to(0.45, { scale: new Vec3(0.96, 0.96, 0.96) }, { easing: 'sineInOut' })
                    )
                    .start();

                this._crosshairNodes.push(crosshairNode);
            });
        });
    }

    /**
     * 清理并淡出销毁所有棋盘上的准星提示节点
     */
    public clearCrosshairs() {
        if (this._crosshairNodes.length === 0) return;

        this._crosshairNodes.forEach(node => {
            if (node && node.isValid) {
                Tween.stopAllByTarget(node);
                tween(node)
                    .to(0.1, { scale: new Vec3(0.01, 0.01, 0.01) })
                    .call(() => {
                        if (node && node.isValid) {
                            node.destroy();
                        }
                    })
                    .start();
            }
        });
        this._crosshairNodes = [];
    }

    // ======================================== 🔩 电钻 (Drill) 核心 3D 表现与底座拆除 ========================================
    /**
     * 执行电钻 (Drill) 道具 (参考原版实机效果)：
     * 1. 阶段 1: 在目标底座上方生成 3D 电钻并快速旋转就位落到底座表面 (0.12s)；
     * 2. 阶段 2: 钻头贴着底座表面进行【极速旋转 + 高频上下冲击微震】钻探 (0.32s)，底座同步产生受力颤动；
     * 3. 阶段 3: 钻穿瞬间触发震屏冲击，电钻与底座【一同顺势向下强力钻透坠入地底】并缩小销毁 (0.22s)；
     * 4. 阶段 4: 从 HexGridManager 中注销该底座 (unregisterSlot)，打通出界通路，恢复游戏正常操作。
     * @param targetR 目标行号 (必须为空格子)
     * @param targetC 目标列号 (必须为空格子)
     * @param onComplete 完成回调
     */
    public executeDrill(targetR: number, targetC: number, onComplete?: () => void) {
        if (this._isExecutingAnim) return;
        this._isExecutingAnim = true;

        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) {
            this._isExecutingAnim = false;
            return;
        }

        GameData.instance.useProp('DRILL');

        // 1. 获取目标底座中心坐标 (精准对齐 slotPosY)
        const radius = gameMain.hexRadius;
        const worldPos = HexMath.hexToWorld(targetR, targetC, 0, radius);
        const posX = worldPos.x - gameMain.currentCenterX;
        const posZ = worldPos.z - gameMain.currentCenterZ;
        const baseY = gameMain.slotPosY;

        // 2. 实例化电钻并执行高速旋钻钻探动画
        this.getOrLoadPrefab(PropsManager.PREFAB_PATHS.DRILL, (drillPrefab) => {
            const drillNode = instantiate(drillPrefab);
            drillNode.name = `Prop_Drill_${targetR}_${targetC}`;
            drillNode.setParent(gameMain.gridContainer);

            // 初始生成在底座上方 (+0.35)
            const drillSpawnPos = new Vec3(posX, baseY + 0.35, posZ);
            const drillContactPos = new Vec3(posX, baseY + 0.02, posZ);
            const drillPressPos1 = new Vec3(posX, baseY + 0.00, posZ);
            const drillPressPos2 = new Vec3(posX, baseY + 0.04, posZ);

            drillNode.setPosition(drillSpawnPos);
            drillNode.setRotationFromEuler(0, 0, 0);
            drillNode.setScale(new Vec3(1, 1, 1));

            // 清理棋盘上所有的瞄准准星
            this.clearCrosshairs();

            const slotNode = gameMain.gridContainer.getChildByName(`Slot_${targetR}_${targetC}`);

            // ================= 阶段 1: 钻头就位落到底座表面 (0.12s) =================
            tween(drillNode)
                .to(0.12, {
                    position: drillContactPos,
                    eulerAngles: new Vec3(0, 360, 0)
                }, { easing: 'quadOut' })
                .call(() => {
                    // ================= 阶段 2: 高频冲击钻探阶段 (0.32s) =================
                    // 底座产生轻微受力震动
                    if (slotNode) {
                        tween(slotNode)
                            .repeat(4,
                                tween()
                                    .to(0.04, { position: new Vec3(posX + 0.008, baseY - 0.015, posZ) })
                                    .to(0.04, { position: new Vec3(posX - 0.008, baseY, posZ) })
                            )
                            .start();
                    }

                    // 钻头高速自旋 + 上下高频冲击微震 (模拟冲击钻钻探质感)
                    tween(drillNode)
                        .to(0.04, { position: drillPressPos1, eulerAngles: new Vec3(0, 540, 0) })
                        .to(0.04, { position: drillPressPos2, eulerAngles: new Vec3(0, 720, 0) })
                        .to(0.04, { position: drillPressPos1, eulerAngles: new Vec3(0, 900, 0) })
                        .to(0.04, { position: drillPressPos2, eulerAngles: new Vec3(0, 1080, 0) })
                        .to(0.04, { position: drillPressPos1, eulerAngles: new Vec3(0, 1260, 0) })
                        .to(0.04, { position: drillPressPos2, eulerAngles: new Vec3(0, 1440, 0) })
                        .to(0.04, { position: drillPressPos1, eulerAngles: new Vec3(0, 1620, 0) })
                        .to(0.04, { position: drillContactPos, eulerAngles: new Vec3(0, 1800, 0) })
                        .call(() => {
                            // ================= 阶段 3: 钻透瞬间！底座崩塌与钻头一同向下钻穿坠落 (0.22s) =================
                            if (gameMain.mainCamera) {
                                this.shakeCamera(gameMain.mainCamera.node, 0.22, 0.18);
                            }

                            const sinkTargetPos = new Vec3(posX, baseY - 0.5, posZ);

                            // 钻穿瞬间先保留底板位置播放碎片，再执行下沉销毁。
                            if (slotNode && slotNode.isValid) {
                                BrokenParticle.playFloor(slotNode, gameMain.gridContainer);
                            }

                            // 底座下沉穿透并销毁
                            if (slotNode) {
                                tween(slotNode)
                                    .to(0.22, {
                                        position: sinkTargetPos,
                                        scale: new Vec3(0.01, 0.01, 0.01)
                                    }, { easing: 'quadIn' })
                                    .call(() => {
                                        if (slotNode && slotNode.isValid) {
                                            slotNode.destroy();
                                        }
                                    })
                                    .start();
                            }

                            // 钻头顺势向下强力钻透穿过底座并销毁
                            tween(drillNode)
                                .to(0.22, {
                                    position: sinkTargetPos,
                                    eulerAngles: new Vec3(0, 2520, 0),
                                    scale: new Vec3(0.01, 0.01, 0.01)
                                }, { easing: 'quadIn' })
                                .call(() => {
                                    if (drillNode && drillNode.isValid) {
                                        drillNode.destroy();
                                    }

                                    // 数据层注销该底座，打通出界缺口
                                    gridMgr.unregisterSlot(targetR, targetC);

                                    // ================= 阶段 4: 结算与复位 =================
                                    this.finishPropAction(onComplete);
                                })
                                .start();
                        })
                        .start();
                })
                .start();
        });
    }

    // ======================================== 通用流程结算 ========================================
    /**
     * 结束当前道具动作，清空状态并结算
     */
    private finishPropAction(onComplete?: () => void) {
        this._isExecutingAnim = false;
        this._currentProp = PropType.NONE;
        this.clearCrosshairs();
        this.notifyPropChanged();

        if (GameMain.instance) {
            GameMain.instance.checkGameStatus();
        }

        if (onComplete) onComplete();
    }

    // ======================================== 视效与相机辅助工具 ========================================
    /**
     * 相机视口空间 3D 震动反馈 (沿相机屏幕视口右/上坐标轴震动，带指数衰减阻尼)
     * @param camNode 相机节点
     * @param duration 震动总时长 (秒)
     * @param strength 震动幅度 (世界单位)
     */
    private shakeCamera(camNode: Node, duration: number = 0.38, strength: number = 0.28) {
        if (!camNode || !camNode.isValid) return;

        const originPos = new Vec3(camNode.position);
        const startTime = Date.now();

        // 提取相机的视口局部坐标轴 (屏幕水平轴与屏幕垂直轴)
        const rightVec = camNode.right.clone();
        const upVec = camNode.up.clone();

        const shakeStep = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            if (elapsed >= duration || !camNode.isValid) {
                camNode.setPosition(originPos);
                return;
            }

            // 指数衰减阻尼
            const damping = Math.pow(1 - elapsed / duration, 1.4);
            const offsetX = (Math.random() * 2 - 1) * strength * damping;
            const offsetY = (Math.random() * 2 - 1) * strength * damping;

            const newPos = originPos.clone()
                .add(rightVec.clone().multiplyScalar(offsetX))
                .add(upVec.clone().multiplyScalar(offsetY));

            camNode.setPosition(newPos);
            setTimeout(shakeStep, 16);
        };

        shakeStep();
    }
}
