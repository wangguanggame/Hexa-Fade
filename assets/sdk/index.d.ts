/**
 * LoadData.ts
 * - 与 FBInstant 云存储同步（key = "user_data1"）
 * - 本地镜像 key = `local_user_data_1${playerId}`
 * - 本地与远端按 timestamp 合并；并发“单航班”保证
 */
type UserDataShape = {
    FBData?: any;
    AvatarMD5?: string;
    timestamp?: number;
    add_hs?: number;
    initEntry?: string;
    loginTime?: number;
    add_hs_refuse_count?: number;
    login_days?: number;
    isConsole?: boolean;
    last_login_dayth?: number;
    last_Reward_dayth?: number;
    login_day_count?: number;
    /** 广告来源追踪信息 */
    ad_source_info?: {
        /** 用户类型：ad=买量 | organic=自然 */
        type: "ad" | "organic";
        /** 首次广告入口的时间戳 */
        firstAdEntryTime: number;
        /** 实际广告组索引：0=自然池，>=1=买量池对应组（rawAdIndex+1） */
        adIndex?: number;
        /** 广告来源存档版本：2=修复 adIndex 缺失误归 AD1 后的版本 */
        sourceVersion?: number;
        /** 本次判定的原因标记，便于复盘归因 */
        sourceReason?: string;
    };
};
declare class LoadData {
    $userData: UserDataShape | null;
    private _isDateReady;
    private _isFetching;
    private _inflight?;
    constructor();
    get userData(): any;
    set userData(data: any);
    getPlayerId(): any;
    fetchData(): Promise<void>;
    private safeParse;
    initUserDate(): Promise<void>;
    /**
     * 提交到远端 & 本地镜像
     * @param flush 远端是否立即 flush（成本高，谨慎用）
     */
    RemoteData(flush?: boolean): Promise<void>;
    /** 清空并提交一个空对象 */
    cr(): Promise<void>;
    /** 读取远端/本地数据 */
    getData(keys: string[]): Promise<any>;
    /** 写远端/本地 */
    setData(data: {
        [key: string]: any;
    }, flush?: boolean): Promise<void>;
}

declare class Emiter {
    static CONST: {
        break: {};
    };
    private maps;
    private uid;
    private add;
    on(name: any, handler: any, thisObject?: any, priority?: any): number;
    once(name: any, handler: any, thisObject?: any, priority?: any): number;
    private _duringEmit;
    rm(id: any, name?: any): boolean;
    rmall(name?: any): void;
    emit(name: any, data?: any): boolean;
}

interface EntryOption {
    entry?: string;
    switchGameInfo?: string;
    [key: string]: any;
}
interface initData {
    yeeYooID: number;
    AppName: string;
    fbAppId: string;
    ADIntervalTime: number;
    nextADTime: number;
    bannerAdDelay: number;
    isTestMeuGame: boolean;
    GameVersion: string;
    /** 自然用户 - 插屏广告 ID */
    iad_organic?: string[];
    /** 自然用户 - 激励视频广告 ID */
    rad_organic?: string[];
    /** 自然用户 - Banner 广告 ID（单个或多个用于轮播） */
    bannerId_organic?: string | string[];
    /** 买量用户 - 插屏广告 ID */
    iad_paid?: string[];
    /** 买量用户 - 激励视频广告 ID */
    rad_paid?: string[];
    /** 买量用户 - Banner 广告 ID（单个或多个用于轮播） */
    bannerId_paid?: string | string[];
    /** 买量用户追踪天数，默认 15 天 */
    adSourceTrackingDays?: number;
}
declare class PlatFormSDK extends Emiter {
    private FriendsInfo;
    private UserInfo1;
    iadWatchCount: number;
    radWatchCount: number;
    contextEntry: string;
    countryCode: string;
    countryName: string;
    countryChName: string;
    playerType: string;
    isNewPlayer: boolean;
    FBData: LoadData;
    private _canAdd2HomeScreen;
    private isBanner;
    private LoadInterstitialAD;
    private CreateInterstitialAD;
    private PreloadedChaPing;
    private rad;
    private iad;
    private rewardInterstitialad;
    LoginData: any;
    _canJoinGroup: boolean;
    isInitAD: boolean;
    isLoginTD: boolean;
    isAddFriends: boolean;
    isLoginSuccess: boolean;
    isUpEventShareReturn: boolean;
    FBSDK: any;
    entryOption: EntryOption;
    private isAdConfigReady;
    private bannerAdIndex;
    private hasStartedMetaAdAttributionReport;
    yeeYooID: number;
    AppName: string;
    fbAppId: string;
    iadNumber: string[];
    radNumber: string[];
    /** 内部统一为数组，供 Banner 轮播使用 */
    bannerId: string[];
    ADIntervalTime: number;
    nextADTime: number;
    bannerAdDelay: number;
    isTestMeuGame: boolean;
    GameVersion: string;
    private iadNumber_paid;
    private iadNumber_organic;
    private radNumber_paid;
    private radNumber_organic;
    private bannerId_paid;
    private bannerId_organic;
    private adSourceTrackingDays;
    private adSourceInfoVersion;
    private adSourceCleanLegacyAd1;
    private adSourceLegacyAd1CleanupBefore;
    initSDK(initData: initData): Promise<void>;
    loginGame(): Promise<void>;
    startGameAsync(): Promise<void>;
    private reportMetaAdAttributionLaunch;
    startGame(): Promise<void>;
    hashShortId(id: string): string;
    reverseString(str: string): string;
    initAD(): void;
    loginTD(): void;
    getUserInfoAsync(): Promise<void>;
    get UserInfo(): {
        name: string;
        id: string;
        photo: string;
        friends: any[];
        asd: string;
        lang: string;
    };
    getEntryPoint(): Promise<void>;
    getEntryPointAsync(): Promise<void>;
    upEventShare(): Promise<void>;
    setLoading(progress: number): void;
    setSessionScore(): void;
    getPlatFormiOS(): boolean;
    GetFrinedsInfo(): FBInstant.ConnectedPlayer[];
    canFollowPage(): Promise<boolean>;
    followPageAsync(): Promise<boolean>;
    canJoinGroup(): Promise<boolean>;
    joinGroupAsync(): Promise<boolean>;
    checkMatchPlayer(): Promise<boolean>;
    MatchPlayer(): Promise<boolean>;
    interval: number;
    isShowBanner: boolean;
    get _isShowBanner(): boolean;
    ShowBanner(): Promise<boolean>;
    loadBanner(): Promise<void>;
    HideBanner(): boolean;
    nextAdBannerTime: number;
    ShowBannerAd(): Promise<true | void>;
    hideBannerAd(): boolean;
    hasRAD(): boolean;
    showRAD(entry?: string): Promise<void>;
    hasIAD(entry?: string): boolean;
    showIAD(entry?: string): Promise<void>;
    hasRIAD(entry?: string): boolean | Promise<void>;
    showRIAD(): Promise<void>;
    isInterstitialAD(): boolean;
    getTournamentAsync(): Promise<FBInstant.tournamentInfo>;
    createTournamentAsync(score: number, payload?: any, image?: string, title?: string): Promise<boolean>;
    shareTournamentAsync(score: number, payload?: {}): Promise<boolean>;
    postSessionScoreAsync(score: number): Promise<boolean>;
    getContextId(): string;
    getPlayerId(): string;
    getLocale(): string;
    switchAsync(contextId: string): Promise<boolean | void>;
    chooseAsync(): Promise<boolean>;
    createAsync(userId: string): Promise<boolean>;
    switchGameAsync(appId: string, data?: any): Promise<boolean>;
    inviteAsync(opt?: {
        image?: any;
        text?: string;
        data?: any;
    }): Promise<boolean>;
    shareAsync(opt?: {
        img?: string;
        text?: string;
        cta?: string;
        data?: any;
    }): Promise<boolean>;
    updateStatues(data: any, option: any & {
        image: string;
    }): Promise<void>;
    canAdd2HomeScreen(): Promise<boolean>;
    add2HomeScreen(): Promise<{
        res: boolean;
        code: any;
    }>;
    addShortcut(): Promise<void>;
    checkHomeScene(): Promise<boolean>;
    checkBotSubscribe(): Promise<boolean>;
    logEvent(name: string, data?: any, valueSum?: number): boolean;
    /**
     * 把 string | string[] | null 统一规整为 string[]（过滤空串）。
     * banner 配置允许单个或多个 ID，内部统一按数组轮播。
     */
    private normalizeAdIds;
    /**
     * 检查广告ID是否有效
     */
    private isValidAdId;
    private getFirstValidAdId;
    private getAdIdByIndex;
    private getPaidAdGroupCount;
    private getEntryRawAdIndex;
    private hasEntryAdIndex;
    private isValidEntryAdIndex;
    private parseEntryAdGroupIndex;
    private normalizeSavedAdGroupIndex;
    private getAdIdByGroupIndex;
    private normalizeEntryValue;
    private isAdEntryValue;
    private getCurrentAdSignalReason;
    /**
     * 判断本次启动是否来自广告入口。
     * 唯一可信信号是 FB 入口下发的合法 adIndex。
     */
    private isCurrentAdEntry;
    private isLegacySuspectAd1Info;
    private saveAdSourceInfo;
    private logAdSourceDecision;
    /**
     * 判断用户广告来源类型
     * @returns "ad" 买量用户 | "organic" 自然用户
     */
    private determineAdSourceType;
    /**
     * 根据用户类型应用广告配置：按 adGroupIndex 从对应池里选单个 placement ID。
     */
    private applyAdConfigByUserType;
    private waitAdConfigReady;
    private getNextBannerAdId;
    onAddEventListener(): boolean;
}

/**
 * 所有单例的基类，做了单例的基础检查。所有子类最好都写一个getInstance的静态方法来获取
 * @author sodaChen
 * Date:2012-10-29
 */
declare class Singleton {
    /** 存放初始化过的构造函数,这里用数组来存放构造函数 **/
    private static classKeys;
    private static classValues;
    constructor();
    private static instance;
    /**
     * 获取实例的静态方法实例
     * @return
     *
     */
    static getInstance<T extends {}>(this: new () => T): T;
    /**
     * 销毁方法。事实上单例是很少进行销毁的
     */
    destroy(o?: any): void;
    /**
     * 子类重写的方法
     */
    protected onDestroy(): void;
    /**
     * 删除单例的实例（不对单例本身做任何的销毁，只是删除他的引用）
     * @param clazz 单例的Class对象
     *
     */
    static removeInstance(clazz: Function): void;
    /**
     * 是否存放有这个构造函数
     * @param clazz 构造函数
     * @return {boolean}
     */
    static getFunValue(clazz: Function): any;
    /**
     * 获取单例类，若不存在则创建.所有的单例创建的时候，都必须使用这个方法来创建，这样可以做到统一管理单例
     * @param clazz 任意需要实现单例效果的类
     * @return
     *
     */
    static getInstanceOrCreate(clazz: any): any;
}

interface LoginInfo {
    faceCount: number;
    countryCode: string;
    loginToken: string;
    shareAppInfos: any[];
    userInfo: {
        avatarUrl: string;
        fbUserId: string;
        id: number;
        s3partUserId: string;
        userName: string;
    };
    clientApiConfig: {
        chechAccountSeconds: number;
        uploadAvatarEnable: number;
    };
}
declare class UserLogin extends Singleton {
    LoginData: LoginInfo;
    isLogin: boolean;
    constructor();
    Login(appId: number, fbAppId: string, fbUserId: string, fbUserAsid: string, userName: string, avatarUrl: string): Promise<void>;
    getFriendsList(): Promise<any>;
    get isFace(): number;
    set isFace(num: number);
}

declare class GlobalLeaderBoard extends Singleton {
    leaderboardKey: string;
    nowRankInfo: rankingList[];
    myOldRanking: rankingData;
    myRanking: rankingData;
    nowIndex: number;
    lastIndex: number;
    NowRankInfo: rankingList;
    oldRankInfo: rankingList;
    isResult: boolean;
    RankInfo: rankingList[];
    MyRankingData: rankingList;
    constructor();
    SaveScore(score: number, pageSize?: number, myRankingSize?: number, myOldRankingSize?: number): Promise<void>;
    GetRankResult(): Promise<void>;
    GetMyRankiData(): Promise<void>;
    GetRankingData(): Promise<rankingList[]>;
    GetRank(score?: number, pageStart?: number, pageSize?: number, myRankingSize?: number, myOldRankingSize?: number): Promise<void>;
    leaderboardGetRanking(): {
        leaderboardInfo: {
            appId: number;
            id: number;
            name: string;
            state: number;
            type: string;
            myRanking: {
                score: number;
                ranking: number;
            };
            myOldRanking: {
                score: number;
                ranking: number;
            };
            rankingPage: {
                pageList: {
                    userId: string;
                    score: number;
                    ranking: number;
                    userInfo: {
                        id: number;
                        avatarUrl: string;
                        userName: string;
                        fbUserId: string;
                    };
                }[];
                pageInfo: {
                    pageStart: number;
                    pageSize: number;
                    pageTotal: any;
                    pageStamp: any;
                    pageNumber: number;
                };
            };
        };
    };
    deWeight(arr4: any, isUser?: boolean): any;
    deWeight2(arr4: any): any;
}

declare class Tournament extends Singleton {
    tournamentList: touranmentList[];
    nowRankInfo: rankingList[];
    myOldRanking: rankingData;
    myRanking: rankingData;
    nowIndex: number;
    lastIndex: number;
    NowRankInfo: rankingList;
    oldRankInfo: rankingList;
    isResult: boolean;
    RankInfo: rankingList[];
    MyRankingData: rankingList;
    constructor();
    GetRankResult(): Promise<void>;
    GetMyRankiData(): Promise<void>;
    GetRankingData(): Promise<rankingList[]>;
    SaveScore(leaderboardKey: string, tournamentKey: string, score: number, pageSize?: number, myRankingSize?: number, myOldRankingSize?: number): Promise<void>;
    getTournamentList(rankNum?: number): Promise<touranmentList[]>;
    getTournamentRank(leaderboardKey: string, tournamentKey: string, pageStart?: number, pageSize?: number, myRankingSize?: number, myOldRankingSize?: number): Promise<tournamentInfo>;
    deWeight(arr4: any, isUser?: boolean): any;
    deWeight2(arr4: any): any;
}

declare global {
    export let app: App;
}
declare class App {
    static get userLogin(): UserLogin;
    static get globalLeaderBoard(): GlobalLeaderBoard;
    static get tournament(): Tournament;
}

declare namespace ShareManager {
    function inviteAsync(entry: string, base64: string, payload?: any): Promise<void>;
    function updateStatues(payload?: any): Promise<void>;
    function ShareImage(entry: string, base64: string, payload?: any): Promise<boolean>;
}

/**
 * IapManager - Facebook Instant Games 内购管理器
 * 提供初始化、购买、查询等封装接口
 */
declare class IapManager {
    private static _instance;
    private _isPaymentsReady;
    private _iapInventory;
    /** 单例获取 */
    static getInstance(): IapManager;
    private constructor();
    /** 是否已准备好支付系统 */
    isReady(): boolean;
    /**
     * 初始化内购系统
     * 会检测支持的 API 和平台，并监听 paymentsReady 事件
     */
    init(): Promise<void>;
    /**
     * 获取产品目录（商品列表）
     */
    getCatalog(): Promise<FBInstant.Product[] | null>;
    /**
     * 购买指定产品
     * @param productId - 商品ID
     * @param developerPayload - 可选开发者自定义字段
     * @returns 返回购买结果对象，包含成功状态与错误信息
     */
    purchase(productId: string, developerPayload?: string): Promise<{
        success: boolean;
        code?: string;
        message?: string;
    }>;
    /**
     * 检查是否已拥有某商品（如去广告）
     * @param productId - 商品ID
     */
    hasPurchased(productId: string): boolean;
    /**
     * 手动设置当前已拥有商品（通常用于远端同步）
     */
    setInventory(inventory: string[]): void;
    /**
     * 获取已拥有的商品列表（如用于展示）
     */
    getInventory(): string[];
    /**
     * 检查未消耗的购买记录（如首次初始化或断网恢复后）
     */
    private checkUnconsumedPurchases;
    /**
     * 添加商品至本地库存
     */
    private addToInventory;
    /**
     * 同步远端数据（例如上传到云端存档）
     * ⚠️ 此处需要你按实际项目实现
     */
    private syncRemoteData;
    /**
     * 通用日志方法，可接入打点系统
     */
    private log;
}

declare const IGSDK: {
    PlatFormSDK: typeof PlatFormSDK;
    IapManager: typeof IapManager;
    App: typeof App;
    ShareManager: typeof ShareManager;
};

export { App, IapManager, PlatFormSDK, ShareManager, IGSDK as default };
