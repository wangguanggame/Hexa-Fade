import { GameSDK } from '../../sdk/GameSDK';
import {
    _decorator, Component, instantiate, Label, Layout, Node,
    Prefab, resources, ScrollView, Sprite, SpriteFrame, tween, Tween,
    UIOpacity, UITransform, Vec2, Vec3,
} from 'cc';
import { GameData, GameDataEvent } from '../Config/GameData';
import { COLLECTION_LEVEL_CONFIGS, collectionTargetCount } from '../Config/CollectionConfig';
import { LoadingWaiting } from './LoadingWaiting';

const { ccclass, property } = _decorator;
const COLLECTION_ITEM_PATH = 'Other/View/CollectionItem';

/**
 * 收藏页面：根据收藏配置生成卡片，并显示 GameData 中持久化的进度。
 */
@ccclass('CollectionPage')
export class CollectionPage extends Component {
    // ======================================== 资源配置 ========================================
    @property({ type: Prefab, tooltip: '收藏卡片预制体 (CollectionItem)' })
    public collectionItemPrefab: Prefab | null = null;

    @property({ type: [SpriteFrame], tooltip: '按序号排列的 Sculpture_1 ~ Sculpture_12' })
    public sculptureFrames: SpriteFrame[] = [];

    @property({ type: [SpriteFrame], tooltip: '按序号排列的 Sculpture_Mask_1 ~ Sculpture_Mask_12' })
    public sculptureMaskFrames: SpriteFrame[] = [];

    @property({ type: [SpriteFrame], tooltip: '按序号排列的 title_1 ~ title_12' })
    public titleFrames: SpriteFrame[] = [];

    // ======================================== 内部状态 ========================================
    private _content: Node | null = null;
    private _scrollView: ScrollView | null = null;
    private _items: Node[] = [];
    /** 这批 id 先按“还差最后一关”来画，再播填满。 */
    private _holdUnlockIds: number[] = [];
    private _unlockPlaying: boolean = false;
    private _presentToken: number = 0;
    private _unlockTween: Tween<{ ratio: number }> | null = null;
    /** Tab 打开本页时占着 LoadingWaiting，卡片生成完再关掉。 */
    private _loadingHeld: boolean = false;

    // ======================================== 生命周期 ========================================
    onLoad(): void {
        this.initNodeReferences();
        this._content?.parent?.on(Node.EventType.SIZE_CHANGED, this.centerGrid, this);
        this._holdUnlockIds = GameData.instance.pendingCollectionUnlockIds.slice();

        if (this.collectionItemPrefab) {
            this.createItems();
            this.finishPageLoading();
        } else {
            resources.load(COLLECTION_ITEM_PATH, Prefab, (err, prefab) => {
                if (!this.isValid) return;
                if (err || !prefab) {
                    this.finishPageLoading();
                    return;
                }
                this.collectionItemPrefab = prefab;
                this.createItems();
                this.finishPageLoading();
            });
        }
    }

    /** 由 TabPage 在挂到场景前调用，避免预制体刚实例化就把等待遮罩关掉。 */
    public markLoadingHeld(): void {
        this._loadingHeld = true;
    }

    /** 卡片已经铺好再收遮罩。普通进入多留一瞬，解锁演出则马上让开。 */
    private finishPageLoading(): void {
        if (!this._loadingHeld) return;
        const delay = this._holdUnlockIds.length > 0 ? 0 : 0.35;
        this.scheduleOnce(() => this.releaseLoadingWaiting(), delay);
    }

    private releaseLoadingWaiting(): void {
        if (!this._loadingHeld) return;
        this._loadingHeld = false;
        LoadingWaiting.release();
    }

    onDestroy(): void {
        this._content?.parent?.off(Node.EventType.SIZE_CHANGED, this.centerGrid, this);
        this.releaseLoadingWaiting();
    }

    onEnable(): void {
        GameSDK.inst.logEvent('showPage', { value: 'collectionPage' });
        GameData.event.on(GameDataEvent.LEVEL_CHANGED, this.refreshProgress, this);
        this.refreshProgress();
        this.tryPresentUnlocks();
    }

    onDisable(): void {
        this._presentToken++;
        this._unlockTween?.stop();
        this._unlockTween = null;
        GameData.event.off(GameDataEvent.LEVEL_CHANGED, this.refreshProgress, this);
    }

    // ======================================== 节点与卡片初始化 ========================================
    /** Inspector 未绑定节点时，从页面预制体的固定路径获取。 */
    private initNodeReferences(): void {
        const scrollNode = this.node.getChildByPath('Frame/ScrollView');
        this._scrollView = scrollNode?.getComponent(ScrollView) || null;
        this._content = this._scrollView?.content
            || scrollNode?.getChildByPath('view/content')
            || null;
    }

    /** 每个卡片只实例化一次；进度变化时复用节点。 */
    private createItems(): void {
        if (!this._content || !this.collectionItemPrefab) return;
        this._content.children.slice().forEach(child => {
            child.removeFromParent();
            child.destroy();
        });
        this._items.length = 0;

        for (let index = 0; index < COLLECTION_LEVEL_CONFIGS.length; index++) {
            const config = COLLECTION_LEVEL_CONFIGS[index];
            const item = instantiate(this.collectionItemPrefab);
            item.name = `CollectionItem${config.id}`;
            item.setParent(this._content);
            this._items.push(item);

            const title = item.getChildByName('name')?.getComponent(Sprite);
            const titleFrame = this.titleFrames[config.id - 1];
            if (title && titleFrame) {
                const titleTransform = title.node.getComponent(UITransform);
                const rect = titleFrame.rect;
                const scale = titleTransform
                    ? Math.min(titleTransform.width / rect.width, titleTransform.height / rect.height)
                    : 1;
                title.sizeMode = Sprite.SizeMode.CUSTOM;
                title.spriteFrame = titleFrame;
                titleTransform?.setContentSize(rect.width * scale, rect.height * scale);
            }

            const sculpture = item.getChildByName('top')?.getComponent(Sprite);
            if (sculpture && this.sculptureFrames[config.id - 1]) {
                // 保留预制体的 FILLED / VERTICAL 与图片尺寸模式。
                sculpture.spriteFrame = this.sculptureFrames[config.id - 1];
            }

            const mask = item.getChildByName('bom')?.getComponent(Sprite);
            if (mask && this.sculptureMaskFrames[config.id - 1]) {
                mask.spriteFrame = this.sculptureMaskFrames[config.id - 1];
            }
        }

        this.centerGrid();
        this._scrollView?.scrollToTop(0);
        this.refreshProgress();
        this.tryPresentUnlocks();
    }

    // ======================================== 关卡进度渲染 ========================================
    /** 三列卡片按实际可视宽度居中，左右均分剩余空间。 */
    private centerGrid(): void {
        const content = this._content;
        const layout = content?.getComponent(Layout);
        const viewTransform = content?.parent?.getComponent(UITransform);
        const contentTransform = content?.getComponent(UITransform);
        if (!layout || !viewTransform || !contentTransform || !this._items.length) return;
        const columns = Math.min(3, this._items.length);
        const cardWidth = this._items[0].getComponent(UITransform)?.width ?? layout.cellSize.width;
        const rowWidth = columns * cardWidth + (columns - 1) * layout.spacingX;
        const padding = Math.max(0, (viewTransform.width - rowWidth) / 2);
        contentTransform.width = viewTransform.width;
        layout.paddingLeft = padding;
        layout.paddingRight = padding;
        layout.updateLayout();
    }

    /** 使用已存档的每件藏品进度，配置数组提供各自的解锁目标。 */
    public refreshProgress(): void {
        if (this._unlockPlaying) return;
        const savedProgress = GameData.instance.collectionProgress;
        this._items.forEach((item, index) => {
            const config = COLLECTION_LEVEL_CONFIGS[index];
            const target = collectionTargetCount(config);
            const saved = Math.max(0, Math.min(savedProgress[index] || 0, target));
            const holding = this._holdUnlockIds.indexOf(config.id) >= 0;
            const current = holding ? Math.max(0, target - 1) : saved;
            const completed = !holding && (config.startLevel === 0 || current >= target);
            this.applyItemVisual(item, index, completed ? 1 : current / target, completed);
        });
    }

    /** 待解锁的卡片先停在差一关，再逐个填满，播完通知首页换地标。 */
    private tryPresentUnlocks(): void {
        if (this._unlockPlaying || !this._items.length || !this._holdUnlockIds.length) return;
        this._unlockPlaying = true;
        const token = this._presentToken;
        const ids = this._holdUnlockIds.slice();
        this.presentUnlockAt(ids, 0, token);
    }

    private presentUnlockAt(ids: number[], cursor: number, token: number): void {
        if (token !== this._presentToken || !this.isValid) return;
        if (cursor >= ids.length) {
            this.scheduleOnce(() => {
                if (token !== this._presentToken || !this.isValid) return;
                GameData.instance.finishCollectionUnlockPresentation();
            }, 0);
            return;
        }

        const configIndex = COLLECTION_LEVEL_CONFIGS.findIndex(config => config.id === ids[cursor]);
        const item = configIndex >= 0 ? this._items[configIndex] : null;
        const config = configIndex >= 0 ? COLLECTION_LEVEL_CONFIGS[configIndex] : null;
        if (!item || !config) {
            this.presentUnlockAt(ids, cursor + 1, token);
            return;
        }

        this.scrollToItem(configIndex);
        const target = collectionTargetCount(config);
        const startRatio = target <= 1 ? 0 : (target - 1) / target;
        this.scheduleOnce(() => {
            if (token !== this._presentToken || !this.isValid) return;
            this.playFillUnlock(item, configIndex, startRatio, token, () => {
                this.presentUnlockAt(ids, cursor + 1, token);
            });
        }, 0.35);
    }

    private playFillUnlock(item: Node, index: number, startRatio: number, token: number, onDone: () => void): void {
        const state = { ratio: startRatio };
        this.applyItemVisual(item, index, startRatio, false);
        this._unlockTween?.stop();
        this._unlockTween = tween(state)
            .to(0.75, { ratio: 1 }, {
                onUpdate: () => {
                    if (token !== this._presentToken || !item.isValid) return;
                    this.applyItemVisual(item, index, state.ratio, false);
                },
            })
            .call(() => {
                if (token !== this._presentToken || !item.isValid) return;
                this.applyItemVisual(item, index, 1, true);
                const mask = item.getChildByName('bom');
                if (mask) mask.active = false;
                tween(item)
                    .to(0.12, { scale: new Vec3(1.06, 1.06, 1) })
                    .to(0.12, { scale: new Vec3(1, 1, 1) })
                    .start();
            })
            .delay(0.45)
            .call(() => {
                if (token !== this._presentToken || !this.isValid) return;
                onDone();
            })
            .start();
    }

    private applyItemVisual(item: Node, index: number, ratio: number, completed: boolean): void {
        const config = COLLECTION_LEVEL_CONFIGS[index];
        const shownRatio = completed ? 1 : Math.max(0, Math.min(ratio, 0.999));
        const topNode = item.getChildByName('top');
        const sculpture = topNode?.getComponent(Sprite);
        if (sculpture) sculpture.fillRange = completed ? 1 : shownRatio;
        if (topNode) topNode.active = shownRatio > 0 || completed;

        const mask = item.getChildByName('bom');
        if (mask) {
            mask.active = !completed;
            const maskOpacity = mask.getComponent(UIOpacity);
            if (maskOpacity && !completed) maskOpacity.opacity = 255;
        }

        const progress = item.getChildByName('Progress');
        if (!progress) return;
        progress.active = !completed;
        if (completed) return;

        const target = collectionTargetCount(config);
        const current = Math.round(shownRatio * target);
        const label = progress.getChildByName('Level')?.getComponent(Label);
        if (label) {
            const shownLevel = config.startLevel + Math.max(0, current - 1);
            label.string = label.font
                ? `L${shownLevel}X${config.endLevel}`
                : `LEVEL ${shownLevel}/${config.endLevel}`;
        }

        const fill = progress.getChildByName('ProgressFill');
        const fillTransform = fill?.getComponent(UITransform);
        if (fill && fillTransform) {
            const track = progress.getChildByName('ProgressTrack');
            const trackTransform = track?.getComponent(UITransform);
            const trackWidth = trackTransform?.width || 242;
            const fillWidth = trackWidth * shownRatio;
            const fillSprite = fill.getComponent(Sprite);
            if (fillSprite) {
                fillSprite.type = Sprite.Type.SIMPLE;
                fillSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            }
            fillTransform.setContentSize(fillWidth, fillTransform.height);
            const trackLeft = (track?.position.x || 0) - trackWidth * (trackTransform?.anchorX ?? 0.5);
            fill.setPosition(trackLeft + fillWidth * fillTransform.anchorX, track?.position.y ?? fill.position.y, fill.position.z);
            fill.active = shownRatio > 0;
        }
    }

    private scrollToItem(index: number): void {
        const scroll = this._scrollView;
        const content = this._content;
        const item = this._items[index];
        if (!scroll || !content || !item) return;
        const contentTransform = content.getComponent(UITransform);
        const viewTransform = scroll.node.getComponent(UITransform);
        if (!contentTransform || !viewTransform) return;
        content.getComponent(Layout)?.updateLayout();

        const itemCenter = contentTransform.convertToNodeSpaceAR(item.worldPosition);
        const contentTop = contentTransform.height * (1 - contentTransform.anchorPoint.y);
        let offsetY = contentTop - itemCenter.y - viewTransform.height / 2;
        const maxY = scroll.getMaxScrollOffset().y;
        offsetY = maxY <= 0 ? 0 : Math.max(0, Math.min(maxY, offsetY));
        scroll.scrollToOffset(new Vec2(0, offsetY), 0.3);
    }
}
