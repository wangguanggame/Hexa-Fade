import { _decorator, Component, Node, Vec3, Color, MeshRenderer, Material, tween, v3 } from 'cc';
import { TurnBlock } from './TurnBlock';
import { HexMath } from '../HexMath';

const { ccclass, property } = _decorator;

// ====================================================================================================
//                                     模块一：组件基础定义与核心职责说明
// ====================================================================================================
/**
 * 双向交替分流转向板控制器 (RandomTurnBlock / Special_17_1701)
 * 对应预制体: Special_17_1701.prefab
 * 对应美术资产: 17_RandomTurnBlock
 * 关卡配置格式: r_c_1701_A^B (例如 9_6_1701_2^4)
 * 
 * 选项一特性实现：
 * 1. 【双箭头常驻显示】：两个方向箭头均在底盘上清晰可见，不隐藏待命箭头；
 * 2. 【高对比度材质区分】：
 *    - 当前生效箭头：亮白色材质 (RandomTurnBlock1)，1.05 放大微浮动；
 *    - 待命备用箭头：暗灰色材质 (MultiLayerBlock2)，0.88 比例微缩沉底；
 * 3. 【分层深度防穿模】：激活箭头略高 (-0.050)，待命箭头略低 (-0.055)，杜绝 Z-fighting 闪烁；
 * 4. 【方块踩踏交替轮换】：方块经过折射后，两只箭头弹性互换状态 (亮白 <-> 暗灰)，底盘同步轻微震动。
 */
@ccclass('RandomTurnBlock')
export class RandomTurnBlock extends TurnBlock {

    // ====================================================================================================
    //                                     模块二：节点引用与材质表现配置
    // ====================================================================================================
    @property({ type: Node, tooltip: '第一指示箭头节点 (dir)', group: { name: '节点引用', id: '0' } })
    public arrowNodeA: Node = null!;

    @property({ type: Node, tooltip: '第二指示箭头节点 (dir1)', group: { name: '节点引用', id: '0' } })
    public arrowNodeB: Node = null!;

    @property({ type: Node, tooltip: '备用/多余箭头节点 (dir2，默认隐藏)', group: { name: '节点引用', id: '0' } })
    public arrowNodeC: Node = null!;

    @property({ type: Node, tooltip: '底盘根节点 (_1701_pre)', group: { name: '节点引用', id: '0' } })
    public baseNode: Node = null!;

    @property({ type: Material, tooltip: '生效激活箭头材质 (亮白)', group: { name: '材质配置', id: '1' } })
    public activeMaterial: Material | null = null;

    @property({ type: Material, tooltip: '待命备用箭头材质 (暗灰)', group: { name: '材质配置', id: '1' } })
    public dimMaterial: Material | null = null;

    // ====================================================================================================
    //                                     模块三：核心运行时状态数据
    // ====================================================================================================
    /** 预设的交替出口方向列表 (例如 [2, 4]) */
    public directions: number[] = [1, 2];

    /** 当前生效的方向在 directions 数组中的索引 (0 或 1) */
    public currentIndex: number = 0;

    /** 激活箭头尺寸与悬浮高度 */
    private readonly SCALE_ACTIVE: Vec3 = v3(1.05, 1.05, 1.05);
    private readonly POS_Y_ACTIVE: number = -0.050;

    /** 待命箭头尺寸与贴地高度 */
    private readonly SCALE_INACTIVE: Vec3 = v3(0.88, 0.88, 0.88);
    private readonly POS_Y_INACTIVE: number = -0.055;

    /** 上一次触发变向的时间戳 (用于批次防抖节流，避免同一柱多层方块连环触发多次变向) */
    private _lastTriggerTimestamp: number = 0;
    private readonly BATCH_COOLDOWN_MS: number = 350;

    // ====================================================================================================
    //                                     模块四：生命周期与节点引用初始化
    // ====================================================================================================
    onLoad() {
        this.initNodeReferences();
    }

    /**
     * 自动解析并绑定预制体内的各级子节点及初始材质引用
     */
    protected override initNodeReferences() {
        if (!this.baseNode) {
            this.baseNode = this.node.getChildByName('_1701_pre') || this.node;
        }
        if (!this.arrowNodeA) {
            this.arrowNodeA = this.node.getChildByPath('_1701_pre/dir') || this.node.getChildByName('dir')!;
        }
        if (!this.arrowNodeB) {
            this.arrowNodeB = this.node.getChildByPath('_1701_pre/dir1') || this.node.getChildByName('dir1')!;
        }
        if (!this.arrowNodeC) {
            this.arrowNodeC = this.node.getChildByPath('_1701_pre/dir2') || this.node.getChildByName('dir2')!;
        }

        // 默认将 TurnBlock 的主体节点指向 baseNode
        this.dirModelNode = this.baseNode;

        // 自动提取预制体已挂载的材质作为缓存
        if (!this.activeMaterial && this.arrowNodeA) {
            const mrA = this.arrowNodeA.getComponent(MeshRenderer);
            if (mrA) this.activeMaterial = mrA.getMaterial(0);
        }
        if (!this.dimMaterial && this.arrowNodeB) {
            const mrB = this.arrowNodeB.getComponent(MeshRenderer);
            if (mrB && mrB.getMaterial(0) !== this.activeMaterial) {
                this.dimMaterial = mrB.getMaterial(0);
            }
        }
    }

    // ====================================================================================================
    //                                     模块五：数据初始化与双箭头角度计算
    // ====================================================================================================
    /**
     * 初始化双向交替分流转向板
     * @param r 网格行号
     * @param c 网格列号
     * @param subDirections 包含两个方向的数组 (例如 [2, 4])
     */
    public initRandomTurnBlock(r: number, c: number, subDirections: number[] = [1, 2]) {
        this.r = r;
        this.c = c;
        this.initNodeReferences();

        // 1. 规范化并保存方向列表
        if (subDirections && subDirections.length >= 2) {
            this.directions = [subDirections[0], subDirections[1]];
        } else if (subDirections && subDirections.length === 1) {
            this.directions = [subDirections[0], (subDirections[0] % 6) + 1];
        } else {
            this.directions = [1, 4];
        }

        this.currentIndex = 0;
        this.targetDir = this.directions[this.currentIndex];

        // 2. 隐藏多余的第三个模型节点 (dir2)
        if (this.arrowNodeC) {
            this.arrowNodeC.active = false;
        }

        // 3. 计算并设置两个方向箭头的欧拉角旋转 (精确对齐六边形 1~6 号出口)
        const angleA = HexMath.getArrowAngleY(this.directions[0], this.c);
        const angleB = HexMath.getArrowAngleY(this.directions[1], this.c);

        if (this.arrowNodeA) {
            this.arrowNodeA.active = true;
            this.arrowNodeA.setRotationFromEuler(0, angleA, 0);
        }

        if (this.arrowNodeB) {
            this.arrowNodeB.active = true;
            this.arrowNodeB.setRotationFromEuler(0, angleB, 0);
        }

        // 4. 应用选项一：双箭头同时常驻显示，初始 A 亮白微凸，B 暗灰微缩
        this.updateArrowVisuals(false);

    }

    // ====================================================================================================
    //                                     模块六：选项一高低亮与尺寸视觉外观渲染
    // ====================================================================================================
    /**
     * 刷新双箭头的材质颜色、分层高度与缩放状态
     * @param animated 是否使用过渡动画 (初始化为 false，切换状态时为 true)
     */
    private updateArrowVisuals(animated: boolean = true) {
        const isCurrentA = (this.currentIndex === 0);

        // 确定两个箭头的目标身份
        const activeNode = isCurrentA ? this.arrowNodeA : this.arrowNodeB;
        const inactiveNode = isCurrentA ? this.arrowNodeB : this.arrowNodeA;

        // 确保两个箭头节点始终保持激活开启状态 (选项一核心要求)
        if (activeNode) activeNode.active = true;
        if (inactiveNode) inactiveNode.active = true;

        // 切换材质：生效者亮白，待命者暗灰
        if (this.activeMaterial && activeNode) {
            this.setNodeMaterial(activeNode, this.activeMaterial);
        }
        if (this.dimMaterial && inactiveNode) {
            this.setNodeMaterial(inactiveNode, this.dimMaterial);
        }

        if (animated) {
            // 激活节点：从微缩快速弹起到 1.20 再平稳收拢在 1.05，伴随高度上浮
            if (activeNode) {
                tween(activeNode).stop();
                tween(activeNode)
                    .to(0.08, { 
                        scale: v3(1.20, 1.20, 1.20),
                        position: v3(0, this.POS_Y_ACTIVE, 0)
                    }, { easing: 'quadOut' })
                    .to(0.12, { scale: this.SCALE_ACTIVE }, { easing: 'quadIn' })
                    .start();
            }
            // 待命节点：平滑回缩至 0.88 并略微下沉，退居第二视觉层
            if (inactiveNode) {
                tween(inactiveNode).stop();
                tween(inactiveNode)
                    .to(0.14, { 
                        scale: this.SCALE_INACTIVE,
                        position: v3(0, this.POS_Y_INACTIVE, 0)
                    }, { easing: 'sineOut' })
                    .start();
            }
        } else {
            if (activeNode) {
                activeNode.setScale(this.SCALE_ACTIVE);
                activeNode.setPosition(0, this.POS_Y_ACTIVE, 0);
            }
            if (inactiveNode) {
                inactiveNode.setScale(this.SCALE_INACTIVE);
                inactiveNode.setPosition(0, this.POS_Y_INACTIVE, 0);
            }
        }
    }

    /**
     * 安全赋予目标节点 MeshRenderer 新材质
     */
    private setNodeMaterial(targetNode: Node | null, mat: Material | null) {
        if (!targetNode || !mat) return;
        const mr = targetNode.getComponent(MeshRenderer);
        if (mr) {
            mr.setMaterial(mat, 0);
        }
    }

    // ====================================================================================================
    //                                     模块七：踩踏触发、变向轮换与动画
    // ====================================================================================================
    /**
     * 重写父类触发事件：方块踩入本转向板时被调用
     * 执行底盘微弹动效，并轮换至下一个生效方向！
     */
    public override playTriggerAnim() {
        const now = Date.now();
        // 关键防抖：同一柱 3 层方块紧随通过的时间窗口内只触发 1 次换向
        if (now - this._lastTriggerTimestamp < this.BATCH_COOLDOWN_MS) {
            return;
        }
        this._lastTriggerTimestamp = now;

        // 1. 触发底盘脉冲微弹动效 (增强打击感)
        if (this.baseNode) {
            const originalScale = v3(1, 1, 1);
            const bumpScale = v3(1.10, 1.10, 1.10);

            tween(this.baseNode)
                .to(0.06, { scale: bumpScale }, { easing: 'quadOut' })
                .to(0.10, { scale: originalScale }, { easing: 'quadIn' })
                .start();
        }

        // 2. 轮转交替索引 (0 -> 1 -> 0)
        this.toggleNextDirection();
    }

    /**
     * 切换至下一个方向并同步更新外部导向 targetDir
     */
    public toggleNextDirection() {
        this.currentIndex = (this.currentIndex + 1) % this.directions.length;
        this.targetDir = this.directions[this.currentIndex];

        // 3. 播放箭头亮暗材质与尺寸切换动画
        this.updateArrowVisuals(true);

    }
}
