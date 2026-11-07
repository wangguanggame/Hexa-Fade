import { _decorator, Component, Node, Vec3, tween, v3 } from 'cc';
import { HexGridManager } from '../HexGridManager';
import { Audio, AudioId } from '../../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

// ======================================== 升降伸缩柱/路障机关控制器 ========================================
/**
 * 升降伸缩柱组件 (Telescopic / Special_9_901)
 * 挂载在 Special_9_901.prefab 预制体上
 * 对应美术目录: 9_Telescopic
 * 核心机制：
 * 1. 初始状态：升降柱处于升起状态 (isExtended = true)，作为地图不可穿透障碍物阻挡方块；
 * 2. 回合交替伸缩 (每步/每次消除切换)：
 *    - 消除一组方块后，升降柱平滑缩入地下 (isExtended = false)，解除障碍物状态，方块可直接通行经过；
 *    - 再次消除方块后，升降柱重新向上弹出伸出 (isExtended = true)，再次恢复为障碍物；
 * 3. 动态注册：
 *    - 升起时：在 HexGridManager 中 registerObstacle(r, c)；
 *    - 降下时：在 HexGridManager 中 unregisterObstacle(r, c)，保持槽位 base 底座正常通行。
 */
@ccclass('Telescopic')
export class Telescopic extends Component {
    // ======================================== 节点引用 ========================================
    @property({ type: Node, tooltip: '伸缩活动柱体节点 (dz3)' })
    public pillarNode: Node = null!;

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    /** 当前是否处于升起伸出状态 (true = 升起阻挡 scaleY:1.0, false = 缩回地面通行 scaleY:0.3) */
    public isExtended: boolean = true;

    /** 是否正在播放升降过渡动画 */
    public isAnimating: boolean = false;

    /** 柱身升起时的目标缩放 (scaleY = 1.0) */
    private _extendedScale: Vec3 = v3(1, 1.0, 1);
    /** 柱身缩回时的目标缩放 (scaleY = 0.3) */
    private _retractedScale: Vec3 = v3(1, 0.3, 1);

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    private initNodeReferences() {
        if (!this.pillarNode) {
            // 自动检索活动柱头节点 dz3
            this.pillarNode = this.node.getChildByPath('_901_pre/dz3') ||
                this.node.getChildByName('dz3') ||
                this.node.getChildByName('_901_pre') ||
                this.node;
        }

        if (this.pillarNode) {
            const curScale = this.pillarNode.scale;
            this._extendedScale = v3(curScale.x, 1.0, curScale.z);
            this._retractedScale = v3(curScale.x, 0.3, curScale.z);
        }
    }

    /**
     * 初始化升降伸缩柱
     * @param r 行号
     * @param c 列号
     * @param initialExtended 初始是否升起 (默认 true)
     */
    public initTelescopic(r: number, c: number, initialExtended: boolean = true) {
        this.r = r;
        this.c = c;
        this.initNodeReferences();
        this.setExtended(initialExtended, false);
    }

    // ======================================== 状态切换与升降动效 ========================================
    /**
     * 设置升降柱伸出/缩回状态
     * @param extended true 升起伸出 (scaleY=1.0), false 缩回地面 (scaleY=0.3)
     * @param animate 是否播放缓动动画
     * @param onComplete 动画完成回调
     */
    public setExtended(extended: boolean, animate: boolean = true, onComplete?: () => void) {
        this.isExtended = extended;

        // 同步网格管理器中的障碍物状态
        if (HexGridManager.instance) {
            if (this.isExtended) {
                HexGridManager.instance.registerObstacle(this.r, this.c);
            } else {
                HexGridManager.instance.unregisterObstacle(this.r, this.c);
            }
        }

        if (!this.pillarNode) {
            if (onComplete) onComplete();
            return;
        }

        const targetScale = this.isExtended ? this._extendedScale : this._retractedScale;

        if (!animate) {
            this.pillarNode.setScale(targetScale);
            if (onComplete) onComplete();
            return;
        }

        this.isAnimating = true;
        this.playToggleFeedback(this.isExtended);

        if (this.isExtended) {
            // 升起动画：scaleY 从 0.3 快速拔高至 1.0 并带有轻微弹性 (0.2s backOut)
            tween(this.pillarNode)
                .to(0.2, { scale: targetScale }, { easing: 'backOut' })
                .call(() => {
                    this.isAnimating = false;
                    if (onComplete) onComplete();
                })
                .start();
        } else {
            // 降下动画：scaleY 从 1.0 迅速收缩至 0.3 缩入底座 (0.18s quadIn)
            tween(this.pillarNode)
                .to(0.18, { scale: targetScale }, { easing: 'quadIn' })
                .call(() => {
                    this.isAnimating = false;
                    if (onComplete) onComplete();
                })
                .start();
        }
    }

    /**
     * 翻转当前升降状态 (升起 -> 降下 / 降下 -> 升起)
     * @param animate 是否播放动画
     * @param onComplete 完成回调
     */
    public toggleState(animate: boolean = true, onComplete?: () => void) {
        this.setExtended(!this.isExtended, animate, onComplete);
    }

    /**
     * 升降动作反馈 (预留微震与音效/粒子接口)
     * @param extended 目标状态
     */
    public playToggleFeedback(extended: boolean) {
        Audio.play(AudioId.obstacle);
    }
}
