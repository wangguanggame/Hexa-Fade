import { _decorator, Component, Node, Vec3, tween, v3 } from 'cc';
import { HexBlock, BlockState } from '../HexBlock';

const { ccclass, property } = _decorator;

// ======================================== 特殊元素 1001：神秘盲盒 / 问号方块控制器 ========================================
/**
 * 神秘盲盒 / 问号方块组件 (MysteryBlock / Special_10_1001)
 * 挂载在 Special_10_1001.prefab 预制体上
 * 对应美术资产: 10_MysteryBlock
 * 核心机制：
 * 1. 覆盖在底层的真实彩色方块上方，以灰色六边形外壳 (hx_1) 与 3D 浮动问号 (Mystery) 遮挡其原本的颜色与逃逸箭头；
 * 2. 初始时将底层方块箭头隐藏，避免提前剧透逃逸方向；
 * 3. 玩家点击该盲盒时，播放开箱动效：问号向上跳跃微弹并放大爆开消散，底层真实方块随即揭晓 (revealAsTop)，呈现真实的逃逸箭头；
 * 4. 揭晓后盲盒节点销毁，方块恢复为普通可操作的顶层活动方块。
 */
@ccclass('MysteryBlock')
export class MysteryBlock extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '盲盒主体节点 (_1001_pre)', group: { name: '节点引用', id: '0' } })
    public preNode: Node = null!;

    @property({ type: Node, tooltip: '3D 问号标识节点 (Mystery)', group: { name: '节点引用', id: '0' } })
    public mysteryNode: Node = null!;

    @property({ type: Node, tooltip: '六边形外壳底座节点 (hx_1)', group: { name: '节点引用', id: '0' } })
    public hexBodyNode: Node = null!;

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    /** 被覆盖的底层真实彩色方块 */
    public underlyingBlock: HexBlock | null = null;

    /** 是否已经揭晓开箱 */
    public isRevealed: boolean = false;

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    private initNodeReferences() {
        if (!this.preNode) {
            this.preNode = this.node.getChildByName('_1001_pre') || this.node;
        }
        if (!this.mysteryNode && this.preNode) {
            this.mysteryNode = this.preNode.getChildByName('Mystery')!;
        }
        if (!this.hexBodyNode && this.preNode) {
            this.hexBodyNode = this.preNode.getChildByName('hx_1')!;
        }
    }

    /**
     * 初始化神秘方块
     * @param r 行号
     * @param c 列号
     * @param underlyingBlock 被覆盖的真实方块
     */
    public initMysteryBlock(r: number, c: number, underlyingBlock?: HexBlock | null) {
        this.r = r;
        this.c = c;
        this.underlyingBlock = underlyingBlock || null;
        this.isRevealed = false;
        this.initNodeReferences();

        // 遮盖底层真实方块：隐藏顶层方块节点与箭头，避免底层颜色外露与悬空
        if (this.underlyingBlock) {
            this.underlyingBlock.setArrowState(false);
            this.underlyingBlock.state = BlockState.ANIMATING;
            this.underlyingBlock.node.active = false;
        }

    }

    /**
     * 玩家点击未解锁的盲盒时，播放轻微抖动反馈 (提示需要消除相邻方块解锁)
     */
    public shake() {
        if (this.isRevealed) return;
        const targetNode = this.preNode || this.node;
        if (!targetNode) return;
        const basePos = targetNode.getPosition();
        tween(targetNode)
            .by(0.04, { position: v3(0.05, 0, 0) })
            .by(0.08, { position: v3(-0.10, 0, 0) })
            .by(0.08, { position: v3(0.10, 0, 0) })
            .to(0.04, { position: basePos })
            .start();
    }

    // ======================================== 开箱揭晓交互 ========================================
    /**
     * 点击触发揭晓动效 (Unveil / Pop Open)
     * @param onComplete 揭晓完成后的回调
     */
    public reveal(onComplete?: () => void) {
        if (this.isRevealed) return;
        this.isRevealed = true;


        const revealTargetBlock = this.underlyingBlock;

        // 1. 问号主体向上弹起并缩放爆散消失
        if (this.mysteryNode) {
            const startPos = this.mysteryNode.getPosition();
            tween(this.mysteryNode)
                .to(0.12, { position: v3(startPos.x, startPos.y + 0.25, startPos.z), scale: v3(1.4, 1.4, 1.4) }, { easing: 'backOut' })
                .to(0.10, { scale: v3(0.01, 0.01, 0.01) }, { easing: 'quadIn' })
                .call(() => {
                    if (this.mysteryNode && this.mysteryNode.isValid) {
                        this.mysteryNode.active = false;
                    }
                })
                .start();
        }

        // 2. 六边形外壳平滑缩小并渐隐消失
        if (this.hexBodyNode) {
            tween(this.hexBodyNode)
                .to(0.18, { scale: v3(0.01, 0.01, 0.01) }, { easing: 'backIn' })
                .call(() => {
                    // 3. 展现底层方块并播放箭头弹出动效
                    if (revealTargetBlock && revealTargetBlock.isValid) {
                        revealTargetBlock.node.active = true;
                        revealTargetBlock.revealAsTop();
                        revealTargetBlock.state = BlockState.IDLE;
                    }
                    if (onComplete) onComplete();
                    if (this.node && this.node.isValid) {
                        this.node.destroy();
                    }
                })
                .start();
        } else {
            if (revealTargetBlock && revealTargetBlock.isValid) {
                revealTargetBlock.node.active = true;
                revealTargetBlock.revealAsTop();
                revealTargetBlock.state = BlockState.IDLE;
            }
            if (onComplete) onComplete();
            if (this.node && this.node.isValid) {
                this.node.destroy();
            }
        }
    }
}
