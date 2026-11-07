import {
    _decorator, Button, Component, instantiate, Node,
    Prefab, resources, Sprite, SpriteFrame, tween, UIOpacity, Vec3,
} from 'cc';
import { GameData } from '../Config/GameData';
import { LevelBlockData, LevelManager } from '../Logic/LevelManager';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { LoadingWaiting } from './LoadingWaiting';

const { ccclass } = _decorator;

interface SpecialGuideConfig {
    iconPath: string;
    titlePath: string;
    subtitlePath: string;
}

/** 教程图片位于 resources，确保发布构建包含全部 15 种教程。 */
const GUIDE_CONFIGS: Readonly<Record<number, SpecialGuideConfig>> = {
    1: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon1_Rotate/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title1_Rotate/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle1_Rotate/spriteFrame' },
    2: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon2_ForcedTurning/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title2_ForcedTurning/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle2_ForcedTurning/spriteFrame' },
    3: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon3_TileBreaker/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title3_TileBreaker/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle3_TileBreaker/spriteFrame' },
    4: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon4_TimedObstacle/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title4_TimedObstacle/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle4_TimedObstacle/spriteFrame' },
    5: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon5_ArrowBomb/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title5_ArrowBomb/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle5_ArrowBomb/spriteFrame' },
    6: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon6_BrokenFloor/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title6_BrokenFloor/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle6_BrokenFloor/spriteFrame' },
    7: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon7_DirectionalFloor/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title7_DirectionalFloor/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle7_DirectionalFloor/spriteFrame' },
    8: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon8_SnowyTile/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title8_SnowyTile/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle8_SnowyTile/spriteFrame' },
    9: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon9_PopUpObstacle/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title9_PopUpObstacle/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle9_PopUpObstacle/spriteFrame' },
    10: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon10_MysteryTile/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title10_MysteryTile/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle10_MysteryTile/spriteFrame' },
    11: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon11_DirectionalTile/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title11_DirectionalTile/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle11_DirectionalTile/spriteFrame' },
    12: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon12_PauseTile/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title12_PauseTile/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle12_PauseTile/spriteFrame' },
    13: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon13_Bomb/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title13_Bomb/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle13_Bomb/spriteFrame' },
    14: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon14_StopFloor/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title14_StopFloor/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle14_StopFloor/spriteFrame' },
    15: { iconPath: 'Other/SpacialMapItemGuide/Icons/Icon15_ObstacleWall/spriteFrame', titlePath: 'Other/SpacialMapItemGuide/Text/Title15_ObstacleWall/spriteFrame', subtitlePath: 'Other/SpacialMapItemGuide/Text/Subtitle15_ObstacleWall/spriteFrame' },
};

/**
 * 关卡 specialType -> 教程图编号。
 * 编号与美术「道具N / 标题N / 文字N」对齐，不是 Special_N 文件夹号。
 */
export function getSpecialGuideId(rawType: number): number | null {
    if ((rawType >= 401 && rawType <= 403) || (rawType >= 501 && rawType <= 503)) return 1;
    if (rawType >= 601 && rawType <= 606) return 2;
    if (rawType === 701) return 3;
    if (rawType === 202) return 4;
    if (rawType >= 1501 && rawType <= 1506) return 5;
    if (rawType === 801) return 6;
    if (rawType === 1701) return 7;
    if (rawType === 901) return 9;
    if (rawType === 1001) return 10;
    if (rawType === 1101 || rawType === 1301) return 11;
    if (rawType >= 1201 && rawType <= 1206) return 12;
    if (rawType === 301) return 13;
    if (rawType === 101) return 14;
    if (rawType === 102) return 15;
    return null;
}

@ccclass('SpacialMapItemPage')
export class SpacialMapItemPage extends Component {
    private static readonly PREFAB_PATH = 'Other/View/SpacialMapItemPage';
    private static _currentNode: Node | null = null;
    private static _queue: number[] = [];
    private static _onAllClosed: (() => void) | null = null;
    /** 每种教程在 CSV 里第一次出现的关卡号 */
    private static _debutLevelByGuide: Map<number, number> | null = null;

    private _guideId = 1;
    private _content: Node | null = null;
    private _mask: Node | null = null;
    private _btnOk: Button | null = null;
    private _btnClose: Button | null = null;
    private _isClosing = false;

    private static ensureDebutMap(): void {
        if (this._debutLevelByGuide) return;
        const debut = new Map<number, number>();
        const manager = LevelManager.instance;
        for (let levelId = 1; levelId <= 500; levelId++) {
            const data = manager.getLevel(levelId);
            if (!data) continue;
            data.blocks.forEach(block => {
                const rawType = (block.specialType !== undefined) ? block.specialType : 0;
                const guideId = getSpecialGuideId(rawType);
                if (!guideId || debut.has(guideId) || !GUIDE_CONFIGS[guideId]) return;
                debut.set(guideId, levelId);
            });
        }
        this._debutLevelByGuide = debut;
    }

    public static collectUnseenGuideIds(blocks: LevelBlockData[], levelId: number): number[] {
        this.ensureDebutMap();
        const seen = new Set<number>();
        const ids: number[] = [];
        blocks.forEach(block => {
            const rawType = (block.specialType !== undefined) ? block.specialType : 0;
            const guideId = getSpecialGuideId(rawType);
            if (!guideId || seen.has(guideId) || !GUIDE_CONFIGS[guideId]) return;
            if (this._debutLevelByGuide && this._debutLevelByGuide.get(guideId) !== levelId) return;
            if (GameData.instance.hasSeenSpecialMapItem(guideId)) return;
            seen.add(guideId);
            ids.push(guideId);
        });
        return ids;
    }

    public static showUnseenForLevel(blocks: LevelBlockData[], parent: Node, levelId: number, onAllClosed?: () => void): boolean {
        const ids = this.collectUnseenGuideIds(blocks, levelId);
        if (ids.length <= 0 || !parent || !parent.isValid) {
            if (onAllClosed) onAllClosed();
            return false;
        }
        this._queue = ids;
        this._onAllClosed = onAllClosed || null;
        this.showNext(parent);
        return true;
    }

    private static showNext(parent: Node): void {
        const guideId = this._queue.shift();
        if (guideId === undefined) {
            this.finishAll();
            return;
        }

        LoadingWaiting.acquire(parent, () => {
            if (!parent.isValid) {
                this.finishAll();
                LoadingWaiting.release();
                return;
            }
            const config = GUIDE_CONFIGS[guideId];
            const imagePaths = config ? [config.iconPath, config.titlePath, config.subtitlePath] : [];
            const images = imagePaths.map(path => new Promise<void>((resolve, reject) => {
                resources.load(path, SpriteFrame, (err, frame) => {
                    if (err || !frame) reject(err || new Error(`Guide image missing: ${path}`));
                    else resolve();
                });
            }));
            const prefabTask = new Promise<Prefab>((resolve, reject) => {
                resources.load(this.PREFAB_PATH, Prefab, (err, prefab) => {
                    if (err || !prefab) reject(err || new Error('Guide prefab missing'));
                    else resolve(prefab);
                });
            });
            Promise.all([prefabTask, ...images]).then(([prefab]) => {
                if (!parent.isValid) {
                    this.finishAll();
                    return;
                }
                const aliveNode = this._currentNode?.isValid ? this._currentNode : null;
                const alivePage = aliveNode?.getComponent(SpacialMapItemPage);
                if (alivePage && !alivePage._isClosing) {
                    alivePage.initialize(guideId);
                    return;
                }
                const pageNode = instantiate(prefab as Prefab);
                pageNode.setParent(parent);
                pageNode.setSiblingIndex(parent.children.length - 1);
                this._currentNode = pageNode;
                const page = pageNode.getComponent(SpacialMapItemPage) || pageNode.addComponent(SpacialMapItemPage);
                page.initialize(guideId);
            }).catch(error => {
                console.warn('[SpacialMapItemPage] Guide load failed:', error);
                this.finishAll();
            }).finally(() => LoadingWaiting.release());
        });
    }
    private static finishAll(): void {
        const done = this._onAllClosed;
        this._onAllClosed = null;
        this._queue.length = 0;
        if (done) done();
    }

    onLoad(): void {
        this.resolveNodes();
        this.bindEvents();
    }

    onDestroy(): void {
        if (this._mask && this._mask.isValid) {
            this._mask.off(Node.EventType.TOUCH_END, this.close, this);
        }
        if (this._btnOk && this._btnOk.node && this._btnOk.node.isValid) {
            this._btnOk.node.off(Button.EventType.CLICK, this.close, this);
        }
        if (this._btnClose && this._btnClose.node && this._btnClose.node.isValid) {
            this._btnClose.node.off(Button.EventType.CLICK, this.close, this);
        }
        if (SpacialMapItemPage._currentNode === this.node) {
            SpacialMapItemPage._currentNode = null;
        }
    }

    public initialize(guideId: number): void {
        this._guideId = guideId;
        this._isClosing = false;
        GameData.instance.markSpecialMapItemSeen(guideId);

        const config = GUIDE_CONFIGS[guideId];
        if (config) {
            this.setSprite('InnerSlot/Icon', config.iconPath, guideId);
            this.setSprite('Ribbon/Title', config.titlePath, guideId);
            this.setSprite('Subtitle', config.subtitlePath, guideId);
        }

        this.playEnterAnimation();
    }

    private playEnterAnimation(): void {
        if (this._mask) {
            const maskOpacity = this._mask.getComponent(UIOpacity) || this._mask.addComponent(UIOpacity);
            maskOpacity.opacity = 0;
            tween(maskOpacity)
                .to(0.25, { opacity: 230 })
                .start();
        }

        if (!this._content) return;

        this._content.setScale(new Vec3(0.2, 0.2, 1));
        const contentOpacity = this._content.getComponent(UIOpacity) || this._content.addComponent(UIOpacity);
        contentOpacity.opacity = 0;

        tween(contentOpacity)
            .to(0.2, { opacity: 255 })
            .start();

        tween(this._content)
            .to(0.35, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'cubicOut' })
            .to(0.15, { scale: new Vec3(0.98, 0.98, 1) }, { easing: 'quadInOut' })
            .to(0.12, { scale: Vec3.ONE }, { easing: 'quadOut' })
            .start();
    }

    private resolveNodes(): void {
        this._mask = this.node.getChildByName('Mask');
        this._content = this.node.getChildByName('Content');
        this._btnOk = null;
        this._btnClose = null;
        if (this._content) {
            const okNode = this._content.getChildByName('BtnOK');
            this._btnOk = okNode ? okNode.getComponent(Button) : null;
            const closeInContent = this._content.getChildByName('Btn_Close');
            this._btnClose = closeInContent ? closeInContent.getComponent(Button) : null;
        }
        if (!this._btnClose) {
            const closeNode = this.node.getChildByName('Btn_Close');
            this._btnClose = closeNode ? closeNode.getComponent(Button) : null;
        }
    }

    private bindEvents(): void {
        if (this._mask) {
            this._mask.on(Node.EventType.TOUCH_END, this.close, this);
        }
        if (this._btnOk && this._btnOk.node) {
            this._btnOk.node.on(Button.EventType.CLICK, this.close, this);
        }
        if (this._btnClose && this._btnClose.node) {
            this._btnClose.node.on(Button.EventType.CLICK, this.close, this);
        }
    }

    private setSprite(path: string, resourcePath: string, expectedId: number): void {
        if (!this._content) return;
        const target = this._content.getChildByPath(path);
        if (!target) return;
        const sprite = target.getComponent(Sprite);
        if (!sprite) return;
        const cached = resources.get(resourcePath, SpriteFrame);
        if (cached) {
            sprite.spriteFrame = cached;
            return;
        }
        sprite.spriteFrame = null;
        resources.load(resourcePath, SpriteFrame, (error, spriteFrame) => {
            if (error || !spriteFrame) {
                console.warn('[SpacialMapItemPage] 教程图片加载失败:', resourcePath, error);
                return;
            }
            if (!this.node || !this.node.isValid) return;
            if (this._guideId !== expectedId) return;
            if (!sprite.isValid) return;
            sprite.spriteFrame = spriteFrame;
        });
    }

    private close(): void {
        Audio.play(AudioId.uiClick);
        if (this._isClosing) return;
        if (!this.node || !this.node.isValid) return;
        this._isClosing = true;

        const parent = this.node.parent;
        const hasMore = SpacialMapItemPage._queue.length > 0;

        if (hasMore && parent && parent.isValid) {
            this._isClosing = false;
            SpacialMapItemPage.showNext(parent);
            return;
        }

        if (this._content && this._content.isValid) {
            tween(this._content)
                .to(0.2, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'backIn' })
                .start();
            const contentOpacity = this._content.getComponent(UIOpacity);
            if (contentOpacity) tween(contentOpacity).to(0.2, { opacity: 0 }).start();
        }

        if (this._mask && this._mask.isValid) {
            const maskOpacity = this._mask.getComponent(UIOpacity);
            if (maskOpacity) tween(maskOpacity).to(0.2, { opacity: 0 }).start();
        }

        this.scheduleOnce(() => {
            SpacialMapItemPage._currentNode = null;
            if (this.node && this.node.isValid) this.node.destroy();
            SpacialMapItemPage.finishAll();
        }, 0.22);
    }
}
