import { _decorator, Color, Component, Node, Button, director, Label, tween, Tween, Vec3, Sprite, SpriteFrame, assetManager, Prefab, instantiate, resources, UITransform, Widget, find } from 'cc';
import { GameScene } from '../Scene/GameScene';
import { GameMain, GameState } from '../Logic/GameMain';
import { LevelManager, LevelBlockData } from '../Logic/LevelManager';
import { PropsManager, PropType } from '../Logic/PropsManager';
import { GameData, GameDataEvent } from '../Config/GameData';
import { Remind } from '../Tools/Remind/Remind';
import { PropPurchasePage, PurchasePropType } from './PropPurchasePage';
import { SpacialMapItemPage } from './SpacialMapItemPage';
import { GameScoreText } from './GameScoreText';
import { SettingPage } from './SettingPage';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { GameSDK } from '../../sdk/GameSDK';

const { ccclass, property } = _decorator;

// ======================================== 游戏主界面控制器 ========================================
/**
 * 游戏主界面 UI 控制器 (GamePage)
 * 负责界面交互控制：
 * - 设置 (btnBack，游戏内打开设置页)
 * - 上一关 (btnPre) / 下一关 (btnNext) 关卡快速切换与重载渲染
 * - 道具栏交互 (btnTnt / btnHammer / btnDrill / btnAddMoves)
 * - 步数实时显示 (showMoves/text)
 * - 道具数量实时监听与动态更新
 * - 道具使用提示条 (Prop_Remind)
 */
@ccclass('GamePage')
export class GamePage extends Component {
    // ======================================== 单例引用 ========================================
    private static _instance: GamePage | null = null;
    public static get instance(): GamePage | null {
        return this._instance;
    }

    // ======================================== 节点挂载引用 ========================================
    @property({ type: Node, tooltip: '设置按钮节点（游戏内打开设置页）', group: { name: '节点引用', id: '0' } })
    public btnBack: Node = null!;

    @property({ type: Node, tooltip: '下一关按钮节点 (btnNext)', group: { name: '节点引用', id: '0' } })
    public btnNext: Node = null!;

    @property({ type: Node, tooltip: '上一关按钮节点 (btnPre)', group: { name: '节点引用', id: '0' } })
    public btnPre: Node = null!;

    @property({ type: Node, tooltip: '道具使用提示条节点 (TopBar/Prop_Remind)', group: { name: '节点引用', id: '0' } })
    public propRemindNode: Node | null = null;

    @property({ type: Node, tooltip: '炸弹按钮节点 (btnTnt)', group: { name: '道具按钮', id: '1' } })
    public btnTnt: Node = null!;

    @property({ type: Node, tooltip: '锤子按钮节点 (btnHammer)', group: { name: '道具按钮', id: '1' } })
    public btnHammer: Node = null!;

    @property({ type: Node, tooltip: '电钻按钮节点 (btnDrill)', group: { name: '道具按钮', id: '1' } })
    public btnDrill: Node = null!;

    @property({ type: Node, tooltip: '加步数按钮节点 (btnAddMoves)', group: { name: '道具按钮', id: '1' } })
    public btnAddMoves: Node = null!;

    @property({ type: Label, tooltip: '步数显示文本组件 (showMoves/text)', group: { name: 'UI文本', id: '2' } })
    public lblMoves: Label | null = null;

    /** 剩余步数小于等于该值时进入警示状态 */
    private static readonly LOW_MOVES_THRESHOLD = 5;
    private static readonly LOW_MOVES_COLOR = new Color(255, 70, 70, 255);
    private _movesNormalColor: Color | null = null;
    private _movesWarning = false;
    private _lastMoves = -1;

    @property({ type: Label, tooltip: '关卡显示文本组件 (TopBar/LevelGroup/lblLevel)', group: { name: 'UI文本', id: '2' } })
    public lblLevel: Label | null = null;

    @property({ type: Label, tooltip: '积分显示文本组件 (TopBar/LevelGroup/lblScore)', group: { name: 'UI文本', id: '2' } })
    public lblScore: Label | null = null;

    @property({ type: Node, tooltip: '连击提示节点 (TopBar/Combo)', group: { name: 'UI文本', id: '2' } })
    public comboNode: Node | null = null;

    @property({ type: Label, tooltip: '连击数文本组件 (TopBar/Combo/text)', group: { name: 'UI文本', id: '2' } })
    public lblCombo: Label | null = null;

    @property({ type: SpriteFrame, tooltip: '炸弹 (TNT) 提示图片 (Prop_Tnt_Remind)', group: { name: '道具提示图', id: '3' } })
    public sfPropTntRemind: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '锤子 (Hammer) 提示图片 (Prop_Hammer_Remind)', group: { name: '道具提示图', id: '3' } })
    public sfPropHammerRemind: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '电钻 (Drill) 提示图片 (Prop_Drill_Remind)', group: { name: '道具提示图', id: '3' } })
    public sfPropDrillRemind: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '炸弹 (TNT) 提示图标 (Prop_Tnt)', group: { name: '道具提示图', id: '3' } })
    public sfPropTntIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '锤子 (Hammer) 提示图标 (Prop_Hammer)', group: { name: '道具提示图', id: '3' } })
    public sfPropHammerIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '电钻 (Drill) 提示图标 (Prop_Drill)', group: { name: '道具提示图', id: '3' } })
    public sfPropDrillIcon: SpriteFrame | null = null;

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameSDK.inst.logEvent('showPage', { value: 'gamePage' });
        GamePage._instance = this;
        this.autoFindNodes();
        this.initButtons();
        this.registerDataEvents();
        PropsManager.onPropActiveChanged = (prop) => {
            this.updatePropSelectUI(prop);
        };
        this.updatePropSelectUI(PropType.NONE);
        this.hideCombo();
        this.preloadScoreFlyPrefab();
    }

    onDestroy() {
        if (PropsManager.onPropActiveChanged) {
            PropsManager.onPropActiveChanged = null;
        }
        this.stopPropRemindLoop();
        if (this.lblMoves?.isValid) Tween.stopAllByTarget(this.lblMoves.node);
        this.unregisterDataEvents();
        this.clearScoreFlies();
        if (GamePage._instance === this) {
            GamePage._instance = null;
        }
    }

    start() {
        this.reserveBannerSpace();
        // 二次保障事件绑定与初始界面数据刷新
        this.initButtons();
        this.updateMovesDisplay();
        this.updateLevelDisplay();
        this.updateScoreDisplay();
        this.updatePropsDisplay();
        this.updatePropSelectUI();
        this.hideCombo();
        SettingPage.applySaved();
    }

    /** 按平台设置道具栏间距与底部广告预留空间。 */
    private reserveBannerSpace(): void {
        const propsRoot = this.node.getChildByName('showProps') || this.node.getChildByPath('Node/showProps');
        const widget = propsRoot?.getComponent(Widget);
        if (!widget?.isAlignBottom || !widget.isAbsoluteBottom) return;
        widget.bottom = 30 + (GameSDK.inst.GetPlatForm() === 1 ? 220 : 160);
        widget.updateAlignment();
    }

    /** 棋盘视口取分数下沿至道具上沿之间，返回屏幕高度的归一化范围。 */
    public getBoardVerticalRange(): { bottom: number; height: number } | null {
        this.reserveBannerSpace();
        this.node.getComponent(Widget)?.updateAlignment();
        const topBar = this.node.getChildByName('TopBar');
        topBar?.getComponent(Widget)?.updateAlignment();
        const score = this.lblScore?.node.getComponent(UITransform);
        const group = topBar?.getChildByName('LevelGroup')?.getComponent(UITransform);
        const props = (this.node.getChildByName('showProps') || this.node.getChildByPath('Node/showProps'))?.getComponent(UITransform);
        const page = this.node.getComponent(UITransform);
        if (!score || !props || !page) return null;
        const pageBounds = page.getBoundingBoxToWorld();
        const scoreBounds = score.getBoundingBoxToWorld();
        const propsBounds = props.getBoundingBoxToWorld();
        const top = Math.min(scoreBounds.yMin, group?.getBoundingBoxToWorld().yMin ?? scoreBounds.yMin);
        const bottom = propsBounds.yMax;
        if (top <= bottom || pageBounds.height <= 0) return null;
        return {
            bottom: Math.max(0, (bottom - pageBounds.yMin) / pageBounds.height),
            height: (top - bottom) / pageBounds.height,
        };
    }

    /** 连击剩余有效时间 (秒) */
    private _comboRemainTime: number = 0;
    /** 顶栏当前已展示的分数 (飞分到达后才累加) */
    private _displayedScore: number = 0;
    /** 飞分预制体缓存 */
    private _scoreFlyPrefab: Prefab | null = null;
    /** 当前仍在飞行的 GameScoreText 节点 */
    private _activeScoreFlies: Node[] = [];

    update(dt: number) {
        if (this._comboRemainTime > 0) {
            this._comboRemainTime -= dt;
            if (this._comboRemainTime <= 0) {
                this._comboRemainTime = 0;
                this.hideCombo(true);
                if (GameMain.instance) {
                    GameMain.instance.resetCombo();
                }
            }
        }
    }

    /**
     * 注册全局数据事件监听
     */
    private registerDataEvents() {
        GameData.event.on(GameDataEvent.PROP_CHANGED, this.onPropDataChanged, this);
    }

    /**
     * 注销全局数据事件监听
     */
    private unregisterDataEvents() {
        GameData.event.off(GameDataEvent.PROP_CHANGED, this.onPropDataChanged, this);
    }

    private onPropDataChanged() {
        this.updatePropsDisplay();
    }

    // ======================================== 节点检索与事件绑定 ========================================
    /**
     * 自动寻找子节点
     */
    private autoFindNodes() {
        if (!this.btnBack) {
            this.btnBack = (this.node.getChildByPath('TopBar/btnBack') ||
                this.node.getChildByPath('Node/btnBack') ||
                this.node.getChildByName('btnBack'))!;
        }
        if (!this.btnNext) {
            this.btnNext = (this.node.getChildByPath('TopBar/DebugNav/btnNext') ||
                this.node.getChildByPath('Node/btnNext') ||
                this.node.getChildByName('btnNext'))!;
        }
        if (!this.btnPre) {
            this.btnPre = (this.node.getChildByPath('TopBar/DebugNav/btnPre') ||
                this.node.getChildByPath('Node/btnPre') ||
                this.node.getChildByName('btnPre'))!;
        }

        // 道具使用提示条 (TopBar/Prop_Remind)
        if (!this.propRemindNode) {
            this.propRemindNode = this.node.getChildByPath('TopBar/Prop_Remind') ||
                this.node.getChildByPath('Node/TopBar/Prop_Remind') ||
                this.node.getChildByName('Prop_Remind');
        }

        // 道具按钮
        const propsRoot = this.node.getChildByName('showProps') || this.node.getChildByPath('Node/showProps');
        if (propsRoot) {
            if (!this.btnTnt) this.btnTnt = propsRoot.getChildByName('btnTnt')!;
            if (!this.btnHammer) this.btnHammer = propsRoot.getChildByName('btnHammer')!;
            if (!this.btnDrill) this.btnDrill = propsRoot.getChildByName('btnDrill')!;
            if (!this.btnAddMoves) this.btnAddMoves = propsRoot.getChildByName('btnAddMoves')!;
        }

        // 步数文本 (TopBar/showMoves/text 或 showMoves/text)
        if (!this.lblMoves) {
            const textNode = this.node.getChildByPath('TopBar/showMoves/text') || this.node.getChildByPath('showMoves/text');
            if (textNode) {
                this.lblMoves = textNode.getComponent(Label);
            }
        }

        // 关卡文本 (TopBar/LevelGroup/lblLevel)
        if (!this.lblLevel) {
            const levelNode = this.node.getChildByPath('TopBar/LevelGroup/lblLevel');
            if (levelNode) {
                this.lblLevel = levelNode.getComponent(Label);
            }
        }

        // 积分文本 (TopBar/LevelGroup/lblScore)
        if (!this.lblScore) {
            const scoreNode = this.node.getChildByPath('TopBar/LevelGroup/lblScore');
            if (scoreNode) {
                this.lblScore = scoreNode.getComponent(Label);
            }
        }

        // 连击提示组件 (TopBar/Combo)
        if (!this.comboNode) {
            this.comboNode = this.node.getChildByPath('TopBar/Combo') ||
                this.node.getChildByPath('Node/TopBar/Combo') ||
                this.node.getChildByName('Combo');
        }
        if (this.comboNode && !this.lblCombo) {
            const textNode = this.comboNode.getChildByName('text');
            if (textNode) {
                this.lblCombo = textNode.getComponent(Label);
            }
        }
    }

    /**
     * 刷新关卡文本展示 (位图字体 numimage1 下 'L' 整体为 LEVEL 图标字样)
     * @param levelId 可选指定关卡ID
     */
    public updateLevelDisplay(levelId?: number) {
        const id = levelId !== undefined ? levelId : (GameMain.instance ? GameMain.instance.currentLevelId : 1);
        if (this.lblLevel) {
            // 项目位图字体 numimage1 中已将 "L" 整体绘制为 "LEVEL " 图标字样 (width=217)
            if (this.lblLevel.font) {
                this.lblLevel.string = `L${id}`;
            } else {
                this.lblLevel.string = `LEVEL ${id}`;
            }
        }
    }

    /**
     * 本关首次出现的特殊元素，弹出说明页；看完前暂停操作。
     */
    public tryShowSpecialMapGuides(blocks: LevelBlockData[]): void {
        const gameScene = GameScene.instance;
        const gameMain = GameMain.instance;
        const parent = gameScene ? gameScene.getTopUIParent() : null;
        if (!parent || !parent.isValid || !gameMain) return;

        const shown = SpacialMapItemPage.showUnseenForLevel(blocks, parent, gameMain.currentLevelId, () => {
            if (gameMain.gameState === GameState.VICTORY || gameMain.gameState === GameState.FAIL) return;
            gameMain.gameState = GameState.PLAYING;
            gameMain.isPlaying = true;
        });
        if (shown) {
            gameMain.gameState = GameState.PAUSE;
            gameMain.isPlaying = false;
        }
    }

    /**
     * 刷新所有道具数量角标展示
     */
    public updatePropsDisplay() {
        this.updateSinglePropBadge(this.btnAddMoves, 'ADD_MOVES');
        this.updateSinglePropBadge(this.btnTnt, 'TNT');
        this.updateSinglePropBadge(this.btnHammer, 'HAMMER');
        this.updateSinglePropBadge(this.btnDrill, 'DRILL');
    }

    /** 道具提示文字图运行时缓存 */
    private _remindSpriteCache: Map<number, SpriteFrame> = new Map();
    /** 道具提示图标运行时缓存 */
    private _remindIconCache: Map<number, SpriteFrame> = new Map();

    /**
     * 获取指定道具对应的提示文字图 SpriteFrame UUID (TNT: 3, HAMMER: 1, DRILL: 2)
     */
    private getPropRemindUuid(propType: number): string | null {
        switch (propType) {
            case 3: // TNT
                return 'ca48534f-fa9e-42e0-8c8d-692871527887@f9941';
            case 1: // HAMMER
                return '1a6a0d0d-6162-4df0-8789-27d4e31ea9fb@f9941';
            case 2: // DRILL
                return 'c691272b-0756-4b7c-a7c3-ce68d42e100f@f9941';
            default:
                return null;
        }
    }

    /**
     * 获取指定道具对应的提示图标 SpriteFrame UUID (TNT: 3, HAMMER: 1, DRILL: 2)
     */
    private getPropIconUuid(propType: number): string | null {
        switch (propType) {
            case 3: // TNT
                return '75c91f44-dd95-4372-9a37-9afa7302b3fa@f9941';
            case 1: // HAMMER
                return '5373d763-6341-402f-8a26-451b3057b52d@f9941';
            case 2: // DRILL
                return 'e9487125-a984-422e-a059-cb06d5f1c982@f9941';
            default:
                return null;
        }
    }

    /**
     * 刷新道具选中高亮状态 (使用/选中对应道具时显示 choose 隐藏 bg；未激活道具显示 bg 隐藏 choose)
     * 同时控制 Prop_Remind 提示条的显隐（不使用道具或使用道具一加步数时必须隐藏，使用道具二/三/四时显示）
     * @param activeType 当前激活的道具类型 (若不传，则自动读取 PropsManager.instance.currentProp)
     */
    public updatePropSelectUI(activeType?: PropType) {
        const current = activeType !== undefined ? activeType : (PropsManager.instance ? PropsManager.instance.currentProp : PropType.NONE);
        this.setPropButtonHighlight(this.btnTnt, current === PropType.TNT);
        this.setPropButtonHighlight(this.btnHammer, current === PropType.HAMMER);
        this.setPropButtonHighlight(this.btnDrill, current === PropType.DRILL);
        this.setPropButtonHighlight(this.btnAddMoves, current === PropType.ADD_MOVES);

        // 道具使用提示条 (Prop_Remind)：不使用道具或使用道具一(加步数)时必须隐藏；仅在激活道具二/三/四时显示
        if (this.propRemindNode && this.propRemindNode.isValid) {
            const isNoneOrAddMoves = (current === PropType.NONE || current === PropType.ADD_MOVES);
            if (isNoneOrAddMoves) {
                this.hidePropRemind();
            } else {
                this.showPropRemind(current);
            }
        }
    }

    /** 显示道具提示条，并播放缩放循环 */
    private showPropRemind(propType: PropType) {
        if (!this.propRemindNode || !this.propRemindNode.isValid) return;
        const wasHidden = !this.propRemindNode.active;
        this.propRemindNode.active = true;
        this.updatePropRemindSprite(propType);
        if (wasHidden) {
            this.playPropRemindLoop();
        }
    }

    /** 隐藏道具提示条，并停掉缩放循环 */
    private hidePropRemind() {
        this.stopPropRemindLoop();
        if (this.propRemindNode && this.propRemindNode.isValid) {
            this.propRemindNode.active = false;
        }
    }

    /** 提示条在 1 与 1.05 之间来回缩放 */
    private playPropRemindLoop() {
        const node = this.propRemindNode;
        if (!node || !node.isValid) return;
        Tween.stopAllByTarget(node);
        node.setScale(new Vec3(1, 1, 1));
        tween(node)
            .to(0.55, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
            .to(0.55, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private stopPropRemindLoop() {
        const node = this.propRemindNode;
        if (!node || !node.isValid) return;
        Tween.stopAllByTarget(node);
        node.setScale(new Vec3(1, 1, 1));
    }

    /**
     * 刷新道具使用提示条：文字图 (Prop_Remind/text) 与图标 (Prop_Remind/icon)
     * @param propType 激活的道具类型
     */
    private updatePropRemindSprite(propType: PropType) {
        if (!this.propRemindNode || !this.propRemindNode.isValid) return;
        this.applyRemindSprite(
            this.propRemindNode.getChildByName('text'),
            this.getRemindTextFrame(propType),
            propType,
            this._remindSpriteCache,
            this.getPropRemindUuid(propType),
        );
        this.applyRemindSprite(
            this.propRemindNode.getChildByName('icon'),
            this.getRemindIconFrame(propType),
            propType,
            this._remindIconCache,
            this.getPropIconUuid(propType),
        );
    }

    /** 编辑器挂载的提示文字图 */
    private getRemindTextFrame(propType: PropType): SpriteFrame | null {
        switch (propType) {
            case PropType.TNT:
                return this.sfPropTntRemind;
            case PropType.HAMMER:
                return this.sfPropHammerRemind;
            case PropType.DRILL:
                return this.sfPropDrillRemind;
            default:
                return null;
        }
    }

    /** 编辑器挂载的提示图标 */
    private getRemindIconFrame(propType: PropType): SpriteFrame | null {
        switch (propType) {
            case PropType.TNT:
                return this.sfPropTntIcon;
            case PropType.HAMMER:
                return this.sfPropHammerIcon;
            case PropType.DRILL:
                return this.sfPropDrillIcon;
            default:
                return null;
        }
    }

    /**
     * 给提示条子节点换图。优先用检查器挂载的 SpriteFrame，否则按 UUID 加载。
     */
    private applyRemindSprite(
        targetNode: Node | null,
        mountedFrame: SpriteFrame | null,
        propType: PropType,
        cache: Map<number, SpriteFrame>,
        uuid: string | null,
    ) {
        if (!targetNode || !targetNode.isValid) return;
        const sprite = targetNode.getComponent(Sprite);
        if (!sprite) return;

        if (mountedFrame) {
            sprite.spriteFrame = mountedFrame;
            return;
        }

        if (cache.has(propType)) {
            sprite.spriteFrame = cache.get(propType)!;
            return;
        }

        if (!uuid) return;

        assetManager.loadAny({ uuid }, (err: Error | null, sp: SpriteFrame) => {
            if (!err && sp && this.node && this.node.isValid) {
                cache.set(propType, sp);
                const current = PropsManager.instance ? PropsManager.instance.currentProp : PropType.NONE;
                if (current === propType && targetNode.isValid && sprite.isValid) {
                    sprite.spriteFrame = sp;
                }
            }
        });
    }



    /**
     * 设置单个道具按钮的选中/默认状态显隐 (choose 与 bg 互斥)
     * @param btnNode 目标道具按钮节点
     * @param isChosen 是否处于选中/使用状态
     */
    private setPropButtonHighlight(btnNode: Node | null, isChosen: boolean) {
        if (!btnNode || !btnNode.isValid) return;

        // 仅在直接子节点中查找 bg 与 choose，避免误触 badge/bg
        const bgNode = btnNode.getChildByName('bg');
        const chooseNode = btnNode.getChildByName('choose');

        if (chooseNode) {
            chooseNode.active = isChosen;
        }
        if (bgNode) {
            bgNode.active = !isChosen;
        }
    }

    /**
     * 短暂闪烁高亮单个道具按钮 (适用于即时生效类道具，如加步数)
     * @param btnNode 目标道具按钮节点
     * @param duration 闪烁持续时间 (秒)
     */
    public flashPropButton(btnNode: Node | null, duration: number = 0.25) {
        if (!btnNode || !btnNode.isValid) return;
        this.setPropButtonHighlight(btnNode, true);
        this.scheduleOnce(() => {
            if (btnNode && btnNode.isValid) {
                const current = PropsManager.instance ? PropsManager.instance.currentProp : PropType.NONE;
                this.updatePropSelectUI(current);
            }
        }, duration);
    }

    private updateSinglePropBadge(btnNode: Node | null, propType: string) {
        if (!btnNode || !btnNode.isValid) return;
        const textNode = btnNode.getChildByPath('badge/text') || btnNode.getChildByName('text');
        if (textNode) {
            const lbl = textNode.getComponent(Label);
            if (lbl) {
                const count = GameData.instance.getPropCount(propType);
                if (count > 0) {
                    lbl.string = `${count}`;
                } else {
                    lbl.string = '+';
                }
            }
        }
    }

    /**
     * 显示连击提示节点并更新连击数字
     * @param comboCount 当前连击数 (>= 1)
     * @param duration 连击有效保持时间 (默认 5.0 秒)
     */
    public showCombo(comboCount: number, duration: number = 5.0) {
        this._comboRemainTime = duration;
        if (!this.comboNode) {
            this.comboNode = this.node.getChildByPath('TopBar/Combo') ||
                this.node.getChildByPath('Node/TopBar/Combo') ||
                this.node.getChildByName('Combo');
            if (this.comboNode && !this.lblCombo) {
                const textNode = this.comboNode.getChildByName('text');
                if (textNode) this.lblCombo = textNode.getComponent(Label);
            }
        }
        if (!this.comboNode || !this.comboNode.isValid) return;

        Tween.stopAllByTarget(this.comboNode);
        this.comboNode.active = true;
        this.comboNode.setScale(new Vec3(1, 1, 1));
        if (this.lblCombo) {
            this.lblCombo.string = `${comboCount}`;
        }
        // 连击微弹跳动画反馈
        tween(this.comboNode)
            .to(0.08, { scale: new Vec3(1.2, 1.2, 1) })
            .to(0.12, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'backOut' })
            .start();
    }

    /**
     * 隐藏连击提示节点
     * @param withAnim 是否带有平滑缩小隐藏动画
     */
    public hideCombo(withAnim: boolean = false) {
        this._comboRemainTime = 0;
        if (!this.comboNode) {
            this.comboNode = this.node.getChildByPath('TopBar/Combo') ||
                this.node.getChildByPath('Node/TopBar/Combo') ||
                this.node.getChildByName('Combo');
        }
        if (!this.comboNode || !this.comboNode.isValid) return;

        Tween.stopAllByTarget(this.comboNode);
        if (withAnim && this.comboNode.active) {
            tween(this.comboNode)
                .to(0.2, { scale: new Vec3(0, 0, 1) }, { easing: 'backIn' })
                .call(() => {
                    if (this.comboNode && this.comboNode.isValid) {
                        this.comboNode.active = false;
                        this.comboNode.setScale(new Vec3(1, 1, 1));
                    }
                })
                .start();
        } else {
            this.comboNode.active = false;
            this.comboNode.setScale(new Vec3(1, 1, 1));
        }
    }

    /**
     * 刷新得分文本展示
     * @param score 可选指定本关分数，未传时默认读取 GameMain.instance.levelScore
     */
    public updateScoreDisplay(score?: number) {
        let currentScore = score;
        if (currentScore === undefined) {
            currentScore = GameMain.instance ? GameMain.instance.levelScore : this._displayedScore;
        }
        this._displayedScore = currentScore !== undefined ? currentScore : 0;
        this.clearScoreFlies();
        this.applyScoreLabel(this._displayedScore);
    }

    /**
     * 飞分到达或即时消除时累加顶栏展示分，并播放轻微弹跳。
     */
    public addDisplayedScore(addScore: number) {
        if (addScore <= 0) return;
        this._displayedScore += addScore;
        this.applyScoreLabel(this._displayedScore);
        this.punchScoreLabel();
    }

    private applyScoreLabel(score: number) {
        if (!this.lblScore) {
            const scoreNode = this.node.getChildByPath('TopBar/LevelGroup/lblScore');
            if (scoreNode) {
                this.lblScore = scoreNode.getComponent(Label);
            }
        }
        if (this.lblScore) {
            this.lblScore.string = `${score}`;
        }
    }

    private punchScoreLabel() {
        if (!this.lblScore || !this.lblScore.node || !this.lblScore.node.isValid) return;
        const scoreNode = this.lblScore.node;
        Tween.stopAllByTarget(scoreNode);
        scoreNode.setScale(new Vec3(1, 1, 1));
        tween(scoreNode)
            .to(0.08, { scale: new Vec3(1.28, 1.28, 1) })
            .to(0.12, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    /**
     * 预加载飞分预制体
     */
    public preloadScoreFlyPrefab() {
        if (this._scoreFlyPrefab) return;
        resources.load('Main/Game/View/GameScoreText', Prefab, (err, prefab) => {
            if (err || !prefab) {
                return;
            }
            this._scoreFlyPrefab = prefab;
        });
    }

    /**
     * 从 3D 世界坐标生成飞分，弧线飞向顶栏 lblScore。
     * 直接实例化 GameScoreText 预制体，不改 Trail 粒子参数。
     */
    public playScoreFly(worldPos: Vec3, addScore: number): boolean {
        if (addScore <= 0 || !this.node || !this.node.isValid) return false;

        const parent = this.getScoreFlyParent();
        if (!parent || !parent.isValid) {
            this.addDisplayedScore(addScore);
            return false;
        }

        const startPos = this.worldToTargetUI(worldPos, parent);
        const endPos = this.getScoreTargetUIPos(parent);
        if (!startPos || !endPos) {
            this.addDisplayedScore(addScore);
            return false;
        }

        const spawn = (prefab: Prefab) => {
            if (!parent.isValid) {
                this.addDisplayedScore(addScore);
                return;
            }
            const flyNode = instantiate(prefab);
            flyNode.layer = parent.layer;
            parent.addChild(flyNode);
            this._activeScoreFlies.push(flyNode);

            const flyer = flyNode.getComponent(GameScoreText) || flyNode.addComponent(GameScoreText);
            flyer.play(startPos, endPos, addScore, () => {
                if (this._activeScoreFlies.indexOf(flyNode) < 0) return;
                this.removeActiveFly(flyNode);
                if (this.node && this.node.isValid) {
                    this.addDisplayedScore(addScore);
                }
            });
        };

        if (this._scoreFlyPrefab) {
            spawn(this._scoreFlyPrefab);
            return true;
        }

        resources.load('Main/Game/View/GameScoreText', Prefab, (err, prefab) => {
            if (err || !prefab) {
                this.addDisplayedScore(addScore);
                return;
            }
            this._scoreFlyPrefab = prefab;
            spawn(prefab);
        });
        return true;
    }

    private getScoreFlyParent(): Node {
        const scene = GameScene.instance;
        if (scene) {
            const topUI = scene.getTopUIParent();
            if (topUI && topUI.isValid) return topUI;
        }
        return find('Canvas') || this.node;
    }

    private removeActiveFly(flyNode: Node) {
        const idx = this._activeScoreFlies.indexOf(flyNode);
        if (idx >= 0) this._activeScoreFlies.splice(idx, 1);
    }

    private clearScoreFlies() {
        if (this._activeScoreFlies.length === 0) return;
        const nodes = this._activeScoreFlies.splice(0, this._activeScoreFlies.length);
        nodes.forEach(node => {
            if (node && node.isValid) node.destroy();
        });
    }

    private worldToTargetUI(worldPos: Vec3, target: Node): Vec3 | null {
        const cam = GameMain.instance ? GameMain.instance.mainCamera : null;
        if (!cam || !target) return null;
        const out = new Vec3();
        if (typeof (cam as any).convertToUINode === 'function') {
            cam.convertToUINode(worldPos, target, out);
            return out;
        }
        cam.worldToScreen(worldPos, out);
        const uiTrans = target.getComponent(UITransform);
        if (!uiTrans) return null;
        uiTrans.convertToNodeSpaceAR(out, out);
        return out;
    }

    private getScoreTargetUIPos(target: Node): Vec3 | null {
        if (!this.lblScore) {
            const scoreNode = this.node.getChildByPath('TopBar/LevelGroup/lblScore');
            if (scoreNode) this.lblScore = scoreNode.getComponent(Label);
        }
        if (!this.lblScore || !this.lblScore.node || !target) return null;
        const uiTrans = target.getComponent(UITransform);
        if (!uiTrans) return null;
        const out = new Vec3();
        uiTrans.convertToNodeSpaceAR(this.lblScore.node.worldPosition, out);
        return out;
    }

    /**
     * 刷新步数文本展示
     * @param steps 可选指定步数，若未传则自动读取 GameMain.instance.remainingSteps
     */
    public updateMovesDisplay(steps?: number) {
        const remaining = steps !== undefined ? steps : (GameMain.instance ? GameMain.instance.remainingSteps : 0);
        if (this.lblMoves) {
            this.lblMoves.string = `${remaining}`;
        }
        this.updateMovesWarning(remaining);
    }

    /** 剩余步数小于等于阈值时文本变红并循环呼吸；刚进入警示时弹一次提示。 */
    private updateMovesWarning(remaining: number) {
        const warn = remaining <= GamePage.LOW_MOVES_THRESHOLD;
        const crossed = warn && remaining > 0 && this._lastMoves > GamePage.LOW_MOVES_THRESHOLD;
        this._lastMoves = remaining;

        const label = this.lblMoves;
        if (!label || !label.isValid) return;
        if (!this._movesNormalColor) this._movesNormalColor = label.color.clone();

        if (warn === this._movesWarning) {
            if (crossed) this.showLowMovesTip(remaining);
            return;
        }
        this._movesWarning = warn;

        const textNode = label.node;
        Tween.stopAllByTarget(textNode);
        textNode.setScale(1, 1, 1);
        if (!warn) {
            label.color = this._movesNormalColor;
            return;
        }

        label.color = GamePage.LOW_MOVES_COLOR;
        tween(textNode)
            .repeatForever(
                tween(textNode)
                    .to(0.45, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'sineInOut' })
                    .to(0.45, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
            )
            .start();
        if (crossed) this.showLowMovesTip(remaining);
    }

    private showLowMovesTip(remaining: number) {
        Remind.showTipRemind(`Only ${remaining} move${remaining > 1 ? 's' : ''} left!`);
    }

    /**
     * 初始化各按钮点击监听
     */
    private initButtons() {
        // 1. 设置（图标是设置，打开游戏内设置页）
        if (this.btnBack) {
            this.btnBack.off(Node.EventType.TOUCH_END, this.onBtnBackClick, this);
            this.btnBack.on(Node.EventType.TOUCH_END, this.onBtnBackClick, this);
        }

        // 2. 下一关
        if (this.btnNext) {
            this.btnNext.off(Node.EventType.TOUCH_END, this.onBtnNextClick, this);
            this.btnNext.on(Node.EventType.TOUCH_END, this.onBtnNextClick, this);
        }

        // 3. 上一关
        if (this.btnPre) {
            this.btnPre.off(Node.EventType.TOUCH_END, this.onBtnPreClick, this);
            this.btnPre.on(Node.EventType.TOUCH_END, this.onBtnPreClick, this);
        }

        // 4. 炸弹 (TNT) 道具按钮
        if (this.btnTnt) {
            this.btnTnt.off(Node.EventType.TOUCH_END, this.onBtnTntClick, this);
            this.btnTnt.on(Node.EventType.TOUCH_END, this.onBtnTntClick, this);
        }

        // 5. 锤子道具按钮
        if (this.btnHammer) {
            this.btnHammer.off(Node.EventType.TOUCH_END, this.onBtnHammerClick, this);
            this.btnHammer.on(Node.EventType.TOUCH_END, this.onBtnHammerClick, this);
        }

        // 6. 电钻道具按钮
        if (this.btnDrill) {
            this.btnDrill.off(Node.EventType.TOUCH_END, this.onBtnDrillClick, this);
            this.btnDrill.on(Node.EventType.TOUCH_END, this.onBtnDrillClick, this);
        }

        // 7. 加步数道具按钮
        if (this.btnAddMoves) {
            this.btnAddMoves.off(Node.EventType.TOUCH_END, this.onBtnAddMovesClick, this);
            this.btnAddMoves.on(Node.EventType.TOUCH_END, this.onBtnAddMovesClick, this);
        }
    }

    /**
     * 通用按钮点击弹性缩放反馈
     */
    private playBtnClickAnim(btnNode: Node | null) {
        Audio.play(AudioId.uiClick);
        if (!btnNode || !btnNode.isValid) return;
        tween(btnNode)
            .to(0.08, { scale: new Vec3(0.9, 0.9, 1) })
            .to(0.08, { scale: new Vec3(1.0, 1.0, 1) })
            .start();
    }

    // ======================================== 道具交互响应 ========================================
    /**
     * 点击炸弹 (TNT) 道具按钮
     */
    public onBtnTntClick() {
        this.playBtnClickAnim(this.btnTnt);
        if (GameData.instance.getPropCount('TNT') <= 0) {
            this.showPropPurchasePage(PurchasePropType.TNT);
            return;
        }
        if (PropsManager.instance) {
            PropsManager.instance.toggleProp(PropType.TNT);
        }
        this.updatePropsDisplay();
        this.updatePropSelectUI();
    }

    /**
     * 点击锤子道具按钮
     */
    public onBtnHammerClick() {
        this.playBtnClickAnim(this.btnHammer);
        if (GameData.instance.getPropCount('HAMMER') <= 0) {
            this.showPropPurchasePage(PurchasePropType.HAMMER);
            return;
        }
        if (PropsManager.instance) {
            PropsManager.instance.toggleProp(PropType.HAMMER);
        }
        this.updatePropsDisplay();
        this.updatePropSelectUI();
    }

    /**
     * 点击电钻道具按钮
     */
    public onBtnDrillClick() {
        this.playBtnClickAnim(this.btnDrill);
        if (GameData.instance.getPropCount('DRILL') <= 0) {
            this.showPropPurchasePage(PurchasePropType.DRILL);
            return;
        }
        if (PropsManager.instance) {
            PropsManager.instance.toggleProp(PropType.DRILL);
        }
        this.updatePropsDisplay();
        this.updatePropSelectUI();
    }

    /**
     * 点击加步数按钮 (+5 步)
     */
    public onBtnAddMovesClick() {
        this.playBtnClickAnim(this.btnAddMoves);

        if (GameData.instance.getPropCount('ADD_MOVES') <= 0) {
            this.showPropPurchasePage(PurchasePropType.ADD_MOVES);
            return;
        }

        let success = false;
        if (PropsManager.instance) {
            success = PropsManager.instance.executeAddMoves(5);
        } else {
            const gameMain = GameMain.instance;
            if (gameMain && gameMain.isPlaying) {
                GameData.instance.useProp('ADD_MOVES');
                gameMain.remainingSteps += 5;
                gameMain.notifyStepsChanged();
                Remind.showTipRemind('+5 Moves Added!');
                success = true;
            }
        }

        // 如果当前处于其他道具激活态，点击加步数时自动取消其他道具
        if (PropsManager.instance && PropsManager.instance.isPropActive) {
            PropsManager.instance.cancelProp();
        }

        // 显式确保【Prop_Remind】节点隐藏
        this.hidePropRemind();

        if (success) {
            this.flashPropButton(this.btnAddMoves, 0.25);
        }
        this.updatePropsDisplay();
    }

    // ======================================== 按钮响应交互逻辑 ========================================
    /** 在顶层 UI 打开指定道具的购买页。 */
    private showPropPurchasePage(type: PurchasePropType) {
        // 数量不足打开购买弹窗时，立即取消道具激活模式、清理准星、隐藏提示条并重置按钮高亮
        if (PropsManager.instance && PropsManager.instance.isPropActive) {
            PropsManager.instance.cancelProp();
        }
        this.hidePropRemind();
        this.updatePropSelectUI(PropType.NONE);

        const gameScene = GameScene.instance || director.getScene()?.getComponentInChildren(GameScene);
        if (!gameScene) {
            return;
        }
        PropPurchasePage.show(type, gameScene.getTopUIParent());
    }

    /**
     * 点击设置按钮，打开游戏内设置（重开 / 回首页）。
     */
    public onBtnBackClick() {
        Audio.play(AudioId.uiClick);
        const gameScene = GameScene.instance || director.getScene()?.getComponentInChildren(GameScene);
        SettingPage.show('game', gameScene?.getTopUIParent());
    }

    /**
     * 点击上一关按钮 (btnPre)
     */
    public onBtnPreClick() {
        Audio.play(AudioId.uiClick);
        if (PropsManager.instance && PropsManager.instance.isPropActive) {
            PropsManager.instance.cancelProp();
        }

        const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
        if (!gameMain) {
            return;
        }

        const currentId = gameMain.currentLevelId;
        const targetId = Math.max(1, currentId - 1);

        if (targetId === currentId) {
            return;
        }

        gameMain.currentLevelId = targetId;
        this.updateLevelDisplay(targetId);
        gameMain.renderLevel(targetId);
    }

    /**
     * 点击下一关按钮 (btnNext)
     */
    public onBtnNextClick() {
        Audio.play(AudioId.uiClick);
        if (PropsManager.instance && PropsManager.instance.isPropActive) {
            PropsManager.instance.cancelProp();
        }

        const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
        if (!gameMain) {
            return;
        }

        const total = LevelManager.instance.totalLevels || 500;
        const currentId = gameMain.currentLevelId;
        const targetId = currentId < total ? currentId + 1 : 1;

        gameMain.currentLevelId = targetId;
        this.updateLevelDisplay(targetId);
        gameMain.renderLevel(targetId);
    }
}
