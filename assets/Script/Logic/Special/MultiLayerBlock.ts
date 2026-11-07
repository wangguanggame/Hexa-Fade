import { _decorator, Component, Node, Vec3, tween, v3, Label, UITransform, Color, find, Camera, MeshRenderer, Material, Layers, instantiate } from 'cc';
import { HexBlock, BlockState } from '../HexBlock';
import { HexMath } from '../HexMath';
import { HexGridManager } from '../HexGridManager';
import { GameMain } from '../GameMain';

const { ccclass, property } = _decorator;

// ======================================== 1101 多向层叠计数生成井控制器 ========================================
/**
 * 1101 多向层叠生成井组件 (MultiLayerBlock / Block Dispenser / Special_11_1101)
 * 挂载在 Special_11_1101.prefab 预制体上
 *
 * 核心机制（完全还原实机 189.mp4）：
 * 1. 底座为专属带井口模型 Special_11_1101 (内嵌同心圆底盘 hx_1_1, hx_2_1)，独占槽位底座，不生成普通灰色 Floor；
 * 2. 对应关卡数据 1101_dir1^dir2^dir3...，每种方向均为标准 3 层同色方块 (stackLayersPerSlot = 3)；
 * 3. 场上每次只露出一批 3 层方块，顶层带深色指示箭头，由 Canvas 悬浮文字指示当前剩余批次数 (如 5 -> 4 -> 3 -> 2 -> 1)；
 * 4. 玩家点击发射时，当前批次整柱 3 个方块一起翻滚飞出；
 * 5. 在前批飞出的同时，下一批 3 个方块带有向上升起的弹簧动效，从井底冒出 (y - 0.22m -> y)，数字同步递减；
 * 6. 最后一批消除后，专属井口底座永久完好地保留在棋盘上！
 */
@ccclass('MultiLayerBlock')
export class MultiLayerBlock extends Component {
    @property({ type: Node, tooltip: '底座主体根节点 (_1101_pre)' })
    public preNode: Node | null = null;

    public r: number = 0;
    public c: number = 0;
    public directions: number[] = [];
    public currentBatchIndex: number = 0;

    private _darkArrowMaterial: Material | null = null;
    private _uiLabelNode: Node | null = null;
    private _lblCount: Label | null = null;
    private _gridManager: HexGridManager | null = null;

    onLoad() {
        this.initNodeReferences();
    }

    onDestroy() {
        if (this._uiLabelNode && this._uiLabelNode.isValid) {
            this._uiLabelNode.destroy();
            this._uiLabelNode = null;
        }
    }

    private initNodeReferences() {
        if (!this.preNode) {
            this.preNode = this.node.getChildByName('_1101_pre') || this.node;
        }

        if (this.preNode) {
            const dir3 = this.preNode.getChildByName('dir3');
            if (dir3) {
                const mr = dir3.getComponent(MeshRenderer);
                if (mr) {
                    this._darkArrowMaterial = mr.getMaterial(0);
                }
                dir3.active = false; // 隐藏预制体悬空的静态箭头
            }

            const jt = this.preNode.getChildByName('jt');
            if (jt) jt.active = false;

            const tx = this.preNode.getChildByName('tx');
            if (tx) tx.active = false;
        }
    }

    /**
     * 初始化多层生成井
     */
    public initMultiLayerBlock(
        r: number,
        c: number,
        directions: number[],
        gridMgr?: HexGridManager | null
    ) {
        this.r = r;
        this.c = c;
        this.directions = (directions && directions.length > 0) ? [...directions] : [1];
        this.currentBatchIndex = 0;
        this._gridManager = gridMgr || null;

        this.initNodeReferences();
        this.setupCanvasCountLabel();

        // 生成首批 3 层方块 (无延时静默生成)
        this.spawnBatch(0, false);

    }

    /**
     * 生成指定批次的 3 层方块
     * @param batchIndex 批次索引 (0 ~ directions.length - 1)
     * @param animate 是否播放从井底向上升起弹出的动画
     */
    public spawnBatch(batchIndex: number, animate: boolean = true) {
        if (batchIndex >= this.directions.length) {
            this.handleAllBatchesCleared();
            return;
        }

        // 关键防穿模：检查当前井口槽位是否有未清空离开的方块 (例如受阻退回或尚未完全腾出)
        if (this._gridManager) {
            const existingBlocks = this._gridManager.getSlotBlocks(this.r, this.c);
            if (existingBlocks && existingBlocks.some(b => b && b.isValid && b.state !== BlockState.DESTROYED)) {
                this.scheduleOnce(() => {
                    this.spawnBatch(batchIndex, animate);
                }, 0.2);
                return;
            }
        }

        const currentDir = this.directions[batchIndex];
        const remaining = this.directions.length - batchIndex;
        const gm = GameMain.instance;
        if (!gm) return;

        const mat = gm.getMaterialForDir(currentDir);
        const worldPos = HexMath.hexToWorld(this.r, this.c, 0, gm.hexRadius);
        const centerX = gm.currentCenterX;
        const centerZ = gm.currentCenterZ;
        const basePosY = gm.blockBasePosY;
        const layerHeight = gm.layerHeight;

        for (let layer = 0; layer < gm.stackLayersPerSlot; layer++) {
            const blockNode = instantiate(gm.hexBlockPrefab);
            blockNode.name = `Block_${this.r}_${this.c}_B${batchIndex}_L${layer}_Dir${currentDir}`;
            blockNode.setParent(gm.gridContainer);

            const targetY = basePosY + layer * layerHeight;
            const targetPos = new Vec3(worldPos.x - centerX, targetY, worldPos.z - centerZ);
            const isTopLayer = (layer === gm.stackLayersPerSlot - 1);

            // 无论是否播放升起动画，必须先设置标准目标位置以正确初始化基准坐标
            blockNode.setPosition(targetPos);
            blockNode.setScale(gm.blockScale);

            const hexBlock = blockNode.getComponent(HexBlock) || blockNode.addComponent(HexBlock);
            hexBlock.initBlock(
                gm.nextBlockId++,
                { r: this.r, c: this.c, layer },
                currentDir,
                isTopLayer,
                gm.hexRadius,
                mat
            );
            // 严格确保基准对待位置为 targetPos，避免受阻回弹或归位时被重置到下沉坐标
            hexBlock.setBasePosition(targetPos);
            hexBlock.setArrowState(isTopLayer);

            if (animate) {
                // 升起动画期间锁定状态，避免在冒出过程中被点击
                hexBlock.state = BlockState.ANIMATING;

                // 从井口底部向上升起冒出 (起始 Y 轴下沉 0.22m)
                const startPos = new Vec3(worldPos.x - centerX, targetY - 0.22, worldPos.z - centerZ);
                blockNode.setPosition(startPos);

                tween(blockNode)
                    .delay(layer * 0.03)
                    .to(0.24, { position: targetPos }, { easing: 'backOut' })
                    .call(() => {
                        blockNode.setPosition(targetPos);
                        hexBlock.syncBaseTransform();
                        hexBlock.state = BlockState.IDLE;
                    })
                    .start();
            } else {
                hexBlock.state = BlockState.IDLE;
            }

            // 顶层方块深色箭头
            if (isTopLayer && this._darkArrowMaterial && hexBlock.arrowNode) {
                const renderers = hexBlock.arrowNode.getComponentsInChildren(MeshRenderer);
                renderers.forEach(mr => mr.setMaterial(this._darkArrowMaterial!, 0));
            }

            if (this._gridManager) {
                this._gridManager.registerBlock(hexBlock);
            }
        }

        // 刷新 UI 倒计时数字
        if (this._lblCount) {
            this._lblCount.string = remaining.toString();
        }
    }

    /**
     * 当当前这批 3 个方块被点击并出栈飞走时调用
     */
    public onCurrentBatchLaunched() {
        this.currentBatchIndex++;
        const remaining = this.directions.length - this.currentBatchIndex;


        if (remaining > 0) {
            // 稍作延时 (0.12s)，在上一批方块刚翻滚出位的瞬间，新的一批 3 个方块从井底升起冒出！
            this.scheduleOnce(() => {
                this.spawnBatch(this.currentBatchIndex, true);
            }, 0.12);
        } else {
            this.handleAllBatchesCleared();
        }
    }

    /**
     * 获取尚未生成的未来批次数量
     */
    public getRemainingBatchesCount(): number {
        return Math.max(0, this.directions.length - 1 - this.currentBatchIndex);
    }

    /**
     * 在 UI Canvas 下创建实时跟踪 3D 方块的倒计时数字文本
     */
    private setupCanvasCountLabel() {
        const canvasNode = find('Canvas');
        if (!canvasNode) return;

        if (!this._uiLabelNode) {
            this._uiLabelNode = new Node(`MultiLayerCount_${this.r}_${this.c}`);
            this._uiLabelNode.setParent(canvasNode);
            this._uiLabelNode.layer = Layers.Enum.UI_2D;

            const uiTrans = this._uiLabelNode.addComponent(UITransform);
            uiTrans.setContentSize(50, 50);

            this._lblCount = this._uiLabelNode.addComponent(Label);
            this._lblCount.fontSize = 26;
            this._lblCount.lineHeight = 28;
            this._lblCount.isBold = true;
            this._lblCount.color = Color.WHITE;
            this._lblCount.horizontalAlign = Label.HorizontalAlign.CENTER;
            this._lblCount.verticalAlign = Label.VerticalAlign.CENTER;
        }
    }

    lateUpdate() {
        if (!this._uiLabelNode || !this._uiLabelNode.isValid) return;

        const topBlock = this._gridManager?.getTopBlock(this.r, this.c);
        if (!topBlock || !topBlock.node || !topBlock.node.isValid || topBlock.state !== BlockState.IDLE) {
            this._uiLabelNode.active = false;
            return;
        }

        const mainCam = GameMain.instance?.mainCamera || find('Main Camera')?.getComponent(Camera);
        if (!mainCam) return;

        this._uiLabelNode.active = true;

        const worldPos = topBlock.node.worldPosition;
        const targetWorldPos = v3(worldPos.x, worldPos.y + 0.05, worldPos.z);

        const screenPos = new Vec3();
        mainCam.worldToScreen(targetWorldPos, screenPos);

        const canvasNode = this._uiLabelNode.parent;
        if (canvasNode) {
            const canvasTransform = canvasNode.getComponent(UITransform);
            if (canvasTransform) {
                const uiPos = new Vec3();
                canvasTransform.convertToNodeSpaceAR(screenPos, uiPos);
                this._uiLabelNode.setPosition(uiPos.x, uiPos.y, 0);
            }
        }
    }

    private handleAllBatchesCleared() {

        if (this._gridManager) {
            this._gridManager.unregisterMultiLayerBlock(this.r, this.c);
        }

        if (this._uiLabelNode && this._uiLabelNode.isValid) {
            this._uiLabelNode.destroy();
            this._uiLabelNode = null;
        }

        // 隐藏箭头与临时节点，完好保留专属紫色同心圆底盘
        if (this.preNode) {
            const dir3 = this.preNode.getChildByName('dir3');
            if (dir3) dir3.active = false;
            const jt = this.preNode.getChildByName('jt');
            if (jt) jt.active = false;
            const tx = this.preNode.getChildByName('tx');
            if (tx) tx.active = false;

            tween(this.preNode)
                .to(0.08, { scale: v3(1.06, 1.0, 1.06) })
                .to(0.12, { scale: v3(1.0, 1.0, 1.0) }, { easing: 'quadOut' })
                .start();
        }
    }
}
