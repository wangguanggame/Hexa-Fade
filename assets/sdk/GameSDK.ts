declare const IGSDK: typeof import('../sdk/index').default;

type PlatFormSDK = import('../sdk/index').PlatFormSDK;
type App = typeof import('../sdk/index').App;
type ShareManager = typeof import('../sdk/index').ShareManager;
type IapManager = typeof import('../sdk/index').IapManager;
import RecommendGame from "./RecommendGame";
import { DEFAULT_SHARE_IMAGE } from './DefaultShareImage';
import { GameData } from '../Script/Config/GameData';
import { Remind } from '../Script/Tools/Remind/Remind';


export class GameSDK {
    private static _inst: GameSDK;
    public static get inst(): GameSDK {
        if (this._inst == null) {
            this._inst = new GameSDK();
        }
        return this._inst;
    }

    private sdk: PlatFormSDK = null;
    private shareManager: ShareManager | null = null;
    private app: App = null;
    private iapManager: IapManager | null = null;
    private saveTask: Promise<void> = Promise.resolve();

    async init() {

        window['FBSDK'] = this.sdk = new IGSDK.PlatFormSDK();
        this.shareManager = IGSDK.ShareManager;
        this.app = IGSDK.App;
        this.iapManager = IGSDK.IapManager;
        // 推荐位暂时停用，避免请求远程 system.json 配置。
        // RecommendGame.getInstance().init();

        await this.sdk.initSDK({
            yeeYooID: 20111143,
            AppName: "Hexa Fade",
            fbAppId: "27708600165480897",
            ADIntervalTime: 60,
            nextADTime: 30,
            bannerAdDelay: 45,
            isTestMeuGame: false,
            GameVersion: "1.0.0",
            iad_organic: ["27708600165480897_27709326088741638"],
            rad_organic: ["27708600165480897_27709327628741484"],
            bannerId_organic: "27708600165480897_27709324452075135",
            iad_paid: ["27708600165480897_27709326088741638"],
            rad_paid: ["27708600165480897_27709327628741484"],
            bannerId_paid: "27708600165480897_27709324452075135",
            adSourceTrackingDays: 15,
        })
    }

    public GetPlatForm(): number {
        if (this.sdk) return this.sdk.getPlatFormiOS() ? 1 : 0;

        // 场景预览或初始化失败时，布局查询仍可读取平台，避免空实例崩溃。
        try {
            const fb = window['FBInstant'];
            return fb?.getPlatform?.() === 'IOS' ? 1 : 0;
        } catch {
            return 0;
        }
    }

    GetGameRecommendJsonData() {
        return "https://jpggf.oss-us-west-1.aliyuncs.com/jpf/file/app/20111143/config/system.json";
    }

    getContextId() {
        return this.sdk.getContextId();
    }

    public async UpSessionScoreAsync(score: number, force = false) {
        console.log("postSessionScoreAsync...");
        await this.sdk.postSessionScoreAsync(score);
    }

    async createTournamentAsync(score: number) {
        try {
            const tourInfo = await this.sdk.getTournamentAsync();
            if (tourInfo && tourInfo.getEndTime() > Date.now() / 1000) {
                await this.sdk.shareTournamentAsync(score);
            }
            else {
                await this.sdk.createTournamentAsync(score, {}, DEFAULT_SHARE_IMAGE);
            }

        } catch (error) {

        }

    }

    async shareTournamentAsync(score: number) {
        try {
            const tourInfo = await this.sdk.getTournamentAsync();
            if (tourInfo && tourInfo.getEndTime() > Date.now() / 1000) {
                await this.sdk.shareTournamentAsync(score);
            }

        } catch (error) {

        }

    }

    public async canFollowPage() {
        let bo = false;
        try {
            bo = await this.sdk.canFollowPage();
        } catch (error) {
        }
        return bo;
    }

    public async followPageAsync() {
        let bo = false;
        try {
            bo = await this.sdk.followPageAsync();
        } catch (error) {
        }
        return bo;
    }

    public async canJoinGroup() {
        let bo = false;
        try {
            bo = await this.sdk.canJoinGroup();
        } catch (error) {
        }
        return bo;
    }

    public async joinGroupAsync() {
        let bo = false;
        try {
            bo = await this.sdk.joinGroupAsync();
        } catch (error) {
        }
        return bo;
    }

    //------------------------------------------------社交----------------------------------------------------

    public async inviteAsync(base64: string, entry: string = "normal", pauload?: object): Promise<boolean> {
        try {
            const fb = window['FBInstant'];
            const image = base64 || DEFAULT_SHARE_IMAGE;
            const text = 'Come play Hexa Fade with me!';
            const data = { ...pauload, entry };
            if (fb) {
                const supported: string[] | null = typeof fb.getSupportedAPIs === 'function'
                    ? fb.getSupportedAPIs() : null;
                const canInvite = typeof fb.inviteAsync === 'function'
                    && (!supported || supported.indexOf('inviteAsync') >= 0);
                if (canInvite) {
                    try {
                        await fb.inviteAsync({ image, text, data });
                        return true;
                    } catch (error) {
                        // 取消邀请不再打开第二个弹窗；仅接口不支持时使用分享兼容流程。
                        if (error?.code !== 'CLIENT_UNSUPPORTED_OPERATION'
                            && error?.code !== 'UNSUPPORTED_OPERATION') throw error;
                    }
                }
                if (typeof fb.shareAsync === 'function'
                    && (!supported || supported.indexOf('shareAsync') >= 0)) {
                    await fb.shareAsync({ intent: 'INVITE', image, text, data });
                    return true;
                }
                console.warn('[GameSDK] Invite APIs unavailable:', supported);
                return false;
            }
            if (!this.sdk) return false;
            return await this.sdk.inviteAsync({ image, text, data });
        } catch (e) {
            console.warn('[GameSDK] inviteAsync failed', e, {
                code: e?.code,
                message: e?.message,
                name: e?.name,
            });
            return false;
        }
    }

    public async ShareImage(base64: string, entry: string = "normal", pauload?: object) {
        return await this.shareManager.ShareImage(entry, DEFAULT_SHARE_IMAGE, pauload);
    }

    public async shareAsync(text: string = ''): Promise<boolean> {
        try {
            if (!this.sdk || !this.sdk.shareAsync) return false;
            const ok = await this.sdk.shareAsync({ img: DEFAULT_SHARE_IMAGE, text, cta: 'PLAY', data: { from: 'setting' } });
            return !!ok;
        } catch (error) {
            console.warn('[GameSDK] shareAsync failed', error);
            return false;
        }
    }

    public async ChallengeGame(playerId: string) {
        let bo = false;
        try {
            bo = await this.sdk.createAsync(playerId);
        } catch (error) {
            console.log("createAsync error", error);
        }

        return bo;
    }

    public async showChoose() {
        let bo = false;
        try {
            bo = await this.sdk.chooseAsync();
            this.shareManager.updateStatues();
        } catch (e) {
        }

        return bo;
    }

    async switchAsync(contextId: string) {

        let bo = false;
        try {
            bo = await this.sdk.switchAsync(contextId) as boolean;
        } catch (error) {
            console.log("switchAsync error", error);
        }
        return bo;
    }

    async switchGameAsync(appid: string, data?: any) {

        let bo = false;
        try {
            bo = await this.sdk.switchGameAsync(appid, data) as boolean;
        } catch (error) {
            console.log("switchAsync error", error);
        }
        return bo;
    }

    //------------------------------------------------广告----------------------------------------------------

    public async ShowADBanner() {
        if (GameData.instance.isRemoveAds) {
            this.HideADBanner();
            return;
        }
        try {
            await this.sdk.ShowBanner();
            // 展示异步完成前可能刚购买去广告，完成后再检查一次。
            if (GameData.instance.isRemoveAds) this.HideADBanner();
        } catch (error) {

        }
    }

    public HideADBanner() {
        try {
            this.sdk?.HideBanner();
        } catch (error) {
        }
    }

    hadIad() {
        return this.sdk.hasIAD();
    }

    hasRad() {
        return this.sdk.hasRAD();
    }

    public async ShowADChaping(entry: string = "normal") {
        // 去广告权益统一在入口拦截，正常完成 Promise 以继续结算或失败流程。
        if (GameData.instance.isRemoveAds) return;
        console.log(`show interstitial ad`);
        try {
            await this.sdk.showIAD(entry);
        } catch (error) {

        }
    }

    public async ShowADVideo(entry: string = "normal"): Promise<void> {
        this.logEvent("watch_ad_entrance", { entrance: entry });
        // 底层 SDK 在广告管理器尚未初始化时可能直接返回成功，不能据此发奖。
        try {
            if (!this.sdk || !this.sdk.hasRAD()) {
                throw new Error('Rewarded video is not ready');
            }
            await this.sdk.showRAD(entry);
        } catch (error) {
            Remind.showTipRemind('There are no ads now.');
            throw error;
        }
    }

    //--------------------------------------------玩家信息---------------------------------------------

    public GetMyID(): string {
        return this.sdk.UserInfo.id;
    }

    public GetMyName(): string {
        return this.sdk.UserInfo.name;
    }

    public GetMyImage(): string {
        return this.sdk.UserInfo.photo;
    }

    public GetMyS3PartUserId(): string {
        return this.sdk.LoginData?.userInfo?.s3partUserId || "";
    }

    public logEvent(name: string, data?: any, valueSum: number = 1) {
        if (!this.sdk) return;
        // 使用 Hexa 当前关卡；结算事件可明确传入本局关卡，避免推进后错记。
        const payload = { ...data, level: data?.level ?? GameData.instance.currentLevel };
        try {
            this.sdk.logEvent(name, payload, valueSum);
        } catch (error) {
            console.warn('[Analytics] Event failed:', name);
        }
    }

    public readData() {
        if (!this.sdk || !this.sdk.FBData) {
            console.warn("readData: FBData 尚未初始化，返回空对象");
            return {};
        }
        let data = this.sdk.FBData.userData || {};
        return data;
    }

    public setData(data) {
        if (!this.sdk || !this.sdk.FBData) {
            console.warn("setData: FBData 尚未初始化，跳过保存");
            return;
        }
        const snapshot = JSON.parse(JSON.stringify(data));
        this.sdk.FBData.userData = snapshot;
        this.saveTask = this.saveTask.then(async () => {
            this.sdk.FBData.userData = snapshot;
            await this.sdk.FBData.RemoteData();
        }).catch((error) => {
            console.warn('[GameSDK] 云存档保存失败:', error);
        });
    }

    //------------------------------------------------排行榜----------------------------------------------------

    async getRank(score: number = 100, pageStart: number = 0, pageSize: number = 50, myRankingSize: number = 0, myOldRankingSize: number = 0) {
        return await this.app.globalLeaderBoard.GetRank(score, pageStart, pageSize, myRankingSize, myOldRankingSize)
    }

    async getRankingData() {
        const board = this.app.globalLeaderBoard;
        const isEmpty = !board.RankInfo || board.RankInfo.length === 0;
        if (!isEmpty) return await board.GetRankingData();

        // 不调用 SDK 的空榜生成器：它会把自己 0 分写入 RankInfo，
        // 下次进入就被误认为服务端成绩。每次以最新星星生成独立展示数据。
        return [{
            userId: this.GetMyID(),
            score: GameData.instance.totalStar,
            ranking: 0,
            isOld: false,
            userInfo: {
                fbUserId: this.GetMyID(),
                userName: this.GetMyName(),
                avatarUrl: this.GetMyImage(),
            },
        }];
    }

    async saveRankingScore(score: number, pageSize: number = 0, myRankingSize: number = 0, myOldRankingSize: number = 0) {
        return await this.app.globalLeaderBoard.SaveScore(score, pageSize, myRankingSize, myOldRankingSize);
    }

    async getMyRankingData() {
        return await this.app.globalLeaderBoard.MyRankingData;
    }

    //------------------------------------------------锦标赛----------------------------------------------------

    /**
     * 
     * @param tournamentName 锦标赛的名字
     * @param pageStart 返回的起始编号
     * @param pageSize 返回多少条数据
     * @param myRankingSize 
     * @param myOldRankingSize 
     * @returns 
     */
    async getTournamentRank(leaderboardKey: string, tournamentKey: string, pageStart: number = 0, pageSize: number = 20, myRankingSize: number = 0, myOldRankingSize: number = 0) {
        return await this.app.tournament.getTournamentRank(leaderboardKey, tournamentKey, pageStart, pageSize, myRankingSize, myOldRankingSize);
    }

    /**
     * 
     * @param rankNum 默认返回几条用户数据
     * @returns 
     */
    async getTournamentList(rankNum: number = 3) {
        return await this.app.tournament.getTournamentList(rankNum);
    }

    getTournamentData() {
        return this.app.tournament.tournamentList;
    }

    /**
     * 
     * @param tournamentName 锦标赛的名字
     * @param score 分数
     * @param pageSize 返回多少条数数据
     * @param myRankingSize 
     * @param myOldRankingSize 
     * @returns 
     */
    async saveTournamentScore(leaderboardKey: string, tournamentKey: string, score: number, pageSize: number = 20, myRankingSize: number = 0, myOldRankingSize: number = 0) {
        return await this.app.tournament.SaveScore(leaderboardKey, tournamentKey, score, pageSize, myRankingSize, myOldRankingSize);
    }


    //------------------------------------------------内购----------------------------------------------------

    isReady(): boolean {
        try {
            return !!(this.iapManager && this.iapManager.getInstance && this.iapManager.getInstance().isReady());
        } catch (e) {
            return false;
        }
    }

    async purchase(productId: string) {
        if (!this.isReady()) {
            return { success: false, message: 'IAP Manager is not ready' };
        }
        return await this.iapManager.getInstance().purchase(productId);
    }

    //------------------------------------------------其他----------------------------------------------------
    //是否是新的一天
    public GetNewDays(): boolean {

        // if (Date.days() != this.sdk.FBData.$userData.loginTime) {
        //     GameUtils.isSign = false;
        //     GameUtils.NumFreeGoldTT = 5;
        //     FBSDK.FBData.$userData.loginTime = Date.days();
        //     FBSDK.FBData.RemoteData();
        return true;
        // }
        return false;
    }

    //------------------------------------------------推荐位----------------------------------------------------
    // 显示推荐游戏
    ShowGameRecomment(parent: any, distance: { left?: number; top?: number; right?: number; bottom?: number }, size?: { width: number, height: number }) {
        RecommendGame.getInstance().ShowGameRecomment(parent, distance, size);
    }

    // 隐藏推荐游戏
    HideGameRecomment() {
        RecommendGame.getInstance().HideGameRecomment();
    }
}
