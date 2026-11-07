import { _decorator, Component, Node, Vec3, tween, v3 } from 'cc';
import { HexMath } from '../HexMath';

const { ccclass, property } = _decorator;

// ======================================== 地图特殊元素：导向转向板 ========================================
/**
 * 导向转向板组件 (TurnBlock / Special_6_601 ~ 606)
 * 挂载在 Special_6_601.prefab 预制体上
 * 对应美术目录: 6_TurnBlock
 * 核心机制：
 * 1. 固定放置在指定网格底座，具有特定的导向出口方向 (targetDir: 1~6)；
 * 2. 当其他方块沿原本方向翻滚经过该转向板时，运动方向被强制切换为 targetDir；
 * 3. 方块在转向板处接力加速，沿新方向继续向前翻滚直至出界消除或遇阻；
 * 4. 支持多个转向板连续变向与接力飞出！
 */
@ccclass('TurnBlock')
export class TurnBlock extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '转向板旋转导向主体节点 (用于根据方向旋转)', group: { name: '节点引用', id: '0' } })
    public dirModelNode: Node = null!;

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    /** 导向目标出口方向 (1:右上, 2:右, 3:右下, 4:左下, 5:左, 6:左上) */
    public targetDir: number = 1;

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    protected initNodeReferences() {
        if (!this.dirModelNode) {
            this.dirModelNode = this.node.getChildByName('_601_606_pre') ||
                this.node.getChildByName('dir') ||
                this.node;
        }
    }

    /**
     * 初始化导向转向板
     * @param r 行号
     * @param c 列号
     * @param targetDir 导向目标方向 (1~6，默认从 601~606 推导)
     */
    public initTurnBlock(r: number, c: number, targetDir: number = 1) {
        this.r = r;
        this.c = c;
        this.targetDir = targetDir;
        this.initNodeReferences();

        // 根据指示方向调整 3D 旋转角度，使箭头指向对应六边形边沿
        this.updateDirectionRotation();

    }

    /** 兼容旧接口 */
    public initPad(r: number, c: number, targetDir: number = 1) {
        this.initTurnBlock(r, c, targetDir);
    }

    /**
     * 根据 targetDir 计算并设置欧拉角旋转
     */
    private updateDirectionRotation() {
        if (!this.dirModelNode) return;

        // 方块指示方向的角度映射 (与 HexMath.getArrowAngleY 一致)
        const angle = HexMath.getArrowAngleY(this.targetDir, this.c);
        this.dirModelNode.setRotationFromEuler(0, angle, 0);
    }

    // ======================================== 交互动效与反馈 ========================================
    /**
     * 当方块经过该转向板并触发转向时播放微弹高光加速动效
     */
    public playTriggerAnim() {
        if (!this.dirModelNode) return;

        const originalScale = v3(1, 1, 1);
        const bumpScale = v3(1.15, 1.15, 1.15);

        tween(this.dirModelNode)
            .to(0.06, { scale: bumpScale }, { easing: 'quadOut' })
            .to(0.10, { scale: originalScale }, { easing: 'quadIn' })
            .start();
    }
}
