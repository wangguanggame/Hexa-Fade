import { _decorator, Component, Node, Vec3, tween } from 'cc';
import { HexCoord, HexMath } from '../HexMath';
import { HexBlock, BlockState } from '../HexBlock';
import { HexGridManager } from '../HexGridManager';
import { GameMain } from '../GameMain';
import { GearBlock } from './GearBlock';
import { StopBlock } from './StopBlock';
import { GoPauseBlock } from './GoPauseBlock';
import { TurnBlock } from './TurnBlock';
import { TntBlock } from './TntBlock';
import { RocketBombBlock } from './RocketBombBlock';
import { Audio, AudioId } from '../../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

/**
 * 六边形 6 个标准方向沿顺时针排列的循环序列 (0° -> 60° -> 120° -> 180° -> 240° -> 300°)
 * 1: 正上 ⬆ (0°)
 * 2: 右上 ↗ (60°)
 * 3: 右下 ↘ (120°)
 * 4: 正下 ⬇ (180°)
 * 5: 左下 ↙ (240°)
 * 6: 左上 ↖ (300°)
 */
export const CLOCKWISE_DIRECTIONS: number[] = [1, 2, 3, 4, 5, 6];

/**
 * 顺时针旋转指定步长后的新方向
 * @param dir 当前方向 (1~6)
 * @param steps 顺时针步数 (1: 60°, 2: 120°, 3: 180°)
 */
export function rotateDirectionClockwise(dir: number, steps: number = 3): number {
    const idx = CLOCKWISE_DIRECTIONS.indexOf(dir);
    if (idx === -1) return dir;
    const newIdx = (idx + steps) % CLOCKWISE_DIRECTIONS.length;
    return CLOCKWISE_DIRECTIONS[newIdx];
}

interface RotatingBlockItem {
    node: Node;
    block?: HexBlock;
    saw?: GearBlock;
    stop?: StopBlock;
    goPause?: GoPauseBlock;
    turn?: TurnBlock;
    tnt?: TntBlock;
    rocket?: RocketBombBlock;
    offsetX: number;
    offsetZ: number;
    layerY: number;
    fromSlotIndex: number;
}

// ======================================== 通用旋转连杆特殊机关控制器 ========================================
/**
 * 通用旋转连杆机关控制器组件 (RotarySwitch / 401~403 双端, 501~503 三端)
 * 挂载在 Special_1_401 (双端 180°) / Special_1_402 (三端 120°) / Special_1_403 (六端 60°) 预制体上
 * 负责：
 * - 管理中心底座与旋转主体 (hx_xz)
 * - 维护所有分支连杆连接的槽位列表 (slots)
 * - 支持 401~403 (双向 180°)、501~503 (三向 120°) 通用顺时针轮转
 * - 驱动“先拔起 -> 凌空旋转 -> 扣入槽位”的三段式机械动力学动画
 * - 同步交换与迁移所有分支槽位内的整组方块逻辑坐标与世界坐标
 */
@ccclass('RotarySwitch')
export class RotarySwitch extends Component {
    // ======================================== 编辑器/属性配置 ========================================
    @property({ type: Node, tooltip: '旋转主体节点 (hx_xz，含连杆与各分支插销)', group: { name: '节点引用', id: '0' } })
    public rotateNode: Node = null!;

    @property({ type: Node, tooltip: '底座固定节点 (hx_dz)', group: { name: '节点引用', id: '0' } })
    public baseNode: Node = null!;

    // ======================================== 内部状态 ========================================
    /** 机关特殊类型代码: 401~403 (2端 180°), 501~503 (3端 120°) */
    public switchType: number = 401;

    /** 中心机关所在网格坐标 (r, c) */
    public centerR: number = 0;
    public centerC: number = 0;

    /** 连杆所有分支连接的槽位坐标列表 (按顺时针排列) */
    public slots: HexCoord[] = [];

    /** 每次点击顺时针旋转的角度 (401~403: 180°, 501~503: 120°) */
    public stepAngle: number = 180;
    /** 对应的方向数组步进数 (180°: 3, 120°: 2, 60°: 1) */
    public dirStepOffset: number = 3;

    /** 当前累计旋转角度 */
    private _currentRotationAngle: number = 0;
    /** 是否正在执行旋转动画中 */
    private _isRotating: boolean = false;

    public get isRotating(): boolean {
        return this._isRotating;
    }

    // ======================================== 生命周期 ========================================
    onLoad() {
        if (!this.rotateNode) {
            this.rotateNode = this.node.getChildByPath('_501_503_pre/hx_xz') || this.node.getChildByName('hx_xz')!;
        }
        if (!this.baseNode) {
            this.baseNode = this.node.getChildByPath('_501_503_pre/hx_dz') || this.node.getChildByName('hx_dz')!;
        }
    }

    // ======================================== 初始化 ========================================
    /**
     * 初始化通用旋转机关参数
     * @param centerCoord 中心槽位坐标
     * @param switchType 机关类型 (401~403 / 501~503)
     * @param customSlots 可选自定义顺时针槽位列表
     */
    public initSwitch(centerCoord: HexCoord, switchType: number = 401, customSlots?: HexCoord[]) {
        this.centerR = centerCoord.r;
        this.centerC = centerCoord.c;
        this.switchType = switchType;

        let initialAngle = 0;

        if (switchType >= 501 && switchType <= 503) {
            // 501~503: 三端三叉连杆 (120° 旋转步长) -> 对应预制体 Special_1_402
            // 注：Special_1_402 原始模型在 Euler(0,0,0) 下 Node1 朝向 +Z(正下180°)，为倒 Y 型
            // 因此 501(正 Y 型) 初始角度需设为 180°，与 Dir 1(正上)、Dir 3(右下)、Dir 5(左下) 严格对齐！
            this.stepAngle = 120;
            this.dirStepOffset = 2;

            if (switchType === 501) {
                // 501: 正 Y 型三叉 (正上 1, 右下 3, 左下 5，顺时针各相隔 120°)
                initialAngle = 180;
                this.slots = customSlots || [
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 1), // 分支1: 正上 ⬆
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 3), // 分支2: 右下 ↘
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 5)  // 分支3: 左下 ↙
                ];
            } else if (switchType === 502) {
                // 502: 倒 Y 型三叉 (右上 2, 正下 4, 左上 6)
                initialAngle = 0;
                this.slots = customSlots || [
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 2), // 分支1: 右上 ↗
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 4), // 分支2: 正下 ⬇
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 6)  // 分支3: 左上 ↖
                ];
            } else {
                // 503: 偏转 Y 型三叉
                initialAngle = 60;
                this.slots = customSlots || [
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 3), // 分支1: 右下 ↘
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 5), // 分支2: 左下 ↙
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 1)  // 分支3: 正上 ⬆
                ];
            }
        } else if (switchType >= 401 && switchType <= 403) {
            // 401~403: 双端直连杆 (180° 旋转步长) -> 对应预制体 Special_1_401
            this.stepAngle = 180;
            this.dirStepOffset = 3;

            if (switchType === 401) {
                // 401: 垂直轴向 (正上 1 ↔ 正下 4)
                initialAngle = 0;
                this.slots = customSlots || [
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 1), // 正上 ⬆
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 4)  // 正下 ⬇
                ];
            } else if (switchType === 402) {
                // 402: 斜向轴 A (东北右上 2 ↔ 西南左下 5)
                initialAngle = 60;
                this.slots = customSlots || [
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 2), // 右上 ↗
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 5)  // 左下 ↙
                ];
            } else {
                // 403: 斜向轴 B (东南右下 3 ↔ 西北左上 6)
                initialAngle = 120;
                this.slots = customSlots || [
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 3), // 右下 ↘
                    HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 6)  // 左上 ↖
                ];
            }
        } else {
            // 默认备用 / 6向全满连杆 (60° 步长)
            this.stepAngle = 60;
            this.dirStepOffset = 1;
            initialAngle = 0;
            this.slots = customSlots || [
                HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 1),
                HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 2),
                HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 3),
                HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 4),
                HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 5),
                HexMath.getNeighborCoord(centerCoord.r, centerCoord.c, 6)
            ];
        }

        this._currentRotationAngle = initialAngle;
        this._isRotating = false;

        if (this.rotateNode) {
            this.rotateNode.setRotationFromEuler(0, -initialAngle, 0);
        }
    }

    // ======================================== 核心旋转交互 ========================================
    /**
     * 响应点击中心转盘，触发顺时针轮转动画 (整组多层方块同步升降公转)
     * @param onComplete 旋转完成后的回调
     */
    public triggerRotation(onComplete?: () => void) {
        if (this._isRotating) {
            return;
        }

        const gridMgr = HexGridManager.instance;
        const gameMain = GameMain.instance;
        if (!gridMgr || !gameMain || !gameMain.isPlaying) return;

        // 1. 获取所有分支槽位内的整组方块与各类特殊道具/机关
        const slotBlockGroups: HexBlock[][] = [];
        const slotSawList: (GearBlock | null)[] = [];
        const slotStopList: (StopBlock | null)[] = [];
        const slotGoPauseList: (GoPauseBlock | null)[] = [];
        const slotTurnList: (TurnBlock | null)[] = [];
        const slotTntList: (TntBlock | null)[] = [];
        const slotRocketList: (RocketBombBlock | null)[] = [];
        const allRotatingItems: RotatingBlockItem[] = [];

        // 计算中心点世界坐标 (以 gridContainer 为基准)
        const centerWorldPos = HexMath.hexToWorld(this.centerR, this.centerC, 0, gameMain.hexRadius);
        centerWorldPos.x -= gameMain.currentCenterX;
        centerWorldPos.z -= gameMain.currentCenterZ;

        for (let sIdx = 0; sIdx < this.slots.length; sIdx++) {
            const slotCoord = this.slots[sIdx];
            const blocksInSlot = gridMgr.getSlotBlocks(slotCoord.r, slotCoord.c);
            slotBlockGroups.push(blocksInSlot);

            // 检查槽位内是否有 701 旋转锯齿轮 (GearBlock)
            const sawInSlot = gridMgr.getSaw(slotCoord.r, slotCoord.c);
            slotSawList.push(sawInSlot);

            if (sawInSlot) {
                const p = sawInSlot.node.getPosition();
                allRotatingItems.push({
                    node: sawInSlot.node,
                    saw: sawInSlot,
                    offsetX: p.x - centerWorldPos.x,
                    offsetZ: p.z - centerWorldPos.z,
                    layerY: p.y,
                    fromSlotIndex: sIdx
                });
            }

            // 检查槽位内是否有 101 P停车位/停止块 (StopBlock)
            const stopInSlot = gridMgr.getStopSlot(slotCoord.r, slotCoord.c);
            slotStopList.push(stopInSlot || null);

            if (stopInSlot) {
                const p = stopInSlot.node.getPosition();
                allRotatingItems.push({
                    node: stopInSlot.node,
                    stop: stopInSlot,
                    offsetX: p.x - centerWorldPos.x,
                    offsetZ: p.z - centerWorldPos.z,
                    layerY: p.y,
                    fromSlotIndex: sIdx
                });
            }

            // 检查槽位内是否有 1201~1206 前进停止块 (GoPauseBlock)
            const goPauseInSlot = gridMgr.getGoPauseBlock(slotCoord.r, slotCoord.c);
            slotGoPauseList.push(goPauseInSlot || null);

            if (goPauseInSlot) {
                const p = goPauseInSlot.node.getPosition();
                allRotatingItems.push({
                    node: goPauseInSlot.node,
                    goPause: goPauseInSlot,
                    offsetX: p.x - centerWorldPos.x,
                    offsetZ: p.z - centerWorldPos.z,
                    layerY: p.y,
                    fromSlotIndex: sIdx
                });
            }

            // 检查槽位内是否有 601~606 / 1701 导向转向板 (TurnBlock / RandomTurnBlock)
            const turnInSlot = gridMgr.getRedirectPad(slotCoord.r, slotCoord.c);
            slotTurnList.push(turnInSlot || null);

            if (turnInSlot) {
                const p = turnInSlot.node.getPosition();
                allRotatingItems.push({
                    node: turnInSlot.node,
                    turn: turnInSlot,
                    offsetX: p.x - centerWorldPos.x,
                    offsetZ: p.z - centerWorldPos.z,
                    layerY: p.y,
                    fromSlotIndex: sIdx
                });
            }

            // 检查槽位内是否有 301 TNT 炸药 (TntBlock)
            const tntInSlot = gridMgr.getTnt(slotCoord.r, slotCoord.c);
            slotTntList.push(tntInSlot || null);

            if (tntInSlot && !tntInSlot.isExploded) {
                const p = tntInSlot.node.getPosition();
                allRotatingItems.push({
                    node: tntInSlot.node,
                    tnt: tntInSlot,
                    offsetX: p.x - centerWorldPos.x,
                    offsetZ: p.z - centerWorldPos.z,
                    layerY: p.y,
                    fromSlotIndex: sIdx
                });
            }

            // 检查槽位内是否有 1501~1506 火箭炸药 (RocketBombBlock)
            const rocketInSlot = gridMgr.getRocketBomb(slotCoord.r, slotCoord.c);
            slotRocketList.push(rocketInSlot || null);

            if (rocketInSlot && !rocketInSlot.isLaunched && !rocketInSlot.isDestroyed) {
                const p = rocketInSlot.node.getPosition();
                allRotatingItems.push({
                    node: rocketInSlot.node,
                    rocket: rocketInSlot,
                    offsetX: p.x - centerWorldPos.x,
                    offsetZ: p.z - centerWorldPos.z,
                    layerY: p.y,
                    fromSlotIndex: sIdx
                });
            }

            blocksInSlot.forEach(block => {
                const p = block.node.getPosition();
                allRotatingItems.push({
                    node: block.node,
                    block: block,
                    offsetX: p.x - centerWorldPos.x,
                    offsetZ: p.z - centerWorldPos.z,
                    layerY: p.y,
                    fromSlotIndex: sIdx
                });
            });
        }

        // 校验方块状态：不能处于消除或运动动画中
        const isBusy = allRotatingItems.some(item =>
            (item.block && item.block.state !== BlockState.IDLE) ||
            (item.goPause && item.goPause.isMoving) ||
            (item.tnt && item.tnt.isExploded) ||
            (item.rocket && (item.rocket.isLaunched || item.rocket.isDestroyed))
        );
        if (isBusy) {
            return;
        }

        this._isRotating = true;
        Audio.play(AudioId.rotate);
        allRotatingItems.forEach(item => {
            if (item.block) item.block.state = BlockState.ANIMATING;
        });

        // 若有槽位包含 101 停止块，在拔起旋转前显现原槽位底层的备用普通底座
        for (let sIdx = 0; sIdx < this.slots.length; sIdx++) {
            if (slotStopList[sIdx]) {
                const originCoord = this.slots[sIdx];
                const originFloor = gameMain.gridContainer.getChildByName(`Slot_${originCoord.r}_${originCoord.c}`);
                if (originFloor) {
                    originFloor.active = true;
                }
            }
        }

        // 每次旋转消耗 1 个关卡步数并触发方案 B 冰块倒数 -1
        gameMain.consumeOneStep();

        // 2. 动画与高度参数 (先抬起 -> 凌空旋转 -> 再落下)
        const startAngle = this._currentRotationAngle;
        const targetAngle = startAngle + this.stepAngle;
        const liftHeight = gameMain.layerHeight * gameMain.stackLayersPerSlot + 0.06;

        const liftUpDuration = 0.14;
        const rotateDuration = 0.30;
        const dropDuration = 0.14;

        const rotateNodeBasePosY = this.rotateNode ? this.rotateNode.getPosition().y : 0;

        const liftObj = { y: 0 };
        const rotObj = { angle: startAngle };

        // 3. 执行三段式流水线动画
        // 阶段一：垂直拔起 (Lift Up)
        tween(liftObj)
            .to(liftUpDuration, { y: liftHeight }, {
                easing: 'quadOut',
                onUpdate: () => {
                    const curLiftY = liftObj.y;
                    if (this.rotateNode) {
                        const curRotPos = this.rotateNode.getPosition();
                        this.rotateNode.setPosition(curRotPos.x, rotateNodeBasePosY + curLiftY, curRotPos.z);
                    }
                    for (let i = 0; i < allRotatingItems.length; i++) {
                        const item = allRotatingItems[i];
                        item.node.setPosition(centerWorldPos.x + item.offsetX, item.layerY + curLiftY, centerWorldPos.z + item.offsetZ);
                    }
                }
            })
            // 阶段二：高空水平顺时针旋转 stepAngle 度
            .then(
                tween(rotObj).to(rotateDuration, { angle: targetAngle }, {
                    easing: 'quadInOut',
                    onUpdate: () => {
                        if (this.rotateNode) {
                            this.rotateNode.setRotationFromEuler(0, -rotObj.angle, 0);
                        }

                        const deltaDeg = rotObj.angle - startAngle;
                        const rotRad = deltaDeg * (Math.PI / 180);
                        const cos = Math.cos(rotRad);
                        const sin = Math.sin(rotRad);

                        for (let i = 0; i < allRotatingItems.length; i++) {
                            const item = allRotatingItems[i];
                            const curX = centerWorldPos.x + (item.offsetX * cos - item.offsetZ * sin);
                            const curZ = centerWorldPos.z + (item.offsetX * sin + item.offsetZ * cos);
                            item.node.setPosition(curX, item.layerY + liftHeight, curZ);
                        }
                    }
                })
            )
            // 阶段三：垂直下落扣槽 (Drop Down)
            .then(
                tween(liftObj).to(dropDuration, { y: 0 }, {
                    easing: 'quadIn',
                    onUpdate: () => {
                        const curLiftY = liftObj.y;
                        if (this.rotateNode) {
                            const curRotPos = this.rotateNode.getPosition();
                            this.rotateNode.setPosition(curRotPos.x, rotateNodeBasePosY + curLiftY, curRotPos.z);
                        }

                        // 计算下落阶段在目标槽位的位置
                        const rotRad = this.stepAngle * (Math.PI / 180);
                        const cos = Math.cos(rotRad);
                        const sin = Math.sin(rotRad);

                        for (let i = 0; i < allRotatingItems.length; i++) {
                            const item = allRotatingItems[i];
                            const finalX = centerWorldPos.x + (item.offsetX * cos - item.offsetZ * sin);
                            const finalZ = centerWorldPos.z + (item.offsetX * sin + item.offsetZ * cos);
                            item.node.setPosition(finalX, item.layerY + curLiftY, finalZ);
                        }
                    }
                })
            )
            .call(() => {
                this._currentRotationAngle = targetAngle % 360;

                // 还原旋转杆高度与最终角度校准
                if (this.rotateNode) {
                    const curRotPos = this.rotateNode.getPosition();
                    this.rotateNode.setPosition(curRotPos.x, rotateNodeBasePosY, curRotPos.z);
                    this.rotateNode.setRotationFromEuler(0, -this._currentRotationAngle, 0);
                }

                // 4. 数据层网格迁移：采用原子级“两阶段迁移”，避免后继槽位的注销覆盖前驱槽位刚刚注册的新数据
                const numSlots = this.slots.length;

                // 阶段一：先将所有参与旋转分支槽位的旧数据完整注销与移除
                for (let sIdx = 0; sIdx < numSlots; sIdx++) {
                    const originCoord = this.slots[sIdx];

                    if (slotSawList[sIdx]) {
                        gridMgr.unregisterSaw(originCoord.r, originCoord.c);
                    }
                    if (slotStopList[sIdx]) {
                        gridMgr.unregisterStopSlot(originCoord.r, originCoord.c);
                    }
                    if (slotGoPauseList[sIdx]) {
                        gridMgr.unregisterObstacle(originCoord.r, originCoord.c);
                        gridMgr.unregisterGoPauseBlock(originCoord.r, originCoord.c);
                    }
                    if (slotTurnList[sIdx]) {
                        gridMgr.unregisterRedirectPad(originCoord.r, originCoord.c);
                    }
                    if (slotTntList[sIdx]) {
                        gridMgr.unregisterTnt(originCoord.r, originCoord.c);
                    }
                    if (slotRocketList[sIdx]) {
                        gridMgr.unregisterRocketBomb(originCoord.r, originCoord.c);
                    }
                    const fromBlocks = slotBlockGroups[sIdx];
                    if (fromBlocks) {
                        fromBlocks.forEach(block => {
                            gridMgr.removeBlock(block);
                        });
                    }
                }

                // 阶段二：统一更新网格逻辑坐标与世界物理坐标，并精准注册到目标新槽位 (Slot_i -> Slot_(i+1)%N)
                for (let sIdx = 0; sIdx < numSlots; sIdx++) {
                    const nextSlotIdx = (sIdx + 1) % numSlots;
                    const targetSlotCoord = this.slots[nextSlotIdx];

                    // 迁移 701 旋转锯齿轮 (GearBlock)
                    const saw = slotSawList[sIdx];
                    if (saw) {
                        saw.r = targetSlotCoord.r;
                        saw.c = targetSlotCoord.c;
                        saw.node.name = `GearBlock_${targetSlotCoord.r}_${targetSlotCoord.c}`;

                        const worldPos = HexMath.hexToWorld(targetSlotCoord.r, targetSlotCoord.c, 0, gameMain.hexRadius);
                        saw.node.setPosition(worldPos.x - gameMain.currentCenterX, gameMain.slotPosY, worldPos.z - gameMain.currentCenterZ);

                        gridMgr.registerSaw(targetSlotCoord.r, targetSlotCoord.c, saw);
                    }

                    // 迁移 101 P停车位/停止块 (StopBlock)
                    const stop = slotStopList[sIdx];
                    if (stop) {
                        stop.r = targetSlotCoord.r;
                        stop.c = targetSlotCoord.c;
                        stop.node.name = `StopBlock_${targetSlotCoord.r}_${targetSlotCoord.c}`;

                        const worldPos = HexMath.hexToWorld(targetSlotCoord.r, targetSlotCoord.c, 0, gameMain.hexRadius);
                        stop.node.setPosition(worldPos.x - gameMain.currentCenterX, gameMain.slotPosY, worldPos.z - gameMain.currentCenterZ);
                        stop.node.setRotationFromEuler(0, 180, 0);

                        gridMgr.registerStopSlot(targetSlotCoord.r, targetSlotCoord.c, stop);

                        // 隐藏目标槽位的备用普通底座，避免与 StopBlock 底座发生网格重叠
                        const targetFloor = gameMain.gridContainer.getChildByName(`Slot_${targetSlotCoord.r}_${targetSlotCoord.c}`);
                        if (targetFloor) {
                            targetFloor.active = false;
                        }

                    }

                    // 迁移 1201~1206 前进停止块 (GoPauseBlock)
                    const goPause = slotGoPauseList[sIdx];
                    if (goPause) {
                        goPause.r = targetSlotCoord.r;
                        goPause.c = targetSlotCoord.c;
                        goPause.node.name = `GoPauseBlock_${goPause.rawType}_${targetSlotCoord.r}_${targetSlotCoord.c}`;

                        const worldPos = HexMath.hexToWorld(targetSlotCoord.r, targetSlotCoord.c, 0, gameMain.hexRadius);
                        goPause.node.setPosition(worldPos.x - gameMain.currentCenterX, gameMain.slotPosY, worldPos.z - gameMain.currentCenterZ);

                        gridMgr.registerSlot(targetSlotCoord.r, targetSlotCoord.c);
                        gridMgr.registerObstacle(targetSlotCoord.r, targetSlotCoord.c);
                        gridMgr.registerGoPauseBlock(targetSlotCoord.r, targetSlotCoord.c, goPause);
                    }

                    // 迁移 601~606 / 1701 转向板 (TurnBlock / RandomTurnBlock)
                    const turn = slotTurnList[sIdx];
                    if (turn) {
                        turn.r = targetSlotCoord.r;
                        turn.c = targetSlotCoord.c;
                        turn.node.name = `TurnBlock_${targetSlotCoord.r}_${targetSlotCoord.c}`;

                        const worldPos = HexMath.hexToWorld(targetSlotCoord.r, targetSlotCoord.c, 0, gameMain.hexRadius);
                        turn.node.setPosition(worldPos.x - gameMain.currentCenterX, gameMain.slotPosY, worldPos.z - gameMain.currentCenterZ);

                        // 用户确认规则：保持绝对世界方向不变
                        const arrowAngle = HexMath.getArrowAngleY(turn.targetDir, turn.c);
                        if (turn.dirModelNode) {
                            turn.dirModelNode.setRotationFromEuler(0, arrowAngle, 0);
                        }

                        gridMgr.registerRedirectPad(targetSlotCoord.r, targetSlotCoord.c, turn);
                    }

                    // 迁移 301 TNT 炸药 (TntBlock)
                    const tnt = slotTntList[sIdx];
                    if (tnt) {
                        tnt.r = targetSlotCoord.r;
                        tnt.c = targetSlotCoord.c;
                        tnt.node.name = `TntBlock_${targetSlotCoord.r}_${targetSlotCoord.c}`;

                        const worldPos = HexMath.hexToWorld(targetSlotCoord.r, targetSlotCoord.c, 0, gameMain.hexRadius);
                        tnt.node.setPosition(worldPos.x - gameMain.currentCenterX, gameMain.slotPosY, worldPos.z - gameMain.currentCenterZ);

                        gridMgr.registerSlot(targetSlotCoord.r, targetSlotCoord.c);
                        gridMgr.registerTnt(targetSlotCoord.r, targetSlotCoord.c, tnt);
                    }

                    // 迁移 1501~1506 火箭炸药 (RocketBombBlock)
                    const rocket = slotRocketList[sIdx];
                    if (rocket) {
                        rocket.r = targetSlotCoord.r;
                        rocket.c = targetSlotCoord.c;
                        rocket.node.name = `RocketBombBlock_${targetSlotCoord.r}_${targetSlotCoord.c}`;

                        const worldPos = HexMath.hexToWorld(targetSlotCoord.r, targetSlotCoord.c, 0, gameMain.hexRadius);
                        rocket.node.setPosition(worldPos.x - gameMain.currentCenterX, gameMain.slotPosY, worldPos.z - gameMain.currentCenterZ);

                        gridMgr.registerSlot(targetSlotCoord.r, targetSlotCoord.c);
                        gridMgr.registerRocketBomb(targetSlotCoord.r, targetSlotCoord.c, rocket);
                    }

                    // 迁移普通六边形方块 (HexBlock)
                    const fromBlocks = slotBlockGroups[sIdx];
                    if (fromBlocks) {
                        fromBlocks.forEach(block => {
                            // 仅迁移网格物理槽位坐标，方块自身的颜色与绝对逃逸指示方向 (dir) 保持恒定不变
                            block.r = targetSlotCoord.r;
                            block.c = targetSlotCoord.c;

                            // 精准对齐物理坐标与刷新基准
                            const worldPos = HexMath.hexToWorld(targetSlotCoord.r, targetSlotCoord.c, 0, gameMain.hexRadius);
                            const layerY = gameMain.blockBasePosY + block.layer * gameMain.layerHeight;
                            block.node.setPosition(worldPos.x - gameMain.currentCenterX, layerY, worldPos.z - gameMain.currentCenterZ);

                            block.syncBaseTransform();
                            gridMgr.registerBlock(block);
                            block.state = BlockState.IDLE;
                        });
                    }
                }

                // 5. 刷新各分支槽位的顶层方块指示箭头
                for (let sIdx = 0; sIdx < numSlots; sIdx++) {
                    const coord = this.slots[sIdx];
                    const topBlock = gridMgr.getTopBlock(coord.r, coord.c);
                    if (topBlock) {
                        topBlock.setArrowState(true);
                    }
                }

                this._isRotating = false;

                if (gameMain) {
                    gameMain.checkGameStatus();
                }

                if (onComplete) {
                    onComplete();
                }
            })
            .start();
    }
}
