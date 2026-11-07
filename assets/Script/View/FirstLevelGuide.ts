import {
    _decorator, assetManager, Camera, Component, Node, Sprite, SpriteFrame,
    tween, Tween, UITransform, Vec3,
} from 'cc';
import { GameData } from '../Config/GameData';
import { HexBlock, BlockState } from '../Logic/HexBlock';
import { HexGridManager } from '../Logic/HexGridManager';

const { ccclass, property } = _decorator;
const CIRCLE_FRAME_UUID = '85303cfa-6bfa-4d02-b55c-407cb573c423@f9941';
const HAND_FRAME_UUID = 'f6323779-b8fe-4b4a-928d-883d3d7dfa87@f9941';

/** 第一关首次点击引导：圆圈和手指依次标出每个色块。 */
@ccclass('FirstLevelGuide')
export class FirstLevelGuide extends Component {
    private static _framesTask: Promise<void> | null = null;
    private static _frames = new Map<string, SpriteFrame>();

    /** 首页后台准备引导图片，重复调用复用加载任务。 */
    public static preloadFrames(): Promise<void> {
        if (this._framesTask) return this._framesTask;
        this._framesTask = Promise.all([CIRCLE_FRAME_UUID, HAND_FRAME_UUID].map(uuid => {
            if (this._frames.has(uuid)) return Promise.resolve();
            return new Promise<void>((resolve, reject) => {
                assetManager.loadAny({ uuid }, (err: Error | null, frame: SpriteFrame) => {
                    if (err || !(frame instanceof SpriteFrame)) {
                        reject(err || new Error('Guide frame missing'));
                        return;
                    }
                    this._frames.set(uuid, frame);
                    resolve();
                });
            });
        })).then(() => {}).catch(err => {
            this._framesTask = null;
            throw err;
        });
        return this._framesTask;
    }
    // ======================================== 图片资源 ========================================
    @property({ type: SpriteFrame, tooltip: 'GuideCircle 圆圈图片' })
    public circleFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'GuideHand 手指图片' })
    public handFrame: SpriteFrame | null = null;

    // ======================================== 内部状态 ========================================
    private _targets: HexBlock[] = [];
    private _target: HexBlock | null = null;
    private _gridManager: HexGridManager | null = null;
    private _camera: Camera | null = null;
    private _parent: Node | null = null;
    private _circle: Node | null = null;
    private _hand: Node | null = null;
    private _screenPosition = new Vec3();
    private _loadToken = 0;

    /** 棋盘生成后选取可操作的顶层方块，等待加载页关闭后显示。 */
    public prepare(levelId: number, grid: Node, gridManager: HexGridManager, camera: Camera): void {
        this.hide();
        if (levelId !== 1 || GameData.instance.hasSeenFirstLevelGuide) return;

        this._gridManager = gridManager;
        this._camera = camera;
        const topBlocks = grid.getComponentsInChildren(HexBlock).filter(block =>
            block.isTop && block.state === BlockState.IDLE
            && gridManager.getTopBlock(block.r, block.c) === block
        );
        this._targets = this.sortClockwise(topBlocks);
        this._target = this.pickNext();
    }

    /** 从棋盘上方开始，按顺时针排好引导顺序。 */
    private sortClockwise(blocks: HexBlock[]): HexBlock[] {
        if (blocks.length <= 1) return blocks.slice();
        let sumR = 0;
        let sumC = 0;
        blocks.forEach(block => {
            sumR += block.r;
            sumC += block.c;
        });
        const centerR = sumR / blocks.length;
        const centerC = sumC / blocks.length;
        return blocks.slice().sort((a, b) => {
            const angleA = Math.atan2(a.c - centerC, a.r - centerR);
            const angleB = Math.atan2(b.c - centerC, b.r - centerR);
            return angleA - angleB;
        });
    }

    /** 还在场上、并且当前能飞出的色块优先。撞墙退回的色块先留在队列里。 */
    private pickNext(): HexBlock | null {
        this._targets = this._targets.filter(block => block?.isValid && block.state !== BlockState.DESTROYED);
        const alive = this._targets.filter(block => this.isStillGuidable(block));
        if (!this._gridManager) return alive[0] || null;
        return alive.find(block => this._gridManager!.checkPathInfo(block).canFly) || alive[0] || null;
    }

    private isStillGuidable(block: HexBlock | null): boolean {
        return !!block
            && block.isValid
            && block.state === BlockState.IDLE
            && !!this._gridManager
            && this._gridManager.getTopBlock(block.r, block.c) === block;
    }

    /** 由 LoadingPage 在第一关完全进入游戏后调用。 */
    public show(parent: Node): void {
        if (GameData.instance.currentLevel !== 1 || GameData.instance.hasSeenFirstLevelGuide) return;
        if (!this._target?.isValid || !this._camera?.isValid || !parent?.isValid) {
            return;
        }

        this._parent = parent;
        this.circleFrame = this.circleFrame || FirstLevelGuide._frames.get(CIRCLE_FRAME_UUID) || null;
        this.handFrame = this.handFrame || FirstLevelGuide._frames.get(HAND_FRAME_UUID) || null;
        if (!this.circleFrame || !this.handFrame) {
            this.loadFramesAndShow(this._loadToken);
            return;
        }
        this.createGuideNodes(parent);
    }

    /** 场景组件或图片引用未及时导入时，按资源 UUID 补载图片。 */
    private loadFramesAndShow(token: number): void {
        FirstLevelGuide.preloadFrames().then(() => {
            if (token !== this._loadToken || !this.isValid) return;
            this.circleFrame = this.circleFrame || FirstLevelGuide._frames.get(CIRCLE_FRAME_UUID) || null;
            this.handFrame = this.handFrame || FirstLevelGuide._frames.get(HAND_FRAME_UUID) || null;
            if (this._parent?.isValid && this._target?.isValid) this.createGuideNodes(this._parent);
        }).catch(err => console.warn('[FirstLevelGuide] Image preload failed:', err));
    }
    private createGuideNodes(parent: Node): void {
        if (this._circle || !this.circleFrame || !this.handFrame) return;
        this._circle = this.createImageNode('GuideCircle', this.circleFrame, parent);
        this._hand = this.createImageNode('GuideHand', this.handFrame, parent);
        this._hand.setScale(0.87, 0.87, 1);
        this.updatePosition();

        tween(this._circle).repeatForever(
            tween<Node>().to(0.45, { scale: new Vec3(1.12, 1.12, 1) })
                .to(0.45, { scale: new Vec3(1, 1, 1) })
        ).start();
        tween(this._hand).repeatForever(
            tween<Node>().to(0.45, { scale: new Vec3(0.80, 0.80, 1) })
                .to(0.45, { scale: new Vec3(0.87, 0.87, 1) })
        ).start();
    }

    /**
     * 点中的色块真正离场后，手指移到下一个。
     * 四个都点过后才写入存档。
     */
    public onBlockSelected(block: HexBlock, willLeave: boolean): void {
        if (!this._circle || !block || !willLeave) return;
        const index = this._targets.indexOf(block);
        if (index >= 0) this._targets.splice(index, 1);
        if (block === this._target) this._target = null;
    }

    private finish(): void {
        GameData.instance.hasSeenFirstLevelGuide = true;
        GameData.instance.saveData();
        this.hide();
    }

    lateUpdate(): void {
        if (!this._circle) return;
        if (!this.isStillGuidable(this._target)) {
            this._target = this.pickNext();
            if (!this._target) {
                if (this._targets.length === 0) this.finish();
                return;
            }
        }
        this.updatePosition();
    }

    onDestroy(): void {
        this.hide();
    }

    /** 关卡重载、退出或引导完成时清理动画与节点。 */
    public hide(): void {
        this.unscheduleAllCallbacks();
        this._loadToken++;
        this._targets = [];
        this._gridManager = null;
        if (this._circle?.isValid) {
            Tween.stopAllByTarget(this._circle);
            this._circle.destroy();
        }
        if (this._hand?.isValid) {
            Tween.stopAllByTarget(this._hand);
            this._hand.destroy();
        }
        this._circle = null;
        this._hand = null;
        this._target = null;
        this._camera = null;
        this._parent = null;
    }

    private createImageNode(name: string, frame: SpriteFrame, parent: Node): Node {
        const node = new Node(name);
        // 动态节点默认在 DEFAULT 层，界面相机只渲染 UI_2D，不改层就看不见。
        node.layer = parent.layer;
        node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.RAW;
        sprite.spriteFrame = frame;
        node.setParent(parent);
        node.setSiblingIndex(parent.children.length - 1);
        return node;
    }

    private updatePosition(): void {
        const target = this._target;
        const parent = this._parent;
        const circle = this._circle;
        const hand = this._hand;
        const camera = this._camera;
        if (!target || !parent || !circle || !hand || !camera) return;

        const parentTransform = parent.getComponent(UITransform);
        if (!parentTransform) return;
        if (typeof (camera as any).convertToUINode === 'function') {
            camera.convertToUINode(target.node.worldPosition, parent, this._screenPosition);
        } else {
            camera.worldToScreen(target.node.worldPosition, this._screenPosition);
            parentTransform.convertToNodeSpaceAR(this._screenPosition, this._screenPosition);
        }
        circle.setPosition(this._screenPosition.x, this._screenPosition.y, 0);
        hand.setPosition(this._screenPosition.x - 70, this._screenPosition.y - 100, 0);
    }
}
