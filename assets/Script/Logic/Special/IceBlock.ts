import { _decorator, Component, Node, Vec3, tween, Tween, v3, Texture2D, MeshRenderer, Material, instantiate, resources } from 'cc';
import { HexBlock, BlockState } from '../HexBlock';
import { BoomParticle } from '../BoomParticle';
import { Audio, AudioId } from '../../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

/**
 * 0~9 数字图片的真实宽高比 (像素宽 / 像素高 80px)
 * 0: 49/80, 1: 37/80, 2: 47/80, 3: 47/80, 4: 56/80
 * 5: 45/80, 6: 50/80, 7: 47/80, 8: 49/80, 9: 49/80
 */
export const DIGIT_ASPECT_RATIOS: number[] = [
    49 / 80, // 0: 0.6125
    37 / 80, // 1: 0.4625 (最纤细，需重点保持瘦长比例)
    47 / 80, // 2: 0.5875
    47 / 80, // 3: 0.5875
    56 / 80, // 4: 0.7000
    45 / 80, // 5: 0.5625
    50 / 80, // 6: 0.6250
    47 / 80, // 7: 0.5875
    49 / 80, // 8: 0.6125
    49 / 80  // 9: 0.6125
];

// ======================================== 计数冰封方块控制器 ========================================
/**
 * 计数冰封方块组件 (IceBlock / Special_3_202)
 * 挂载在 Special_3_202.prefab 预制体上
 *
 * 核心特性：
 * 1. 【自适应防拉伸 3D 数字】：根据 0~9 各图片原始像素宽高比自动锁定比例，杜绝压扁或拉宽变形！
 * 2. 【智能单双位数排版】：1~9 单数字自动绝对居中；10~99 两位数自动左右对称排版；
 * 3. 【真实步数倒数】：无缝对接关卡 CSV 设定的消除目标次数；
 * 4. 【生动物理动效】：每次消除受击时数字与冰块同步受力弹性震颤；归零时一同爆碎解封！
 */
@ccclass('IceBlock')
export class IceBlock extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '冰晶外壳主体节点 (hx_1)', group: { name: '节点引用', id: '0' } })
    public iceShellNode: Node = null!;

    @property({ type: Node, tooltip: '3D数字面片根节点 (text)', group: { name: '节点引用', id: '0' } })
    public textNode: Node = null!;

    @property({ type: [Texture2D], tooltip: '0~9 数字贴图列表 (若留空则自动从 resources 加载)', group: { name: '数字贴图', id: '1' } })
    public digitTextures: Texture2D[] = [];

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    /** 剩余需要消除的方块组数计数 */
    public remainingCount: number = 1;

    /** 底层被封印的真实彩色方块实例列表 (整柱) */
    private _underlyingBlocks: HexBlock[] = [];

    /** 是否已经碎冰解冻 */
    public isUnlocked: boolean = false;

    /** 网格空间与逻辑管理器引用 */
    public gridManager: any = null;

    // ======================================== 3D 数字显示系统 ========================================
    /** 全局静态贴图缓存: Map<digit, Texture2D> */
    private static _cachedTextures: Map<number, Texture2D> = new Map();
    private static _isPreloading: boolean = false;

    /** 数字显示面片节点集合 [十位节点, 个位节点] 或 [单数字节点] */
    private _digitNodes: Node[] = [];

    /** 数字基准高度缩放比例 (基于 Plane 10x10 网格，0.024 对应 0.24m 高度，精致适中居中) */
    private readonly _baseScaleHeight: number = 0.024;
    /** 贴片顶面局部高度 (微高于冰块顶面) */
    private readonly _digitPosY: number = 0.373;

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
        this.preloadDigitTextures();
    }

    private initNodeReferences() {
        if (!this.iceShellNode) {
            this.iceShellNode = this.node.getChildByPath('_202_pre/hx_1') ||
                this.node.getChildByName('hx_1') ||
                this.node.getChildByName('_201_pre') ||
                this.node;
        }

        if (!this.textNode) {
            this.textNode = this.node.getChildByPath('_201_pre/text') ||
                this.node.getChildByPath('_202_pre/text') ||
                this.node.getChildByName('text')!;
        }

        this.setupDigitNodes();
    }

    /**
     * 预加载并缓存 0~9 贴图
     */
    private preloadDigitTextures() {
        // 1. 若 Inspector 已经拖拽配置了贴图，优先填充到缓存
        if (this.digitTextures && this.digitTextures.length > 0) {
            this.digitTextures.forEach((tex, idx) => {
                if (tex) IceBlock._cachedTextures.set(idx, tex);
            });
        }

        // 2. 检查缓存是否已完整包含 0~9
        let hasAll = true;
        for (let i = 0; i <= 9; i++) {
            if (!IceBlock._cachedTextures.has(i)) {
                hasAll = false;
                break;
            }
        }
        if (hasAll || IceBlock._isPreloading) return;

        IceBlock._isPreloading = true;
        // 依次尝试从 resources/Game/Texture/Text 与 resources/Texture/Text 加载
        resources.loadDir('Main/Game/Texture/Text', Texture2D, (err, assets) => {
            IceBlock._isPreloading = false;
            if (!err && assets && assets.length > 0) {
                assets.forEach(asset => {
                    const digit = parseInt(asset.name, 10);
                    if (!isNaN(digit)) {
                        IceBlock._cachedTextures.set(digit, asset);
                    }
                });
                this.updateNumberDisplay();
            } else {
                // 备用路径尝试
                resources.loadDir('Texture/Text', Texture2D, (err2, assets2) => {
                    if (!err2 && assets2 && assets2.length > 0) {
                        assets2.forEach(asset => {
                            const digit = parseInt(asset.name, 10);
                            if (!isNaN(digit)) {
                                IceBlock._cachedTextures.set(digit, asset);
                            }
                        });
                        this.updateNumberDisplay();
                    }
                });
            }
        });
    }

    /**
     * 初始化数字节点双位插槽结构
     */
    private setupDigitNodes() {
        if (!this.textNode || this._digitNodes.length > 0) return;

        // 第一个节点（作为单数字节点或个位节点）
        this._digitNodes.push(this.textNode);

        // 克隆生成第二个节点（作为十位节点）
        const parentNode = this.textNode.parent || this.node;
        const secondNode = instantiate(this.textNode);
        secondNode.name = 'text_tens';
        secondNode.active = false;
        parentNode.addChild(secondNode);
        this._digitNodes.push(secondNode);
    }

    /**
     * 初始化冰封方块数据
     * @param r 行号
     * @param c 列号
     * @param count 初始解冻所需消除组数 (如 16)
     * @param underlyingBlocks 被封印的底层方块
     * @param gridManager 网格管理器
     */
    public initIceBlock(r: number, c: number, count: number, underlyingBlocks: HexBlock[] = [], gridManager?: any) {
        this.r = r;
        this.c = c;
        this.remainingCount = Math.max(1, count);
        this._underlyingBlocks = underlyingBlocks;
        this.gridManager = gridManager;
        this.isUnlocked = false;

        this.initNodeReferences();

        // 封印底层方块：隐藏顶层箭头，状态设为锁定 (ANIMATING 避免被拾取点击)
        this._underlyingBlocks.forEach(b => {
            b.setArrowState(false);
            b.state = BlockState.ANIMATING;
        });

        // 显式在网格中注册为绝对不可穿透障碍物
        if (this.gridManager) {
            this.gridManager.registerObstacle(this.r, this.c);
        }

        // 刷新显示当前倒数数字
        this.updateNumberDisplay();

    }

    // ======================================== 3D 数字精准自适应渲染 ========================================
    /**
     * 获取指定数字图片的实际宽高比 (宽 / 高)
     */
    private getDigitRatio(digit: number): number {
        const tex = IceBlock._cachedTextures.get(digit);
        if (tex && tex.height > 0) {
            return tex.width / tex.height;
        }
        if (digit >= 0 && digit <= 9) {
            return DIGIT_ASPECT_RATIOS[digit];
        }
        return 0.6;
    }

    /**
     * 刷新 3D 数字显示与排版（支持 1~99 动态自适应防拉伸）
     */
    public updateNumberDisplay() {
        if (this.isUnlocked || this.remainingCount <= 0) {
            this._digitNodes.forEach(node => { if (node) node.active = false; });
            return;
        }

        this.setupDigitNodes();
        if (this._digitNodes.length < 2) return;

        const count = this.remainingCount;

        if (count < 10) {
            // ==================== 1. 单数字模式 (1 ~ 9) ====================
            const unitNode = this._digitNodes[0];
            const tensNode = this._digitNodes[1];

            tensNode.active = false;
            unitNode.active = true;

            const ratio = this.getDigitRatio(count);
            // 锁定 Z 为基准高度，X 根据图片原始比例智能计算，杜绝任何水平变形拉扯
            const scaleX = this._baseScaleHeight * ratio;
            const scaleZ = this._baseScaleHeight;

            unitNode.setScale(v3(scaleX, 1.0, scaleZ));
            unitNode.setPosition(v3(0, this._digitPosY, 0));
            unitNode.setRotationFromEuler(0, 0, 0);

            this.applyDigitTexture(unitNode, count);
        } else {
            // ==================== 2. 双数字模式 (10 ~ 99) ====================
            const unitNode = this._digitNodes[0];
            const tensNode = this._digitNodes[1];

            unitNode.active = true;
            tensNode.active = true;

            const tensDigit = Math.floor(count / 10) % 10;
            const unitDigit = count % 10;

            const ratioTens = this.getDigitRatio(tensDigit);
            const ratioUnit = this.getDigitRatio(unitDigit);

            // 双数字时整体高度微调至 0.020，紧凑精致，并在六边形顶面留出宽阔的冰晶呼吸边缘
            const compactHeight = 0.020;
            const scaleXTens = compactHeight * ratioTens;
            const scaleXUnit = compactHeight * ratioUnit;

            tensNode.setScale(v3(scaleXTens, 1.0, compactHeight));
            unitNode.setScale(v3(scaleXUnit, 1.0, compactHeight));
            tensNode.setRotationFromEuler(0, 0, 0);
            unitNode.setRotationFromEuler(0, 0, 0);

            // 计算 3D 空间实际宽度 (Plane 原始网格为 10x10)
            const widthTens3D = scaleXTens * 10;
            const widthUnit3D = scaleXUnit * 10;
            const gap3D = 0.015; // 紧凑自然的数字间距

            const totalWidth = widthTens3D + gap3D + widthUnit3D;
            // 对称计算居中偏移
            const posX_Tens = -totalWidth * 0.5 + widthTens3D * 0.5;
            const posX_Unit = totalWidth * 0.5 - widthUnit3D * 0.5;

            tensNode.setPosition(v3(posX_Tens, this._digitPosY, 0));
            unitNode.setPosition(v3(posX_Unit, this._digitPosY, 0));

            this.applyDigitTexture(tensNode, tensDigit);
            this.applyDigitTexture(unitNode, unitDigit);
        }
    }

    /**
     * 将指定数字贴图赋予目标节点的 MeshRenderer
     */
    private applyDigitTexture(node: Node, digit: number) {
        const mr = node.getComponent(MeshRenderer);
        if (!mr) return;

        const tex = IceBlock._cachedTextures.get(digit) ||
            (this.digitTextures && this.digitTextures[digit]);

        if (tex) {
            const mat = mr.getMaterialInstance(0);
            if (mat) {
                mat.setProperty('mainTexture', tex);
            }
        }
    }

    // ======================================== 核心计数递减与解冻逻辑 ========================================
    /**
     * 响应场上任意方块消除事件：计数 -1
     * @param onUnlockComplete 解冻完成回调
     */
    public onAnyBlockCleared(onUnlockComplete?: () => void) {
        if (this.isUnlocked || this.remainingCount <= 0) return;

        this.remainingCount--;

        // 刷新 3D 数字显示 (赋予标准的居中与无拉伸比例)
        this.updateNumberDisplay();

        // 仅 3D 数字播放两段式弹跳跳字动效 (清晰可见的向上轻跃放大 + 弹簧回弹落地，总长 0.28s)
        this._digitNodes.forEach(node => {
            if (node && node.active) {
                Tween.stopAllByTarget(node);
                const targetScale = node.scale.clone();
                const baseY = this._digitPosY;
                const hopY = baseY + 0.035;

                // 确保从基准尺寸起步
                node.setScale(targetScale);
                node.setPosition(v3(node.position.x, baseY, node.position.z));

                tween(node)
                    // 阶段 1 (0.10s): 向上灵动轻跃并放大 1.45 倍，肉眼清晰可见
                    .to(0.10, {
                        scale: v3(targetScale.x * 1.45, 1.0, targetScale.z * 1.45),
                        position: v3(node.position.x, hopY, node.position.z)
                    }, { easing: 'quadOut' })
                    // 阶段 2 (0.18s): 弹润落回冰面原位并带有弹性回弹
                    .to(0.18, {
                        scale: targetScale,
                        position: v3(node.position.x, baseY, node.position.z)
                    }, { easing: 'backOut' })
                    .start();
            }
        });

        if (this.remainingCount <= 0) {
            // 计数归零 -> 触发碎冰解冻
            this.breakIce(onUnlockComplete);
        }
    }

    /**
     * 碎冰破封动效与底层方块唤醒
     */
    public breakIce(onComplete?: () => void) {
        if (this.isUnlocked) return;
        this.isUnlocked = true;
        Audio.play(AudioId.iceClear);
        const particleParent = this.gridManager?.node || this.node.parent;
        if (particleParent) {
            const particlePosition = this.node.worldPosition.clone();
            BoomParticle.play('ice', particleParent, particlePosition);
            BoomParticle.play('smoke', particleParent, particlePosition, 2.0);
        }


        // 从网格中注销不可穿透障碍物标记
        if (this.gridManager) {
            this.gridManager.unregisterObstacle(this.r, this.c);
        }

        // 数字随冰晶一起向上微弹爆开后迅速缩小淡出
        this._digitNodes.forEach(node => {
            if (node && node.active) {
                const curPos = node.position.clone();
                const curScale = node.scale.clone();
                tween(node)
                    .to(0.08, { scale: v3(curScale.x * 1.25, curScale.y, curScale.z * 1.25), position: v3(curPos.x, curPos.y + 0.08, curPos.z) }, { easing: 'backOut' })
                    .to(0.16, { scale: Vec3.ZERO, position: v3(curPos.x, curPos.y - 0.05, curPos.z) }, { easing: 'quadIn' })
                    .start();
            }
        });

        // 冰壳爆裂动效：向上微弹爆开 + 快速放大并渐隐缩放销毁
        if (this.iceShellNode) {
            const shellPos = this.iceShellNode.position;
            tween(this.iceShellNode)
                .to(0.08, { scale: v3(1.25, 1.25, 1.25), position: v3(shellPos.x, shellPos.y + 0.08, shellPos.z) }, { easing: 'backOut' })
                .to(0.16, { scale: v3(0.0, 0.0, 0.0), position: v3(shellPos.x, shellPos.y - 0.05, shellPos.z) }, { easing: 'quadIn' })
                .call(() => {
                    // 解封底层方块：重新唤醒顶层方块箭头，状态恢复为可点击待命 IDLE
                    this._underlyingBlocks.forEach((b) => {
                        if (b && b.node && b.node.isValid && b.state !== BlockState.DESTROYED) {
                            b.state = BlockState.IDLE;
                            b.setArrowState(b.isTop);
                        }
                    });

                    // 销毁冰块外壳节点
                    if (this.node && this.node.isValid) {
                        this.node.destroy();
                    }

                    if (onComplete) onComplete();
                })
                .start();
        } else {
            this._underlyingBlocks.forEach(b => {
                if (b && b.node && b.node.isValid && b.state !== BlockState.DESTROYED) {
                    b.state = BlockState.IDLE;
                    b.setArrowState(b.isTop);
                }
            });
            if (this.node && this.node.isValid) {
                this.node.destroy();
            }
            if (onComplete) onComplete();
        }
    }
}
