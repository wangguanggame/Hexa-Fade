import { _decorator, Component, Node, Vec3, tween, MeshRenderer, Material, v3, Color, Quat } from 'cc';
import { HexCoord, HexDirection, HexMath } from './HexMath';
import { PathSegment } from './HexGridManager';

const { ccclass, property } = _decorator;

// ======================================== 方块状态与预设颜色 ========================================
/**
 * 方块生命周期与动画状态枚举
 */
export enum BlockState {
    /** 静止待命状态 (可被点击) */
    IDLE = 0,
    /** 正在播放翻滚飞出、撞击或回退动画中 */
    ANIMATING = 1,
    /** 已完成消除并已销毁 */
    DESTROYED = 2
}

/**
 * 对应关卡配置 1~6 的预设醒目色彩 (RGB)
 */
export const PRESET_HEX_COLORS: Record<number, Color> = {
    1: new Color(245, 158, 11, 255), // 1: 黄色/橙色
    2: new Color(236, 72, 153, 255), // 2: 粉色
    3: new Color(34, 197, 94, 255),  // 3: 绿色
    4: new Color(59, 130, 246, 255), // 4: 蓝色
    5: new Color(239, 68, 68, 255),  // 5: 红色
    6: new Color(6, 182, 212, 255),  // 6: 天蓝/青色
};

// ======================================== 单个六边形方块控制器 ========================================
/**
 * 六边形方块组件控制器
 * 负责单个方块的数据存储、外观初始化、箭头展示、以及 3D 连环翻滚/受阻撞击回退等核心动力学表现
 */
@ccclass('HexBlock')
export class HexBlock extends Component {
    // ======================================== 数据属性 ========================================
    /** 关卡网格行号 r (row) */
    public r: number = 0;
    /** 关卡网格列号 c (col) */
    public c: number = 0;
    /** 所在垂直高度层数 layer (0: 最底层, 1: 中间层, 2: 顶层) */
    public layer: number = 0;
    /** 箭头指示方向与颜色 ID (1~6) */
    public dir: number = HexDirection.DOWN_LEFT;
    /** 当前方块状态 (IDLE / ANIMATING / DESTROYED) */
    public state: BlockState = BlockState.IDLE;
    /** 方块唯一递增 ID */
    public blockId: number = 0;
    /** 本次飞出掉落对应的飞分批次，同柱方块共享，用于只生成一次飞分 */
    public fallScoreBatchKey: string = '';
    /** 方块开始自由落体下落时的静态回调 (由 GameMain 注册，避免循环引用) */
    public static onStartFalling: ((block: HexBlock, worldPos: Vec3) => void) | null = null;
    /** 是否为该槽位当前最顶层方块 */
    public isTop: boolean = false;
    /** 六边形基准外接圆半径 */
    public hexRadius: number = HexMath.DEFAULT_RADIUS;

    // ======================================== 内部基准 Transform 缓存 ========================================
    /** 方块待命时的基准世界/局部位置 */
    private _basePosition: Vec3 = new Vec3();
    /** 方块待命时的基准旋转四元数 */
    private _baseRotation: Quat = new Quat();
    /** 方块待命时的基准缩放比例 */
    private _baseScale: Vec3 = new Vec3(1, 1, 1);

    // ======================================== 编辑器挂载引用 ========================================
    @property({ type: Node, tooltip: '指示箭头子节点 (Arrow)', group: { name: '节点引用', id: '0' } })
    public arrowNode: Node = null!;

    @property({ type: MeshRenderer, tooltip: '主体六边形 Mesh 渲染器 (Hexa)', group: { name: '渲染组件', id: '1' } })
    public meshRenderer: MeshRenderer = null!;

    // ======================================== 生命周期 ========================================
    onLoad() {
        this._basePosition.set(this.node.position);
        this.node.getRotation(this._baseRotation);
        this._baseScale.set(this.node.scale);

        if (!this.arrowNode) {
            this.arrowNode = this.node.getChildByName('Arrow')!;
        }
        if (!this.meshRenderer) {
            const hexa = this.node.getChildByName('Hexa');
            if (hexa) {
                this.meshRenderer = hexa.getComponent(MeshRenderer)!;
            }
        }
    }

    // ======================================== 初始化与状态控制 ========================================
    /**
     * 初始化六边形方块数据与外观
     * @param id 方块唯一 ID
     * @param coord 六边形网格坐标 (含层级 layer)
     * @param dir 逃逸指示方向 (1~6)
     * @param isTop 是否为顶层方块 (仅顶层激活箭头)
     * @param radius 六边形外接圆半径
     * @param mat 对应颜色材质
     */
    public initBlock(
        id: number,
        coord: HexCoord,
        dir: number,
        isTop: boolean,
        radius: number = HexMath.DEFAULT_RADIUS,
        mat?: Material
    ) {
        this.blockId = id;
        this.r = coord.r;
        this.c = coord.c;
        this.layer = coord.layer ?? 0;
        this.dir = dir;
        this.state = BlockState.IDLE;
        this.isTop = isTop;
        this.hexRadius = radius;

        // 根节点保持 (0, 0, 0) 与底座绝对同轴严丝合缝对齐
        this.node.setRotationFromEuler(0, 0, 0);

        this._basePosition.set(this.node.position);
        this.node.getRotation(this._baseRotation);
        this._baseScale.set(this.node.scale);

        // 设置箭头朝向与显隐 (仅顶层激活展示并旋转)
        this.setArrowState(isTop);

        if (this.meshRenderer && mat) {
            this.meshRenderer.setMaterial(mat, 0);
        }
    }

    /**
     * 设置箭头显示状态与旋转角
     * @param active 是否显示箭头
     */
    public setArrowState(active: boolean) {
        if (!this.node || !this.node.isValid) return;
        if (!this.arrowNode) {
            this.arrowNode = this.node.getChildByName('Arrow') || null!;
        }
        if (this.arrowNode && this.arrowNode.isValid) {
            this.arrowNode.active = active;
            if (active) {
                const arrowAngle = HexMath.getArrowAngleY(this.dir, this.c);
                this.arrowNode.setRotationFromEuler(0, arrowAngle, 0);
            }
        }
    }

    /**
     * 当上层方块消除后，本层被揭开成为新的最顶层方块，带有弹性显现动效
     */
    public revealAsTop() {
        if (!this.node || !this.node.isValid || this.state === BlockState.DESTROYED) return;
        this.isTop = true;
        this.setArrowState(true);
        if (this.arrowNode && this.arrowNode.isValid) {
            this.arrowNode.setScale(0.01, 0.01, 0.01);
            tween(this.arrowNode)
                .to(0.18, { scale: v3(1, 1, 1) }, { easing: 'backOut' })
                .start();
        }
    }

    /**
     * 设置局部位置基准坐标
     * @param pos 基准位置
     */
    public setBasePosition(pos: Vec3) {
        this.node.setPosition(pos);
        this._basePosition.set(pos);
    }

    /**
     * 重置/同步当前的 Transform 为新的待命基准 (用于机关旋转/移动后的基准校准)
     */
    public syncBaseTransform() {
        this.node.setRotationFromEuler(0, 0, 0);
        this._basePosition.set(this.node.position);
        this.node.getRotation(this._baseRotation);
        this.setArrowState(this.isTop);
    }

    // ======================================== 核心翻滚与出界下落动画 ========================================
    /**
     * 逐格沿指示方向 180° 连环翻滚飞出消除动画
     * 机制说明：
     * 1. 沿指示方向每走一格，绕垂直于行进方向的水平轴翻滚 180° (立起 90° 并扣入下一格)；
     * 2. 连续逐格匀速翻滚 totalSteps 格到达棋盘边界外；
     * 3. 翻出界后顺势以 3 倍速垂直自由落体下落并销毁。
     * @param totalSteps 连续翻滚格数 (到达界外所需的精确步数)
     * @param stepDuration 单格 180° 翻滚耗时 (秒，默认 0.16s)
     * @param delay 错峰延迟 (秒)
     * @param onComplete 完成回调
     */
    public playFlyAwayAnim(
        totalSteps: number = 4,
        stepDuration: number = 0.16,
        delay: number = 0,
        onComplete?: () => void
    ) {
        if (this.state !== BlockState.IDLE) return;
        this.state = BlockState.ANIMATING;

        const dirVec = HexMath.getDirVector3D(this.dir, this.c);
        // 水平翻滚轴 (dx, 0, dz) -> (dz, 0, -dx)
        const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
        const stepDist = this.hexRadius * Math.sqrt(3); // 相邻两格中心距离

        let currentStep = 0;
        let currentPos = new Vec3(this._basePosition);
        let currentRot = new Quat(this._baseRotation);

        const executeStepRoll = () => {
            if (currentStep >= totalSteps) {
                // 连续翻滚出界完成，顺势以 3 倍速极速下坠并销毁
                this.executeFallAndHide(stepDuration, onComplete);
                return;
            }

            const stepStartPos = new Vec3(currentPos);
            const stepTargetPos = new Vec3(
                stepStartPos.x + dirVec.x * stepDist,
                stepStartPos.y,
                stepStartPos.z + dirVec.z * stepDist
            );

            const stepStartRot = new Quat(currentRot);
            const tempRot = new Quat();
            const deltaRot = new Quat();

            const gridProgress = { t: 0 };
            const arcHeight = 0.25; // 翻滚立起时的物理高度拱起

            // 单格翻滚：位置推进一格，朝向前进轴翻滚 180 度 (立起 90° -> 扣下 180°)
            tween(gridProgress)
                .to(stepDuration, { t: 1 }, {
                    easing: 'linear',
                    onUpdate: (tgt: { t: number }) => {
                        const t = tgt.t;
                        // 1. 水平推进与垂直立起弧线
                        const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                        const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                        const arcY = Math.sin(t * Math.PI) * arcHeight;
                        this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                        // 2. 翻滚 180 度四元数
                        const angle = Math.PI * t;
                        Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                        Quat.multiply(tempRot, deltaRot, stepStartRot);
                        this.node.setRotation(tempRot);
                    }
                })
                .call(() => {
                    // 记录该格翻滚后的新位置与朝向，进入下一格翻滚
                    currentPos.set(stepTargetPos);
                    currentRot.set(tempRot);
                    currentStep++;
                    executeStepRoll();
                })
                .start();
        };

        if (delay > 0) {
            tween(this.node)
                .delay(delay)
                .call(() => {
                    executeStepRoll();
                })
                .start();
        } else {
            executeStepRoll();
        }
    }

    /**
     * 沿多段轨迹 (经由一个或多个导向转向板接力换向) 连续翻滚飞出棋盘并消除
     * @param segments 分段轨迹数据
     * @param stepDuration 单格翻滚耗时
     * @param delay 错峰延迟
     * @param onComplete 全部飞出完成回调
     */
    public playMultiSegmentFlyAnim(
        segments: PathSegment[],
        stepDuration: number = 0.16,
        delay: number = 0,
        onComplete?: () => void
    ) {
        if (this.state !== BlockState.IDLE) return;
        this.state = BlockState.ANIMATING;

        let segIndex = 0;
        let currentPos = new Vec3(this.node.position);
        let currentRot = new Quat(this._baseRotation);

        const executeNextSegment = () => {
            if (segIndex >= segments.length) {
                // 全部段落走完，自由落体下落出界并销毁
                this.executeFallAndHide(stepDuration, onComplete);
                return;
            }

            const seg = segments[segIndex];
            const dirVec = HexMath.getDirVector3D(seg.dir, seg.startCoord.c);
            const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
            const stepDist = this.hexRadius * Math.sqrt(3);

            let stepInSeg = 0;

            const executeStep = () => {
                if (stepInSeg >= seg.steps) {
                    // 该段结束！如果该段终点是转向板，触发转向板脉冲动效
                    if (seg.redirectPad) {
                        seg.redirectPad.playTriggerAnim();
                    }
                    segIndex++;
                    executeNextSegment();
                    return;
                }

                const stepStartPos = new Vec3(currentPos);
                const stepTargetPos = new Vec3(
                    stepStartPos.x + dirVec.x * stepDist,
                    stepStartPos.y,
                    stepStartPos.z + dirVec.z * stepDist
                );

                const stepStartRot = new Quat(currentRot);
                const tempRot = new Quat();
                const deltaRot = new Quat();
                const progress = { t: 0 };
                const arcHeight = 0.25;

                tween(progress)
                    .to(stepDuration, { t: 1 }, {
                        easing: 'linear',
                        onUpdate: (tgt: { t: number }) => {
                            const t = tgt.t;
                            const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                            const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                            const arcY = Math.sin(t * Math.PI) * arcHeight;
                            this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                            // 180° 翻滚
                            const angle = Math.PI * t;
                            Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                            Quat.multiply(tempRot, deltaRot, stepStartRot);
                            this.node.setRotation(tempRot);
                        }
                    })
                    .call(() => {
                        currentPos.set(stepTargetPos);
                        currentRot.set(tempRot);
                        stepInSeg++;
                        executeStep();
                    })
                    .start();
            };

            executeStep();
        };

        if (delay > 0) {
            tween(this.node)
                .delay(delay)
                .call(executeNextSegment)
                .start();
        } else {
            executeNextSegment();
        }
    }

    // ======================================== 拦截移动与停靠入库动画 ========================================
    /**
     * 沿指示方向 3D 翻滚移动并在目标槽位 (如 P 停车位) 平稳落座入库 (支持沿转向板多段折线入库，正面朝上与指示箭头恒定)
     * @param targetSlot 目标槽位网格坐标 (r, c)
     * @param targetWorldPos 目标槽位世界坐标
     * @param totalSteps 连续移动格数
     * @param stepDuration 单格翻滚耗时 (秒)
     * @param delay 延迟时间 (秒)
     * @param onComplete 入库落座完成回调
     * @param segments 可选分段轨迹 (若中途经过转向板折射)
     */
    public playMoveToSlotAnim(
        targetSlot: HexCoord,
        targetWorldPos: Vec3,
        totalSteps: number = 1,
        stepDuration: number = 0.16,
        delay: number = 0,
        onComplete?: () => void,
        segments?: PathSegment[]
    ) {
        if (this.state !== BlockState.IDLE) return;
        this.state = BlockState.ANIMATING;

        const startBaseRot = new Quat(this._baseRotation);

        // 如果存在分段轨迹 (例如经过了转向板变向折射到达停车位)
        if (segments && segments.length > 0) {
            let segIndex = 0;
            let currentPos = new Vec3(this._basePosition);

            const executeNextSegment = () => {
                if (segIndex >= segments.length) {
                    // 全部段落完成：精准就位与状态归位
                    this.node.setPosition(targetWorldPos);
                    this.node.setRotation(startBaseRot);
                    this.r = targetSlot.r;
                    this.c = targetSlot.c;
                    this.syncBaseTransform();
                    this.state = BlockState.IDLE;
                    if (onComplete) onComplete();
                    return;
                }

                const seg = segments[segIndex];
                const dirVec = HexMath.getDirVector3D(seg.dir, seg.startCoord.c);
                const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
                const stepDist = this.hexRadius * Math.sqrt(3);

                let stepInSeg = 0;

                const executeStep = () => {
                    if (stepInSeg >= seg.steps) {
                        // 当前段结束，如果带有转向板，触发脉冲动效
                        if (seg.redirectPad) {
                            seg.redirectPad.playTriggerAnim();
                        }
                        segIndex++;
                        executeNextSegment();
                        return;
                    }

                    const stepStartPos = new Vec3(currentPos);
                    const stepTargetPos = new Vec3(
                        stepStartPos.x + dirVec.x * stepDist,
                        stepStartPos.y,
                        stepStartPos.z + dirVec.z * stepDist
                    );

                    const tempRot = new Quat();
                    const deltaRot = new Quat();
                    const gridProgress = { t: 0 };
                    const arcHeight = 0.22;

                    tween(gridProgress)
                        .to(stepDuration, { t: 1 }, {
                            easing: 'linear',
                            onUpdate: (tgt: { t: number }) => {
                                const t = tgt.t;
                                const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                                const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                                const arcY = Math.sin(t * Math.PI) * arcHeight;
                                this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                                const angle = 2 * Math.PI * t;
                                Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                                Quat.multiply(tempRot, deltaRot, startBaseRot);
                                this.node.setRotation(tempRot);
                            }
                        })
                        .call(() => {
                            currentPos.set(stepTargetPos);
                            this.node.setRotation(startBaseRot);
                            stepInSeg++;
                            executeStep();
                        })
                        .start();
                };

                executeStep();
            };

            if (delay > 0) {
                tween(this.node)
                    .delay(delay)
                    .call(executeNextSegment)
                    .start();
            } else {
                executeNextSegment();
            }
            return;
        }

        // 无转向段时的标准直线入库
        const dirVec = HexMath.getDirVector3D(this.dir, this.c);
        const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
        const stepDist = this.hexRadius * Math.sqrt(3);

        let currentStep = 0;
        let currentPos = new Vec3(this._basePosition);

        const executeStepRoll = () => {
            if (currentStep >= totalSteps) {
                // 到达目标停车位：精准对齐物理坐标并重置基准点，旋转严格归位
                this.node.setPosition(targetWorldPos);
                this.node.setRotation(startBaseRot);
                this.r = targetSlot.r;
                this.c = targetSlot.c;
                this.syncBaseTransform();
                this.state = BlockState.IDLE;
                if (onComplete) onComplete();
                return;
            }

            const stepStartPos = new Vec3(currentPos);
            const stepTargetPos = new Vec3(
                stepStartPos.x + dirVec.x * stepDist,
                stepStartPos.y,
                stepStartPos.z + dirVec.z * stepDist
            );

            const tempRot = new Quat();
            const deltaRot = new Quat();

            const gridProgress = { t: 0 };
            const arcHeight = 0.22;

            tween(gridProgress)
                .to(stepDuration, { t: 1 }, {
                    easing: 'linear',
                    onUpdate: (tgt: { t: number }) => {
                        const t = tgt.t;
                        const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                        const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                        const arcY = Math.sin(t * Math.PI) * arcHeight;
                        this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                        // 每步旋转 360° (2 * PI) 完整前滚翻，落座时正面永远朝上，箭头方向绝对恒定！
                        const angle = 2 * Math.PI * t;
                        Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                        Quat.multiply(tempRot, deltaRot, startBaseRot);
                        this.node.setRotation(tempRot);
                    }
                })
                .call(() => {
                    currentPos.set(stepTargetPos);
                    this.node.setRotation(startBaseRot);
                    currentStep++;
                    executeStepRoll();
                })
                .start();
        };

        if (delay > 0) {
            tween(this.node)
                .delay(delay)
                .call(executeStepRoll)
                .start();
        } else {
            executeStepRoll();
        }
    }

    /**
     * 到达出口后播放碎裂与飞分，立即隐藏方块。
     * @param _stepDuration 保留原调用参数，不再播放下落动画
     * @param onComplete 完成回调
     */
    private executeFallAndHide(_stepDuration: number = 0.16, onComplete?: () => void) {
        // 隐藏前保存出口位置，播放碎裂粒子并生成飞分（同柱只计分一次）。
        if (HexBlock.onStartFalling) {
            HexBlock.onStartFalling(this, this.node.worldPosition.clone());
        }

        this.state = BlockState.DESTROYED;
        this.node.active = false;
        if (onComplete) onComplete();
    }

    // ======================================== 受阻碰撞与翻滚回退动画 ========================================
    /**
     * 紧邻障碍物时的原地敲击与回弹动画
     * @param onComplete 完成回调
     */
    public playWobbleAnim(onComplete?: () => void) {
        if (this.state !== BlockState.IDLE) return;
        this.state = BlockState.ANIMATING;

        const dirVec = HexMath.getDirVector3D(this.dir, this.c);
        const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();

        const startRot = new Quat(this._baseRotation);
        const currentRot = new Quat();
        const deltaRot = new Quat();
        const targetAngleRad = 35 * (Math.PI / 180); // 敲击 35 度

        const progressObj = { t: 0 };

        // 前冲翘起 -> 弹性回弹归位
        tween(progressObj)
            .to(0.08, { t: 1 }, {
                easing: 'quadOut',
                onUpdate: (tgt: { t: number }) => {
                    const angle = targetAngleRad * tgt.t;
                    Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                    Quat.multiply(currentRot, deltaRot, startRot);
                    this.node.setRotation(currentRot);
                }
            })
            .to(0.14, { t: 0 }, {
                easing: 'backOut',
                onUpdate: (tgt: { t: number }) => {
                    const angle = targetAngleRad * tgt.t;
                    Quat.fromAxisAngle(deltaRot, rollAxis, angle);
                    Quat.multiply(currentRot, deltaRot, startRot);
                    this.node.setRotation(currentRot);
                }
            })
            .call(() => {
                this.node.setPosition(this._basePosition);
                this.node.setRotation(this._baseRotation);
                this.node.setScale(this._baseScale);
                this.state = BlockState.IDLE;
                if (onComplete) onComplete();
            })
            .start();
    }

    /**
     * 障碍撞击回弹动画 (支持沿转向板折线向前并在遇阻后原路折线退回)
     * @param forwardSteps 前进格数
     * @param stepDuration 单格翻滚耗时
     * @param delay 错峰延迟
     * @param onComplete 完成回调
     * @param onHit 撞击到达瞬间回调 (用于碰撞触发 TNT 爆炸或机关受击)
     * @param segments 可选分段轨迹 (若中途经过转向板折射)
     */
    public playBlockedRollAnim(
        forwardSteps: number = 0,
        stepDuration: number = 0.16,
        delay: number = 0,
        onComplete?: () => void,
        onHit?: () => void,
        segments?: PathSegment[]
    ) {
        if (this.state !== BlockState.IDLE) return;

        // 如果存在分段轨迹 (例如经过转向板折射后撞击障碍)
        if (segments && segments.length > 0) {
            const totalSegSteps = segments.reduce((sum, s) => sum + s.steps, 0);
            if (totalSegSteps <= 0) {
                if (delay > 0) {
                    tween(this.node).delay(delay).call(() => {
                        if (onHit) onHit();
                        this.playWobbleAnim(onComplete);
                    }).start();
                } else {
                    if (onHit) onHit();
                    this.playWobbleAnim(onComplete);
                }
                return;
            }

            this.state = BlockState.ANIMATING;

            const runSegmentsBlockedFlow = () => {
                let segIndex = 0;
                let currentPos = new Vec3(this._basePosition);
                let currentRot = new Quat(this._baseRotation);

                // 1. 前进阶段：逐段向前翻滚到达障碍物前
                const executeForwardSegment = () => {
                    if (segIndex >= segments.length) {
                        hitAndReturnMulti();
                        return;
                    }

                    const seg = segments[segIndex];
                    const dirVec = HexMath.getDirVector3D(seg.dir, seg.startCoord.c);
                    const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
                    const stepDist = this.hexRadius * Math.sqrt(3);

                    let stepInSeg = 0;

                    const executeStep = () => {
                        if (stepInSeg >= seg.steps) {
                            if (seg.redirectPad) {
                                seg.redirectPad.playTriggerAnim();
                            }
                            segIndex++;
                            executeForwardSegment();
                            return;
                        }

                        const stepStartPos = new Vec3(currentPos);
                        const stepTargetPos = new Vec3(
                            stepStartPos.x + dirVec.x * stepDist,
                            stepStartPos.y,
                            stepStartPos.z + dirVec.z * stepDist
                        );

                        const stepStartRot = new Quat(currentRot);
                        const tempRot = new Quat();
                        const deltaRot = new Quat();
                        const progress = { t: 0 };
                        const arcHeight = 0.25;

                        tween(progress)
                            .to(stepDuration, { t: 1 }, {
                                easing: 'linear',
                                onUpdate: (tgt: { t: number }) => {
                                    const t = tgt.t;
                                    const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                                    const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                                    const arcY = Math.sin(t * Math.PI) * arcHeight;
                                    this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                                    Quat.fromAxisAngle(deltaRot, rollAxis, Math.PI * t);
                                    Quat.multiply(tempRot, deltaRot, stepStartRot);
                                    this.node.setRotation(tempRot);
                                }
                            })
                            .call(() => {
                                currentPos.set(stepTargetPos);
                                currentRot.set(tempRot);
                                stepInSeg++;
                                executeStep();
                            })
                            .start();
                    };

                    executeStep();
                };

                // 2. 障碍前撞击翘起
                const hitAndReturnMulti = () => {
                    const lastSeg = segments[segments.length - 1];
                    const lastDirVec = HexMath.getDirVector3D(lastSeg.dir, lastSeg.startCoord.c);
                    const lastRollAxis = new Vec3(lastDirVec.z, 0, -lastDirVec.x).normalize();

                    const hitRot = new Quat(currentRot);
                    const hitDeltaRot = new Quat();
                    const tempHitRot = new Quat();
                    const hitProgress = { t: 0 };
                    const hitAngleRad = 25 * (Math.PI / 180);

                    tween(hitProgress)
                        .to(0.06, { t: 1 }, {
                            easing: 'quadOut',
                            onUpdate: (tgt: { t: number }) => {
                                Quat.fromAxisAngle(hitDeltaRot, lastRollAxis, hitAngleRad * tgt.t);
                                Quat.multiply(tempHitRot, hitDeltaRot, hitRot);
                                this.node.setRotation(tempHitRot);
                            }
                        })
                        .to(0.08, { t: 0 }, {
                            easing: 'quadIn',
                            onUpdate: (tgt: { t: number }) => {
                                Quat.fromAxisAngle(hitDeltaRot, lastRollAxis, hitAngleRad * tgt.t);
                                Quat.multiply(tempHitRot, hitDeltaRot, hitRot);
                                this.node.setRotation(tempHitRot);
                            }
                        })
                        .call(() => {
                            if (onHit) onHit();

                            // 3. 原路逆向反推翻滚退回初始槽位
                            let backSegIndex = segments.length - 1;

                            const executeBackSegment = () => {
                                if (backSegIndex < 0) {
                                    this.node.setPosition(this._basePosition);
                                    this.node.setRotation(this._baseRotation);
                                    this.node.setScale(this._baseScale);
                                    this.state = BlockState.IDLE;
                                    if (onComplete) onComplete();
                                    return;
                                }

                                const bSeg = segments[backSegIndex];
                                const bDirVec = HexMath.getDirVector3D(bSeg.dir, bSeg.startCoord.c);
                                const fAxis = new Vec3(bDirVec.z, 0, -bDirVec.x).normalize();
                                const bRollAxis = new Vec3(-fAxis.x, -fAxis.y, -fAxis.z);
                                const bStepDist = this.hexRadius * Math.sqrt(3);

                                let bStepInSeg = 0;

                                const executeBackStep = () => {
                                    if (bStepInSeg >= bSeg.steps) {
                                        backSegIndex--;
                                        executeBackSegment();
                                        return;
                                    }

                                    const bStartPos = new Vec3(currentPos);
                                    const bTargetPos = new Vec3(
                                        bStartPos.x - bDirVec.x * bStepDist,
                                        bStartPos.y,
                                        bStartPos.z - bDirVec.z * bStepDist
                                    );

                                    const bStartRot = new Quat(currentRot);
                                    const bTempRot = new Quat();
                                    const bDeltaRot = new Quat();
                                    const bProgress = { t: 0 };
                                    const arcHeight = 0.25;

                                    tween(bProgress)
                                        .to(stepDuration, { t: 1 }, {
                                            easing: 'linear',
                                            onUpdate: (tgt: { t: number }) => {
                                                const t = tgt.t;
                                                const currX = bStartPos.x + (bTargetPos.x - bStartPos.x) * t;
                                                const currZ = bStartPos.z + (bTargetPos.z - bStartPos.z) * t;
                                                const arcY = Math.sin(t * Math.PI) * arcHeight;
                                                this.node.setPosition(currX, bStartPos.y + arcY, currZ);

                                                Quat.fromAxisAngle(bDeltaRot, bRollAxis, Math.PI * t);
                                                Quat.multiply(bTempRot, bDeltaRot, bStartRot);
                                                this.node.setRotation(bTempRot);
                                            }
                                        })
                                        .call(() => {
                                            currentPos.set(bTargetPos);
                                            currentRot.set(bTempRot);
                                            bStepInSeg++;
                                            executeBackStep();
                                        })
                                        .start();
                                };

                                executeBackStep();
                            };

                            executeBackSegment();
                        })
                        .start();
                };

                executeForwardSegment();
            };

            if (delay > 0) {
                tween(this.node).delay(delay).call(runSegmentsBlockedFlow).start();
            } else {
                runSegmentsBlockedFlow();
            }
            return;
        }

        // 紧邻障碍物，直接原地敲击回弹
        if (forwardSteps <= 0) {
            if (delay > 0) {
                tween(this.node)
                    .delay(delay)
                    .call(() => {
                        if (onHit) onHit();
                        this.playWobbleAnim(onComplete);
                    })
                    .start();
            } else {
                if (onHit) onHit();
                this.playWobbleAnim(onComplete);
            }
            return;
        }

        this.state = BlockState.ANIMATING;

        const dirVec = HexMath.getDirVector3D(this.dir, this.c);
        const forwardRollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
        const backwardRollAxis = new Vec3(-forwardRollAxis.x, -forwardRollAxis.y, -forwardRollAxis.z);
        const stepDist = this.hexRadius * Math.sqrt(3);

        const runBlockedFlow = () => {
            let currentStep = 0;
            let currentPos = new Vec3(this._basePosition);
            let currentRot = new Quat(this._baseRotation);

            // 1. 前进阶段：向前连续翻滚 forwardSteps 步到达障碍物前
            const stepForward = () => {
                if (currentStep >= forwardSteps) {
                    if (onHit) onHit();
                    hitAndReturn();
                    return;
                }

                const stepStartPos = new Vec3(currentPos);
                const stepTargetPos = new Vec3(
                    stepStartPos.x + dirVec.x * stepDist,
                    stepStartPos.y,
                    stepStartPos.z + dirVec.z * stepDist
                );

                const stepStartRot = new Quat(currentRot);
                const tempRot = new Quat();
                const deltaRot = new Quat();
                const progress = { t: 0 };
                const arcHeight = 0.25;

                tween(progress)
                    .to(stepDuration, { t: 1 }, {
                        easing: 'linear',
                        onUpdate: (tgt: { t: number }) => {
                            const t = tgt.t;
                            const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                            const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                            const arcY = Math.sin(t * Math.PI) * arcHeight;
                            this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                            Quat.fromAxisAngle(deltaRot, forwardRollAxis, Math.PI * t);
                            Quat.multiply(tempRot, deltaRot, stepStartRot);
                            this.node.setRotation(tempRot);
                        }
                    })
                    .call(() => {
                        currentPos.set(stepTargetPos);
                        currentRot.set(tempRot);
                        currentStep++;
                        stepForward();
                    })
                    .start();
            };

            // 2. 障碍物前碰撞翘起与反向回退
            const hitAndReturn = () => {
                const hitRot = new Quat(currentRot);
                const hitDeltaRot = new Quat();
                const tempHitRot = new Quat();
                const hitProgress = { t: 0 };
                const hitAngleRad = 25 * (Math.PI / 180);

                tween(hitProgress)
                    .to(0.06, { t: 1 }, {
                        easing: 'quadOut',
                        onUpdate: (tgt: { t: number }) => {
                            Quat.fromAxisAngle(hitDeltaRot, forwardRollAxis, hitAngleRad * tgt.t);
                            Quat.multiply(tempHitRot, hitDeltaRot, hitRot);
                            this.node.setRotation(tempHitRot);
                        }
                    })
                    .to(0.08, { t: 0 }, {
                        easing: 'quadIn',
                        onUpdate: (tgt: { t: number }) => {
                            Quat.fromAxisAngle(hitDeltaRot, forwardRollAxis, hitAngleRad * tgt.t);
                            Quat.multiply(tempHitRot, hitDeltaRot, hitRot);
                            this.node.setRotation(tempHitRot);
                        }
                    })
                    .call(() => {
                        // 3. 原路反向翻滚退回初始槽位
                        let backStep = 0;
                        const stepBackward = () => {
                            if (backStep >= forwardSteps) {
                                // 完全退回起点槽位，重置状态
                                this.node.setPosition(this._basePosition);
                                this.node.setRotation(this._baseRotation);
                                this.node.setScale(this._baseScale);
                                this.state = BlockState.IDLE;
                                if (onComplete) onComplete();
                                return;
                            }

                            const bStartPos = new Vec3(currentPos);
                            const bTargetPos = new Vec3(
                                bStartPos.x - dirVec.x * stepDist,
                                bStartPos.y,
                                bStartPos.z - dirVec.z * stepDist
                            );

                            const bStartRot = new Quat(currentRot);
                            const bTempRot = new Quat();
                            const bDeltaRot = new Quat();
                            const bProgress = { t: 0 };
                            const arcHeight = 0.25;

                            tween(bProgress)
                                .to(stepDuration, { t: 1 }, {
                                    easing: 'linear',
                                    onUpdate: (tgt: { t: number }) => {
                                        const t = tgt.t;
                                        const currX = bStartPos.x + (bTargetPos.x - bStartPos.x) * t;
                                        const currZ = bStartPos.z + (bTargetPos.z - bStartPos.z) * t;
                                        const arcY = Math.sin(t * Math.PI) * arcHeight;
                                        this.node.setPosition(currX, bStartPos.y + arcY, currZ);

                                        Quat.fromAxisAngle(bDeltaRot, backwardRollAxis, Math.PI * t);
                                        Quat.multiply(bTempRot, bDeltaRot, bStartRot);
                                        this.node.setRotation(bTempRot);
                                    }
                                })
                                .call(() => {
                                    currentPos.set(bTargetPos);
                                    currentRot.set(bTempRot);
                                    backStep++;
                                    stepBackward();
                                })
                                .start();
                        };

                        stepBackward();
                    })
                    .start();
            };

            stepForward();
        };

        if (delay > 0) {
            tween(this.node)
                .delay(delay)
                .call(() => runBlockedFlow())
                .start();
        } else {
            runBlockedFlow();
        }
    }

    /**
     * 撞击 TNT 专运动画：向前连续翻滚 forwardSteps 步到达 TNT 面前，在撞击瞬间触发引爆并被一同炸毁消散
     * @param forwardSteps 前进可走的步数 (0 表示紧邻 TNT)
     * @param stepDuration 单格翻滚耗时
     * @param delay 错峰延迟
     * @param onImpact 撞击到达 TNT 瞬间回调 (用于引爆 TNT)
     */
    public playRollToImpactAndDestroyAnim(
        forwardSteps: number = 0,
        stepDuration: number = 0.16,
        delay: number = 0,
        onImpact?: () => void
    ) {
        this.state = BlockState.ANIMATING;

        const dirVec = HexMath.getDirVector3D(this.dir, this.c);
        const forwardRollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
        const stepDist = this.hexRadius * Math.sqrt(3);

        const executeForward = () => {
            if (forwardSteps <= 0) {
                // 紧邻 TNT，直接触发爆炸并销毁
                if (onImpact) onImpact();
                this.state = BlockState.DESTROYED;
                this.node.destroy();
                return;
            }

            let currentStep = 0;
            let currentPos = new Vec3(this._basePosition);
            let currentRot = new Quat(this._baseRotation);

            const stepForward = () => {
                if (currentStep >= forwardSteps) {
                    // 到达 TNT 面前！触发爆炸并当场销毁
                    if (onImpact) onImpact();
                    this.state = BlockState.DESTROYED;
                    this.node.destroy();
                    return;
                }

                const stepStartPos = new Vec3(currentPos);
                const stepTargetPos = new Vec3(
                    stepStartPos.x + dirVec.x * stepDist,
                    stepStartPos.y,
                    stepStartPos.z + dirVec.z * stepDist
                );

                const stepStartRot = new Quat(currentRot);
                const tempRot = new Quat();
                const deltaRot = new Quat();
                const progress = { t: 0 };
                const arcHeight = 0.25;

                tween(progress)
                    .to(stepDuration, { t: 1 }, {
                        easing: 'linear',
                        onUpdate: (tgt: { t: number }) => {
                            const t = tgt.t;
                            const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                            const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                            const arcY = Math.sin(t * Math.PI) * arcHeight;
                            this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                            Quat.fromAxisAngle(deltaRot, forwardRollAxis, Math.PI * t);
                            Quat.multiply(tempRot, deltaRot, stepStartRot);
                            this.node.setRotation(tempRot);
                        }
                    })
                    .call(() => {
                        currentPos.set(stepTargetPos);
                        currentRot.set(tempRot);
                        currentStep++;
                        stepForward();
                    })
                    .start();
            };

            stepForward();
        };

        if (delay > 0) {
            tween(this.node)
                .delay(delay)
                .call(executeForward)
                .start();
        } else {
            executeForward();
        }
    }

    /**
     * 701 旋转锯齿轮切碎动画：向前连续翻滚 forwardSteps 步切入锯齿轮中心，并在切入瞬间触发切碎动效并销毁
     * @param forwardSteps 前进到达锯齿轮所需的步数 (>= 1)
     * @param stepDuration 单格翻滚耗时
     * @param delay 错峰延迟
     * @param onShredMoment 切入锯齿轮瞬间回调 (用于触发锯齿轮微震与切碎碎片粒子)
     * @param onComplete 销毁完成回调
     * @param segments 可选分段轨迹 (如果中途经过了转向板)
     */
    public playRollToShredAndDestroyAnim(
        forwardSteps: number = 1,
        stepDuration: number = 0.16,
        delay: number = 0,
        onShredMoment?: (worldPos: Vec3, color?: Color, dir?: number) => void,
        onComplete?: () => void,
        segments?: PathSegment[]
    ) {
        this.state = BlockState.ANIMATING;

        const blockColor = PRESET_HEX_COLORS[this.dir];

        const executeShredMoment = (finalWorldPos: Vec3) => {
            if (onShredMoment) {
                onShredMoment(finalWorldPos, blockColor, this.dir);
            }
            // 方块在切碎轮中心快速缩小收缩并销毁 (配合粒子炸开)
            tween(this.node)
                .to(0.06, { scale: v3(0, 0, 0) }, { easing: 'quadIn' })
                .call(() => {
                    this.state = BlockState.DESTROYED;
                    this.node.active = false;
                    this.node.destroy();
                    if (onComplete) onComplete();
                })
                .start();
        };

        if (segments && segments.length > 0) {
            // 多段轨迹切入 (经由转向板变向后切入锯齿轮)
            let segIndex = 0;
            let currentPos = new Vec3(this.node.position);
            let currentRot = new Quat(this._baseRotation);

            const executeNextSeg = () => {
                if (segIndex >= segments.length) {
                    executeShredMoment(this.node.worldPosition);
                    return;
                }

                const seg = segments[segIndex];
                const dirVec = HexMath.getDirVector3D(seg.dir, seg.startCoord.c);
                const rollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
                const stepDist = this.hexRadius * Math.sqrt(3);

                let stepInSeg = 0;
                const isLastSeg = (segIndex === segments.length - 1);

                const executeSegStep = () => {
                    if (stepInSeg >= seg.steps) {
                        if (seg.redirectPad) {
                            seg.redirectPad.playTriggerAnim();
                        }
                        segIndex++;
                        executeNextSeg();
                        return;
                    }

                    const stepStartPos = new Vec3(currentPos);
                    const stepTargetPos = new Vec3(
                        stepStartPos.x + dirVec.x * stepDist,
                        stepStartPos.y,
                        stepStartPos.z + dirVec.z * stepDist
                    );

                    const stepStartRot = new Quat(currentRot);
                    const tempRot = new Quat();
                    const deltaRot = new Quat();
                    const progress = { t: 0 };
                    const arcHeight = 0.25;

                    tween(progress)
                        .to(stepDuration, { t: 1 }, {
                            easing: 'linear',
                            onUpdate: (tgt: { t: number }) => {
                                const t = tgt.t;
                                const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                                const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                                const arcY = Math.sin(t * Math.PI) * arcHeight;
                                this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                                Quat.fromAxisAngle(deltaRot, rollAxis, Math.PI * t);
                                Quat.multiply(tempRot, deltaRot, stepStartRot);
                                this.node.setRotation(tempRot);
                            }
                        })
                        .call(() => {
                            currentPos.set(stepTargetPos);
                            currentRot.set(tempRot);
                            stepInSeg++;

                            // 如果是最后一段并且刚好走到了锯齿轮中心
                            if (isLastSeg && stepInSeg >= seg.steps) {
                                executeShredMoment(this.node.worldPosition);
                            } else {
                                executeSegStep();
                            }
                        })
                        .start();
                };

                executeSegStep();
            };

            if (delay > 0) {
                tween(this.node)
                    .delay(delay)
                    .call(executeNextSeg)
                    .start();
            } else {
                executeNextSeg();
            }
            return;
        }

        // 单段直接切入
        const dirVec = HexMath.getDirVector3D(this.dir, this.c);
        const forwardRollAxis = new Vec3(dirVec.z, 0, -dirVec.x).normalize();
        const stepDist = this.hexRadius * Math.sqrt(3);

        const executeStraight = () => {
            let currentStep = 0;
            let currentPos = new Vec3(this._basePosition);
            let currentRot = new Quat(this._baseRotation);

            const stepForward = () => {
                if (currentStep >= forwardSteps) {
                    executeShredMoment(this.node.worldPosition);
                    return;
                }

                const stepStartPos = new Vec3(currentPos);
                const stepTargetPos = new Vec3(
                    stepStartPos.x + dirVec.x * stepDist,
                    stepStartPos.y,
                    stepStartPos.z + dirVec.z * stepDist
                );

                const stepStartRot = new Quat(currentRot);
                const tempRot = new Quat();
                const deltaRot = new Quat();
                const progress = { t: 0 };
                const arcHeight = 0.25;

                tween(progress)
                    .to(stepDuration, { t: 1 }, {
                        easing: 'linear',
                        onUpdate: (tgt: { t: number }) => {
                            const t = tgt.t;
                            const currX = stepStartPos.x + (stepTargetPos.x - stepStartPos.x) * t;
                            const currZ = stepStartPos.z + (stepTargetPos.z - stepStartPos.z) * t;
                            const arcY = Math.sin(t * Math.PI) * arcHeight;
                            this.node.setPosition(currX, stepStartPos.y + arcY, currZ);

                            Quat.fromAxisAngle(deltaRot, forwardRollAxis, Math.PI * t);
                            Quat.multiply(tempRot, deltaRot, stepStartRot);
                            this.node.setRotation(tempRot);
                        }
                    })
                    .call(() => {
                        currentPos.set(stepTargetPos);
                        currentRot.set(tempRot);
                        currentStep++;
                        stepForward();
                    })
                    .start();
            };

            stepForward();
        };

        if (delay > 0) {
            tween(this.node)
                .delay(delay)
                .call(executeStraight)
                .start();
        } else {
            executeStraight();
        }
    }

    // ======================================== 道具特效动画表现 ========================================
    /**
     * 播放被炸弹 (TNT) 冲击波向四周炸飞解体并销毁的动画
     * @param centerPos 爆炸中心世界坐标
     * @param delay 延迟开始时间 (秒)
     * @param onComplete 动画完成销毁回调
     */
    public playExplodeAnim(centerPos: Vec3, delay: number = 0, onComplete?: () => void) {
        if (this.state === BlockState.DESTROYED || !this.node || !this.node.isValid) return;

        this.state = BlockState.ANIMATING;

        const runExplode = () => {
            if (!this.node || !this.node.isValid) return;

            const startPos = new Vec3(this.node.position);
            const startRot = new Quat(this.node.rotation);
            const startScale = new Vec3(this.node.scale);

            // 1. 计算被炸飞的方向向量 (水平向外扩散 + 向上扬起)
            let blastDir = new Vec3(startPos.x - centerPos.x, 0, startPos.z - centerPos.z);
            const dist2D = blastDir.length();

            if (dist2D < 0.05) {
                // 如果刚好在中心格，给予轻微随机水平偏移 + 直冲向上
                const randAngle = Math.random() * Math.PI * 2;
                blastDir = new Vec3(Math.cos(randAngle), 0, Math.sin(randAngle));
            } else {
                blastDir.normalize();
            }

            // 抛射终点：向外飞离 0.6~1.0 单位距离
            const flyDist = 0.6 + Math.random() * 0.4;
            const targetX = startPos.x + blastDir.x * flyDist;
            const targetZ = startPos.z + blastDir.z * flyDist;
            const peakY = startPos.y + 0.6 + Math.random() * 0.3; // 向上抛射顶点高度

            // 随机剧烈旋转四元数
            const randAxis = new Vec3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const totalSpinAngle = Math.PI * (2 + Math.random() * 2); // 翻转 1~2 圈

            const progress = { t: 0 };
            const animDuration = 0.42;

            const deltaRot = new Quat();
            const tempRot = new Quat();

            tween(progress)
                .to(animDuration, { t: 1 }, {
                    easing: 'quadOut',
                    onUpdate: (tgt: { t: number }) => {
                        if (!this.node || !this.node.isValid) return;
                        const t = tgt.t;

                        // 抛物线轨迹插值 (X, Z 匀速/缓出外扩，Y 轴先升后降抛物线)
                        const currX = startPos.x + (targetX - startPos.x) * t;
                        const currZ = startPos.z + (targetZ - startPos.z) * t;
                        const currY = startPos.y + Math.sin(t * Math.PI) * (peakY - startPos.y) - (t * t * 0.15);
                        this.node.setPosition(currX, currY, currZ);

                        // 剧烈旋转
                        Quat.fromAxisAngle(deltaRot, randAxis, totalSpinAngle * t);
                        Quat.multiply(tempRot, deltaRot, startRot);
                        this.node.setRotation(tempRot);

                        // 后半段缩小至 0
                        const scaleFactor = Math.max(0, 1 - t * t);
                        this.node.setScale(
                            startScale.x * scaleFactor,
                            startScale.y * scaleFactor,
                            startScale.z * scaleFactor
                        );
                    }
                })
                .call(() => {
                    this.state = BlockState.DESTROYED;
                    if (this.node && this.node.isValid) {
                        this.node.destroy();
                    }
                    if (onComplete) onComplete();
                })
                .start();
        };

        if (delay > 0) {
            tween(this.node)
                .delay(delay)
                .call(() => runExplode())
                .start();
        } else {
            runExplode();
        }
    }
}
