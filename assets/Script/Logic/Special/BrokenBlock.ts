import { _decorator, Component, Node, Vec3, tween, v3 } from 'cc';
import { HexGridManager } from '../HexGridManager';

const { ccclass, property } = _decorator;

// ======================================== 易碎崩塌地块/深坑陷阱控制器 ========================================
/**
 * 易碎崩塌地块组件 (BrokenBlock / Special_8_801)
 * 挂载在 Special_8_801.prefab 预制体上
 * 对应美术目录: 8_BrokenBlock
 * 核心机制：
 * 1. 初始状态：该槽位表面铺设一层易碎裂纹泥土地块，在网格中注册为正常底座；
 * 2. 首次通过（受力崩塌）：
 *    - 当第一个方块沿箭头方向翻滚经过该槽位时，方块正常飞出或通过；
 *    - 泥土地块受到踩踏挤压，触发震动碎裂并向下沉坠落入虚空销毁；
 *    - 塌陷完成后，从 HexGridManager 中注销该底座 (unregisterSlot)，原地形成真实的“镂空无底座深坑”；
 * 3. 后续方块（坠坑消除）：
 *    - 后续方块朝该空坑方向翻滚时，由于该槽位已无底座，直接从该空洞垂直掉落下坠消除。
 */
@ccclass('BrokenBlock')
export class BrokenBlock extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '易碎泥土地块模型主体节点 (hx_1 / _801_pre)', group: { name: '节点引用', id: '0' } })
    public brokenBodyNode: Node = null!;

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    /** 是否已塌陷碎裂 */
    public isBroken: boolean = false;

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    private initNodeReferences() {
        if (!this.brokenBodyNode) {
            this.brokenBodyNode = this.node.getChildByPath('_801_pre/hx_1') ||
                this.node.getChildByName('hx_1') ||
                this.node.getChildByName('_801_pre') ||
                this.node;
        }
    }

    /**
     * 初始化易碎泥土地块
     * @param r 行号
     * @param c 列号
     */
    public initBrokenBlock(r: number, c: number) {
        this.r = r;
        this.c = c;
        this.isBroken = false;
        this.initNodeReferences();
    }

    // ======================================== 崩塌碎裂动效与网格注销 ========================================
    /**
     * 播放受压震颤并向下沉没坠入虚空的崩塌动画
     * @param onComplete 崩塌彻底完成后的回调
     */
    public playCollapseAnim(onComplete?: () => void) {
        if (this.isBroken) return;
        this.isBroken = true;


        if (!this.brokenBodyNode) {
            this.finalizeCollapse(onComplete);
            return;
        }

        const startPos = this.brokenBodyNode.position.clone();
        const fallTargetPos = v3(startPos.x, startPos.y - 2.5, startPos.z);
        const collapseScale = v3(0.6, 0.6, 0.6);

        // 播放预留泥土碎裂粒子飞溅
        this.playCollapseParticles(this.node.worldPosition);

        // 1. 微受压震颤 (0.05s) -> 2. 加速向下坠入虚空并缩小 (0.22s) -> 3. 彻底注销与销毁
        tween(this.brokenBodyNode)
            .to(0.05, { scale: v3(1.06, 0.88, 1.06) }, { easing: 'quadOut' })
            .to(0.22, { position: fallTargetPos, scale: collapseScale }, { easing: 'quadIn' })
            .call(() => {
                this.finalizeCollapse(onComplete);
            })
            .start();
    }

    /**
     * 彻底完成网格注销与节点销毁
     */
    private finalizeCollapse(onComplete?: () => void) {
        if (HexGridManager.instance) {
            HexGridManager.instance.unregisterSlot(this.r, this.c);
            HexGridManager.instance.unregisterBrokenBlock(this.r, this.c);
        }

        if (this.node && this.node.isValid) {
            this.node.destroy();
        }

        if (onComplete) {
            onComplete();
        }
    }

    /**
     * 播放泥土崩塌碎裂粒子效果 (预留接口，供后续粒子系统统一接入)
     * @param worldPos 崩塌发生的世界空间坐标
     */
    public playCollapseParticles(worldPos: Vec3) {
    }
}
