import { _decorator, Component, Node, Vec3, tween, Tween, v3, Material, MeshRenderer, Quat } from 'cc';
import { HexCoord, HexMath } from '../HexMath';
import { HexBlock, BlockState } from '../HexBlock';
import { HexGridManager } from '../HexGridManager';
import { GameMain } from '../GameMain';
import { BrokenParticle } from '../BrokenParticle';
import { BoomParticle } from '../BoomParticle';

const { ccclass, property } = _decorator;

// ======================================== 1501~1506 火箭炸药方块控制器 ========================================
/**
 * 1501~1506 火箭炸药方块组件 (RocketBombBlock / Special_15_1501.prefab)
 * 对应关卡元素: 1501(↑), 1502(↗), 1503(↘), 1504(↓), 1505(↙), 1506(↖)
 *
 * 核心机制：
 * 1. 关卡开局生成在指定槽位，作为实体障碍占据网格，禁止玩家直接点击；
 * 2. 传力激活：任意其他方块移动并撞击到本方块时，被撞传力方块原路返回原位，本火箭方块瞬间被点火激活；
 * 3. 定向 180° 翻滚冲刺：被激活后，3 层方块逐层连环向指示方向高速 180° 翻滚前进；
 * 4. 碰撞爆炸：在遇到前方障碍（方块、冰块、石块或边缘）时瞬间引发大范围爆炸；
 * 5. 范围清屏：摧毁落点自身以及周围相邻全部 6 个方向槽位内的所有方块与厚冰块！
 */
@ccclass('RocketBombBlock')
export class RocketBombBlock extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '模型根节点 (_1501_1506_pre)', group: { name: '节点引用', id: '0' } })
    public modelRoot: Node = null!;

    @property({ type: Node, tooltip: '底层六边形块 (hx_1_2)', group: { name: '节点引用', id: '0' } })
    public hx1: Node = null!;

    @property({ type: Node, tooltip: '中层六边形块 (hx_2_2)', group: { name: '节点引用', id: '0' } })
    public hx2: Node = null!;

    @property({ type: Node, tooltip: '顶层六边形块 (hx_3_1)', group: { name: '节点引用', id: '0' } })
    public hx3: Node = null!;

    @property({ type: Node, tooltip: '炸弹箭头指示节点 (arrow_1)', group: { name: '节点引用', id: '0' } })
    public arrowNode: Node = null!;

    /** 3 层独立的翻滚容器节点 (Layer_0, Layer_1, Layer_2) */
    public layerNodes: Node[] = [];
    private _layerYOffsets: number[] = [0.08, 0.18, 0.28];

    // ======================================== 核心属性 ========================================
    /** 当前槽位行号 */
    public r: number = 0;
    /** 当前槽位列号 */
    public c: number = 0;
    /** 火箭发射推进方向 (1~6) */
    public dir: number = 1;
    /** 特殊元素代码 (1501 ~ 1506) */
    public rawType: number = 1501;

    /** 是否已点火发射或正在爆炸中 */
    public isLaunched: boolean = false;
    /** 是否已被彻底销毁 */
    public isDestroyed: boolean = false;

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
            this.modelRoot = this.node.getChildByName('_1501_1506_pre') || this.node;
        }
        if (this.modelRoot) {
            if (!this.hx1) this.hx1 = this.findChildRecursive(this.modelRoot, 'hx_1_2') || this.findChildRecursive(this.modelRoot, 'hx_1')!;
            if (!this.hx2) this.hx2 = this.findChildRecursive(this.modelRoot, 'hx_2_2') || this.findChildRecursive(this.modelRoot, 'hx_2')!;
            if (!this.hx3) this.hx3 = this.findChildRecursive(this.modelRoot, 'hx_3_1') || this.findChildRecursive(this.modelRoot, 'hx_3')!;
            if (!this.arrowNode) this.arrowNode = this.findChildRecursive(this.modelRoot, 'arrow_1') || this.findChildRecursive(this.modelRoot, 'arrow')!;
        }

        if (this.layerNodes.length === 3) return;

        const hxList = [this.hx1, this.hx2, this.hx3];
        this.layerNodes = [];

        // 构造 3 个与 HexBlock 同心的独立翻滚容器层 (Layer_0, Layer_1, Layer_2)
        // 使得每个容器层的原点 (0, 0, 0) 均落在该槽位正中心，确保翻滚时完全以中心轴旋转
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
            if (hx) {
                hx.setParent(layerContainer);
                hx.setPosition(0, 0, 0.25);
                hx.setRotationFromEuler(0, 0, 0);
                hx.setScale(Vec3.ONE);
            }

            if (i === 2 && this.arrowNode) {
                this.arrowNode.setParent(layerContainer);
                this.arrowNode.setPosition(0, 0.02, 0);
                this.arrowNode.setScale(Vec3.ONE);
            }

            this.layerNodes.push(layerContainer);
        }
    }

    /**
     * 初始化火箭炸药方块
     * @param r 行号
     * @param c 列号
     * @param rawType 元素代码 (1501 ~ 1506)
     * @param colorMat 可选方向材质
     */
    public initRocketBomb(r: number, c: number, rawType: number, colorMat?: Material) {
        this.r = r;
        this.c = c;
        this.rawType = rawType;
        this.dir = (rawType >= 1501 && rawType <= 1506) ? (rawType - 1500) : 1;
        this.isLaunched = false;
        this.isDestroyed = false;

        this.initNodeReferences();

        // 旋转炸弹箭头精确对齐逃逸方向
        if (this.arrowNode) {
            const arrowAngle = HexMath.getArrowAngleY(this.dir, this.c);
            this.arrowNode.setRotationFromEuler(0, arrowAngle, 0);
        }

        // 应用材质
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

    // ======================================== 核心玩家点击与发射逻辑 ========================================
    /**
     * 响应玩家直接点击 (消耗 1 步并主动点火发射)
     */
    public onClick() {
        if (this.isLaunched || this.isDestroyed) return;

        const gameMain = GameMain.instance;
        if (!gameMain || !gameMain.isPlaying) return;

        // 玩家主动点击发射，消耗 1 步并触发方案 B 冰块倒数 -1
        gameMain.consumeOneStep();

        this.launchAndExplode();
    }

    /**
     * 触发火箭炸弹点火发射并在撞击后引发范围大爆炸
     * @param onComplete 爆炸与清障完成后的回调
     */
    public launchAndExplode(onComplete?: () => void) {
        if (this.isLaunched || this.isDestroyed) {
            return;
        }

        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr || !gameMain.isPlaying) return;

        this.isLaunched = true;

        // 1. 发射瞬间立即注销自身在网格中的槽位与障碍物占用
        gridMgr.unregisterRocketBomb(this.r, this.c);
        gridMgr.unregisterObstacle(this.r, this.c);

        // 2. 沿 dir 方向扫描前方碰撞点与途径槽位 (支持多格连环翻滚)
        let currR = this.r;
        let currC = this.c;
        let currDir = this.dir;

        const stepCoords: HexCoord[] = [];
        let hitR = currR;
        let hitC = currC;

        for (let step = 1; step <= 30; step++) {
            const nextCoord = HexMath.getNeighborCoord(currR, currC, currDir);

            // A. 检测是否已出棋盘边界 -> 在边界前当前格停下并引爆
            if (!gridMgr.hasSlot(nextCoord.r, nextCoord.c)) {
                break;
            }

            // B. 检测前方是否有普通方块阻挡 -> 在方块前停下并在当前格引爆！
            const topBlock = gridMgr.getTopBlock(nextCoord.r, nextCoord.c);
            if (topBlock && topBlock.state !== BlockState.DESTROYED) {
                break;
            }

            // C. 检测前方是否有固定障碍物 (石块、冰块、闭合伸缩柱等) -> 在石块前停下并在当前格引爆！
            if (gridMgr.hasObstacle(nextCoord.r, nextCoord.c)) {
                break;
            }

            // D. 检测前方是否有 TNT 炸弹 -> 在 TNT 前停下并在当前格引爆！
            if (gridMgr.getTnt(nextCoord.r, nextCoord.c)) {
                break;
            }

            // 若前方为空槽位，推进记录该步坐标并继续向前扫描
            stepCoords.push(nextCoord);
            currR = nextCoord.r;
            currC = nextCoord.c;
            hitR = currR;
            hitC = currC;

            // E. 检测当前格是否为转向板 (TurnBlock / 1701 RandomTurnBlock) -> 动态折射更新飞行朝向！
            const pad = gridMgr.getRedirectPad(nextCoord.r, nextCoord.c);
            if (pad) {
                currDir = pad.targetDir;
            }
        }

        const flightSteps = stepCoords.length;

        // 紧邻障碍物，直接原地引爆
        if (flightSteps === 0) {
            this.executeExplosionAt(hitR, hitC, onComplete);
            return;
        }

        // 3. 执行连环 180° 翻滚运动流水线 (3 层方块逐层错峰翻滚，速度与手感与普通色块完全统一)
        const hexRadius = gameMain.hexRadius || HexMath.DEFAULT_RADIUS;
        const stepDuration = gameMain.rollStepDuration || 0.16;
        const layerRollInterval = gameMain.layerRollInterval || 0.04;
        const arcHeight = 0.25;

        const layers = this.layerNodes;
        let completedLayers = 0;
        let hasExploded = false;

        layers.forEach((layerNode, layerIdx) => {
            if (!layerNode) {
                completedLayers++;
                if (completedLayers >= layers.length && !hasExploded) {
                    hasExploded = true;
                    this.executeExplosionAt(hitR, hitC, onComplete);
                }
                return;
            }

            // 错峰翻滚：顶层 (Layer_2) 最先翻滚 (delay = 0)，中层与底层依次延后形成多米诺连环翻滚
            const delay = (layers.length - 1 - layerIdx) * layerRollInterval;
            const basePosY = this._layerYOffsets[layerIdx];

            let currentStep = 0;
            let currentPos = new Vec3(0, basePosY, 0);
            let currentRot = layerNode.rotation.clone();

            const runStepRoll = () => {
                if (currentStep >= flightSteps) {
                    completedLayers++;
                    if (completedLayers >= layers.length && !hasExploded) {
                        hasExploded = true;
                        this.executeExplosionAt(hitR, hitC, onComplete);
                    }
                    return;
                }

                const coord_prev = (currentStep === 0) ? { r: this.r, c: this.c, layer: 0 } : stepCoords[currentStep - 1];
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

                const stepStartRot = new Quat(currentRot);
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

                            // 标准 180° (Math.PI * t) 翻转
                            const angle = Math.PI * t;
                            Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                            Quat.multiply(tempRot, deltaRot, stepStartRot);
                            layerNode.setRotation(tempRot);
                        }
                    })
                    .call(() => {
                        currentPos.set(stepTargetPos);
                        currentRot.set(tempRot);

                        // 如果经过了转向板，领头层方块经过时立即触发转向板动效与变向
                        if (layerIdx === layers.length - 1) {
                            const pad = gridMgr.getRedirectPad(coord_curr.r, coord_curr.c);
                            if (pad) {
                                pad.playTriggerAnim();
                            }
                        }

                        currentStep++;
                        runStepRoll();
                    })
                    .start();
            };

            if (delay > 0) {
                tween(layerNode)
                    .delay(delay)
                    .call(() => runStepRoll())
                    .start();
            } else {
                runStepRoll();
            }
        });
    }

    /**
     * 在目标槽位 (centerR, centerC) 引发剧烈爆炸并清空中心与相邻 6 格
     */
    private executeExplosionAt(centerR: number, centerC: number, onComplete?: () => void) {
        const gameMain = GameMain.instance;
        const gridMgr = HexGridManager.instance;
        if (!gameMain || !gridMgr) return;


        // 1. 停止动画并销毁自身节点
        this.layerNodes.forEach(l => {
            if (l && l.isValid) Tween.stopAllByTarget(l);
        });
        Tween.stopAllByTarget(this.node);
        this.isDestroyed = true;
        this.node.destroy();

        // 2. 屏幕震动反馈 (与 TNT 保持同等高冲击震动)
        if (gameMain.mainCamera) {
            this.shakeCamera(gameMain.mainCamera.node, 0.35, 0.25);
        }

        // 3. 收集受波及范围槽位：中心格 + 周围相邻 6 格，共 7 格
        const neighborCoords = HexMath.getAllNeighbors(centerR, centerC);
        const affectedSlots: HexCoord[] = [{ r: centerR, c: centerC, layer: 0 }, ...neighborCoords];
        const worldCenter = HexMath.hexToWorld(centerR, centerC, 0, gameMain.hexRadius);
        const particlePosition = new Vec3(
            worldCenter.x - gameMain.currentCenterX,
            gameMain.blockBasePosY + 0.05,
            worldCenter.z - gameMain.currentCenterZ
        );
        BoomParticle.play('boom', gameMain.gridContainer, particlePosition);
        BoomParticle.play('piece', gameMain.gridContainer, particlePosition);
        BoomParticle.play('trail', gameMain.gridContainer, particlePosition, 1.2);

        let eliminatedCount = 0;
        let spawnedShatterFly = false;

        affectedSlots.forEach(coord => {
            // A. 连锁引爆相邻的 TNT
            const neighborTnt = gridMgr.getTnt(coord.r, coord.c);
            if (neighborTnt && neighborTnt.node && neighborTnt.node.isValid && !neighborTnt.isExploded) {
                neighborTnt.scheduleOnce(() => {
                    if (neighborTnt.node && neighborTnt.node.isValid && !neighborTnt.isExploded) {
                        neighborTnt.triggerExplosion(true);
                    }
                }, 0.06);
            }

            // B. 连锁引爆相邻未发射的火箭炸药块
            const neighborRocket = gridMgr.getRocketBomb(coord.r, coord.c);
            if (neighborRocket && neighborRocket !== this && neighborRocket.node && neighborRocket.node.isValid && !neighborRocket.isLaunched) {
                neighborRocket.scheduleOnce(() => {
                    if (neighborRocket.node && neighborRocket.node.isValid && !neighborRocket.isLaunched) {
                        neighborRocket.launchAndExplode();
                    }
                }, 0.08);
            }

            // C. 清空该槽位内的所有普通/堆叠彩色方块
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

            // D. 障碍物处理：
            // A. 如果是旋转连杆机关中心底座，严禁注销障碍，保护其核心机械机关特性
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

        // 4. 检查场上的 202 冰块并执行强力破冰 (包含 98/99 层超厚冰块直接击碎)
        if ((gameMain as any)._iceBlocks) {
            const iceBlocks: any[] = (gameMain as any)._iceBlocks;
            iceBlocks.forEach(ice => {
                if (ice && !ice.isUnlocked) {
                    const isAffected = affectedSlots.some(sc => sc.r === ice.r && sc.c === ice.c);
                    if (isAffected) {
                        ice.breakIce();
                    }
                }
            });
        }


        // 5. 每个被炸掉的槽位各自飞分；延迟刷新 901 翻转与胜负
        gameMain.scheduleOnce(() => {
            gameMain.notifyBlockCleared(
                eliminatedCount > 0 ? eliminatedCount : 1,
                spawnedShatterFly
            );
            gameMain.checkGameStatus();
            if (onComplete) onComplete();
        }, 0.2);
    }

    /** 全局缓存的相机基准原始位置，避免连环爆炸期间把相机震偏 */
    private static _cameraOriginPos: Vec3 | null = null;

    /**
     * 高冲击力相机震屏动效 (与 TntBlock.ts 严格一致)
     */
    private shakeCamera(cameraNode: Node, duration: number = 0.35, magnitude: number = 0.25) {
        if (!RocketBombBlock._cameraOriginPos) {
            RocketBombBlock._cameraOriginPos = cameraNode.getPosition().clone();
        }
        const originPos = RocketBombBlock._cameraOriginPos;

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
                RocketBombBlock._cameraOriginPos = null;
            })
            .start();
    }
}
