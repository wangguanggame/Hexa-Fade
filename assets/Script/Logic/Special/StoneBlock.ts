import { _decorator, Component, Node, Vec3, tween, v3 } from 'cc';
import { Audio, AudioId } from '../../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

// ======================================== 实体障碍石块控制器 ========================================
/**
 * 障碍石块组件 (StoneBlock / Special_4_102)
 * 挂载在 Special_4_102.prefab 预制体上
 * 对应美术目录: 4_StoneBlock
 * 核心机制：
 * 1. 永久占据地图上的某个六边形槽位，不可被点击或消除；
 * 2. 在网格中注册为绝对实体障碍物 (registerObstacle)，阻挡其它彩色方块穿行；
 * 3. 其它方块逃逸路径遭遇石块时，会发生撞击受阻并原路退回；
 * 4. 支持方块撞击时的物理受击微震动反馈动画。
 */
@ccclass('StoneBlock')
export class StoneBlock extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '石块模型主体节点', group: { name: '节点引用', id: '0' } })
    public stoneBodyNode: Node = null!;

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    private initNodeReferences() {
        if (!this.stoneBodyNode) {
            this.stoneBodyNode = this.node.getChildByPath('_102_pre/hx_1') ||
                this.node.getChildByName('_102_pre') ||
                this.node;
        }
    }

    /**
     * 初始化障碍石块
     * @param r 行号
     * @param c 列号
     */
    public initStoneBlock(r: number, c: number) {
        this.r = r;
        this.c = c;
        this.initNodeReferences();
    }

    /** 兼容旧接口 */
    public initObstacle(r: number, c: number) {
        this.initStoneBlock(r, c);
    }

    // ======================================== 物理受击反馈动画 ========================================
    /**
     * 当有方块撞击到该石块或受到炸弹波及时播放受击微震动动画
     */
    public playHitFeedbackAnim() {
        Audio.play(AudioId.stone);
        if (!this.stoneBodyNode) return;

        const originalScale = v3(1, 1, 1);
        tween(this.stoneBodyNode)
            .to(0.04, { scale: v3(1.08, 0.94, 1.08) }, { easing: 'quadOut' })
            .to(0.08, { scale: originalScale }, { easing: 'backOut' })
            .start();
    }

    /** 受击/爆炸波及受震动效别名 */
    public playHitShakeAnim() {
        this.playHitFeedbackAnim();
    }

    /**
     * 响应爆炸波及摧毁石块 (受击震裂并快速下沉销毁)
     */
    public destroyStone() {
        const targetNode = this.stoneBodyNode || this.node;
        if (!targetNode || !targetNode.isValid) {
            this.node.destroy();
            return;
        }

        tween(targetNode)
            .to(0.06, { scale: v3(1.15, 0.85, 1.15) }, { easing: 'quadOut' })
            .to(0.12, { scale: v3(0.01, 0.01, 0.01) }, { easing: 'quadIn' })
            .call(() => {
                if (this.node && this.node.isValid) {
                    this.node.destroy();
                }
            })
            .start();
    }
}
