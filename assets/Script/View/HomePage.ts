import { _decorator, assetManager, Component, Node, Label, Sprite, SpriteFrame, tween, Tween, Vec3 } from 'cc';
import { GameScene } from '../Scene/GameScene';
import { GameMain } from '../Logic/GameMain';
import { GameData, GameDataEvent } from '../Config/GameData';
import { COLLECTION_SCULPTURE_FRAME_UUIDS, homeLandmarkId } from '../Config/CollectionConfig';
import { SpinPage } from './SpinPage';
import { SignPage } from './SignPage';
import { LevelRewardPage } from './LevelRewardPage';
import { SettingPage } from './SettingPage';
import { AdGetCoinsPage } from './AdGetCoinsPage';
import { GameSDK } from '../../sdk/GameSDK';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { NezpOverlayAnchor } from '../nezpFB/nezp_cocos/NezpOverlayAnchor';
import { NezpArbitraryPlayerWidget, ArbitraryPlayerModeEnum } from '../nezpFB/widgets/NezpArbitraryPlayerWidget';

const { ccclass, property } = _decorator;

/** 入口按钮上的叹号，shown 为 null 表示还没同步过显示状态。 */
interface RemindBadge {
    node: Node;
    available: () => boolean;
    shown: boolean | null;
}

@ccclass('HomePage')
export class HomePage extends Component {
    // ======================================== 挂载变量 ========================================
    @property({ type: Node, tooltip: '开始游戏按钮节点', group: { name: '核心节点', id: '0' } })
    public btnStart: Node = null!;

    @property({ type: Node, tooltip: '关卡数文本节点 (btnStart内的label节点)', group: { name: '核心节点', id: '0' } })
    public lblLevel: Node | null = null;

    @property({ type: Node, tooltip: '金币数量文本节点 (CoinBar/numLabel)', group: { name: '顶部功能', id: '1' } })
    public lblCoin: Node | null = null;

    @property({ type: Node, tooltip: '金币加号按钮 (CoinBar/btnAdd)', group: { name: '顶部功能', id: '1' } })
    public btnAddCoin: Node | null = null;

    @property({ type: Node, tooltip: '星星数量文本节点 (StarBar/numLabel)', group: { name: '顶部功能', id: '1' } })
    public lblStar: Node | null = null;

    @property({ type: Node, tooltip: '设置按钮节点', group: { name: '顶部功能', id: '1' } })
    public btnSetting: Node | null = null;

    @property({ type: Node, tooltip: '幸运转盘按钮节点', group: { name: '左侧功能', id: '2' } })
    public btnSpin: Node | null = null;

    @property({ type: Node, tooltip: '邀请好友按钮节点', group: { name: '左侧功能', id: '2' } })
    public btnInvite: Node | null = null;

    @property({ type: Node, tooltip: '每日签到按钮节点', group: { name: '右侧功能', id: '3' } })
    public btnDaily: Node | null = null;

    @property({ type: Node, tooltip: '通关奖励按钮节点', group: { name: '右侧功能', id: '3' } })
    public btnReward: Node | null = null;

    @property({ type: Node, tooltip: '关注主页按钮节点', group: { name: '右侧功能', id: '3' } })
    public btnPage: Node | null = null;

    // ======================================== 内部缓存的 Label 组件 ========================================
    private _labelLevelComp: Label | null = null;
    private _labelCoinComp: Label | null = null;
    private _labelStarComp: Label | null = null;
    private _statueNode: Node | null = null;
    private _statueBaseScale: Vec3 | null = null;
    private _shownLandmarkId: number = 0;
    private _reminds: RemindBadge[] | null = null;
    private static _sculptureFrames: Map<string, SpriteFrame> = new Map();

    // ======================================== 生命周期 ========================================
    start() {
        this.initPlayerAvatar();
        this.initLabels();
        this.initBtnStart();
        this.initFunctionalButtons();
        this.renderAllData();
        this.registerDataEvents();
        SettingPage.applySaved();
    }

    onEnable() {
        GameSDK.inst.logEvent('showPage', { value: 'homePage' });
        this.initLabels();
        this.renderAllData();
        this.registerDataEvents();
        this.schedule(this.refreshReminds, 1);

    }

    onDisable() {
        this.unregisterDataEvents();
        this.unschedule(this.refreshReminds);
        this.resetReminds();
    }

    onDestroy() {
        this.unregisterDataEvents();
    }

    // ======================================== 初始化与事件绑定 ========================================
    /** 用 Nezp Overlay 显示当前 Facebook 玩家的头像。原图片保留为加载失败时的占位图。 */
    private initPlayerAvatar() {
        const fb = (globalThis as any).FBInstant;
        if (!fb?.player?.getID?.() || !fb?.overlayViews) return;

        const avatar = this.node.getChildByPath('TopBar/AvatarGroup/avatarImg');
        if (!avatar) return;

        if (!avatar.getComponent(NezpOverlayAnchor)) {
            avatar.addComponent(NezpOverlayAnchor);
        }
        const widget = avatar.getComponent(NezpArbitraryPlayerWidget)
            || avatar.addComponent(NezpArbitraryPlayerWidget);
        widget.anchorNode = avatar;
        widget.modeEnum = ArbitraryPlayerModeEnum.AVATAR;
        widget.borderRadius = 50;
        widget.playerId = fb.player.getID();
        widget.onCreated = () => {
            const placeholder = avatar.getComponent(Sprite);
            if (placeholder && avatar.isValid && widget.isRendered()) placeholder.enabled = false;
        };
    }

    /**
     * 自动检索并获取文本标签组件
     */
    private initLabels() {
        if (!this.lblCoin) {
            this.lblCoin = this.node.getChildByPath('TopBar/CoinBar/numLabel') || null;
        }
        if (!this.lblStar) {
            this.lblStar = this.node.getChildByPath('TopBar/StarBar/numLabel') || null;
        }
        if (!this.lblLevel && this.btnStart) {
            this.lblLevel = this.btnStart.getChildByName('label') || null;
        }

        this._labelCoinComp = this.lblCoin?.getComponent(Label) || null;
        this._labelStarComp = this.lblStar?.getComponent(Label) || null;
        this._labelLevelComp = this.lblLevel?.getComponent(Label) || null;
    }

    /**
     * 初始化开始按钮点击事件
     */
    private initBtnStart() {
        if (!this.btnStart) {
            return;
        }

        this.btnStart.on(Node.EventType.TOUCH_END, this.onBtnStartClick, this);
    }

    /**
     * 初始化各功能入口按钮点击事件
     */
    private initFunctionalButtons() {
        if (!this.btnAddCoin) {
            this.btnAddCoin = this.node.getChildByPath('TopBar/CoinBar/btnAdd');
        }
        if (this.btnAddCoin) {
            this.btnAddCoin.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                AdGetCoinsPage.show();
            }, this);
        }

        if (this.btnSetting) {
            this.btnSetting.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                SettingPage.show('home');
            }, this);
        }

        if (this.btnSpin) {
            this.btnSpin.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                if (GameScene.instance) {
                    GameScene.instance.initSpinPage();
                } else {
                    SpinPage.show(this.node.parent || this.node);
                }
            }, this);
        }

        if (this.btnInvite) {
            this.btnInvite.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                GameSDK.inst.inviteAsync('', 'invite');
            }, this);
        }

        if (this.btnDaily) {
            this.btnDaily.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                SignPage.show();
            }, this);
        }

        if (this.btnReward) {
            this.btnReward.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                LevelRewardPage.show();
            }, this);
        }

        if (this.btnPage) {
            this.btnPage.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                GameSDK.inst.followPageAsync();
            }, this);
        }
    }

    // ======================================== 数据驱动渲染 ========================================
    /**
     * 刷新并渲染所有数据信息 (金币、星星、当前关卡)
     */
    public renderAllData() {
        this.initLabels();
        const gameData = GameData.instance;
        this.renderCoin(gameData.totalCoin);
        this.renderStar(gameData.totalStar);
        this.renderLevel(gameData.currentLevel);
        this.renderStatue();
        this.refreshReminds();
    }

    // ======================================== 奖励入口叹号 ========================================
    private getReminds(): RemindBadge[] {
        if (this._reminds) return this._reminds;
        const entries: Array<[Node | null, () => boolean]> = [
            [this.btnSpin, () => SpinPage.hasFreeSpin()],
            [this.btnDaily, () => SignPage.canClaimToday()],
            [this.btnReward, () => LevelRewardPage.hasClaimable()],
        ];
        this._reminds = [];
        for (const [btn, available] of entries) {
            const node = btn?.getChildByName('remind');
            if (node) this._reminds.push({ node, available, shown: null });
        }
        return this._reminds;
    }

    /** 有免费转 / 可领奖励时显示叹号并播动画，领完立即隐藏。 */
    private refreshReminds() {
        for (const badge of this.getReminds()) {
            if (!badge.node.isValid) continue;
            const show = badge.available();
            if (badge.shown === show) continue;
            badge.shown = show;
            this.stopRemindAnim(badge.node);
            badge.node.active = show;
            if (show) this.playRemindAnim(badge.node);
        }
    }

    private resetReminds() {
        if (!this._reminds) return;
        for (const badge of this._reminds) {
            badge.shown = null;
            if (badge.node.isValid) this.stopRemindAnim(badge.node);
        }
    }

    /** 弹一下再左右晃，停顿后循环。 */
    private playRemindAnim(node: Node) {
        tween(node)
            .repeatForever(
                tween(node)
                    .to(0.15, { scale: new Vec3(1.3, 1.3, 1) }, { easing: 'sineOut' })
                    .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' })
                    .to(0.07, { angle: 18 })
                    .to(0.1, { angle: -16 })
                    .to(0.1, { angle: 10 })
                    .to(0.08, { angle: -6 })
                    .to(0.06, { angle: 0 })
                    .delay(1.2),
            )
            .start();
    }

    private stopRemindAnim(node: Node) {
        Tween.stopAllByTarget(node);
        node.setScale(1, 1, 1);
        node.angle = 0;
    }

    /**
     * 渲染金币数量
     * @param coin 金币总数
     */
    public renderCoin(coin: number) {
        if (!this._labelCoinComp && this.lblCoin) {
            this._labelCoinComp = this.lblCoin.getComponent(Label);
        }
        if (this._labelCoinComp) {
            this._labelCoinComp.string = String(coin);
        }
    }

    /**
     * 渲染星星数量
     * @param star 星星总数
     */
    public renderStar(star: number) {
        if (!this._labelStarComp && this.lblStar) {
            this._labelStarComp = this.lblStar.getComponent(Label);
        }
        if (this._labelStarComp) {
            this._labelStarComp.string = String(star);
        }
    }

    /**
     * 渲染当前关卡按钮文本
     * @param level 当前关卡数
     */
    public renderLevel(level: number) {
        if (!this._labelLevelComp && this.lblLevel) {
            this._labelLevelComp = this.lblLevel.getComponent(Label);
        }
        if (this._labelLevelComp) {
            this._labelLevelComp.string = this.formatLevelString(level);
        }
    }

    /**
     * 关卡格式化文本：
     * 项目位图字体 numimage1 中已将 "L" 整体绘制为 "LEVEL " 图标字样 (width=217)；
     * 若使用系统字体则回退为完整的 "LEVEL " + level
     */
    private formatLevelString(level: number): string {
        const comp = this._labelLevelComp || this.lblLevel?.getComponent(Label);
        if (comp && (comp.useSystemFont || !comp.font)) {
            return `LEVEL ${level}`;
        }
        return `L${level}`;
    }

    /** 首页中央地标。解锁演出未播完时仍显示上一件，播完后再换上新的。 */
    private renderStatue() {
        const gameData = GameData.instance;
        const reveal = gameData.playLandmarkReveal;
        gameData.playLandmarkReveal = false;
        const landmarkId = homeLandmarkId(gameData.collectionProgress, gameData.pendingCollectionUnlockIds);
        if (!reveal && this._shownLandmarkId === landmarkId) return;
        this._shownLandmarkId = landmarkId;

        const statue = this.getStatueNode();
        if (!statue) return;
        if (!this._statueBaseScale) this._statueBaseScale = statue.scale.clone();

        if (landmarkId <= 1) {
            if (reveal) this.playStatueReveal(statue);
            return;
        }

        const uuid = COLLECTION_SCULPTURE_FRAME_UUIDS[landmarkId - 1];
        if (!uuid) return;
        if (!reveal) statue.active = false;
        this.loadSculptureFrame(uuid, (frame) => {
            if (!this.isValid || this._shownLandmarkId !== landmarkId) return;
            const sprite = statue.getComponent(Sprite);
            if (sprite) sprite.spriteFrame = frame;
            statue.active = true;
            if (reveal) this.playStatueReveal(statue);
        });
    }

    private getStatueNode(): Node | null {
        if (this._statueNode && this._statueNode.isValid) return this._statueNode;
        this._statueNode = this.node.getChildByPath('CenterGroup/statue');
        return this._statueNode;
    }

    private loadSculptureFrame(uuid: string, done: (frame: SpriteFrame) => void) {
        const cached = HomePage._sculptureFrames.get(uuid);
        if (cached) {
            done(cached);
            return;
        }
        assetManager.loadAny({ uuid }, (error, asset) => {
            if (!this.isValid) return;
            if (error || !(asset instanceof SpriteFrame)) {
                return;
            }
            HomePage._sculptureFrames.set(uuid, asset);
            done(asset);
        });
    }

    private playStatueReveal(statue: Node) {
        const base = this._statueBaseScale || statue.scale.clone();
        statue.setScale(base.x * 0.45, base.y * 0.45, base.z);
        tween(statue)
            .to(0.35, { scale: base }, { easing: 'backOut' })
            .call(() => {
                if (!this.isValid) return;
                GameScene.instance?.showTipRemind('New landmark unlocked!');
            })
            .start();
    }

    // ======================================== 全局数据变更事件监听 ========================================
    /**
     * 注册 GameData 全局事件监听
     */
    private registerDataEvents() {
        this.unregisterDataEvents();

        GameData.event.on(GameDataEvent.COIN_CHANGED, this.onCoinChanged, this);
        GameData.event.on(GameDataEvent.STAR_CHANGED, this.onStarChanged, this);
        GameData.event.on(GameDataEvent.LEVEL_CHANGED, this.onLevelChanged, this);
        GameData.event.on(GameDataEvent.REWARD_STATE_CHANGED, this.refreshReminds, this);
    }

    /**
     * 解绑 GameData 全局事件监听
     */
    private unregisterDataEvents() {
        GameData.event.off(GameDataEvent.COIN_CHANGED, this.onCoinChanged, this);
        GameData.event.off(GameDataEvent.STAR_CHANGED, this.onStarChanged, this);
        GameData.event.off(GameDataEvent.LEVEL_CHANGED, this.onLevelChanged, this);
        GameData.event.off(GameDataEvent.REWARD_STATE_CHANGED, this.refreshReminds, this);
    }

    private onCoinChanged(coin: number) {
        this.renderCoin(coin);
    }

    private onStarChanged(star: number) {
        this.renderStar(star);
    }

    private onLevelChanged(level: number) {
        this.renderLevel(level);
    }

    // ======================================== 按钮交互响应 ========================================
    /**
     * 点击 btnStart 响应函数：同步关卡数据并通知 GameScene 启动游戏
     */
    public onBtnStartClick() {
        Audio.play(AudioId.uiClick);
        const targetLevel = GameData.instance.currentLevel;

        // 同步当前关卡至 GameMain
        if (GameMain.instance) {
            GameMain.instance.currentLevelId = targetLevel;
        }

        GameScene.instance?.startGame();
    }
}
