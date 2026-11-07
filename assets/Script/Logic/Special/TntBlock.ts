import { _decorator, Component, Node, Vec3, tween, Tween, v3 } from 'cc';
import { HexMath, HexCoord } from '../HexMath';
import { HexGridManager } from '../HexGridManager';
import { HexBlock, BlockState } from '../HexBlock';
import { GameMain } from '../GameMain';
import { BrokenParticle } from '../BrokenParticle';

const { ccclass, property } = _decorator;

// ======================================== 全方位 TNT 炸药桶控制器 ========================================
/**
 * 全方位 TNT 炸弹组件 (TntBlock / 元素代码 301)
 * 挂载在 Special_5_301.prefab (兼容 Special_5_201.prefab) 预制体上
 * 核心机制：
 * 1. 关卡开局时放置在指定六边形槽位，作为实体障碍占据网格；
 * 2. 触发方式：其他方块向前翻滚撞击 TNT 时触发碰撞引爆（亦支持直接点击引爆）；
 * 3. 爆炸动画：引信多段加速呼吸蓄力脉冲 -> 剧烈放大爆开与屏幕高冲击震动；
 * 4. 消除范围：瞬间摧毁自身以及周围相邻全部 6 个方向槽位内的所有方块与冰块；
 * 5. 爆炸完成后自动触发关卡胜负与通关检测！
 */
@ccclass('TntBlock')
export class TntBlock extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: 'TNT 炸药桶模型主体节点', group: { name: '节点引用', id: '0' } })
    public tntBodyNode: Node = null!;

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    /** 是否已触发引爆或正在爆炸中 */
    public isExploded: boolean = false;

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    private initNodeReferences() {
        if (!this.tntBodyNode) {
            this.tntBodyNode = this.node.getChildByName('TNT') ||
                this.node.getChildByPath('_201_pre/TNT') ||
                this.node;
        }
    }

    /**
     * 初始化 TNT 炸弹
     * @param r 行号
     * @param c 列号
     */
    public initTnt(r: number, c: number) {
        this.r = r;
        this.c = c;
        this.isExploded = false;
        this.initNodeReferences();
    }

    // ======================================== 核心引爆与范围消除逻辑 ========================================
    /**
     * 触发引爆流程 (直接瞬间爆炸并范围消除)
     * @param isChainReaction 是否为相邻炸弹连环引爆 (连环引爆不重复扣除玩家步数)
     * @param onComplete 爆炸完成回调
     */
    public triggerExplosion(isChainReaction: boolean = false, onComplete?: () => void) {
        if (this.isExploded) {
            return;
        }

        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr || !gameMain.isPlaying) return;

        this.isExploded = true;

        // 仅首发操作扣除 1 个关卡步数并触发方案 B 冰块倒数 -1，连锁爆炸不扣步数
        if (!isChainReaction) {
            gameMain.consumeOneStep();
        }

        // 直接瞬间爆炸、震屏与范围清除 (无延迟放大缩小)
        this.executeExplosion(onComplete);
    }

    /**
     * 执行实际瞬间爆炸摧毁与范围清除
     */
    private executeExplosion(onComplete?: () => void) {
        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) return;

        // 1. 注销自身在网格中的 TNT 与障碍物标记并销毁自身节点
        gridMgr.unregisterTnt(this.r, this.c);
        this.node.destroy();

        // 2. 晃动屏幕 (高冲击力相机震动)
        if (gameMain.mainCamera) {
            this.shakeCamera(gameMain.mainCamera.node, 0.35, 0.25);
        }

        // 3. 获取周围相邻 6 个方向的槽位坐标
        const neighborCoords = HexMath.getAllNeighbors(this.r, this.c);

        // 4. 周围相邻 6 个方向上的方块、冰块与相邻 TNT 连环引爆
        let eliminatedCount = 0;
        let spawnedShatterFly = false;

        neighborCoords.forEach(coord => {
            // 4.1 检查相邻槽位是否包含其他未引爆的 TNT 炸弹 -> 触发连环引爆！
            const neighborTnt = gridMgr.getTnt(coord.r, coord.c);
            if (neighborTnt && neighborTnt.node && neighborTnt.node.isValid && !neighborTnt.isExploded) {
                // 极短错峰微延迟 (0.06s)，形成节奏极爽的连环爆炸视觉冲击
                neighborTnt.scheduleOnce(() => {
                    if (neighborTnt.node && neighborTnt.node.isValid && !neighborTnt.isExploded) {
                        neighborTnt.triggerExplosion(true);
                    }
                }, 0.06);
            }

            // 4.2 清除可能存在的普通/特殊彩色方块
            const poppedBlocks = gridMgr.popAllBlocksInSlot(coord.r, coord.c);
            if (poppedBlocks.length > 0) {
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

                // 若方块原停靠在 P 停车位，释放该停车位占用
                const stopSlot = gridMgr.getStopSlot(coord.r, coord.c);
                if (stopSlot) {
                    poppedBlocks.forEach(b => stopSlot.releaseBlock(b));
                }

                // 若该槽位是 1101 多层生成井，通知生成井当前批次已清除，以便升起下一批次
                const multiLayer = gridMgr.getMultiLayerBlock(coord.r, coord.c);
                if (multiLayer) {
                    multiLayer.onCurrentBatchLaunched();
                }

                // 联动解锁周围相邻的 1001 神秘盲盒
                gameMain.triggerAdjacentMysteryBlocks(coord.r, coord.c);
            }

            // 4.3 障碍物处理：
            // A. 如果是旋转连杆机关中心底座，严禁注销障碍，保护其不可穿透核心特性
            const isRotaryCenter = gameMain.isRotarySwitchCenter(coord.r, coord.c);
            if (!isRotaryCenter) {
                // B. 如果是 102 障碍石块，执行炸碎受力销毁并打通通行道路
                const stone = gameMain.getStoneBlock(coord.r, coord.c);
                if (stone) {
                    stone.destroyStone();
                    gameMain.removeStoneBlock(stone);
                }
                gridMgr.unregisterObstacle(coord.r, coord.c);
            }
        });

        // 检查场上的冰块并同步破冰
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


        // 刷新关卡消除计数 (同步驱动 901 伸缩柱翻转；飞分已按槽位入账)
        if (eliminatedCount > 0) {
            gameMain.notifyBlockCleared(eliminatedCount, spawnedShatterFly);
        }

        // 5. 延迟检查胜负与关卡状态
        this.scheduleOnce(() => {
            if (gameMain) {
                gameMain.checkGameStatus();
            }
            if (onComplete) onComplete();
        }, 0.2);
    }

    /** 全局缓存的相机基准原始位置，避免连环爆炸期间把相机震偏 */
    private static _cameraOriginPos: Vec3 | null = null;

    /**
     * 高冲击力相机震屏动效
     */
    private shakeCamera(cameraNode: Node, duration: number = 0.35, magnitude: number = 0.25) {
        // 如果当前没有正在震动，才记录基准初始位置；如果正在震动中，必须严格保持最初的原始位置！
        if (!TntBlock._cameraOriginPos) {
            TntBlock._cameraOriginPos = cameraNode.getPosition().clone();
        }
        const originPos = TntBlock._cameraOriginPos;

        // 停止之前的震动动画，先精准归位到基准位置，彻底避免震动叠加导致相机永久偏位
        Tween.stopAllByTarget(cameraNode);
        cameraNode.setPosition(originPos);

        const sampleCount = Math.floor(duration / 0.03);
        let tw = tween(cameraNode);

        for (let i = 0; i < sampleCount; i++) {
            const decay = 1 - (i / sampleCount);
            const offsetX = (Math.random() - 0.5) * 2 * magnitude * decay;
            const offsetY = (Math.random() - 0.5) * 2 * magnitude * decay;
            tw = tw.to(0.03, { position: v3(originPos.x + offsetX, originPos.y + offsetY, originPos.z) });
        }

        tw.to(0.04, { position: originPos }, { easing: 'quadOut' })
            .call(() => {
                cameraNode.setPosition(originPos);
                TntBlock._cameraOriginPos = null;
            })
            .start();
    }
}
