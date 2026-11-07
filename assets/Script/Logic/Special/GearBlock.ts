import { _decorator, Component, Node, Vec3, tween, v3, Color } from 'cc';
import { BrokenParticle } from '../BrokenParticle';
import { BoomParticle } from '../BoomParticle';
import { GameMain } from '../GameMain';
import { PRESET_HEX_COLORS } from '../HexBlock';

const { ccclass, property } = _decorator;

// ======================================== 旋转锯齿轮/切碎机控制器 ========================================
/**
 * 旋转锯齿轮粉碎机组件 (GearBlock / Special_7_701)
 * 挂载在 Special_7_701.prefab 预制体上
 * 对应美术目录: 7_GearBlock
 * 核心机制：
 * 1. 固定放置在指定六边形底座槽位，锯齿刀片在场景中持续高速自转；
 * 2. 充当特殊的“粉碎通道/切碎机”：其他方块沿箭头方向翻滚进入该槽位时，不会被阻挡弹回，而是被当场切碎消除；
 * 3. 方块切入时触发高频机械切削微震动动效与碎片飞溅粒子回调；
 * 4. 锯齿轮自身保持留存并继续工作。
 */
@ccclass('GearBlock')
export class GearBlock extends Component {
    // ======================================== 节点与属性引用 ========================================
    @property({ type: Node, tooltip: '锯齿叶片旋转主体节点 (hx_1)', group: { name: '节点引用', id: '0' } })
    public sawBladeNode: Node = null!;

    @property({ tooltip: '锯齿轮自转角速度 (度/秒，默认 450°/s)', group: { name: '动力学参数', id: '1' } })
    public rotateSpeed: number = 450;

    // ======================================== 核心属性 ========================================
    /** 网格行号 */
    public r: number = 0;
    /** 网格列号 */
    public c: number = 0;

    /** 当前累计旋转角度 */
    private _currentAngleY: number = 0;

    // ======================================== 生命周期与初始化 ========================================
    onLoad() {
        this.initNodeReferences();
    }

    private initNodeReferences() {
        if (!this.sawBladeNode) {
            this.sawBladeNode = this.node.getChildByPath('_701_pre/hx_1') ||
                this.node.getChildByName('hx_1') ||
                this.node.getChildByName('_701_pre') ||
                this.node;
        }
    }

    /**
     * 初始化锯齿轮粉碎机
     * @param r 行号
     * @param c 列号
     */
    public initGearBlock(r: number, c: number) {
        this.r = r;
        this.c = c;
        this.initNodeReferences();
        this._currentAngleY = 0;
    }

    /** 兼容旧接口命名 */
    public initSaw(r: number, c: number) {
        this.initGearBlock(r, c);
    }

    /**
     * 驱动锯齿轮在每一帧持续高速自转 (反方向/逆时针旋转，使刀齿切削感更自然)
     */
    update(dt: number) {
        if (!this.sawBladeNode) return;

        this._currentAngleY = (this._currentAngleY - this.rotateSpeed * dt) % 360;
        this.sawBladeNode.setRotationFromEuler(0, this._currentAngleY, 0);
    }

    // ======================================== 切削动力学动效与粒子预留 ========================================
    /**
     * 当有方块翻滚切入锯齿轮时播放切削微震动动效
     */
    public playShredFeedbackAnim() {
        if (!this.sawBladeNode) return;

        const originalScale = v3(1, 1, 1);
        const bumpScale = v3(1.12, 0.92, 1.12);

        // 瞬间挤压微震 -> 弹性回弹
        tween(this.sawBladeNode)
            .to(0.04, { scale: bumpScale }, { easing: 'quadOut' })
            .to(0.08, { scale: originalScale }, { easing: 'backOut' })
            .start();
    }

    /**
     * 播放切碎碎片飞溅粒子效果 (彩色碎片爆炸飞溅 + 机械切削火花粒子叠加)
     * @param worldPos 切碎发生的空间世界坐标
     * @param color 被切碎方块的颜色 (可选)
     * @param dir 被切碎方块的方向/颜色编号 1~6 (可选)
     */
    public playShredParticles(worldPos: Vec3, color?: Color, dir?: number) {
        const gameMain = GameMain.instance;
        const parentNode = gameMain?.gridContainer || this.node.parent || this.node;
        if (!parentNode || !parentNode.isValid) return;

        // 1. 确定色块对应的颜色编号 (1~6)
        let colorId = (dir && dir >= 1 && dir <= 6) ? dir : 1;
        if (!dir && color) {
            const foundKey = Object.keys(PRESET_HEX_COLORS).find(k => {
                const c = PRESET_HEX_COLORS[Number(k)];
                return c && c.r === color.r && c.g === color.g && c.b === color.b;
            });
            if (foundKey) {
                colorId = Number(foundKey);
            }
        }

        // 2. 播放方块同色的六边形爆裂碎片粒子
        BrokenParticle.playAtWorldPos(worldPos, parentNode, colorId, color);

        // 3. 叠加金属锯齿刀片高速旋转切削的火花碎片粒子 (Boom-piece)
        BoomParticle.play('piece', parentNode, worldPos, 1.8);
    }
}
