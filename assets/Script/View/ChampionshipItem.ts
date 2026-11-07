import { _decorator, Component, Node, Label, Sprite, SpriteFrame, Button, tween, Vec3, assetManager } from 'cc';
import { GameSDK } from '../../sdk/GameSDK';
import { GameData } from '../Config/GameData';
import { GameScene } from '../Scene/GameScene';
import { NezpArbitraryPlayerWidget, ArbitraryPlayerModeEnum } from '../nezpFB/widgets/NezpArbitraryPlayerWidget';
import { NezpOverlayAnchor } from '../nezpFB/nezp_cocos/NezpOverlayAnchor';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

/**
 * 锦标赛附加元数据
 */
export interface TmExtraData {
    title?: string;
    contentID?: string;
    tournamentID?: string;
}

/**
 * 玩家信息
 */
export interface TmUserInfo {
    id?: number;
    userName: string;
    avatarUrl?: string;
    fbUserId?: string;
    s3partUserId?: string;
}

/**
 * 锦标赛排名条目
 */
export interface TmRankingItem {
    userId?: string;
    score: number;
    ranking?: number;
    isOld?: boolean;
    userInfo: TmUserInfo;
}

/**
 * 锦标赛卡片数据
 */
export interface TournamentItemData {
    appId?: number;
    category?: string;
    leaderboardKey?: string;
    tournamentKey?: string;
    endTime: number;
    extraData?: string;
    extraData2?: TmExtraData;
    id?: number;
    name?: string;
    sortOrder?: number;
    state?: number;
    userId?: number;
    rankingList?: TmRankingItem[];
    rankingTotal?: number;
}

/**
 * 锦标赛单项卡片组件 (ChampionshipItem)
 * 对齐 CarMatch_OnLine tournamentItemMgr 逻辑：
 * 1. 展示前 3 名玩家昵称、分数与排行奖牌
 * 2. 动态倒计时 (Xxd Xxh 或 Ended)
 * 3. 参与人数展示 (12 Players)
 * 4. 智能判断当前比赛状态并切换 JOIN / PLAY 按钮
 * 5. 点击加入或开始比赛，调用 switchAsync 切换上下文并拉起对局
 */
@ccclass('ChampionshipItem')
export class ChampionshipItem extends Component {
    // ======================================== 属性挂载 ========================================
    @property({ type: Label, tooltip: '倒计时文本 (Countdown)' })
    public timeLabel: Label | null = null;

    @property({ type: Label, tooltip: '玩家人数数值 (PlayerCount)' })
    public playerCountLabel: Label | null = null;

    @property({ type: Node, tooltip: '加入/开始按钮 (BtnShare)' })
    public btnShare: Node | null = null;

    @property({ type: Sprite, tooltip: '按钮文字精灵 (BtnShare/text)' })
    public btnShareText: Sprite | null = null;

    @property({ type: SpriteFrame, tooltip: 'JOIN 按钮图片' })
    public spJoin: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'PLAY 按钮图片' })
    public spPlay: SpriteFrame | null = null;

    @property({ type: [SpriteFrame], tooltip: '前三名奖牌 (Rank_Bg1, Rank_Bg2, Rank_Bg3)' })
    public spRankBgs: SpriteFrame[] = [];

    // ======================================== 内部状态 ========================================
    private _data: TournamentItemData | null = null;
    private _index: number = -1;
    private _isJoined: boolean = false;
    private _isActionPending: boolean = false;
    private _nezpWidgets: NezpArbitraryPlayerWidget[] = [];

    // ======================================== 生命周期 ========================================
    onLoad() {
        this.initNodeReferences();
        this.ensureResources();
        this.bindEvents();
    }

    onDisable() {
        this._nezpWidgets.forEach(w => {
            if (w && w.isValid) w.hide();
        });
    }

    onDestroy() {
        this._nezpWidgets.forEach(w => {
            if (w && w.isValid) w.hide();
        });
        this._nezpWidgets = [];
    }

    // ======================================== 初始化 ========================================
    private initNodeReferences(): void {
        if (!this.timeLabel) {
            const timeNode = this.node.getChildByName('Countdown');
            if (timeNode) this.timeLabel = timeNode.getComponent(Label);
        }

        if (!this.playerCountLabel) {
            const countNode = this.node.getChildByName('PlayerCount');
            if (countNode) this.playerCountLabel = countNode.getComponent(Label);
        }

        if (!this.btnShare) {
            this.btnShare = this.node.getChildByName('BtnShare');
        }

        if (this.btnShare && !this.btnShareText) {
            const textNode = this.btnShare.getChildByName('text');
            if (textNode) this.btnShareText = textNode.getComponent(Sprite);
        }
    }

    /**
     * 自动加载美术精灵帧资源 (JOIN/PLAY 以及前三名奖牌)
     */
    private ensureResources(): void {
        const joinUuid = 'a1beae98-7744-4614-897d-acb83caf94bc@f9941';
        const playUuid = '451deb02-9e34-4459-90fe-b04fd63b88e5@f9941';

        if (!this.spJoin) {
            assetManager.loadAny({ uuid: joinUuid }, (err: any, sf: SpriteFrame) => {
                if (!err && sf && this.isValid) {
                    this.spJoin = sf;
                    this.updateButtonState();
                }
            });
        }

        if (!this.spPlay) {
            assetManager.loadAny({ uuid: playUuid }, (err: any, sf: SpriteFrame) => {
                if (!err && sf && this.isValid) {
                    this.spPlay = sf;
                    this.updateButtonState();
                }
            });
        }

        const rankUuids = [
            'd6e75508-3994-4783-87f8-4a88f7b6e162@f9941',
            'fd315873-8600-4d6a-b172-f27af4951540@f9941',
            '50cc3fc6-c694-4925-84e2-f007a7479201@f9941'
        ];

        if (!this.spRankBgs || this.spRankBgs.length === 0) {
            this.spRankBgs = [];
            rankUuids.forEach((uuid, idx) => {
                assetManager.loadAny({ uuid }, (err: any, sf: SpriteFrame) => {
                    if (!err && sf && this.isValid) {
                        this.spRankBgs[idx] = sf;
                        if (this._data) {
                            this.renderRankRows(this._data.rankingList || []);
                        }
                    }
                });
            });
        }
    }

    private bindEvents(): void {
        if (this.btnShare) {
            this.btnShare.off(Node.EventType.TOUCH_END, this.onBtnClick, this);
            this.btnShare.on(Node.EventType.TOUCH_END, this.onBtnClick, this);
        }
    }

    // ======================================== 数据填充 ========================================
    /**
     * 填充锦标赛卡片数据 (对齐 CarMatch_OnLine)
     */
    public setData(data: TournamentItemData, index: number): void {
        this._data = data;
        this._index = index;
        this.initNodeReferences();

        // 1. 解析 extraData 附加数据
        let extra: TmExtraData | null = data.extraData2 || null;
        if (!extra && data.extraData) {
            try {
                extra = JSON.parse(data.extraData);
                data.extraData2 = extra;
            } catch (e) {
                // 忽略非 JSON 格式
            }
        }

        // 2. 校验是否已在锦标赛 Context 中
        const currentContextId = GameSDK.inst?.getContextId ? GameSDK.inst.getContextId() : '';
        this._isJoined = !!(extra && extra.contentID && currentContextId === extra.contentID);
        this.updateButtonState();

        // 4. 当排行榜为空时，默认将当前玩家展示在榜首 (对齐 CarMatch_OnLine)
        if (!data.rankingList || data.rankingList.length === 0) {
            const myName = GameSDK.inst?.GetMyName ? GameSDK.inst.GetMyName() : 'Me';
            const myId = GameSDK.inst?.GetMyID ? GameSDK.inst.GetMyID() : '0';
            data.rankingList = [
                {
                    userId: myId,
                    // 尚无榜单成绩时，不以普通关卡分数充当锦标赛星星数。
                    score: 0,
                    ranking: 0,
                    userInfo: {
                        userName: myName,
                        fbUserId: myId
                    }
                }
            ];
            if (!data.rankingTotal) {
                data.rankingTotal = 1;
            }
        }

        // 5. 更新玩家总人数
        const total = data.rankingTotal || (data.rankingList ? data.rankingList.length : 1);
        if (this.playerCountLabel) {
            this.playerCountLabel.string = `${total}`;
        }

        // 6. 渲染前三名榜单
        this.renderRankRows(data.rankingList || []);

        // 7. 立即更新一次倒计时文本
        this.updateCountdown();
    }

    /**
     * 渲染前三名排名行
     */
    private renderRankRows(rankings: TmRankingItem[]): void {
        const rowNames = ['Rank1', 'Rank2', 'Rank3'];

        rowNames.forEach((rowName, idx) => {
            const rowNode = this.node.getChildByName(rowName);
            if (!rowNode) return;

            const nameNode = rowNode.getChildByName('PlayerName');
            const scoreNode = rowNode.getChildByName('Score');
            const medalNode = rowNode.getChildByName('Medal');

            const nameLabel = nameNode ? nameNode.getComponent(Label) : null;
            const scoreLabel = scoreNode ? scoreNode.getComponent(Label) : null;
            const medalSprite = medalNode ? medalNode.getComponent(Sprite) : null;

            // Rank_Bg 图片是左侧奖牌，整条排名背景使用预制体中的独立图片。
            if (medalSprite && this.spRankBgs && this.spRankBgs[idx]) {
                medalSprite.spriteFrame = this.spRankBgs[idx];
            }

            const itemData = rankings[idx];
            if (itemData) {
                const uName = itemData.userInfo?.userName || `Player ${idx + 1}`;
                const uScore = itemData.score !== undefined ? itemData.score : 0;

                if (nameLabel) nameLabel.string = uName;
                if (scoreLabel) scoreLabel.string = `${uScore}`;

                // 若处于 Facebook 原生环境，挂载 Nezp 昵称覆盖组件
                const fbUserId = itemData.userInfo?.s3partUserId || itemData.userInfo?.fbUserId;
                if (nameNode && fbUserId) {
                    if (!nameNode.getComponent(NezpOverlayAnchor)) {
                        nameNode.addComponent(NezpOverlayAnchor);
                    }
                    let nezpWidget = nameNode.getComponent(NezpArbitraryPlayerWidget);
                    if (!nezpWidget) {
                        nezpWidget = nameNode.addComponent(NezpArbitraryPlayerWidget);
                        nezpWidget.modeEnum = ArbitraryPlayerModeEnum.NAME;
                        nezpWidget.fontSize = 18;
                        nezpWidget.fontColor = '#ffffff';
                        nezpWidget.onCreated = () => {
                            if (nameLabel && nameLabel.isValid) nameLabel.string = '';
                        };
                        this._nezpWidgets.push(nezpWidget);
                    }
                    nezpWidget.anchorNode = nameNode;
                    nezpWidget.nameFontSizeCocos = nameLabel?.fontSize || 28;
                    nezpWidget.nameOutlineWidthCocos = 2;
                    nezpWidget.nameOffsetYCocos = 4;
                    nezpWidget.nameTextAlign = nameLabel?.horizontalAlign === 1 ? 'center'
                        : nameLabel?.horizontalAlign === 2 ? 'right' : 'left';
                    if (nameLabel) {
                        const color = nameLabel.color;
                        nezpWidget.fontColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
                    }
                    this.scheduleOnce(() => {
                        if (!this.isValid) return;
                        if (nezpWidget && nezpWidget.isValid) {
                            nezpWidget.setPlayerId(fbUserId);
                            nezpWidget.show();
                            if (nezpWidget.isRendered() && nezpWidget.currentPlayerId === fbUserId && nameLabel) {
                                nameLabel.string = '';
                            }
                        }
                    }, 0);
                }
            } else {
                // 空位兜底展示
                if (nameLabel) nameLabel.string = '---';
                if (scoreLabel) scoreLabel.string = '0';
            }
        });
    }

    /**
     * 刷新按钮文案与图片
     */
    private updateButtonState(): void {
        if (!this.btnShareText) return;

        if (this._isJoined) {
            if (this.spPlay) {
                this.btnShareText.spriteFrame = this.spPlay;
            }
        } else {
            if (this.spJoin) {
                this.btnShareText.spriteFrame = this.spJoin;
            }
        }
    }

    /**
     * 点击参与或开始锦标赛 (对齐 CarMatch_OnLine onTapPlay)
     */
    public async onBtnClick(): Promise<void> {
        Audio.play(AudioId.uiClick);
        if (this._isActionPending || !this._data) return;
        this._isActionPending = true;

        // 按钮轻微缩放点击反馈 (基于原有缩放比例)
        if (this.btnShare) {
            const origScale = this.btnShare.scale.clone();
            tween(this.btnShare)
                .to(0.08, { scale: new Vec3(origScale.x * 0.92, origScale.y * 0.92, origScale.z) })
                .to(0.08, { scale: origScale })
                .start();
        }


        try {
            const data = this._data;
            const contextId = data.extraData2?.contentID;
            const scene = GameScene.instance;
            if (!contextId || !data.leaderboardKey || !data.tournamentKey || !scene) return;

            // SDK 用 false 表示切换失败，不能仅以 Promise 完成判断成功。
            const switched = await GameSDK.inst.switchAsync(contextId);
            if (!switched || !this.isValid || this._data !== data) return;

            GameData.instance.currentTournament = data;
            GameData.instance.isJoinTournament = true;
            this._isJoined = true;
            this.updateButtonState();
            scene.startGame();
        } catch (err) {
        } finally {
            this._isActionPending = false;
        }
    }

    // ======================================== 实时倒计时 ========================================
    update(deltaTime: number) {
        this.updateCountdown();
    }

    /**
     * 刷新倒计时展示 (对齐 CarMatch_OnLine)
     */
    private updateCountdown(): void {
        if (!this.timeLabel || !this._data || !this._data.endTime) return;

        const nowSec = Math.floor(Date.now() / 1000);
        const endSec = Math.floor(this._data.endTime / 1000);
        const diff = endSec - nowSec;

        if (diff > 0) {
            const day = Math.floor(diff / 86400);
            const h = Math.floor((diff % 86400) / 3600);
            const m = Math.floor((diff % 3600) / 60);

            let str = '';
            if (day > 0) {
                str = `${day}d ${h}h`;
            } else if (h > 0) {
                str = `${h}h ${m}m`;
            } else {
                str = `${m}m`;
            }
            this.timeLabel.string = str;
        } else {
            this.timeLabel.string = 'Ended';
        }
    }
}
