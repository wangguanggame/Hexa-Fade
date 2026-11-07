import { _decorator, Component, Node, Vec3, tween, v3 } from 'cc';
import { HexCoord } from '../HexMath';
import { HexBlock } from '../HexBlock';

const { ccclass, property } = _decorator;

// ======================================== P停车位/暂停拦截底座控制器 ========================================
/**
 * P 停车位 / 路线拦截槽位控制器 (StopBlock / Special_2_101)
 * 挂载在 Special_2_101.prefab 预制体上
 * 对应美术目录: 2_StopBlock
 * 负责：
 * - 维护本停车位网格坐标 (r, c) 与停靠占用状态
 * - 拦截行经此处的移动方块并完成入库注册
 * - 当停靠方块再次被消除飞出时，自动恢复空闲状态
 */
@ccclass('StopBlock')
export class StopBlock extends Component {
    // ======================================== 编辑器/属性配置 ========================================
    @property({ type: Node, tooltip: 'P 停车位标识主体节点 (含红色底座与 P 符号)', group: { name: '节点引用', id: '0' } })
    public slotBodyNode: Node = null!;

    // ======================================== 内部状态 ========================================
    /** 槽位行号 */
    public r: number = 0;
    /** 槽位列号 */
    public c: number = 0;

    /** 当前停靠在停车位上的方块列表 (多层) */
    private _parkedBlocks: any[] = [];

    /** 当前停车位是否已被方块占用 */
    public get isOccupied(): boolean {
        return this._parkedBlocks.length > 0;
    }

    /** 获取当前停靠的最顶层方块 */
    public get topParkedBlock(): any | null {
        if (this._parkedBlocks.length === 0) return null;
        return this._parkedBlocks[this._parkedBlocks.length - 1];
    }

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        if (!this.slotBodyNode) {
            this.slotBodyNode = this.node.getChildByPath('_101_pre/stop') ||
                this.node.getChildByName('_101_pre') ||
                this.node;
        }
    }

    /**
     * 初始化停车位网格坐标与状态
     * @param r 网格行号
     * @param c 网格列号
     */
    public initStopBlock(r: number, c: number) {
        this.r = r;
        this.c = c;
        this._parkedBlocks = [];

        if (!this.slotBodyNode) {
            this.slotBodyNode = this.node.getChildByPath('_101_pre/stop') ||
                this.node.getChildByName('_101_pre') ||
                this.node;
        }
    }

    /** 兼容旧接口命名 */
    public initStopSlot(r: number, c: number) {
        this.initStopBlock(r, c);
    }

    // ======================================== 方块停靠与释放 ========================================
    /**
     * 接收方块入库停靠
     * @param block 停靠的方块
     */
    public parkBlock(block: HexBlock | any) {
        if (this._parkedBlocks.indexOf(block) === -1) {
            this._parkedBlocks.push(block);
        }
        const bId = block && block.blockId !== undefined ? `#${block.blockId}` : 'GoPauseBlock';
    }

    /**
     * 释放/移出停靠方块 (方块二次点击飞出或消除时调用)
     * @param block 移出的方块
     */
    public releaseBlock(block: HexBlock | any) {
        const idx = this._parkedBlocks.indexOf(block);
        if (idx !== -1) {
            this._parkedBlocks.splice(idx, 1);
        }
        const bId = block && block.blockId !== undefined ? `#${block.blockId}` : 'GoPauseBlock';
    }
}
