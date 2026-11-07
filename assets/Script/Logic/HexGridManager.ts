import { _decorator, Component } from 'cc';
import { HexBlock, BlockState } from './HexBlock';
import { HexCoord, HexMath } from './HexMath';
import { StopBlock } from './Special/StopBlock';
import { TntBlock } from './Special/TntBlock';
import { TurnBlock } from './Special/TurnBlock';
import { GearBlock } from './Special/GearBlock';
import { BrokenBlock } from './Special/BrokenBlock';
import { Telescopic } from './Special/Telescopic';
import { MysteryBlock } from './Special/MysteryBlock';
import { MultiLayerBlock } from './Special/MultiLayerBlock';
import { GoPauseBlock } from './Special/GoPauseBlock';
import { RocketBombBlock } from './Special/RocketBombBlock';

const { ccclass } = _decorator;

/**
 * 单段翻滚路径结构 (用于直行或经由转向板变向)
 */
export interface PathSegment {
    /** 本段起始网格坐标 (r, c) */
    startCoord: HexCoord;
    /** 本段翻滚推进方向 (1~6) */
    dir: number;
    /** 本段连续翻滚格数 */
    steps: number;
    /** 本段终点处触发的导向转向板组件 (若该段终点为转向板) */
    redirectPad?: TurnBlock;
}

/**
 * 深度路径分析结果接口
 */
export interface PathAnalysisResult {
    /** 是否可畅通出界飞出 */
    canFly: boolean;
    /** 飞出所需连续步数 */
    exitSteps: number;
    /** 受阻前可推进的步数 (0 表示紧邻阻挡) */
    blockedSteps: number;
    /** 是否被前方的 P 停车位拦截入库 */
    isInterceptedByStopSlot?: boolean;
    /** 拦截目标停车位组件实例 */
    targetStopSlot?: StopBlock;
    /** 翻滚到达停车位所需步数 */
    stepsToStopSlot?: number;
    /** 目标停车位网格坐标 */
    targetStopCoord?: HexCoord;
    /** 路径前方遭遇的 TNT 炸药桶组件实例 */
    hitTnt?: TntBlock;
    /** 撞击 TNT 所需步数 */
    stepsToTnt?: number;
    /** 目标 TNT 网格坐标 */
    hitTntCoord?: HexCoord;
    /** 路径前方遭遇的 1501~1506 火箭炸药块组件实例 */
    hitRocketBomb?: RocketBombBlock;
    /** 撞击火箭炸药块所需步数 */
    stepsToRocketBomb?: number;
    /** 目标火箭炸药块网格坐标 */
    hitRocketBombCoord?: HexCoord;
    /** 路径前方遭遇的 701 旋转锯齿粉碎机组件实例 */
    hitSaw?: GearBlock;
    /** 到达锯齿轮所需步数 */
    stepsToSaw?: number;
    /** 目标锯齿轮网格坐标 */
    hitSawCoord?: HexCoord;
    /** 路径行经并将触发崩塌的 801 易碎泥土地块列表及行进步数 */
    brokenBlocksToCollapse?: { block: BrokenBlock; steps: number }[];
    /** 分段翻滚轨迹 (如果路径中途经过了一个或多个导向转向板) */
    segments?: PathSegment[];
}

// ======================================== 六边形棋盘网格与槽位管理器 ========================================
/**
 * 六边形棋盘网格管理器
 * 负责维护所有底座槽位集合、垂直堆叠栈、P停车位拦截点、TNT撞击点、701锯齿粉碎点、射线阻挡深度分析、以及多层方块出栈操作
 */
@ccclass('HexGridManager')
export class HexGridManager extends Component {
    // ======================================== 单例模式 ========================================
    private static _instance: HexGridManager | null = null;
    public static get instance(): HexGridManager | null {
        return this._instance;
    }

    // ======================================== 内部数据结构 ========================================
    /** 存储每个槽位堆叠方块栈的 Map: key = "r_c", value = [layer0, layer1, layer2] (按 layer 升序) */
    private _stackMap: Map<string, HexBlock[]> = new Map();
    /** 记录关卡中所有有效底座槽位坐标的 Set: key = "r_c" (用于出界判定) */
    private _slotSet: Set<string> = new Set();
    /** 记录关卡中所有特殊固定障碍物/旋转机关中心坐标的 Set: key = "r_c" (阻挡普通方块通行) */
    private _obstacleSet: Set<string> = new Set();
    /** 记录关卡中所有 P 停车位机关实例的 Map: key = "r_c", value = StopBlock */
    private _stopSlotsMap: Map<string, StopBlock> = new Map();
    /** 记录关卡中所有 TNT 炸药桶实例的 Map: key = "r_c", value = TntBlock */
    private _tntSlotsMap: Map<string, TntBlock> = new Map();
    /** 记录关卡中所有导向转向板实例的 Map: key = "r_c", value = TurnBlock */
    private _redirectPadsMap: Map<string, TurnBlock> = new Map();
    /** 记录关卡中所有 701 旋转锯齿粉碎机实例的 Map: key = "r_c", value = GearBlock */
    private _sawSlotsMap: Map<string, GearBlock> = new Map();
    /** 记录关卡中所有 801 易碎崩塌地块实例的 Map: key = "r_c", value = BrokenBlock */
    private _brokenBlocksMap: Map<string, BrokenBlock> = new Map();
    /** 记录关卡中所有 901 升降伸缩柱实例的 Map: key = "r_c", value = Telescopic */
    private _telescopicMap: Map<string, Telescopic> = new Map();
    /** 记录关卡中所有 1001 神秘盲盒实例的 Map: key = "r_c", value = MysteryBlock */
    private _mysteryBlocksMap: Map<string, MysteryBlock> = new Map();
    /** 记录关卡中所有 1101 多向层叠方块实例的 Map: key = "r_c", value = MultiLayerBlock */
    private _multiLayerBlocksMap: Map<string, MultiLayerBlock> = new Map();
    /** 记录关卡中所有 1201~1206 GoPauseBlock 实例的 Map: key = "r_c", value = GoPauseBlock */
    private _goPauseBlocksMap: Map<string, GoPauseBlock> = new Map();
    /** 记录关卡中所有 1501~1506 火箭炸药方块实例的 Map: key = "r_c", value = RocketBombBlock */
    private _rocketBombsMap: Map<string, RocketBombBlock> = new Map();

    // ======================================== 生命周期 ========================================
    onLoad() {
        HexGridManager._instance = this;
    }

    onDestroy() {
        if (HexGridManager._instance === this) {
            HexGridManager._instance = null;
        }
    }

    // ======================================== 网格与底座数据管理 ========================================
    /**
     * 清空当前所有槽位堆叠数据、停车位记录、锯齿轮记录与底座坐标记录
     */
    public clearGrid() {
        this._stackMap.clear();
        this._slotSet.clear();
        this._obstacleSet.clear();
        this._stopSlotsMap.clear();
        this._tntSlotsMap.clear();
        this._redirectPadsMap.clear();
        this._sawSlotsMap.clear();
        this._brokenBlocksMap.clear();
        this._telescopicMap.clear();
        this._mysteryBlocksMap.clear();
        this._multiLayerBlocksMap.clear();
        this._goPauseBlocksMap.clear();
        this._rocketBombsMap.clear();
    }

    /**
     * 注册有效底座槽位坐标
     * @param r 行号
     * @param c 列号
     */
    public registerSlot(r: number, c: number) {
        this._slotSet.add(this.getSlotKey(r, c));
    }

    /**
     * 注销/移除指定底座槽位 (电钻拆除底座，打通出界缺口)
     * @param r 行号
     * @param c 列号
     */
    public unregisterSlot(r: number, c: number) {
        const key = this.getSlotKey(r, c);
        this._slotSet.delete(key);
        this._stackMap.delete(key);
        this._obstacleSet.delete(key);
    }

    /**
     * 注册特殊固定障碍物 (如旋转转盘等不可穿行机关)
     * @param r 行号
     * @param c 列号
     */
    public registerObstacle(r: number, c: number) {
        this._obstacleSet.add(this.getSlotKey(r, c));
    }

    /**
     * 注销特殊固定障碍物
     * @param r 行号
     * @param c 列号
     */
    public unregisterObstacle(r: number, c: number) {
        this._obstacleSet.delete(this.getSlotKey(r, c));
    }

    /**
     * 判断指定坐标是否存在特殊障碍物/旋转转盘
     * @param r 行号
     * @param c 列号
     */
    public hasObstacle(r: number, c: number): boolean {
        return this._obstacleSet.has(this.getSlotKey(r, c));
    }

    /**
     * 判断指定坐标是否存在有效底座
     * @param r 行号
     * @param c 列号
     */
    public hasSlot(r: number, c: number): boolean {
        return this._slotSet.has(this.getSlotKey(r, c));
    }

    /**
     * 判断指定坐标是否包含任何特殊机关、道具或特殊底座 (不可随意拆除或覆盖)
     * 涵盖：固定障碍物/转盘中心、TNT炸弹、导向转向板、旋转锯齿轮、易碎地块、升降伸缩柱、神秘盲盒、多层生成井、前进停止块、火箭炸药、P停车位
     * @param r 行号
     * @param c 列号
     */
    public isSpecialSlot(r: number, c: number): boolean {
        const key = this.getSlotKey(r, c);
        return this._obstacleSet.has(key) ||
            this._tntSlotsMap.has(key) ||
            this._redirectPadsMap.has(key) ||
            this._sawSlotsMap.has(key) ||
            this._brokenBlocksMap.has(key) ||
            this._telescopicMap.has(key) ||
            this._mysteryBlocksMap.has(key) ||
            this._multiLayerBlocksMap.has(key) ||
            this._goPauseBlocksMap.has(key) ||
            this._rocketBombsMap.has(key) ||
            this._stopSlotsMap.has(key);
    }

    /**
     * 判断指定坐标是否为纯净的普通空底座 (有有效底座、无彩色方块、无任何特殊机关或特殊道具底座)
     * 专供电钻拆除与局内 TNT 道具放置使用
     * @param r 行号
     * @param c 列号
     */
    public isPureEmptySlot(r: number, c: number): boolean {
        if (!this.hasSlot(r, c)) return false;
        if (this.isSpecialSlot(r, c)) return false;
        const blocks = this.getSlotBlocks(r, c);
        return blocks.length === 0;
    }

    // ======================================== TNT 炸药桶登记管理 ========================================
    /**
     * 注册 TNT 炸弹实例
     * @param r 行号
     * @param c 列号
     * @param tnt TntBlock 组件实例
     */
    public registerTnt(r: number, c: number, tnt: TntBlock) {
        this._tntSlotsMap.set(this.getSlotKey(r, c), tnt);
        this.registerObstacle(r, c);
    }

    /**
     * 注销 TNT 炸弹实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterTnt(r: number, c: number) {
        this._tntSlotsMap.delete(this.getSlotKey(r, c));
        this.unregisterObstacle(r, c);
    }

    /**
     * 获取指定坐标上的 TNT 炸弹实例
     * @param r 行号
     * @param c 列号
     */
    public getTnt(r: number, c: number): TntBlock | null {
        return this._tntSlotsMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 导向转向板登记管理 ========================================
    /**
     * 注册导向转向板实例
     * @param r 行号
     * @param c 列号
     * @param pad TurnBlock 组件实例
     */
    public registerRedirectPad(r: number, c: number, pad: TurnBlock) {
        this._redirectPadsMap.set(this.getSlotKey(r, c), pad);
        this.registerSlot(r, c);
    }

    /**
     * 注销导向转向板实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterRedirectPad(r: number, c: number) {
        this._redirectPadsMap.delete(this.getSlotKey(r, c));
    }

    /**
     * 获取指定坐标上的导向转向板实例
     * @param r 行号
     * @param c 列号
     */
    public getRedirectPad(r: number, c: number): TurnBlock | null {
        return this._redirectPadsMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 701 旋转锯齿粉碎机登记管理 ========================================
    /**
     * 注册 701 旋转锯齿粉碎机实例
     * @param r 行号
     * @param c 列号
     * @param saw GearBlock 组件实例
     */
    public registerSaw(r: number, c: number, saw: GearBlock) {
        this._sawSlotsMap.set(this.getSlotKey(r, c), saw);
        this.registerSlot(r, c);
    }

    /**
     * 注销 701 旋转锯齿粉碎机实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterSaw(r: number, c: number) {
        this._sawSlotsMap.delete(this.getSlotKey(r, c));
    }

    /**
     * 获取指定坐标上的 701 旋转锯齿粉碎机实例
     * @param r 行号
     * @param c 列号
     */
    public getSaw(r: number, c: number): GearBlock | null {
        return this._sawSlotsMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 801 易碎崩塌地块登记管理 ========================================
    /**
     * 注册 801 易碎崩塌地块实例
     * @param r 行号
     * @param c 列号
     * @param brokenBlock BrokenBlock 组件实例
     */
    public registerBrokenBlock(r: number, c: number, brokenBlock: BrokenBlock) {
        this._brokenBlocksMap.set(this.getSlotKey(r, c), brokenBlock);
        this.registerSlot(r, c);
    }

    /**
     * 注销 801 易碎崩塌地块实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterBrokenBlock(r: number, c: number) {
        this._brokenBlocksMap.delete(this.getSlotKey(r, c));
    }

    /**
     * 获取指定坐标上的 801 易碎崩塌地块实例
     * @param r 行号
     * @param c 列号
     */
    public getBrokenBlock(r: number, c: number): BrokenBlock | null {
        return this._brokenBlocksMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 901 升降伸缩柱登记管理 ========================================
    /**
     * 注册 901 升降伸缩柱实例
     * @param r 行号
     * @param c 列号
     * @param telescopic Telescopic 组件实例
     */
    public registerTelescopic(r: number, c: number, telescopic: Telescopic) {
        this._telescopicMap.set(this.getSlotKey(r, c), telescopic);
        this.registerSlot(r, c);
        if (telescopic.isExtended) {
            this.registerObstacle(r, c);
        } else {
            this.unregisterObstacle(r, c);
        }
    }

    /**
     * 注销 901 升降伸缩柱实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterTelescopic(r: number, c: number) {
        this._telescopicMap.delete(this.getSlotKey(r, c));
        this.unregisterObstacle(r, c);
    }

    /**
     * 获取指定坐标上的 901 升降伸缩柱实例
     * @param r 行号
     * @param c 列号
     */
    public getTelescopic(r: number, c: number): Telescopic | null {
        return this._telescopicMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 1001 神秘盲盒方块登记管理 ========================================
    /**
     * 注册 1001 神秘盲盒实例
     * @param r 行号
     * @param c 列号
     * @param mystery MysteryBlock 组件实例
     */
    public registerMysteryBlock(r: number, c: number, mystery: MysteryBlock) {
        this._mysteryBlocksMap.set(this.getSlotKey(r, c), mystery);
    }

    /**
     * 注销 1001 神秘盲盒实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterMysteryBlock(r: number, c: number) {
        this._mysteryBlocksMap.delete(this.getSlotKey(r, c));
    }

    /**
     * 获取指定坐标上的 1001 神秘盲盒实例
     * @param r 行号
     * @param c 列号
     */
    public getMysteryBlock(r: number, c: number): MysteryBlock | null {
        return this._mysteryBlocksMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 1101 多向层叠方块登记管理 ========================================
    /**
     * 注册 1101 多向层叠方块实例
     * @param r 行号
     * @param c 列号
     * @param multiLayer MultiLayerBlock 组件实例
     */
    public registerMultiLayerBlock(r: number, c: number, multiLayer: MultiLayerBlock) {
        this._multiLayerBlocksMap.set(this.getSlotKey(r, c), multiLayer);
    }

    /**
     * 注销 1101 多向层叠方块实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterMultiLayerBlock(r: number, c: number) {
        this._multiLayerBlocksMap.delete(this.getSlotKey(r, c));
    }

    /**
     * 获取指定坐标上的 1101 多向层叠方块实例
     * @param r 行号
     * @param c 列号
     */
    public getMultiLayerBlock(r: number, c: number): MultiLayerBlock | null {
        return this._multiLayerBlocksMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 1201~1206 GoPauseBlock 登记管理 ========================================
    /**
     * 注册 1201~1206 GoPauseBlock 实例
     * @param r 行号
     * @param c 列号
     * @param block GoPauseBlock 组件实例
     */
    public registerGoPauseBlock(r: number, c: number, block: GoPauseBlock) {
        this._goPauseBlocksMap.set(this.getSlotKey(r, c), block);
        this.registerObstacle(r, c);
    }

    /**
     * 注销 1201~1206 GoPauseBlock 实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterGoPauseBlock(r: number, c: number) {
        this._goPauseBlocksMap.delete(this.getSlotKey(r, c));
        this.unregisterObstacle(r, c);
    }

    /**
     * 获取指定坐标上的 1201~1206 GoPauseBlock 实例
     * @param r 行号
     * @param c 列号
     */
    public getGoPauseBlock(r: number, c: number): GoPauseBlock | null {
        return this._goPauseBlocksMap.get(this.getSlotKey(r, c)) || null;
    }

    // ======================================== 1501~1506 RocketBombBlock 登记管理 ========================================
    /**
     * 注册 1501~1506 火箭炸药方块实例
     * @param r 行号
     * @param c 列号
     * @param bomb RocketBombBlock 组件实例
     */
    public registerRocketBomb(r: number, c: number, bomb: RocketBombBlock) {
        this._rocketBombsMap.set(this.getSlotKey(r, c), bomb);
        this.registerObstacle(r, c);
    }

    /**
     * 注销 1501~1506 火箭炸药方块实例
     * @param r 行号
     * @param c 列号
     */
    public unregisterRocketBomb(r: number, c: number) {
        this._rocketBombsMap.delete(this.getSlotKey(r, c));
        this.unregisterObstacle(r, c);
    }

    /**
     * 获取指定坐标上的 1501~1506 火箭炸药方块实例
     * @param r 行号
     * @param c 列号
     */
    public getRocketBomb(r: number, c: number): RocketBombBlock | null {
        return this._rocketBombsMap.get(this.getSlotKey(r, c)) || null;
    }

    /**
     * 格式化槽位唯一键名: "r_c"
     * @param r 行号
     * @param c 列号
     */
    private getSlotKey(r: number, c: number): string {
        return `${r}_${c}`;
    }

    /**
     * 获取所有已注册的有效底座槽位坐标列表
     */
    public getAllRegisteredSlots(): { r: number; c: number }[] {
        const result: { r: number; c: number }[] = [];
        this._slotSet.forEach(key => {
            const parts = key.split('_');
            if (parts.length === 2) {
                result.push({ r: parseInt(parts[0], 10), c: parseInt(parts[1], 10) });
            }
        });
        return result;
    }

    /**
     * 注册方块到对应槽位的堆叠栈中 (按 layer 升序排列，保证栈顶为最高层)
     * @param block 六边形方块实例
     */
    public registerBlock(block: HexBlock) {
        const key = this.getSlotKey(block.r, block.c);
        let stack = this._stackMap.get(key);
        if (!stack) {
            stack = [];
            this._stackMap.set(key, stack);
        }
        stack.push(block);
        // 按层级升序排序，保证 stack[length-1] 永远为最顶层方块
        stack.sort((a, b) => a.layer - b.layer);
    }

    /**
     * 从网格中精确注销/移除指定方块实例 (例如旋转对调或特定销毁)
     * @param block 六边形方块实例
     */
    public removeBlock(block: HexBlock) {
        if (!block) return;
        const key = this.getSlotKey(block.r, block.c);
        const stack = this._stackMap.get(key);
        if (!stack) return;

        const idx = stack.indexOf(block);
        if (idx !== -1) {
            stack.splice(idx, 1);
        }
        if (stack.length === 0) {
            this._stackMap.delete(key);
        }
    }

    /**
     * 获取指定槽位当前的顶层存活方块
     * @param r 行号
     * @param c 列号
     */
    public getTopBlock(r: number, c: number): HexBlock | undefined {
        const key = this.getSlotKey(r, c);
        const stack = this._stackMap.get(key);
        if (!stack || stack.length === 0) return undefined;

        // 从栈顶向下寻找第一个未被消除且节点有效的方块
        for (let i = stack.length - 1; i >= 0; i--) {
            const b = stack[i];
            if (b && b.state !== BlockState.DESTROYED && b.node && b.node.isValid) {
                return b;
            }
        }
        return undefined;
    }

    /**
     * 获取指定槽位内的所有存活方块列表 (整柱垂直堆叠方块)
     * @param r 行号
     * @param c 列号
     */
    public getSlotBlocks(r: number, c: number): HexBlock[] {
        const key = this.getSlotKey(r, c);
        const stack = this._stackMap.get(key);
        if (!stack || stack.length === 0) return [];

        return stack.filter(b => b && b.state !== BlockState.DESTROYED && b.node && b.node.isValid);
    }

    /**
     * 弹出并移除指定槽位内的全部方块 (整柱 3 层方块原子级出栈)
     * @param r 行号
     * @param c 列号
     */
    public popAllBlocksInSlot(r: number, c: number): HexBlock[] {
        const key = this.getSlotKey(r, c);
        const stack = this._stackMap.get(key);
        if (!stack || stack.length === 0) return [];

        const blocks = [...stack];
        this._stackMap.delete(key);
        return blocks;
    }

    /**
     * 弹出并移除指定槽位的单层顶层方块，并自动揭开下一层箭头
     * @param r 行号
     * @param c 列号
     */
    public popTopBlock(r: number, c: number): HexBlock | undefined {
        const key = this.getSlotKey(r, c);
        const stack = this._stackMap.get(key);
        if (!stack || stack.length === 0) return undefined;

        const removedBlock = stack.pop();

        // 检查是否有下一层方块，若有则自动揭开并弹性显现指示箭头
        const newTop = this.getTopBlock(r, c);
        if (newTop) {
            newTop.revealAsTop();
        }

        return removedBlock;
    }

    // ======================================== P 停车位特殊机关管理 ========================================
    /**
     * 注册 P 停车位机关
     * @param r 行号
     * @param c 列号
     * @param stopSlot 停车位组件
     */
    public registerStopSlot(r: number, c: number, stopSlot: StopBlock) {
        this._stopSlotsMap.set(this.getSlotKey(r, c), stopSlot);
        this.registerSlot(r, c);
    }

    /**
     * 注销 P 停车位机关
     * @param r 行号
     * @param c 列号
     */
    public unregisterStopSlot(r: number, c: number) {
        this._stopSlotsMap.delete(this.getSlotKey(r, c));
    }

    /**
     * 获取指定坐标的 P 停车位机关
     * @param r 行号
     * @param c 列号
     */
    public getStopSlot(r: number, c: number): StopBlock | undefined {
        return this._stopSlotsMap.get(this.getSlotKey(r, c));
    }

    // ======================================== 路径阻挡深度分析与状态查询 ========================================
    /**
     * 深度路径分析：判断方块是能畅通出界、沿导向转向板接力变向、被 P 停车位拦截入库、还是在前方第 N 格遭遇障碍受阻
     * @param block 待检测方块
     * @param maxSearchSteps 最大网格步进搜索深度 (默认 30)
     */
    public checkPathInfo(block: HexBlock, maxSearchSteps: number = 30): PathAnalysisResult {
        if (!block || block.state !== BlockState.IDLE) {
            return { canFly: false, exitSteps: 0, blockedSteps: 0 };
        }

        let currR = block.r;
        let currC = block.c;
        let currDir = block.dir;

        const segments: PathSegment[] = [];
        const brokenBlocksToCollapse: { block: BrokenBlock; steps: number }[] = [];
        let currSegStart: HexCoord = { r: currR, c: currC };
        let currSegSteps = 0;
        let totalSteps = 0;

        // 辅助构建包含当前末段完整轨迹的 segments 数组
        const buildCurrentSegments = (extraSteps: number = 0): PathSegment[] | undefined => {
            const finalSteps = currSegSteps + extraSteps;
            if (segments.length === 0 && finalSteps <= 0) return undefined;
            const res = [...segments];
            if (finalSteps > 0) {
                res.push({
                    startCoord: currSegStart,
                    dir: currDir,
                    steps: finalSteps
                });
            }
            return res.length > 0 ? res : undefined;
        };

        for (let i = 0; i < maxSearchSteps; i++) {
            const nextCoord = HexMath.getNeighborCoord(currR, currC, currDir);

            // 1. 检查当前格是否有未消除的方块阻挡
            const obstacleTop = this.getTopBlock(nextCoord.r, nextCoord.c);
            if (obstacleTop && obstacleTop.state !== BlockState.DESTROYED && obstacleTop !== block) {
                // 路径遭遇方块阻挡
                return {
                    canFly: false,
                    exitSteps: 0,
                    blockedSteps: totalSteps,
                    segments: buildCurrentSegments(0)
                };
            }

            // 2. 检查当前格是否为未引爆的 TNT 炸弹 (TntBlock) -> 碰撞引爆！
            const tnt = this.getTnt(nextCoord.r, nextCoord.c);
            if (tnt && !tnt.isExploded) {
                return {
                    canFly: false,
                    exitSteps: 0,
                    blockedSteps: totalSteps,
                    hitTnt: tnt,
                    stepsToTnt: totalSteps + 1,
                    hitTntCoord: nextCoord,
                    segments: buildCurrentSegments(0)
                };
            }

            // 2.5 检查当前格是否为未发射的火箭炸药块 (RocketBombBlock) -> 碰撞传力激活发射！
            const rocketBomb = this.getRocketBomb(nextCoord.r, nextCoord.c);
            if (rocketBomb && !rocketBomb.isLaunched && !rocketBomb.isDestroyed) {
                return {
                    canFly: false,
                    exitSteps: 0,
                    blockedSteps: totalSteps,
                    hitRocketBomb: rocketBomb,
                    stepsToRocketBomb: totalSteps + 1,
                    hitRocketBombCoord: nextCoord,
                    segments: buildCurrentSegments(0)
                };
            }

            // 3. 检查当前格是否为 P 停车位 (StopBlock)
            const stopSlot = this.getStopSlot(nextCoord.r, nextCoord.c);
            if (stopSlot) {
                if (!stopSlot.isOccupied) {
                    // 关键特性：遇到空闲的 P 停车位 -> 拦截方块并引导入库停靠！
                    return {
                        canFly: false,
                        exitSteps: 0,
                        blockedSteps: 0,
                        isInterceptedByStopSlot: true,
                        targetStopSlot: stopSlot,
                        stepsToStopSlot: totalSteps + 1,
                        targetStopCoord: nextCoord,
                        brokenBlocksToCollapse: brokenBlocksToCollapse.length > 0 ? brokenBlocksToCollapse : undefined,
                        segments: buildCurrentSegments(1)
                    };
                } else {
                    return {
                        canFly: false,
                        exitSteps: 0,
                        blockedSteps: totalSteps,
                        segments: buildCurrentSegments(0)
                    };
                }
            }

            // 4. 检查当前格是否为 701 旋转锯齿粉碎机 (GearBlock) -> 翻滚切入并切碎消除！
            const saw = this.getSaw(nextCoord.r, nextCoord.c);
            if (saw) {
                segments.push({
                    startCoord: currSegStart,
                    dir: currDir,
                    steps: currSegSteps + 1
                });
                return {
                    canFly: false,
                    exitSteps: 0,
                    blockedSteps: totalSteps,
                    hitSaw: saw,
                    stepsToSaw: totalSteps + 1,
                    hitSawCoord: nextCoord,
                    segments: segments.length > 0 ? segments : undefined
                };
            }

            // 5. 检查当前格是否有特殊固定障碍物/旋转转盘阻挡
            if (this.hasObstacle(nextCoord.r, nextCoord.c)) {
                return {
                    canFly: false,
                    exitSteps: 0,
                    blockedSteps: totalSteps,
                    segments: buildCurrentSegments(0)
                };
            }

            // 6. 检查当前格是否为 801 易碎崩塌地块 (BrokenBlock) -> 记录待塌陷，继续通行
            const brokenBlock = this.getBrokenBlock(nextCoord.r, nextCoord.c);
            if (brokenBlock && !brokenBlock.isBroken) {
                brokenBlocksToCollapse.push({
                    block: brokenBlock,
                    steps: totalSteps + 1
                });
            }

            currSegSteps++;
            totalSteps++;

            // 7. 检查当前格是否为导向转向板 (TurnBlock / 601~606)
            const redirectPad = this.getRedirectPad(nextCoord.r, nextCoord.c);
            if (redirectPad) {
                // 关键特性：方块到达该转向板，记录当前段并在转向板处立即换向！
                segments.push({
                    startCoord: currSegStart,
                    dir: currDir,
                    steps: currSegSteps,
                    redirectPad: redirectPad
                });

                // 更新下一段起始位置与方向
                currR = nextCoord.r;
                currC = nextCoord.c;
                currDir = redirectPad.targetDir;
                currSegStart = { r: currR, c: currC };
                currSegSteps = 0;
                continue;
            }

            // 8. 检查当前格是否脱离底座边界或落入崩塌深坑 (出界消除)
            if (!this.hasSlot(nextCoord.r, nextCoord.c)) {
                segments.push({
                    startCoord: currSegStart,
                    dir: currDir,
                    steps: currSegSteps
                });
                return {
                    canFly: true,
                    exitSteps: totalSteps,
                    blockedSteps: 0,
                    brokenBlocksToCollapse: brokenBlocksToCollapse.length > 0 ? brokenBlocksToCollapse : undefined,
                    segments: segments
                };
            }

            // 正常向前推进一步
            currR = nextCoord.r;
            currC = nextCoord.c;
        }

        segments.push({
            startCoord: currSegStart,
            dir: currDir,
            steps: currSegSteps
        });
        return {
            canFly: true,
            exitSteps: totalSteps,
            blockedSteps: 0,
            brokenBlocksToCollapse: brokenBlocksToCollapse.length > 0 ? brokenBlocksToCollapse : undefined,
            segments: segments
        };
    }

    /**
     * 检测指定方块沿其指示方向是否畅通无阻 (前方路径无任何其他未消除方块阻挡)
     * @param block 待检测方块
     * @param maxSearchSteps 搜索深度
     */
    public checkCanFly(block: HexBlock, maxSearchSteps: number = 30): boolean {
        return this.checkPathInfo(block, maxSearchSteps).canFly;
    }

    /**
     * 获取棋盘上当前剩余未销毁的方块总数量 (用于关卡结算判定)
     */
    public getRemainingBlockCount(): number {
        let count = 0;
        this._stackMap.forEach(stack => {
            stack.forEach(block => {
                if (block && block.state !== BlockState.DESTROYED && block.node && block.node.isValid) {
                    count++;
                }
            });
        });

        // 加上多层生成井尚未冒出的未来批次方块数 (每批 3 个)
        this._multiLayerBlocksMap.forEach(multi => {
            if (multi && multi.isValid) {
                count += multi.getRemainingBatchesCount() * 3;
            }
        });

        // 加上棋盘上尚未消除的 GoPauseBlock 数量
        this._goPauseBlocksMap.forEach(gp => {
            if (gp && gp.isValid && !gp.isDestroyed) {
                count += 1;
            }
        });

        // 加上棋盘上尚未发射消除的火箭炸药方块数量
        this._rocketBombsMap.forEach(rb => {
            if (rb && rb.isValid && !rb.isDestroyed && !rb.isLaunched) {
                count += 1;
            }
        });

        return count;
    }

    /**
     * 获取当前所有槽位的顶层方块列表 (用于屏幕触控快速几何/平面拾取)
     */
    public getAllTopBlocks(): HexBlock[] {
        const list: HexBlock[] = [];
        this._stackMap.forEach(stack => {
            if (stack.length > 0) {
                const top = stack[stack.length - 1];
                if (top && top.state !== BlockState.DESTROYED && top.node && top.node.isValid) {
                    list.push(top);
                }
            }
        });
        return list;
    }
}
