import { _decorator, Component, Node, Vec3, tween, Material, MeshRenderer, Quat, instantiate } from 'cc';
import { HexCoord, HexMath } from '../HexMath';
import { HexBlock, BlockState } from '../HexBlock';
import { HexGridManager } from '../HexGridManager';
import { GameMain } from '../GameMain';
import { GearBlock } from './GearBlock';
import { StopBlock } from './StopBlock';
import { BrokenBlock } from './BrokenBlock';

const { ccclass, property } = _decorator;

// ======================================== 1201~1206 GoPauseBlock 前进撞击暂停方块 ========================================
/**
 * 1201~1206 GoPauseBlock 控制器 (Special_12_1201.prefab)
 * 对应美术目录: 12_GoPauseBlock
 * 核心机制：
 * 1. 玩家点击红色/主题色 GoPauseBlock 启动向前行进 (Go)；
 * 2. 途中若前方一路畅通无阻，直接翻滚飞出棋盘消除；
 * 3. 途中若撞到其他方块，在其后方一格紧急停下 (Pause)；
 * 4. 碰撞与连锁推挤判定 (Chain Reaction 连带反应)：
 *    - 撞到普通方块 (HexBlock)：若该方块前方通畅可飞出，前方方块刚翻出当前槽位 (~0.14s)，本方块立即如影随形丝滑跟进；出不去则整条链条受击抖动并在此驻留；
 *    - 撞到另一个 GoPauseBlock：递归检测前方 GoPauseBlock 能否继续向前推移；若可以，前方 GoPauseBlock 率先推进，后方紧密丝滑跟进！
 * 
 * 动力学翻滚表现（与普通方块 HexBlock.ts 完全 1:1 绝对一致）：
 * - 单格翻滚角度严格为 180° (Math.PI * t)，角速度与普通块 100% 同速，杜绝 360° 狂转抽搐；
 * - 物理抛物线起伏拱高 arcHeight = 0.25，与 HexBlock.playFlyAwayAnim 绝对一致；
 * - 3 层方块 (hx_1, hx_2, hx_3) 同心独立旋转，由顶层至底层错峰多米诺连环翻跟头 (delay = (2 - layer) * 0.04s)；
 * - 顶面与底面双向镜像指示箭头，无论翻滚 180° 还是 360°，朝上一面永远呈现清晰指示箭头！
 */
@ccclass('GoPauseBlock')
export class GoPauseBlock extends Component {
    // ======================================== 网格与状态属性 ========================================
    /** 当前槽位行号 */
    public r: number = 0;
    /** 当前槽位列号 */
    public c: number = 0;
    /** 前进逃逸方向 (1~6 对应 6 个六边形标准邻接方向) */
    public dir: number = 1;
    /** 特殊类型编号 (1201 ~ 1206) */
    public rawType: number = 1201;

    /** 是否正在运动/处理中 */
    public isMoving: boolean = false;
    /** 是否已被彻底销毁/飞出 */
    public isDestroyed: boolean = false;

    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '模型根节点 (_1201_1206_pre)', group: { name: '节点引用', id: '0' } })
    public modelRoot: Node = null!;

    @property({ type: Node, tooltip: '底层六边形块 (hx_1)', group: { name: '节点引用', id: '0' } })
    public hx1: Node = null!;

    @property({ type: Node, tooltip: '中层六边形块 (hx_2)', group: { name: '节点引用', id: '0' } })
    public hx2: Node = null!;

    @property({ type: Node, tooltip: '顶层六边形块 (hx_3)', group: { name: '节点引用', id: '0' } })
    public hx3: Node = null!;

    @property({ type: Node, tooltip: '指示箭头节点 (arrow_1)', group: { name: '节点引用', id: '0' } })
    public arrowNode: Node = null!;

    @property({ type: Node, tooltip: '底面镜像箭头节点 (可选)', group: { name: '节点引用', id: '0' } })
    public bottomArrowNode: Node = null!;

    /** 3 个同心旋转容器层 (Layer_0, Layer_1, Layer_2) */
    public layerNodes: Node[] = [];
    private _layerYOffsets: number[] = [0.06, 0.14, 0.22];

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    private findChildRecursive(parent: Node, name: string): Node | null {
        if (!parent) return null;
        const direct = parent.getChildByName(name);
        if (direct) return direct;
        for (const child of parent.children) {
            const found = this.findChildRecursive(child, name);
            if (found) return found;
        }
        return null;
    }

    private initNodeReferences() {
        if (!this.modelRoot) {
            this.modelRoot = this.node.getChildByName('_1201_1206_pre') || this.node;
        }
        if (!this.modelRoot) return;

        // 保持模型根节点 (0, 0, 0) 无额外旋转，使六边形底座与棋盘网格绝对对齐
        this.modelRoot.setRotationFromEuler(0, 0, 0);

        if (this.layerNodes.length === 3) return;

        const gameMain = GameMain.instance;
        const basePosY = gameMain ? gameMain.blockBasePosY : 0.06;
        const layerH = gameMain ? gameMain.layerHeight : 0.08;
        this._layerYOffsets = [
            basePosY + 0 * layerH,
            basePosY + 1 * layerH,
            basePosY + 2 * layerH
        ];

        // 彻底防御：确保 hx1, hx2, hx3, arrowNode 是真正的叶子模型部件，绝对不能是 modelRoot 或根节点自身
        if (!this.hx1 || this.hx1 === this.modelRoot || this.hx1 === this.node || this.hx1.name !== 'hx_1') {
            this.hx1 = this.findChildRecursive(this.modelRoot, 'hx_1')!;
        }
        if (!this.hx2 || this.hx2 === this.modelRoot || this.hx2 === this.node || this.hx2.name !== 'hx_2') {
            this.hx2 = this.findChildRecursive(this.modelRoot, 'hx_2')!;
        }
        if (!this.hx3 || this.hx3 === this.modelRoot || this.hx3 === this.node || this.hx3.name !== 'hx_3') {
            this.hx3 = this.findChildRecursive(this.modelRoot, 'hx_3')!;
        }
        if (!this.arrowNode || this.arrowNode === this.modelRoot || this.arrowNode === this.node || !this.arrowNode.name.includes('arrow')) {
            this.arrowNode = this.findChildRecursive(this.modelRoot, 'arrow')!;
        }

        const hxList = [this.hx1, this.hx2, this.hx3];
        this.layerNodes = [];

        // 构造 3 个与 HexBlock 同心的独立旋转容器层 (Layer_0, Layer_1, Layer_2)
        // 使得每个容器层的原点 (0, 0, 0) 均落在该槽位正中心，消除模型部件偏心问题
        for (let i = 0; i < 3; i++) {
            let layerContainer = this.modelRoot.getChildByName(`Layer_${i}`);
            if (!layerContainer) {
                layerContainer = new Node(`Layer_${i}`);
                layerContainer.setParent(this.modelRoot);
            }
            layerContainer.setPosition(0, this._layerYOffsets[i], 0);
            layerContainer.setRotationFromEuler(0, 0, 0);
            layerContainer.setScale(Vec3.ONE);

            const hx = hxList[i];
            if (hx && hx !== this.modelRoot && hx !== this.node) {
                hx.setParent(layerContainer);
                hx.setPosition(0, 0, 0.25);
                hx.setRotationFromEuler(0, 0, 0);
                hx.setScale(Vec3.ONE);
            }

            if (i === 2 && this.arrowNode) {
                this.arrowNode.setParent(layerContainer);
                this.arrowNode.setPosition(0, 0.02, 0);
                this.arrowNode.setScale(Vec3.ONE);

                // 在 Layer_2 底面镜像挂载双面箭头：
                // 这样无论方块每步按标准 180° 翻滚，翻到哪一面，朝上一面永远有清晰的指示箭头！
                let bottomArrow = layerContainer.getChildByName('arrow_bottom');
                if (!bottomArrow) {
                    bottomArrow = instantiate(this.arrowNode);
                    bottomArrow.name = 'arrow_bottom';
                    bottomArrow.setParent(layerContainer);
                    bottomArrow.setPosition(0, -0.02, 0);
                    bottomArrow.setScale(Vec3.ONE);
                }
                this.bottomArrowNode = bottomArrow;
            }

            this.layerNodes.push(layerContainer);
        }
    }

    /**
     * 初始化 GoPauseBlock
     * @param r 行号
     * @param c 列号
     * @param rawType 1201 ~ 1206
     * @param colorMat 对应方向的主题色材质
     */
    public initGoPauseBlock(r: number, c: number, rawType: number, colorMat?: Material) {
        this.r = r;
        this.c = c;
        this.rawType = rawType;
        this.dir = (rawType >= 1201 && rawType <= 1206) ? (rawType - 1200) : 1;
        this.isMoving = false;
        this.isDestroyed = false;

        this.initNodeReferences();

        // 旋转指示箭头到指示方向 (六边形本体保持与底座严丝合缝对齐，与 HexBlock 完全一致)
        const arrowAngle = HexMath.getArrowAngleY(this.dir, this.c);
        if (this.arrowNode) {
            this.arrowNode.setRotationFromEuler(0, arrowAngle, 0);
        }
        if (this.bottomArrowNode) {
            // 底面箭头方向精确对齐：
            // 当方块整体绕 rollAxis 翻滚 180° 后，位于底面的 bottomArrowNode 恰好翻转朝上 (+Y)
            // 根据四元数几何逆运算：R_bottom = R_rollAxis180 * R_arrow
            // 翻转后其世界朝向为 R_rollAxis180 * R_bottom = (R_rollAxis180)^2 * R_arrow = R_arrow
            // 保证 180° 翻滚落座后，朝上的指示箭头与初始方向 100% 绝对一致！
            const hexRadius = (GameMain.instance ? GameMain.instance.hexRadius : HexMath.DEFAULT_RADIUS);
            const dirVec = HexMath.getDirVector3D(this.dir, this.c, hexRadius);
            const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();

            const rArrow = new Quat();
            Quat.fromEuler(rArrow, 0, arrowAngle, 0);

            const rRoll180 = new Quat();
            Quat.fromAxisAngle(rRoll180, rollAxis, Math.PI);

            const rBottom = new Quat();
            Quat.multiply(rBottom, rRoll180, rArrow);
            this.bottomArrowNode.setRotation(rBottom);
        }

        // 应用对应方向的主题色材质到 hx_1, hx_2, hx_3
        if (colorMat) {
            [this.hx1, this.hx2, this.hx3].forEach(hexNode => {
                if (hexNode) {
                    const mr = hexNode.getComponent(MeshRenderer);
                    if (mr) {
                        mr.setMaterial(colorMat, 0);
                    }
                }
            });
        }
    }

    // ======================================== 核心点击交互与运动流水线 ========================================
    /**
     * 响应玩家点击
     */
    public onClick() {
        if (this.isMoving || this.isDestroyed) return;

        const gameMain = GameMain.instance;
        if (!gameMain || !gameMain.isPlaying) return;

        // 每次点击消耗 1 步并触发方案 B 冰块倒数 -1
        gameMain.consumeOneStep();

        this.isMoving = true;
        this.executeMovement();
    }

    /**
     * 由后方方块连锁推挤触发本 GoPauseBlock 向前行进 (不消耗玩家操作步数)
     * @param onVacated 本方块脱离原槽位并使其空出时的回调 (通知后方方块跟进)
     */
    public triggerChainAdvance(onVacated?: () => void) {
        if (this.isMoving || this.isDestroyed) {
            if (onVacated) onVacated();
            return;
        }
        this.isMoving = true;
        this.executeMovement(onVacated);
    }

    /**
     * 预测检测：本 GoPauseBlock 是否能够前移至少 1 格并腾空当前槽位 (支持递归连锁检测)
     */
    public checkCanClearSlot(visited: Set<GoPauseBlock> = new Set()): boolean {
        if (visited.has(this) || this.isDestroyed) {
            return false;
        }
        visited.add(this);

        const gridMgr = HexGridManager.instance;
        if (!gridMgr) return false;

        let currR = this.r;
        let currC = this.c;
        let dir = this.dir;

        const nextCoord = HexMath.getNeighborCoord(currR, currC, dir);

        // 1. 如果前方直接是棋盘外边界 -> 必定可以飞出腾空槽位
        if (!gridMgr.hasSlot(nextCoord.r, nextCoord.c)) {
            return true;
        }

        // 2. 如果前方是 701 旋转锯齿轮 (规则 A: 切碎消除) -> 必定可以腾空槽位
        if (gridMgr.getSaw(nextCoord.r, nextCoord.c)) {
            return true;
        }

        // 3. 如果前方是 101 P 停车位 (规则 B: 空闲入库停靠)
        const stopSlot = gridMgr.getStopSlot(nextCoord.r, nextCoord.c);
        if (stopSlot) {
            return !stopSlot.isOccupied;
        }

        // 4. 如果前方是普通六边形方块 (HexBlock)
        const topBlock = gridMgr.getTopBlock(nextCoord.r, nextCoord.c);
        if (topBlock && topBlock.state !== BlockState.DESTROYED) {
            const pathInfo = gridMgr.checkPathInfo(topBlock);
            return pathInfo.canFly;
        }

        // 5. 如果前方是另一个 GoPauseBlock
        const nextGoPause = gridMgr.getGoPauseBlock(nextCoord.r, nextCoord.c);
        if (nextGoPause && !nextGoPause.isDestroyed) {
            return nextGoPause.checkCanClearSlot(visited);
        }

        // 6. 如果前方是不可穿透固定障碍
        if (gridMgr.hasObstacle(nextCoord.r, nextCoord.c)) {
            return false;
        }

        // 7. 前方为空闲槽位 -> 至少可以前进 1 格，必定可以腾空当前槽位
        return true;
    }

    /**
     * 沿链条向前方传递受阻抖动动效
     */
    public playChainWobble(visited: Set<GoPauseBlock> = new Set()) {
        if (visited.has(this)) return;
        visited.add(this);

        this.playWobbleAnim();

        const gridMgr = HexGridManager.instance;
        if (!gridMgr) return;

        const nextCoord = HexMath.getNeighborCoord(this.r, this.c, this.dir);
        const nextBlock = gridMgr.getTopBlock(nextCoord.r, nextCoord.c);
        if (nextBlock && nextBlock.state !== BlockState.DESTROYED) {
            nextBlock.playWobbleAnim();
        }

        const nextGoPause = gridMgr.getGoPauseBlock(nextCoord.r, nextCoord.c);
        if (nextGoPause && !nextGoPause.isDestroyed) {
            nextGoPause.playChainWobble(visited);
        }
    }

    /**
     * 执行向前移动检测与连锁接力流水线 (3 层方块连环翻滚，与普通色块 3 个一起翻滚手感完全一致)
     * @param onFirstStepVacated 当本方块离开原槽位完成腾空时的回调 (用于后方连锁推进)
     */
    public executeMovement(onFirstStepVacated?: () => void) {
        const gridMgr = HexGridManager.instance;
        const gameMain = GameMain.instance;
        if (!gridMgr || !gameMain || this.isDestroyed) return;

        let currR = this.r;
        let currC = this.c;
        let currDir = this.dir;

        const stepCoords: HexCoord[] = [];
        let hitBlock: HexBlock | null = null;
        let hitGoPause: GoPauseBlock | null = null;
        let hitSaw: GearBlock | null = null;
        let hitStopSlot: StopBlock | null = null;
        let isExit = false;
        const brokenBlocksToCollapse: BrokenBlock[] = [];

        // 1. 沿方向逐格扫描前方网格 (最多 30 步，支持转向板动态折射变向)
        for (let step = 1; step <= 30; step++) {
            const nextCoord = HexMath.getNeighborCoord(currR, currC, currDir);

            // A. 检测是否已经跨出棋盘边界 (无阻挡直接出界)
            if (!gridMgr.hasSlot(nextCoord.r, nextCoord.c)) {
                isExit = true;
                // 将界外目标格加入步数，让它顺滑翻滚出棋盘界外
                stepCoords.push(nextCoord);
                const extraExitCoord = HexMath.getNeighborCoord(nextCoord.r, nextCoord.c, currDir);
                stepCoords.push(extraExitCoord);
                break;
            }

            // B. 检测前方是否有未引爆的 TNT 炸弹 -> 阻挡停下
            if (gridMgr.getTnt(nextCoord.r, nextCoord.c)) {
                break;
            }

            // C. 检测前方是否为 701 旋转锯齿轮 (规则 A: 切碎消除)
            const saw = gridMgr.getSaw(nextCoord.r, nextCoord.c);
            if (saw) {
                stepCoords.push(nextCoord);
                currR = nextCoord.r;
                currC = nextCoord.c;
                hitSaw = saw;
                break;
            }

            // D. 检测前方是否为 101 P 停车位 (规则 B: 若空闲则入库停靠)
            const stopSlot = gridMgr.getStopSlot(nextCoord.r, nextCoord.c);
            if (stopSlot) {
                if (!stopSlot.isOccupied) {
                    stepCoords.push(nextCoord);
                    currR = nextCoord.r;
                    currC = nextCoord.c;
                    hitStopSlot = stopSlot;
                    break;
                } else {
                    // 已被占用 -> 视为阻挡受阻
                    break;
                }
            }

            // E. 检测当前格是否有普通方块阻挡
            const topBlock = gridMgr.getTopBlock(nextCoord.r, nextCoord.c);
            if (topBlock && topBlock.state !== BlockState.DESTROYED) {
                hitBlock = topBlock;
                break;
            }

            // F. 检测当前格是否有另一个 GoPauseBlock 阻挡
            const otherGoPause = gridMgr.getGoPauseBlock(nextCoord.r, nextCoord.c);
            if (otherGoPause && otherGoPause !== this && !otherGoPause.isDestroyed) {
                hitGoPause = otherGoPause;
                break;
            }

            // G. 检测当前格是否有不可穿透固定障碍 (石头、关闭的伸缩柱等)
            if (gridMgr.hasObstacle(nextCoord.r, nextCoord.c)) {
                break;
            }

            // H. 检测当前格是否为 801 易碎崩塌地块
            const broken = gridMgr.getBrokenBlock(nextCoord.r, nextCoord.c);
            if (broken && !broken.isBroken) {
                brokenBlocksToCollapse.push(broken);
            }

            stepCoords.push(nextCoord);
            currR = nextCoord.r;
            currC = nextCoord.c;

            // I. 检测当前格是否为导向转向板 (TurnBlock / 1701 RandomTurnBlock) -> 动态折射更新朝向！
            const pad = gridMgr.getRedirectPad(nextCoord.r, nextCoord.c);
            if (pad) {
                currDir = pad.targetDir;
            }
        }

        const startR = this.r;
        const startC = this.c;
        const stopR = currR;
        const stopC = currC;
        const numSteps = stepCoords.length;

        if (numSteps > 0) {
            // 移动期间注销原坐标网格占用
            gridMgr.unregisterObstacle(startR, startC);
            gridMgr.unregisterGoPauseBlock(startR, startC);
            const prevStop = gridMgr.getStopSlot(startR, startC);
            if (prevStop) {
                prevStop.releaseBlock(this as any);
            }

            const stepDuration = gameMain.rollStepDuration || 0.16;
            const layerRollInterval = gameMain.layerRollInterval || 0.04;
            const hexRadius = gameMain.hexRadius || HexMath.DEFAULT_RADIUS;
            const arcHeight = 0.25;

            const layers = this.layerNodes;
            let completedLayers = 0;

            layers.forEach((layerNode, layerIdx) => {
                if (!layerNode) {
                    completedLayers++;
                    return;
                }

                // 错峰翻滚延时：顶层 (layer 2) 最先翻滚 (delay = 0)，中层与底层依次延后形成多米诺连环翻滚
                const delay = (layers.length - 1 - layerIdx) * layerRollInterval;
                const basePosY = this._layerYOffsets[layerIdx];

                let currentStep = 0;
                let currentPos = new Vec3(0, basePosY, 0);
                let currentRot = layerNode.rotation.clone();

                const runStepRoll = () => {
                    if (currentStep >= numSteps) {
                        completedLayers++;
                        if (completedLayers >= layers.length) {
                            if (isExit) {
                                // 3 层方块全部顺畅翻滚出棋盘界外！直接顺势自由落体下坠消除！
                                this.isDestroyed = true;
                                this.isMoving = false;

                                if (onFirstStepVacated) {
                                    const cb = onFirstStepVacated;
                                    onFirstStepVacated = undefined;
                                    cb();
                                }

                                // 触发经过的 801 易碎地块崩塌
                                brokenBlocksToCollapse.forEach(b => {
                                    if (b && b.isValid && !b.isBroken) {
                                        b.playCollapseAnim();
                                    }
                                });

                                const fallDistance = 2.0;
                                const fallDuration = 0.25;
                                let destroyedLayers = 0;

                                const firstFallLayer = layers.find(l => !!l) || null;
                                if (firstFallLayer) {
                                    gameMain.spawnFallScoreFly(firstFallLayer.worldPosition.clone(), `gopause-hole-${this.node.uuid}`);
                                }

                                layers.forEach((lNode) => {
                                    if (!lNode) {
                                        destroyedLayers++;
                                        return;
                                    }
                                    const startPos = lNode.position.clone();
                                    const fallProgress = { t: 0 };
                                    tween(fallProgress)
                                        .to(fallDuration, { t: 1 }, {
                                            easing: 'linear',
                                            onUpdate: (tgt: { t: number }) => {
                                                lNode.setPosition(startPos.x, startPos.y - fallDistance * tgt.t, startPos.z);
                                            }
                                        })
                                        .call(() => {
                                            lNode.destroy();
                                            destroyedLayers++;
                                            if (destroyedLayers >= layers.length) {
                                                gameMain.notifyBlockCleared(layers.length, true);
                                                gameMain.checkGameStatus();
                                                this.node.destroy();
                                            }
                                        })
                                        .start();
                                });
                                return;
                            }

                            // 非出界分支：3 层方块全部翻滚到达目标槽位 (停留棋盘内)
                            this.r = stopR;
                            this.c = stopC;
                            this.dir = currDir; // 更新为经过转向板后的最新朝向

                            // 将整组根节点移动至目标槽位世界位置
                            const targetWorldPos = HexMath.hexToWorld(stopR, stopC, 0, hexRadius);
                            this.node.setPosition(
                                targetWorldPos.x - gameMain.currentCenterX,
                                gameMain.slotPosY,
                                targetWorldPos.z - gameMain.currentCenterZ
                            );

                            // 重置各容器层局部坐标回 (0, basePosY, 0)，朝向保持当前四元数无缝延续
                            layers.forEach((lNode, lIdx) => {
                                if (lNode) {
                                    lNode.setPosition(0, this._layerYOffsets[lIdx], 0);
                                }
                            });

                            gridMgr.registerSlot(this.r, this.c);
                            gridMgr.registerObstacle(this.r, this.c);
                            gridMgr.registerGoPauseBlock(this.r, this.c, this);

                            // 触发经过的 801 易碎地块崩塌
                            brokenBlocksToCollapse.forEach(b => {
                                if (b && b.isValid && !b.isBroken) {
                                    b.playCollapseAnim();
                                }
                            });

                            // 原槽位已腾空，通知后方推挤方块跟进
                            if (onFirstStepVacated) {
                                const cb = onFirstStepVacated;
                                onFirstStepVacated = undefined;
                                cb();
                            }

                            this.onArrivedAtStopSlot(false, hitBlock, hitGoPause, hitSaw, hitStopSlot);
                        }
                        return;
                    }

                    const coord_prev = (currentStep === 0) ? { r: startR, c: startC, layer: 0 } : stepCoords[currentStep - 1];
                    const coord_curr = stepCoords[currentStep];

                    const world_prev = HexMath.hexToWorld(coord_prev.r, coord_prev.c, 0, hexRadius);
                    const world_curr = HexMath.hexToWorld(coord_curr.r, coord_curr.c, 0, hexRadius);

                    const stepDelta = new Vec3(world_curr.x - world_prev.x, 0, world_curr.z - world_prev.z);
                    const rollAxis = new Vec3(stepDelta.z, 0, -stepDelta.x).normalize();

                    const stepStartPos = currentPos.clone();
                    const stepTargetPos = new Vec3(
                        stepStartPos.x + stepDelta.x,
                        basePosY,
                        stepStartPos.z + stepDelta.z
                    );

                    const stepStartRot = currentRot.clone();
                    const tempRot = new Quat();
                    const deltaRot = new Quat();
                    const progress = { t: 0 };

                    tween(progress)
                        .to(stepDuration, { t: 1 }, {
                            easing: 'linear',
                            onUpdate: (tgt: { t: number }) => {
                                const t = tgt.t;
                                const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                                const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                                const arcY = Math.sin(t * Math.PI) * arcHeight;
                                layerNode.setPosition(currX, basePosY + arcY, currZ);

                                const angle = Math.PI * t;
                                Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                                Quat.multiply(tempRot, deltaRot, stepStartRot);
                                layerNode.setRotation(tempRot);
                            }
                        })
                        .call(() => {
                            currentPos.set(stepTargetPos);
                            currentRot.set(tempRot);
                            layerNode.setPosition(stepTargetPos);
                            layerNode.setRotation(tempRot);

                            // 如果该步是转向板，领头层经过时触发变向反馈动效
                            if (layerIdx === layers.length - 1) {
                                const pad = gridMgr.getRedirectPad(coord_curr.r, coord_curr.c);
                                if (pad) {
                                    pad.playTriggerAnim();
                                }
                            }

                            currentStep++;
                            if (currentStep === 1 && onFirstStepVacated) {
                                const cb = onFirstStepVacated;
                                onFirstStepVacated = undefined;
                                cb();
                            }
                            runStepRoll();
                        })
                        .start();
                };

                if (delay > 0) {
                    tween(layerNode)
                        .delay(delay)
                        .call(runStepRoll)
                        .start();
                } else {
                    runStepRoll();
                }
            });
        } else {
            // 原地紧邻障碍、其他方块或边界
            this.onArrivedAtStopSlot(isExit, hitBlock, hitGoPause, hitSaw, hitStopSlot, onFirstStepVacated);
        }
    }

    /**
     * 到达前进停顿点后的处理分支
     */
    private onArrivedAtStopSlot(
        isExit: boolean,
        hitBlock: HexBlock | null,
        hitGoPause: GoPauseBlock | null,
        hitSaw: GearBlock | null = null,
        hitStopSlot: StopBlock | null = null,
        onFirstStepVacated?: () => void
    ) {
        const gridMgr = HexGridManager.instance;
        const gameMain = GameMain.instance;
        if (!gridMgr || !gameMain || this.isDestroyed) return;

        // 分支 1：切入 701 旋转锯齿粉碎机 (规则 A: 像普通方块一样直接被切碎消除！)
        if (hitSaw) {
            if (onFirstStepVacated) {
                onFirstStepVacated();
            }
            hitSaw.playShredFeedbackAnim();
            const flyWorldPos = this.node.worldPosition.clone();
            const worldPos = HexMath.hexToWorld(this.r, this.c, 0, gameMain.hexRadius);
            const shredPos = new Vec3(worldPos.x - gameMain.currentCenterX, gameMain.slotPosY + 0.05, worldPos.z - gameMain.currentCenterZ);
            hitSaw.playShredParticles(shredPos, undefined, this.dir);

            this.isDestroyed = true;
            this.isMoving = false;
            gameMain.spawnShatterScoreFly(flyWorldPos);
            const layerCount = this.layerNodes.length > 0 ? this.layerNodes.length : 1;
            gameMain.notifyBlockCleared(layerCount, true);
            gameMain.checkGameStatus();
            this.node.destroy();
            return;
        }

        // 分支 2：停入 101 P 停车位 (规则 B: 空闲入库停靠！)
        if (hitStopSlot) {
            hitStopSlot.parkBlock(this as any);
            this.isMoving = false;
            gridMgr.registerSlot(this.r, this.c);
            gridMgr.registerObstacle(this.r, this.c);
            gridMgr.registerGoPauseBlock(this.r, this.c, this);
            gameMain.checkGameStatus();
            return;
        }

        // 分支 3：前方无阻挡一路出界 -> 飞出棋盘下坠消除
        if (isExit) {
            if (onFirstStepVacated) {
                onFirstStepVacated();
            }
            this.flyAwayAndDestroy();
            return;
        }

        // 分支 4：撞到普通方块 (HexBlock)
        if (hitBlock) {
            const pathInfo = gridMgr.checkPathInfo(hitBlock);

            if (pathInfo.canFly) {
                // 子分支 4A：被撞方块能够逃逸！
                // 1. 立即启动被撞方块飞出
                gameMain.launchBlockFly(hitBlock);

                // 2. 无缝紧随：前方方块一滚出当前格 (~0.14s)，本方块立即如影随形丝滑跟进！无需傻等 1 秒出界消除！
                const followDelay = Math.max(0.06, (gameMain.rollStepDuration || 0.16) - 0.02);
                this.scheduleOnce(() => {
                    this.executeMovement(onFirstStepVacated);
                }, followDelay);
            } else {
                // 子分支 4B：被撞方块受阻出不去 -> 被撞方块受击抖动，本方块同步前冲翘起抖动并在当前槽位驻留
                hitBlock.playWobbleAnim();
                this.playWobbleAnim(() => {
                    this.isMoving = false;
                    gridMgr.registerSlot(this.r, this.c);
                    gridMgr.registerObstacle(this.r, this.c);
                    gridMgr.registerGoPauseBlock(this.r, this.c, this);
                });
            }
            return;
        }

        // 分支 5：撞到另一个 GoPauseBlock (连锁推挤连带反应！)
        if (hitGoPause) {
            const canClear = hitGoPause.checkCanClearSlot();

            if (canClear) {
                // 1. 立即触发前方停止块推进
                hitGoPause.triggerChainAdvance();

                // 2. 无缝紧随：前方停止块翻滚腾空第一格后 (~0.14s)，本方块丝滑跟进！
                const followDelay = Math.max(0.06, (gameMain.rollStepDuration || 0.16) - 0.02);
                this.scheduleOnce(() => {
                    this.executeMovement(onFirstStepVacated);
                }, followDelay);
            } else {
                hitGoPause.playChainWobble();
                this.playWobbleAnim(() => {
                    this.isMoving = false;
                    gridMgr.registerSlot(this.r, this.c);
                    gridMgr.registerObstacle(this.r, this.c);
                    gridMgr.registerGoPauseBlock(this.r, this.c, this);
                });
            }
            return;
        }

        // 分支 6：撞到不可穿透固定死障碍物 -> 停下抖动驻留
        this.playWobbleAnim(() => {
            this.isMoving = false;
            gridMgr.registerSlot(this.r, this.c);
            gridMgr.registerObstacle(this.r, this.c);
            gridMgr.registerGoPauseBlock(this.r, this.c, this);
        });
    }

    /**
     * 播放撞击受阻前冲翘起抖动动效 (与 HexBlock.playWobbleAnim 100% 对齐)
     */
    public playWobbleAnim(onComplete?: () => void) {
        const gameMain = GameMain.instance;
        const hexRadius = gameMain ? gameMain.hexRadius : HexMath.DEFAULT_RADIUS;
        const dirVec = HexMath.getDirVector3D(this.dir, this.c, hexRadius);
        const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
        const targetAngleRad = 35 * (Math.PI / 180);
        const layers = this.layerNodes;
        let finished = 0;

        layers.forEach((layerNode, idx) => {
            if (!layerNode) {
                finished++;
                return;
            }
            const delay = (layers.length - 1 - idx) * 0.04;
            const startRot = layerNode.rotation.clone();
            const currentRot = new Quat();
            const deltaRot = new Quat();
            const progress = { t: 0 };

            tween(progress)
                .delay(delay)
                .to(0.08, { t: 1 }, {
                    easing: 'quadOut',
                    onUpdate: (tgt) => {
                        const angle = targetAngleRad * tgt.t;
                        Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                        Quat.multiply(currentRot, deltaRot, startRot);
                        layerNode.setRotation(currentRot);
                    }
                })
                .to(0.14, { t: 0 }, {
                    easing: 'backOut',
                    onUpdate: (tgt) => {
                        const angle = targetAngleRad * tgt.t;
                        Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                        Quat.multiply(currentRot, deltaRot, startRot);
                        layerNode.setRotation(currentRot);
                    }
                })
                .call(() => {
                    layerNode.setRotation(startRot);
                    finished++;
                    if (finished >= layers.length && onComplete) {
                        onComplete();
                    }
                })
                .start();
        });
    }

    /**
     * 畅通无阻 3 层方块连环翻滚飞离棋盘并下坠消除 (手感与普通方块连环出界消除 HexBlock.playFlyAwayAnim 100% 对齐)
     */
    public flyAwayAndDestroy() {
        const gridMgr = HexGridManager.instance;
        const gameMain = GameMain.instance;
        if (this.isDestroyed) return;

        this.isDestroyed = true;
        this.isMoving = false;

        if (gridMgr) {
            gridMgr.unregisterObstacle(this.r, this.c);
            gridMgr.unregisterGoPauseBlock(this.r, this.c);
            const prevStop = gridMgr.getStopSlot(this.r, this.c);
            if (prevStop) {
                prevStop.releaseBlock(this as any);
            }
        }

        const stepDuration = gameMain ? gameMain.rollStepDuration : 0.16;
        const layerRollInterval = gameMain ? gameMain.layerRollInterval : 0.04;
        const hexRadius = gameMain ? gameMain.hexRadius : HexMath.DEFAULT_RADIUS;
        const dirVec = HexMath.getDirVector3D(this.dir, this.c, hexRadius);
        const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
        const stepDist = hexRadius * Math.sqrt(3);
        const arcHeight = 0.25;

        // 计算到达棋盘外边缘所需步数 + 2 步出界
        let stepsToEdge = 0;
        let chkR = this.r, chkC = this.c;
        if (gridMgr) {
            while (gridMgr.hasSlot(chkR, chkC)) {
                const next = HexMath.getNeighborCoord(chkR, chkC, this.dir);
                chkR = next.r;
                chkC = next.c;
                stepsToEdge++;
                if (stepsToEdge > 30) break;
            }
        }
        const totalExitSteps = Math.max(2, stepsToEdge + 1);

        const layers = this.layerNodes;
        let destroyedLayers = 0;

        layers.forEach((layerNode, layerIdx) => {
            if (!layerNode) {
                destroyedLayers++;
                return;
            }

            const delay = (layers.length - 1 - layerIdx) * layerRollInterval;
            const basePosY = this._layerYOffsets[layerIdx];

            let step = 0;
            let currentPos = new Vec3(0, basePosY, 0);
            let currentRot = layerNode.rotation.clone();

            const runExitRoll = () => {
                if (step >= totalExitSteps) {
                    // 翻出界外后自由落体下落 2.0 米并销毁 (与 HexBlock.executeFallAndHide 100% 对齐)
                    if (gameMain) {
                        gameMain.spawnFallScoreFly(layerNode.worldPosition.clone(), `gopause-exit-${this.node.uuid}`);
                    }
                    const fallStartPos = layerNode.position.clone();
                    const fallDistance = 2.0;
                    const rollSpeed = stepDist / Math.max(0.01, stepDuration);
                    const fallSpeed = rollSpeed * 3.0;
                    const fallDuration = fallDistance / fallSpeed;

                    const fallProgress = { t: 0 };
                    tween(fallProgress)
                        .to(fallDuration, { t: 1 }, {
                            easing: 'linear',
                            onUpdate: (tgt: { t: number }) => {
                                layerNode.setPosition(fallStartPos.x, fallStartPos.y - fallDistance * tgt.t, fallStartPos.z);
                            }
                        })
                        .call(() => {
                            layerNode.destroy();
                            destroyedLayers++;
                            if (destroyedLayers >= layers.length) {
                                if (gameMain) {
                                    gameMain.notifyBlockCleared(layers.length, true);
                                    gameMain.checkGameStatus();
                                }
                                this.node.destroy();
                            }
                        })
                        .start();
                    return;
                }

                const stepStartPos = currentPos.clone();
                const stepTargetPos = new Vec3(
                    stepStartPos.x + dirVec.x * stepDist,
                    stepStartPos.y,
                    stepStartPos.z + dirVec.z * stepDist
                );

                const stepStartRot = currentRot.clone();
                const tempRot = new Quat();
                const deltaRot = new Quat();
                const progress = { t: 0 };

                tween(progress)
                    .to(stepDuration, { t: 1 }, {
                        easing: 'linear',
                        onUpdate: (tgt: { t: number }) => {
                            const t = tgt.t;
                            const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                            const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                            const arcY = Math.sin(t * Math.PI) * arcHeight;
                            layerNode.setPosition(currX, basePosY + arcY, currZ);

                            // 180° 翻滚飞出 (立起 90° -> 扣下 180°)
                            const angle = Math.PI * t;
                            Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                            Quat.multiply(tempRot, deltaRot, stepStartRot);
                            layerNode.setRotation(tempRot);
                        }
                    })
                    .call(() => {
                        currentPos.set(stepTargetPos);
                        currentRot.set(tempRot);
                        layerNode.setPosition(stepTargetPos);
                        layerNode.setRotation(tempRot);
                        step++;
                        runExitRoll();
                    })
                    .start();
            };

            if (delay > 0) {
                tween(layerNode)
                    .delay(delay)
                    .call(runExitRoll)
                    .start();
            } else {
                runExitRoll();
            }
        });
    }
}
