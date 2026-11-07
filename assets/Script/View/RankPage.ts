import { _decorator, Component, Node, Prefab, instantiate, Label, Sprite, SpriteFrame, ScrollView, Layout, UIOpacity, Vec3, tween, resources, assetManager, Texture2D, ImageAsset, UITransform, Color } from 'cc';
import { GameSDK } from '../../sdk/GameSDK';
import { GameData } from '../Config/GameData';
import { LoadingWaiting } from './LoadingWaiting';
import { GameScene } from '../Scene/GameScene';
import { NezpArbitraryPlayerWidget, ArbitraryPlayerModeEnum } from '../nezpFB/widgets/NezpArbitraryPlayerWidget';
import { NezpOverlayAnchor } from '../nezpFB/nezp_cocos/NezpOverlayAnchor';
import { NezpScrollViewMask } from '../nezpFB/nezp_cocos/NezpScrollViewMask';

const { ccclass, property } = _decorator;

/**
 * 玩家排行榜用户信息定义
 */
export interface RankUserInfo {
    avatarUrl?: string;
    fbUserId?: string;
    id?: number;
    userName: string;
    s3partUserId?: string;
}

/**
 * 单条排行榜数据结构定义
 */
export interface RankingItemData {
    userId?: string;
    score: number;
    ranking?: number;
    userInfo: RankUserInfo;
    isOld?: boolean;
}

/**
 * 排行榜主界面管理器 (RankPage)
 * - 前三名在专属领奖台展示 (First / Second / Third)
 * - 不足 3 人时，未达成席位的名字与星星处均显示 " ？"
 * - 第 4 名及以后通过 RankItem 在下方 ScrollView 中滑动展示
 * - 支持接入 SDK 数据与 Nezp 原生头像、昵称 Overlay
 * - 包含打开时的 LoadingWaiting 等待遮罩与超时兜底
 */
@ccclass('RankPage')
export class RankPage extends Component {
    // ======================================== 挂载配置 ========================================
    @property({ type: Prefab, tooltip: '排行榜条目预制体 (RankItem)' })
    public rankItemPrefab: Prefab | null = null;

    @property({ type: SpriteFrame, tooltip: '玩家自己条目的高亮背景图 (Rank_Bg3 亮蓝底)' })
    public selfBgSpriteFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '普通条目的背景图 (Rank_Bg2 紫底)' })
    public normalBgSpriteFrame: SpriteFrame | null = null;

    @property({ type: Node, tooltip: '前三名容器节点 (SpecRankCont)' })
    public specRankCont: Node | null = null;

    @property({ type: Node, tooltip: '列表内容容器节点 (ScrollView/view/content)' })
    public contentNode: Node | null = null;

    @property({ type: ScrollView, tooltip: '滚动视图组件' })
    public scrollView: ScrollView | null = null;

    // ======================================== 内部状态 ========================================
    private _loadToken: number = 0;
    private _isLoadingWaitingActive: boolean = false;
    private _loadingTimeoutTimer: any = null;
    private _nezpWidgets: NezpArbitraryPlayerWidget[] = [];

    // ======================================== 生命周期 ========================================
    onLoad() {
        // 自动检索节点引用（ Inspector 未手动绑定时的可靠兜底）
        this.initNodeReferences();

        // 自动加载预制体与材质资源兜底
        this.ensureResources();
    }

    start() {
        // 开始加载并渲染排行榜数据
        this.refreshRankData();
    }

    onEnable() {
        GameSDK.inst.logEvent('showPage', { value: 'rankPage' });
        this._nezpWidgets.forEach(w => {
            if (w && w.isValid) w.show();
        });
    }

    onDisable() {
        this.hideLoadingWaiting();
        this._nezpWidgets.forEach(w => {
            if (w && w.isValid) w.hide();
        });
    }

    onDestroy() {
        this.hideLoadingWaiting();
        this._nezpWidgets.forEach(w => {
            if (w && w.isValid) w.hide();
        });
        this._nezpWidgets = [];
    }

    // ======================================== 初始化节点与资源 ========================================
    /**
     * 自动初始化组件节点引用
     */
    private initNodeReferences() {
        const frameNode = this.node.getChildByName('Frame') || this.node;

        if (!this.specRankCont) {
            this.specRankCont = frameNode.getChildByName('SpecRankCont');
        }

        const svNode = frameNode.getChildByName('ScrollView');
        if (svNode) {
            if (!this.scrollView) {
                this.scrollView = svNode.getComponent(ScrollView);
            }
            if (!this.contentNode) {
                const viewNode = svNode.getChildByName('view');
                this.contentNode = viewNode ? viewNode.getChildByName('content') : svNode.getChildByName('content');
            }
            const viewNode = svNode.getChildByName('view');
            if (viewNode && !viewNode.getComponent(NezpScrollViewMask)) {
                viewNode.addComponent(NezpScrollViewMask);
            }
        }
    }

    /**
     * 确保预制体与纹理资源已准备好
     */
    private ensureResources() {
        // 1. 若 Inspector 未绑定 RankItem 预制体，从 resources 加载
        if (!this.rankItemPrefab) {
            resources.load('Other/View/RankItem', Prefab, (err, prefab) => {
                if (!err && prefab) {
                    this.rankItemPrefab = prefab;
                }
            });
        }

        // 2. 若未绑定自己高亮背景 (排名bg3)，动态加载兜底
        if (!this.selfBgSpriteFrame) {
            resources.load('Other/View/RankItem', Prefab, (err, prefab) => {
                // 如果需要可以从项目路径载入，或者通过 uuid 引用
            });
        }
    }

    // ======================================== LoadingWaiting 管理 ========================================
    /**
     * 显示加载中遮罩
     */
    private showLoadingWaiting() {
        if (this._isLoadingWaitingActive) return;
        this._isLoadingWaitingActive = true;

        const targetParent = GameScene.instance?.topUI || this.node;
        LoadingWaiting.acquire(targetParent, () => {
            LoadingWaiting.raise();
        });

        // 5 秒统一超时保护，防止网络慢或接口未返回导致界面永远遮挡
        if (this._loadingTimeoutTimer) {
            clearTimeout(this._loadingTimeoutTimer);
        }
        this._loadingTimeoutTimer = setTimeout(() => {
            if (this._isLoadingWaitingActive) {
                this.hideLoadingWaiting();
            }
        }, 5000);
    }

    /**
     * 隐藏加载中遮罩
     */
    private hideLoadingWaiting() {
        if (this._loadingTimeoutTimer) {
            clearTimeout(this._loadingTimeoutTimer);
            this._loadingTimeoutTimer = null;
        }

        // 仅释放排行榜自己持有的等待层，旧页面延迟销毁不能清掉新页面的等待层。
        if (!this._isLoadingWaitingActive) return;
        this._isLoadingWaitingActive = false;
        LoadingWaiting.release();
    }

    // ======================================== 排行榜核心逻辑 ========================================
    /**
     * 刷新并加载排行榜数据
     */
    public async refreshRankData() {
        const loadToken = ++this._loadToken;
        this.showLoadingWaiting();

        try {
            // 打开排行榜直接读取前 50 名，不等待上传。
            if (GameSDK.inst?.getRank) {
                await GameSDK.inst.getRank(100, 0, 50);
            }

            let data: RankingItemData[] = [];
            if (GameSDK.inst?.getRankingData) {
                const sdkData = await GameSDK.inst.getRankingData();
                if (Array.isArray(sdkData)) {
                    data = sdkData;
                }
            }

            // 3. 数据过滤与排序：排除无名字的空项，按分数降序排列
            data = data.filter(item => item && item.userInfo && item.userInfo.userName !== '');
            data.sort((a, b) => (b.score || 0) - (a.score || 0));

            // 空榜沿用 SDK 的当前玩家 0 分兜底，不注入虚构玩家。

            // 检查当前组件状态与 token
            if (!this.isValid || loadToken !== this._loadToken) {
                return;
            }

            // 5. 渲染前三名特殊领奖台
            this.renderTopThree(data);

            // 6. 渲染第 4 名及以后的条目列表
            await this.renderRankList(data);

            // 7. 播放列表入场动效
            this.playItemsIntro();
        } catch (error) {
        } finally {
            // 关闭等待遮罩
            if (loadToken === this._loadToken) this.hideLoadingWaiting();
        }
    }

    // ======================================== 前三名渲染 ========================================
    /**
     * 渲染前三名特殊领奖台区域
     * 规则要求：如果玩家人数不足 3 个人，前 3 的名字显示 " ？"，星星显示也是 " ？ "
     */
    private renderTopThree(data: RankingItemData[]) {
        if (!this.specRankCont) return;

        // 对应关系：索引 0 -> First (第1名), 索引 1 -> Second (第2名), 索引 2 -> Third (第3名)
        const podiums = [
            { nodeName: 'First', rankIdx: 0 },
            { nodeName: 'Second', rankIdx: 1 },
            { nodeName: 'Third', rankIdx: 2 },
        ];

        podiums.forEach(({ nodeName, rankIdx }) => {
            const podiumNode = this.specRankCont!.getChildByName(nodeName);
            if (!podiumNode) return;

            const nameNode = podiumNode.getChildByName('name');
            const starBarNode = podiumNode.getChildByName('StarBar');
            const numLabelNode = starBarNode ? starBarNode.getChildByName('numLabel') : null;
            const avatarGroup = podiumNode.getChildByName('AvatarGroup');
            const avatarImgNode = avatarGroup ? avatarGroup.getChildByName('avatarImg') : null;

            const nameLabel = nameNode ? nameNode.getComponent(Label) : null;
            const starLabel = numLabelNode ? numLabelNode.getComponent(Label) : null;

            const rankItem = data[rankIdx];
            if (rankItem && rankItem.userInfo) {
                // 有玩家数据：展示玩家名字与真实星星数
                if (nameLabel) {
                    nameLabel.string = rankItem.userInfo.userName || 'Player';
                }
                if (starLabel) {
                    starLabel.enableWrapText = false;
                    starLabel.string = `${rankItem.score || 0}`;
                }

                // 绑定 Nezp 头像与昵称
                if (nameNode && avatarImgNode) {
                    this.attachNezpOverlay(nameNode, avatarImgNode, rankItem, nameLabel);
                }

                // 若有图片 url，下载并展示到原生 Sprite
                if (avatarImgNode && rankItem.userInfo.avatarUrl) {
                    this.loadRemoteAvatar(avatarImgNode, rankItem.userInfo.avatarUrl);
                }
            } else {
                // 不足 3 个人：没有人的名字显示 " ？"，星星显示也是 " ？ "
                if (nameLabel) {
                    nameLabel.string = ' ？';
                }
                if (starLabel) {
                    starLabel.enableWrapText = false;
                    starLabel.string = '0';
                }

                // 清理 Nezp 组件，避免显示旧残留
                if (nameNode) {
                    const w = nameNode.getComponent(NezpArbitraryPlayerWidget);
                    if (w) w.hide();
                }
                if (avatarImgNode) {
                    const w = avatarImgNode.getComponent(NezpArbitraryPlayerWidget);
                    if (w) w.hide();
                }
            }
        });
    }

    // ======================================== 第 4 名及以后的列表渲染 ========================================
    /**
     * 渲染第 4 名及以后的列表条目
     */
    private async renderRankList(data: RankingItemData[]) {
        if (!this.contentNode) return;

        // 清空列表中的旧节点
        this.contentNode.removeAllChildren();

        // 确保 Prefab 存在
        let prefab = this.rankItemPrefab;
        if (!prefab) {
            prefab = await this.loadRankItemPrefabAsync();
        }
        if (!prefab) {
            return;
        }

        const myId = GameSDK.inst?.GetMyID ? GameSDK.inst.GetMyID() : '';

        // 从第 4 项开始遍历 (i >= 3)
        for (let i = 3; i < data.length; i++) {
            const itemData = data[i];
            const itemNode = instantiate(prefab);
            itemNode.setParent(this.contentNode);

            this.setupRankItemNode(itemNode, i, itemData, myId);
        }

        // 刷新 Layout 重新排布
        const layout = this.contentNode.getComponent(Layout);
        if (layout) {
            layout.updateLayout();
        }
    }

    /**
     * 配置单个 RankItem 节点
     */
    private setupRankItemNode(itemNode: Node, idx: number, itemData: RankingItemData, myId: string) {
        // 1. 设置排名数字 (RankItem 根节点下的 numLabel)
        const rankNumLabelNode = itemNode.getChildByName('numLabel');
        if (rankNumLabelNode) {
            const rankLabel = rankNumLabelNode.getComponent(Label);
            if (rankLabel) {
                const rankNumber = idx + 1;
                rankLabel.string = rankNumber <= 50 ? `${rankNumber}` : '50+';
            }
        }

        // 2. 设置玩家昵称
        const nameNode = itemNode.getChildByName('name');
        const nameLabel = nameNode ? nameNode.getComponent(Label) : null;
        if (nameLabel) {
            nameLabel.string = itemData.userInfo?.userName || `Player${idx + 1}`;
        }

        // 3. 设置星星分数 (StarBar 下的 numLabel)
        const starBarNode = itemNode.getChildByName('StarBar');
        if (starBarNode) {
            const starNumLabelNode = starBarNode.getChildByName('numLabel');
            if (starNumLabelNode) {
                const starLabel = starNumLabelNode.getComponent(Label);
                if (starLabel) {
                    starLabel.enableWrapText = false;
                    starLabel.string = `${itemData.score || 0}`;
                }
            }
        }

        // 4. 判定是否为玩家自己，高亮蓝底 (排名bg3) 与普通紫底 (排名bg2)
        const isSelf = myId && (myId === itemData.userInfo?.fbUserId || myId === itemData.userInfo?.s3partUserId);
        const itemSprite = itemNode.getComponent(Sprite);
        if (itemSprite) {
            if (isSelf && this.selfBgSpriteFrame) {
                itemSprite.spriteFrame = this.selfBgSpriteFrame;
            } else if (!isSelf && this.normalBgSpriteFrame) {
                itemSprite.spriteFrame = this.normalBgSpriteFrame;
            }
        }

        // 5. 头像与 Nezp 挂载
        const avatarGroup = itemNode.getChildByName('AvatarGroup');
        const avatarImgNode = avatarGroup ? avatarGroup.getChildByName('avatarImg') : null;

        if (nameNode && avatarImgNode) {
            this.attachNezpOverlay(nameNode, avatarImgNode, itemData, nameLabel);
        }

        if (avatarImgNode && itemData.userInfo?.avatarUrl) {
            this.loadRemoteAvatar(avatarImgNode, itemData.userInfo.avatarUrl);
        }
    }

    // ======================================== Nezp SDK 接入与头像名字绑定 ========================================
    /**
     * 对照 CarMatch_OnLine 挂载 NezpArbitraryPlayerWidget 原生头像与昵称
     */
    private attachNezpOverlay(nameNode: Node, avatarNode: Node, itemData: RankingItemData, nameLabel: Label | null) {
        const userId = itemData.userInfo?.s3partUserId || itemData.userInfo?.fbUserId || '';
        if (!userId) return;

        // Overlay 必须挂到 Anchor 的 DOM 容器，且组件创建时就要能找到它。
        if (!avatarNode.getComponent(NezpOverlayAnchor)) avatarNode.addComponent(NezpOverlayAnchor);
        if (!nameNode.getComponent(NezpOverlayAnchor)) nameNode.addComponent(NezpOverlayAnchor);

        // 1. 头像组件
        let avatarWidget = avatarNode.getComponent(NezpArbitraryPlayerWidget);
        if (!avatarWidget) {
            avatarWidget = avatarNode.addComponent(NezpArbitraryPlayerWidget);
            avatarWidget.modeEnum = ArbitraryPlayerModeEnum.AVATAR;
            avatarWidget.borderRadius = 50; // 圆形头像
        }

        // Canvas 装饰无法盖住 DOM 头像，将头像框和领奖台顶部叠在同一 Overlay 中。
        const avatarGroup = avatarNode.parent;
        const frameNode = avatarGroup?.getChildByName('avatarBg');
        const frameUI = frameNode?.getComponent(UITransform);
        avatarWidget.avatarDecorations = [];
        if (frameNode && frameUI) {
            avatarWidget.avatarDecorations.push({
                url: 'frame/Avatar_Frame_Bg.png', width: frameUI.width, height: frameUI.height,
                x: frameNode.position.x - avatarNode.position.x,
                y: frameNode.position.y - avatarNode.position.y,
            });
        }
        const podium = avatarGroup?.parent;
        const podiumImages: Record<string, string> = {
            First: 'Top1_Bg.png', Second: 'Top2_Bg.png', Third: 'Top3_Bg.png',
        };
        const podiumImage = podium && podiumImages[podium.name];
        const podiumBg = podiumImage ? podium?.getChildByName('bg') : null;
        const podiumUI = podiumBg?.getComponent(UITransform);
        const avatarUI = avatarNode.getComponent(UITransform);
        if (podiumImage && podiumBg && podiumUI && avatarGroup && avatarUI) {
            const y = podiumBg.position.y - avatarGroup.position.y - avatarNode.position.y;
            // 只重绘与头像重叠的顶部，避免 HTML 领奖台遮挡 Canvas 名字和星星。
            const clipHeight = Math.max(0, y + podiumUI.height / 2 + avatarUI.height / 2);
            if (clipHeight > 0) avatarWidget.avatarDecorations.push({
                url: `frame/${podiumImage}`, width: podiumUI.width, height: podiumUI.height,
                x: podiumBg.position.x - avatarGroup.position.x - avatarNode.position.x,
                y, clipHeight,
            });
        }

        // 2. 昵称组件
        let nameWidget = nameNode.getComponent(NezpArbitraryPlayerWidget);
        if (!nameWidget) {
            nameWidget = nameNode.addComponent(NezpArbitraryPlayerWidget);
            nameWidget.modeEnum = ArbitraryPlayerModeEnum.NAME;
            nameWidget.fontSize = 18;
            nameWidget.fontColor = '#ffffff';

            // 当 Nezp 昵称成功生成上屏时，清空原生 Canvas 文字避免重合
            nameWidget.onCreated = () => {
                if (nameLabel && nameLabel.isValid) {
                    nameLabel.string = '';
                }
            };
        }

        nameWidget.nameTextAlign = nameLabel?.horizontalAlign === 1 ? 'center'
            : nameLabel?.horizontalAlign === 2 ? 'right' : 'left';
        nameWidget.nameFontSizeCocos = nameLabel?.fontSize || 0;

        if (avatarWidget && this._nezpWidgets.indexOf(avatarWidget) === -1) {
            this._nezpWidgets.push(avatarWidget);
        }
        if (nameWidget && this._nezpWidgets.indexOf(nameWidget) === -1) {
            this._nezpWidgets.push(nameWidget);
        }

        // 延迟一帧设置 ID，确保布局尺寸稳定后再定位
        this.scheduleOnce(() => {
            if (!this.isValid) return;
            if (avatarWidget && avatarWidget.isValid) {
                avatarWidget.setPlayerId(userId);
                avatarWidget.show();
            }
            if (nameWidget && nameWidget.isValid) {
                nameWidget.setPlayerId(userId);
                nameWidget.show();

                if (nameWidget.isRendered() && nameWidget.currentPlayerId === userId) {
                    if (nameLabel && nameLabel.isValid) nameLabel.string = '';
                }
            }
        }, 0);
    }

    /**
     * 远端头像图片下载与原生 Sprite 兜底
     */
    private loadRemoteAvatar(avatarNode: Node, url: string) {
        if (!url || !avatarNode) return;

        assetManager.loadRemote<ImageAsset>(url, { ext: '.png' }, (err, imageAsset) => {
            if (err || !imageAsset || !avatarNode.isValid) return;

            const sprite = avatarNode.getComponent(Sprite);
            if (sprite) {
                const spriteFrame = SpriteFrame.createWithImage(imageAsset);
                // 远端头像通常比预制体头像框大，RAW 模式会把节点改成原图尺寸。
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                sprite.spriteFrame = spriteFrame;
            }
        });
    }

    // ======================================== 动效与工具方法 ========================================
    /**
     * 列表项入场淡入与轻微位移动画 (对齐 CarMatch_OnLine 视觉标准)
     */
    private playItemsIntro() {
        if (!this.contentNode) return;
        const items = this.contentNode.children;
        if (!items || items.length === 0) return;

        items.forEach((item, idx) => {
            let opacityComp = item.getComponent(UIOpacity);
            if (!opacityComp) {
                opacityComp = item.addComponent(UIOpacity);
            }
            opacityComp.opacity = 0;

            const origPos = item.position.clone();
            const fromPos = new Vec3(origPos.x, origPos.y - 40, origPos.z);
            item.setPosition(fromPos);

            const delay = Math.min(idx * 0.04, 0.4);
            tween(opacityComp)
                .delay(delay)
                .to(0.25, { opacity: 255 }, { easing: 'quadOut' })
                .start();

            tween(item)
                .delay(delay)
                .to(0.3, { position: origPos }, { easing: 'cubicOut' })
                .start();
        });
    }

    /**
     * 异步加载 RankItem.prefab
     */
    private loadRankItemPrefabAsync(): Promise<Prefab | null> {
        return new Promise((resolve) => {
            resources.load('Other/View/RankItem', Prefab, (err, prefab) => {
                if (!err && prefab) {
                    this.rankItemPrefab = prefab;
                    resolve(prefab);
                } else {
                    resolve(null);
                }
            });
        });
    }

}
