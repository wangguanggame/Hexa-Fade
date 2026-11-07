import {
    _decorator, assetManager, Button, Component, instantiate, Label,
    Node, Prefab, resources, Sprite, SpriteFrame, tween, UIOpacity, Vec3,
} from 'cc';
import { GameData, GameDataEvent } from '../Config/GameData';
import { Remind } from '../Tools/Remind/Remind';
import { GameSDK } from '../../sdk/GameSDK';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { AdGetCoinsPage } from './AdGetCoinsPage';
import { LoadingWaiting } from './LoadingWaiting';

const { ccclass, property } = _decorator;

export enum PurchasePropType {
    TNT = 'TNT',
    HAMMER = 'HAMMER',
    DRILL = 'DRILL',
    ADD_MOVES = 'ADD_MOVES',
}

interface PropPurchaseConfig {
    price: number;
    iconUuid: string;
    titleUuid: string;
    subtitleUuid: string;
}

// 顺序依次为 TNT、锤子、电钻、加步数，后续调价只需修改此数组。
export const PROP_PRICES = [1000, 1000, 1000, 1000] as const;

const PROP_CONFIGS: Readonly<Record<PurchasePropType, PropPurchaseConfig>> = {
    [PurchasePropType.TNT]: {
        price: PROP_PRICES[0],
        iconUuid: '75c91f44-dd95-4372-9a37-9afa7302b3fa@f9941',
        titleUuid: '05eca293-2ea7-4914-a60c-9a6988596b4d@f9941',
        subtitleUuid: '4dc9d46a-b054-44ed-82c3-9b682ff7a9e7@f9941',
    },
    [PurchasePropType.HAMMER]: {
        price: PROP_PRICES[1],
        iconUuid: '5373d763-6341-402f-8a26-451b3057b52d@f9941',
        titleUuid: '6d41bdd2-badd-4836-b56c-3ebf517abf6b@f9941',
        subtitleUuid: '21e67041-a593-4dd7-b4e5-c76db89e6408@f9941',
    },
    [PurchasePropType.DRILL]: {
        price: PROP_PRICES[2],
        iconUuid: 'e9487125-a984-422e-a059-cb06d5f1c982@f9941',
        titleUuid: '170f9c6d-8328-45bb-b8e0-5d9c8f720fb6@f9941',
        subtitleUuid: '86d5dfd9-c694-4e16-b1c0-d65135ec8c2a@f9941',
    },
    [PurchasePropType.ADD_MOVES]: {
        price: PROP_PRICES[3],
        iconUuid: 'f35a89e3-203a-4d6e-af10-13b4ba0afeaf@f9941',
        titleUuid: 'a3cea47d-c4a2-4804-850f-e2c404bf65c5@f9941',
        subtitleUuid: '344cc55c-8087-4bc5-80b7-cd35abf95cec@f9941',
    },
};

@ccclass('PropPurchasePage')
export class PropPurchasePage extends Component {
    @property({ type: [SpriteFrame], tooltip: '标题图片：TNT、锤子、电钻、加步数。显式引用确保发布包包含资源。' })
    public titleFrames: SpriteFrame[] = [];

    @property({ type: [SpriteFrame], tooltip: '说明图片：TNT、锤子、电钻、加步数。' })
    public subtitleFrames: SpriteFrame[] = [];

    private static readonly PREFAB_PATH = 'Other/View/PropPurchasePage';
    private static readonly FALLBACK_PREFAB_PATH = 'Main/Game/View/PropPurchasePage';
    private static _currentNode: Node | null = null;
    private static _opening = false;
    private static _frames = new Map<string, SpriteFrame>();

    private _type = PurchasePropType.HAMMER;
    private _content: Node | null = null;
    private _mask: Node | null = null;
    private _btnCoin: Button | null = null;
    private _btnFree: Button | null = null;
    private _btnClose: Button | null = null;
    private _priceLabel: Label | null = null;
    private _coinLabel: Label | null = null;
    private _btnAddCoin: Button | null = null;
    private _isClosing = false;
    private _isShown = false;
    private _adPlaying = false;

    public static show(type: PurchasePropType, parent: Node): void {
        if (!parent?.isValid || this._opening) return;
        const config = PROP_CONFIGS[type];
        const uuids = [config.iconUuid, config.titleUuid, config.subtitleUuid];
        const cached = resources.get(this.PREFAB_PATH, Prefab)
            || resources.get(this.FALLBACK_PREFAB_PATH, Prefab);
        const display = (prefab: Prefab) => {
            if (!parent.isValid) return;
            let pageNode = this._currentNode?.isValid ? this._currentNode : null;
            if (!pageNode) {
                pageNode = instantiate(prefab);
                pageNode.setParent(parent);
                pageNode.setSiblingIndex(parent.children.length - 1);
                this._currentNode = pageNode;
            }
            (pageNode.getComponent(PropPurchasePage) || pageNode.addComponent(PropPurchasePage)).initialize(type);
        };
        if (cached && uuids.every(uuid => this._frames.has(uuid))) {
            display(cached);
            return;
        }
        this._opening = true;
        LoadingWaiting.acquire(parent, () => {
            if (!parent.isValid) {
                this._opening = false;
                LoadingWaiting.release();
                return;
            }
            const loadPrefab = (path: string) => new Promise<Prefab>((resolve, reject) => {
                resources.load(path, Prefab, (err, prefab) => {
                    if (err || !prefab) reject(err || new Error('Purchase prefab missing'));
                    else resolve(prefab);
                });
            });
            const prefabTask = cached ? Promise.resolve(cached)
                : loadPrefab(this.PREFAB_PATH).catch(() => loadPrefab(this.FALLBACK_PREFAB_PATH));
            const imageTasks = uuids.map(uuid => {
                if (this._frames.has(uuid)) return Promise.resolve();
                return new Promise<void>((resolve, reject) => {
                    assetManager.loadAny({ uuid }, (err: Error | null, frame: SpriteFrame) => {
                        if (err || !(frame instanceof SpriteFrame)) {
                            reject(err || new Error('Purchase image missing'));
                            return;
                        }
                        this._frames.set(uuid, frame);
                        resolve();
                    });
                });
            });
            Promise.all([prefabTask, ...imageTasks]).then(([prefab]) => {
                display(prefab as Prefab);
            }).catch(err => {
                console.warn('[PropPurchasePage] Load failed:', err);
                if (parent.isValid) Remind.showTipRemind('Loading failed. Please try again.');
            }).finally(() => {
                this._opening = false;
                LoadingWaiting.release();
            });
        });
    }
    onLoad(): void {
        GameSDK.inst.logEvent('showPage', { value: 'propPurchasePage' });
        this.resolveNodes();
        this.bindEvents();
        GameData.event.on(GameDataEvent.COIN_CHANGED, this.renderCoin, this);
    }

    onDestroy(): void {
        // Cocos Creator 运行时对可选链调用的转译不稳定，销毁阶段显式判空。
        if (this._mask && this._mask.isValid) {
            this._mask.off(Node.EventType.TOUCH_END, this.onCloseClick, this);
        }
        if (this._btnCoin && this._btnCoin.node && this._btnCoin.node.isValid) {
            this._btnCoin.node.off(Button.EventType.CLICK, this.buyWithCoin, this);
        }
        if (this._btnFree && this._btnFree.node && this._btnFree.node.isValid) {
            this._btnFree.node.off(Button.EventType.CLICK, this.onFreeClick, this);
        }
        if (this._btnClose && this._btnClose.node && this._btnClose.node.isValid) {
            this._btnClose.node.off(Button.EventType.CLICK, this.onCloseClick, this);
        }
        GameData.event.off(GameDataEvent.COIN_CHANGED, this.renderCoin, this);
        if (this._btnAddCoin && this._btnAddCoin.node && this._btnAddCoin.node.isValid) {
            this._btnAddCoin.node.off(Button.EventType.CLICK, this.onAddCoinClick, this);
        }
        if (PropPurchasePage._currentNode === this.node) PropPurchasePage._currentNode = null;
    }

    public initialize(type: PurchasePropType): void {
        this._type = type;
        const config = PROP_CONFIGS[type];
        if (this._priceLabel) this._priceLabel.string = String(config.price);
        this.renderCoin(GameData.instance.totalCoin);
        this.setSprite('InnerSlot/Icon', config.iconUuid, type);
        const frameIndex = [PurchasePropType.TNT, PurchasePropType.HAMMER, PurchasePropType.DRILL, PurchasePropType.ADD_MOVES].indexOf(type);
        this.setSprite('Ribbon/Title', config.titleUuid, type, this.titleFrames[frameIndex]);
        this.setSprite('Subtitle', config.subtitleUuid, type, this.subtitleFrames[frameIndex]);

        if (!this._isShown) {
            this._isShown = true;
            this.playEnterAnimation();
        }
    }

    // ======================================== 入场与退场动画 ========================================
    /** 播放与复活页面一致的遮罩渐入及三段式弹性入场。 */
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
        this._btnCoin = this._content?.getChildByName('BtnCoin')?.getComponent(Button) || null;
        this._btnFree = this._content?.getChildByName('BtnFree')?.getComponent(Button) || null;
        this._btnClose = this._content?.getChildByName('Btn_Close')?.getComponent(Button)
            || this._content?.getChildByName('btnClose')?.getComponent(Button)
            || this.node.getChildByName('Btn_Close')?.getComponent(Button)
            || null;
        this._priceLabel = this._content?.getChildByPath('BtnCoin/lblPrice')?.getComponent(Label) || null;
        // CoinBar 已调整为页面根节点的同级节点，不再从 Content 下查找。
        this._coinLabel = this.node.getChildByPath('CoinBar/numLabel')?.getComponent(Label) || null;
        this._btnAddCoin = this.node.getChildByPath('CoinBar/btnAdd')?.getComponent(Button) || null;
    }

    private bindEvents(): void {
        this._mask?.on(Node.EventType.TOUCH_END, this.onCloseClick, this);
        this._btnCoin?.node.on(Button.EventType.CLICK, this.buyWithCoin, this);
        this._btnFree?.node.on(Button.EventType.CLICK, this.onFreeClick, this);
        this._btnClose?.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this._btnAddCoin?.node.on(Button.EventType.CLICK, this.onAddCoinClick, this);
    }

    private onAddCoinClick(): void {
        if (this._isClosing || this._adPlaying) return;
        Audio.play(AudioId.uiClick);
        AdGetCoinsPage.show(this.node.parent || undefined);
    }

    private setSprite(path: string, uuid: string, expectedType: PurchasePropType, boundFrame?: SpriteFrame): void {
        const sprite = this._content?.getChildByPath(path)?.getComponent(Sprite);
        if (!sprite) return;
        boundFrame = boundFrame || PropPurchasePage._frames.get(uuid);
        if (boundFrame) {
            sprite.spriteFrame = boundFrame;
            return;
        }
        assetManager.loadAny({ uuid }, (error: Error | null, spriteFrame: SpriteFrame) => {
            if (!error && spriteFrame && this.node.isValid && this._type === expectedType) {
                sprite.spriteFrame = spriteFrame;
            }
        });
    }

    private renderCoin(coin: number): void {
        if (this._coinLabel) this._coinLabel.string = String(coin);
    }

    private onCloseClick(): void {
        Audio.play(AudioId.uiClick);
        this.close();
    }

    private buyWithCoin(): void {
        Audio.play(AudioId.uiClick);
        if (this._isClosing) return;
        const price = PROP_CONFIGS[this._type].price;
        if (!GameData.instance.useCoin(price)) {
            Remind.showTipRemind('Not enough coins!');
            return;
        }
        GameData.instance.addProp(this._type, 1);
        Audio.play(AudioId.buy);
        Remind.showTipRemind('+1 Prop!');
        this.close();
    }

    private onFreeClick(): void {
        Audio.play(AudioId.uiClick);
        if (this._isClosing || this._adPlaying) return;
        this._adPlaying = true;

        GameSDK.inst.logEvent('readyStartAD', { value: 'propPurchase' });
        GameSDK.inst.ShowADVideo('propPurchase_' + this._type).then(() => {
            GameSDK.inst.logEvent('realEndAD', { value: 'propPurchase' });
            this.grantFreeProp();
        }).catch(() => {
            // 取消、未看完或播放失败都不发奖，解除锁定以便重新点击。
            this._adPlaying = false;
        });
    }

    /** 看完广告免费获得 1 个当前道具。 */
    private grantFreeProp(): void {
        this._adPlaying = false;
        if (!this.isValid || this._isClosing) return;
        GameData.instance.addProp(this._type, 1);
        Audio.play(AudioId.buy);
        Remind.showTipRemind('+1 Prop!');
        this.close();
    }

    private close(): void {
        if (this._isClosing || !this.node.isValid) return;
        this._isClosing = true;

        if (this._content) {
            tween(this._content)
                .to(0.2, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'backIn' })
                .start();

            const contentOpacity = this._content.getComponent(UIOpacity);
            if (contentOpacity) tween(contentOpacity).to(0.2, { opacity: 0 }).start();
        }

        if (this._mask) {
            const maskOpacity = this._mask.getComponent(UIOpacity);
            if (maskOpacity) tween(maskOpacity).to(0.2, { opacity: 0 }).start();
        }

        this.scheduleOnce(() => {
            if (this.node.isValid) this.node.destroy();
        }, 0.22);
    }
}
