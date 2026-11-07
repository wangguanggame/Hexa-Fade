import { _decorator, Component, ParticleSystem2D, tween, Tween, Vec3, Node } from 'cc';

const { ccclass } = _decorator;

/**
 * 飞分特效：从方块掉落点沿二次贝塞尔弧线飞向顶栏分数。
 * Trail 会从根节点拆到同一父节点下单独位移，粒子使用 FREE，
 * 才能像编辑器里拖拽那样留下彗星拖尾。
 */
@ccclass('GameScoreText')
export class GameScoreText extends Component {
    private static readonly FLY_DURATION: number = 0.75;
    private _flyProgress: { t: number } | null = null;
    private _trailNode: Node | null = null;

    public play(startPos: Vec3, endPos: Vec3, _addScore: number, onArrive?: () => void) {
        const textNode = this.node.getChildByName('text');
        if (textNode) {
            textNode.active = false;
        }

        this.detachTrail();
        this.node.setPosition(startPos);
        if (this._trailNode && this._trailNode.isValid) {
            this._trailNode.setPosition(startPos);
            this.resetTrailParticle();
        }

        const ctrl = this.buildControlPoint(startPos, endPos);
        const progress = { t: 0 };
        this._flyProgress = progress;

        tween(progress)
            .to(GameScoreText.FLY_DURATION, { t: 1 }, {
                easing: 'sineIn',
                onUpdate: (obj: { t: number }) => {
                    if (!this.node || !this.node.isValid) return;
                    const t = obj.t;
                    const u = 1 - t;
                    const x = u * u * startPos.x + 2 * u * t * ctrl.x + t * t * endPos.x;
                    const y = u * u * startPos.y + 2 * u * t * ctrl.y + t * t * endPos.y;
                    const pos = new Vec3(x, y, 0);
                    this.node.setPosition(pos);
                    if (this._trailNode && this._trailNode.isValid) {
                        this._trailNode.setPosition(pos);
                    }
                }
            })
            .call(() => {
                if (onArrive) onArrive();
                if (textNode && textNode.isValid) textNode.active = false;
                this.stopTrailEmission();
                tween(this.node)
                    .delay(0.55)
                    .call(() => {
                        if (this.node && this.node.isValid) this.node.destroy();
                    })
                    .start();
            })
            .start();
    }

    /**
     * 把 Trail 从飞分根节点拆到同一父级。父节点整体位移时，
     * 粒子本地坐标不变，看起来就像贴在数字上；单独改 Trail 坐标才是编辑器里那种拖尾。
     */
    private detachTrail() {
        const trail = this.node.getChildByName('Trail');
        const parent = this.node.parent;
        if (!trail || !parent) return;

        trail.setParent(parent, true);
        const rootIndex = this.node.getSiblingIndex();
        trail.setSiblingIndex(Math.max(0, rootIndex));
        this._trailNode = trail;
    }

    private resetTrailParticle() {
        if (!this._trailNode || !ParticleSystem2D) return;
        const ps = this._trailNode.getComponent(ParticleSystem2D);
        if (!ps) return;
        ps.positionType = ParticleSystem2D.PositionType.FREE;
        ps.resetSystem();
    }

    private stopTrailEmission() {
        if (!this._trailNode || !this._trailNode.isValid || !ParticleSystem2D) return;
        const ps = this._trailNode.getComponent(ParticleSystem2D);
        if (ps) ps.stopSystem();
    }

    onDestroy() {
        Tween.stopAllByTarget(this.node);
        if (this._flyProgress) {
            Tween.stopAllByTarget(this._flyProgress);
            this._flyProgress = null;
        }
        if (this._trailNode && this._trailNode.isValid) {
            this._trailNode.destroy();
            this._trailNode = null;
        }
    }

    private buildControlPoint(startPos: Vec3, endPos: Vec3): Vec3 {
        const side = startPos.x >= 0 ? 1 : -1;
        return new Vec3(
            startPos.x + side * 180,
            startPos.y + (endPos.y - startPos.y) * 0.45 + 80,
            0
        );
    }
}
