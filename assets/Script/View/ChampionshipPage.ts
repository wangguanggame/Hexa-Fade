import {
    _decorator, Component, Node, Prefab, instantiate, resources,
    ScrollView, Layout, UIOpacity, Vec3, tween, Color, Sprite, UITransform, BlockInputEvents, Widget
} from 'cc';
import { GameSDK } from '../../sdk/GameSDK';
import { GameScene } from '../Scene/GameScene';
import { LoadingWaiting } from './LoadingWaiting';
import { ChampionshipItem, TournamentItemData, TmExtraData } from './ChampionshipItem';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

const CHAMPIONSHIP_PREFAB_PATH = 'Other/View/ChampionshipPage';
const ITEM_PREFAB_PATH = 'Other/View/ChampionshipItem';

/**
 * 锦标赛主页面控制器 (ChampionshipPage)
 * 对齐 CarMatch_OnLine tournamentPageMgr 架构，支持：
 * 1. 动态拉取平台 SDK 锦标赛列表 (getTournamentList & getTournamentData)
 * 2. 结合 LoadingWaiting 提供流畅的加载等待反馈与超时保护
 * 3. 无比赛时展示空状态
 * 4. 级联入场动效与 ScrollView 自适应排版
 * 5. 支持独立弹出 (ChampionshipPage.show()) 与 TabPage 底栏切换双重模式
 */
@ccclass('ChampionshipPage')
export class ChampionshipPage extends Component {
    // ======================================== 属性挂载 ========================================
    @property({ type: Prefab, tooltip: '锦标赛卡片预制体 (ChampionshipItem)' })
    public itemPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: '滚动视图容器节点 (ScrollView)' })
    public scrollViewNode: Node | null = null;

    @property({ type: Node, tooltip: '卡片挂载容器 (content)' })
    public contentNode: Node | null = null;

    @property({ type: Node, tooltip: '无比赛时的空状态提示节点 (EmptyNode)' })
    public emptyNode: Node | null = null;

    // ======================================== 内部状态 ========================================
    private _loadToken: number = 0;
    private _isLoadingWaitingActive: boolean = false;
    private _loadingTimeoutTimer: any = null;
    private _tournaments: TournamentItemData[] = [];
    private _isHeldByCaller: boolean = false;

    // ======================================== 静态快捷弹出入口 ========================================
    /**
     * 快捷弹出锦标赛界面 (支持任意场景直接打开)
     */
    public static show(parent?: Node): void {
        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            return;
        }

        LoadingWaiting.acquire(targetParent, () => {
            resources.load(CHAMPIONSHIP_PREFAB_PATH, Prefab, (err, prefab) => {
                if (err || !prefab) {
                    LoadingWaiting.release();
                    return;
                }
                if (!targetParent.isValid) {
                    LoadingWaiting.release();
                    return;
                }

                const pageNode = instantiate(prefab);
                const pageComp = pageNode.getComponent(ChampionshipPage) || pageNode.addComponent(ChampionshipPage);
                pageComp.markLoadingHeld();

                // 检查是否已有背景，若无则自动注入半透明黑底遮罩
                pageComp.ensureBackdrop();

                pageNode.setParent(targetParent);
                pageNode.setSiblingIndex(targetParent.children.length - 1);
                LoadingWaiting.raise();
            });
        });
    }

    /** 标识由外部打开时占用了 LoadingWaiting */
    public markLoadingHeld(): void {
        this._isHeldByCaller = true;
    }

    // ======================================== 生命周期 ========================================
    onLoad() {
        this.initNodeReferences();
        this.ensureResources();
        this.bindEvents();
    }

    start() {
        // 页面打开埋点 (对齐 CarMatch_OnLine)
        try {
            GameSDK.inst?.logEvent?.('showPage', { value: 'tournamentPage' });
        } catch (e) {
            // 忽略
        }

        // 加载并渲染锦标赛列表 (内部自动展示 LoadingWaiting 等待遮罩)
        this.refreshTournaments();
    }

    onDisable() {
        this.hideLoadingWaiting();
    }

    onDestroy() {
        this.hideLoadingWaiting();
    }

    // ======================================== 初始化与节点绑定 ========================================
    private initNodeReferences(): void {
        const frameNode = this.node.getChildByName('Frame') || this.node;

        if (!this.scrollViewNode) {
            this.scrollViewNode = frameNode.getChildByName('ScrollView');
        }

        if (this.scrollViewNode && !this.contentNode) {
            const sv = this.scrollViewNode.getComponent(ScrollView);
            if (sv && sv.content) {
                this.contentNode = sv.content;
            } else {
                const view = this.scrollViewNode.getChildByName('view');
                this.contentNode = view ? view.getChildByName('content') : this.scrollViewNode.getChildByName('content');
            }
        }

        if (!this.emptyNode) {
            this.emptyNode = frameNode.getChildByName('EmptyNode') || this.node.getChildByName('EmptyNode');
        }
        if (this.emptyNode) {
            this.emptyNode.active = false;
        }
    }

    /**
     * 为全屏独立模态弹窗提供黑色半透明背景
     */
    public ensureBackdrop(): void {
        let bg = this.node.getChildByName('bg');
        if (!bg) {
            bg = new Node('bg');
            const tf = bg.addComponent(UITransform);
            tf.setContentSize(1080, 1920);

            const sprite = bg.addComponent(Sprite);
            sprite.color = new Color(0, 0, 0, 190);

            bg.addComponent(BlockInputEvents);

            const widget = bg.addComponent(Widget);
            widget.alignFlags = 45;
            widget.updateAlignment();

            bg.setParent(this.node);
            bg.setSiblingIndex(0);

            // 独立弹窗模式下点击背景可关闭
            bg.on(Node.EventType.TOUCH_END, () => {
                Audio.play(AudioId.uiClick);
                this.close();
            }, this);
        }
    }

    private ensureResources(): void {
        if (!this.itemPrefab) {
            resources.load(ITEM_PREFAB_PATH, Prefab, (err, prefab) => {
                if (!err && prefab) {
                    this.itemPrefab = prefab;
                }
            });
        }
    }

    private bindEvents(): void {
    }

    /**
     * 关闭页面
     */
    public close(): void {
        this.hideLoadingWaiting();
        this.node.destroy();
    }

    // ======================================== LoadingWaiting 管理 ========================================
    private showLoadingWaiting(timeoutSec: number = 5.0): void {
        if (this._isLoadingWaitingActive) return;
        this._isLoadingWaitingActive = true;

        const targetParent = GameScene.instance?.getTopUIParent() || this.node;
        if (this._isHeldByCaller) {
            this._isHeldByCaller = false;
            LoadingWaiting.raise();
        } else {
            LoadingWaiting.acquire(targetParent, () => {
                LoadingWaiting.raise();
            });
        }

        if (this._loadingTimeoutTimer) {
            clearTimeout(this._loadingTimeoutTimer);
        }
        this._loadingTimeoutTimer = setTimeout(() => {
            if (this._isLoadingWaitingActive) {
                this.hideLoadingWaiting();
            }
        }, timeoutSec * 1000);
    }

    private hideLoadingWaiting(): void {
        if (this._loadingTimeoutTimer) {
            clearTimeout(this._loadingTimeoutTimer);
            this._loadingTimeoutTimer = null;
        }
        if (!this._isLoadingWaitingActive) return;
        this._isLoadingWaitingActive = false;
        LoadingWaiting.release();
    }

    // ======================================== 核心业务逻辑 ========================================
    /**
     * 刷新锦标赛列表数据 (对齐 CarMatch_OnLine tournamentPageMgr.initData)
     */
    public async refreshTournaments(): Promise<void> {
        const token = ++this._loadToken;
        this.showLoadingWaiting();

        if (this.emptyNode) {
            this.emptyNode.active = false;
        }

        if (this.contentNode) {
            this.contentNode.removeAllChildren();
        }

        let rawTournaments: any[] = [];

        // 1. 调用平台 SDK 获取最新锦标赛列表
        try {
            if (GameSDK.inst?.getTournamentList) {
                await GameSDK.inst.getTournamentList(4);
            }
            if (GameSDK.inst?.getTournamentData) {
                rawTournaments = GameSDK.inst.getTournamentData() || [];
            }
        } catch (err) {
        }

        // 2. 检查页面是否仍然存活
        if (!this.node || !this.node.isValid || this._loadToken !== token) {
            this.hideLoadingWaiting();
            return;
        }

        // 3. 处理并清洗数据
        const validTournaments: TournamentItemData[] = [];
        for (const item of rawTournaments) {
            if (!item || !item.endTime) continue;

            let extra: TmExtraData | null = null;
            if (item.extraData) {
                try {
                    extra = typeof item.extraData === 'string' ? JSON.parse(item.extraData) : item.extraData;
                    item.extraData2 = extra;
                } catch (e) {
                    // 忽略
                }
            }
            validTournaments.push(item);
        }

        // 4. 与 Car Wash 一致，无比赛时展示空状态。
        if (validTournaments.length === 0) {
            this._tournaments = [];
            this.hideLoadingWaiting();
            if (this.emptyNode) {
                this.emptyNode.active = true;
            }
            return;
        }

        if (this.emptyNode) {
            this.emptyNode.active = false;
        }

        // 5. 按结束时间降序排列
        validTournaments.sort((a, b) => b.endTime - a.endTime);
        this._tournaments = validTournaments;

        // 6. 渲染卡片列表
        await this.renderTournamentItems();

        this.hideLoadingWaiting();

        // 7. 播放卡片级联入场动画
        this.playItemsIntroAnimation();
    }

    /**
     * 渲染各卡片
     */
    private async renderTournamentItems(): Promise<void> {
        if (!this.contentNode) return;

        // 确保预制体就绪
        if (!this.itemPrefab) {
            this.itemPrefab = await new Promise<Prefab | null>((resolve) => {
                resources.load(ITEM_PREFAB_PATH, Prefab, (err, prefab) => {
                    resolve(err ? null : prefab);
                });
            });
        }

        if (!this.itemPrefab) {
            return;
        }

        this.contentNode.removeAllChildren();

        for (let i = 0; i < this._tournaments.length; i++) {
            const data = this._tournaments[i];
            const itemNode = instantiate(this.itemPrefab);
            itemNode.setParent(this.contentNode);

            const comp = itemNode.getComponent(ChampionshipItem) || itemNode.addComponent(ChampionshipItem);
            comp.setData(data, i);

            // 初始透明度置为 0，供入场动效平滑过渡
            let op = itemNode.getComponent(UIOpacity);
            if (!op) op = itemNode.addComponent(UIOpacity);
            op.opacity = 0;
        }

        const layout = this.contentNode.getComponent(Layout);
        if (layout) {
            layout.updateLayout();
        }
    }

    /**
     * 播放卡片级联入场动画 (对齐 CarMatch_OnLine playItemsIntro)
     */
    private playItemsIntroAnimation(): void {
        if (!this.contentNode || this.contentNode.children.length === 0) return;

        this.contentNode.children.forEach((child, idx) => {
            const op = child.getComponent(UIOpacity) || child.addComponent(UIOpacity);
            op.opacity = 0;

            const origPos = child.position.clone();
            const fromPos = new Vec3(origPos.x, origPos.y - 50, origPos.z);
            child.setPosition(fromPos);

            const delay = Math.min(idx * 0.08, 0.4);

            tween(op)
                .delay(delay)
                .to(0.25, { opacity: 255 }, { easing: 'quadOut' })
                .start();

            tween(child)
                .delay(delay)
                .to(0.35, { position: origPos }, { easing: 'backOut' })
                .start();
        });
    }

}
