import { sys, EventTarget } from 'cc';
import { COLLECTION_LEVEL_CONFIGS, calculateCollectionProgress, isCollectionCompleted } from './CollectionConfig';
import { GameSDK } from '../../sdk/GameSDK';

/**
 * 游戏数据变更事件定义
 */
export enum GameDataEvent {
    COIN_CHANGED = 'COIN_CHANGED',             // 金币数量变动
    STAR_CHANGED = 'STAR_CHANGED',             // 星星数量变动
    LEVEL_CHANGED = 'LEVEL_CHANGED',           // 当前关卡变动
    COLLECTION_UNLOCK_SHOWN = 'COLLECTION_UNLOCK_SHOWN', // 收藏页解锁动画播完
    SCORE_CHANGED = 'SCORE_CHANGED',           // 历史积分变动
    PROP_CHANGED = 'PROP_CHANGED',             // 道具数量变动
    REMOVE_ADS_CHANGED = 'REMOVE_ADS_CHANGED', // 去广告状态变动
    REWARD_STATE_CHANGED = 'REWARD_STATE_CHANGED', // 转盘 / 签到 / 关卡奖励的可领取状态变动
}

/**
 * 游戏核心数据持久化与全局管理类
 */
export class GameData {
    public static sdkReady: boolean = false;
    // ======================================== 单例模式 ========================================
    private static _instance: GameData | null = null;
    public static get instance(): GameData {
        if (!this._instance) {
            this._instance = new GameData();
            this._instance.loadData();
        }
        return this._instance;
    }

    /** 全局数据变更事件派发中心 */
    public static readonly event: EventTarget = new EventTarget();

    // ======================================== 核心存储字段 ========================================
    /** 是否新用户 (默认 true) */
    public isNewUser: boolean = true;

    /** 是否已购买去除广告 (非消耗品) */
    public isRemoveAds: boolean = false;

    /** 当前参与的锦标赛数据 (null 表示未处于锦标赛模式) */
    public currentTournament: any = null;

    /** 是否正处于锦标赛竞赛模式中 */
    public isJoinTournament: boolean = false;

    /** 按账号和比赛累计星星，优先采用本地与后台榜单中较大的已知值。 */
    public addTournamentStars(amount: number): number {
        const tournament = this.currentTournament;
        if (!tournament?.leaderboardKey || !tournament?.tournamentKey) return 0;
        const playerId = String(GameSDK.inst.GetMyID());
        const key = `Hexa_TournamentStars_v1:${playerId}:${tournament.leaderboardKey}:${tournament.tournamentKey}`;
        const ranking = tournament.rankingList?.find((item: any) => {
            const info = item.userInfo;
            return String(info?.s3partUserId || info?.fbUserId || '') === playerId;
        });
        const remote = Math.max(0, Number(ranking?.score) || 0);
        let local = 0;
        try { local = Math.max(0, Number(sys.localStorage.getItem(key)) || 0); } catch {}
        const total = Math.max(local, remote) + Math.max(0, Math.floor(amount));
        try { sys.localStorage.setItem(key, String(total)); } catch {}
        // 保持本次进入持有的榜单数据一致，连续通关时也能继续累计。
        if (ranking) ranking.score = total;
        return total;
    }

    /** 当前主线关卡进度 (默认 1，主界面按钮展示由此驱动) */
    public currentLevel: number = 1;

    /** 第一关点击引导是否已经完成 */
    public hasSeenFirstLevelGuide: boolean = false;

    /** 每件藏品对应关卡区间内的已通关数，顺序与 COLLECTION_LEVEL_CONFIGS 一致 */
    public collectionProgress: number[] = calculateCollectionProgress(0);

    /** 刚达成、还没在收藏页播过解锁的藏品 id。播完才清空。 */
    public pendingCollectionUnlockIds: number[] = [];

    /** 回到首页时播一次地标切换，不写入存档。 */
    public playLandmarkReveal: boolean = false;

    /** 玩家总金币 (默认 1000) */
    public totalCoin: number = 1000;

    /** 玩家总星星数 (默认 0) */
    public totalStar: number = 0;

    /** 历史总积分 (默认 0) */
    public totalScore: number = 0;

    /** 加步数道具数量 (默认 2) */
    public propAddMoves: number = 2;

    /** 炸弹道具数量 (默认 2) */
    public propTnt: number = 2;

    /** 锤子道具数量 (默认 2) */
    public propHammer: number = 2;

    /** 电钻道具数量 (默认 2) */
    public propDrill: number = 2;

    /** 已经看过的特殊元素教程编号 (对应 SpacialMapItemGuide 1~15) */
    public seenSpecialMapItems: number[] = [];

    /** 关卡奖励本周期已领取档数 */
    public levelRewardClaimed: number = 0;

    /** 关卡奖励本周期已通关次数，按各档累计通关门槛解锁奖励 */
    public levelRewardPassed: number = 0;

    /** 关卡奖励本周期结束时间戳（毫秒），到点后进度清空 */
    public levelRewardCycleEnd: number = 0;

    public signClaimedCount: number = 0;
    public signLastClaimDate: string = '';
    public signResetVersion: number = 2;
    public lastSpinTimestamp: number = 0;
    public musicOn: boolean = true;
    public soundOn: boolean = true;

    /** 关卡奖励轨道刷新周期 */
    public static readonly LEVEL_REWARD_CYCLE_MS = 24 * 60 * 60 * 1000;

    /** 关卡奖励各档之间需要通关的次数 */
    public static readonly LEVEL_REWARD_LEVELS_PER_STEP: ReadonlyArray<number> = [3, 3, 3, 5, 5, 5, 10, 10, 10, 20];

    /** 前 count 档奖励所需的累计通关次数。 */
    public static levelRewardThreshold(count: number): number {
        return GameData.LEVEL_REWARD_LEVELS_PER_STEP
            .slice(0, Math.max(0, count))
            .reduce((total, interval) => total + interval, 0);
    }

    /** 开发者调试开关：设为 true 时，启动时会自动清空旧存档并强制重置为新用户数据 */
    public static readonly DEBUG_RESET_TO_NEW_USER: boolean = false;

    /**
     * 全员数据重置版本号。存档里的版本和这里不一致时，启动会重置为新用户（本地和云端都覆盖），每个用户只重置一次。
     * 需要再全员重置一次时 +1 后发版，去广告状态也一起重置。
     */
    public static readonly DATA_RESET_VERSION: number = 4;

    // ======================================== 本地存储键名 ========================================
    private static readonly STORAGE_KEY = 'Hexa_GameData_v1';
    private static readonly COLLECTION_PROGRESS_VERSION = 4;

    // ======================================== 数据存取核心方法 ========================================
    /**
     * 保存数据到本地存储 (同时预留 SDK 云端存储)
     */
    public saveData(): void {
        const data = {
            dataResetVersion: GameData.DATA_RESET_VERSION,
            isNewUser: this.isNewUser,
            isRemoveAds: this.isRemoveAds,
            currentLevel: this.currentLevel,
            hasSeenFirstLevelGuide: this.hasSeenFirstLevelGuide,
            collectionProgress: this.collectionProgress,
            collectionProgressVersion: GameData.COLLECTION_PROGRESS_VERSION,
            pendingCollectionUnlockIds: this.pendingCollectionUnlockIds,
            totalCoin: this.totalCoin,
            totalStar: this.totalStar,
            totalScore: this.totalScore,
            propAddMoves: this.propAddMoves,
            propTnt: this.propTnt,
            propHammer: this.propHammer,
            propDrill: this.propDrill,
            seenSpecialMapItems: this.seenSpecialMapItems,
            levelRewardClaimed: this.levelRewardClaimed,
            levelRewardPassed: this.levelRewardPassed,
            levelRewardCycleEnd: this.levelRewardCycleEnd,
            signClaimedCount: this.signClaimedCount,
            signLastClaimDate: this.signLastClaimDate,
            signResetVersion: this.signResetVersion,
            lastSpinTimestamp: this.lastSpinTimestamp,
            musicOn: this.musicOn,
            soundOn: this.soundOn,
        };

        // 1. 本地可靠持久化
        try {
            sys.localStorage.setItem(GameData.STORAGE_KEY, JSON.stringify(data));
        } catch (err) {
        }

        // 2. SDK 云端存储 (留空预留)
        this.saveDataToSDK(data);
    }

    /**
     * 读取存档数据
     */
    public loadData(): void {
        // 若开启强制新用户调试模式，直接重置
        if (GameData.DEBUG_RESET_TO_NEW_USER) {
            this.resetToNewUser();
            return;
        }

        const data = this.readSavedData();
        if (!data) {
            this.saveData();
            return;
        }

        if (data.dataResetVersion !== GameData.DATA_RESET_VERSION) {
            this.resetToNewUser();
            return;
        }

        this.applyData(data);
        this.saveData();
    }

    /** 优先读 SDK 云端存档，没有再读本地缓存。 */
    private readSavedData(): any {
        const sdkData = this.loadDataFromSDK();
        if (sdkData && typeof sdkData.currentLevel === 'number') return sdkData;

        try {
            const raw = sys.localStorage.getItem(GameData.STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (err) {
        }
        return null;
    }

    /**
     * 将数据对象应用到当前单例实例
     */
    private applyData(data: any): void {
        if (!data) return;
        if (typeof data.isNewUser === 'boolean') this.isNewUser = data.isNewUser;
        if (typeof data.isRemoveAds === 'boolean') this.isRemoveAds = data.isRemoveAds;
        if (typeof data.currentLevel === 'number') this.currentLevel = data.currentLevel;
        if (typeof data.hasSeenFirstLevelGuide === 'boolean') this.hasSeenFirstLevelGuide = data.hasSeenFirstLevelGuide;
        const passedLevels = Math.max(0, Math.floor(this.currentLevel) - 1);
        const calculated = calculateCollectionProgress(passedLevels);
        // 旧版数组含有不同的进度口径，统一按主线关卡重建区间进度。
        this.collectionProgress = calculated.map((progress, index) => {
            if (data.collectionProgressVersion !== GameData.COLLECTION_PROGRESS_VERSION) return progress;
            const saved = data.collectionProgress?.[index];
            if (typeof saved !== 'number' || !Number.isFinite(saved)) return progress;
            const config = COLLECTION_LEVEL_CONFIGS[index];
            if (config.startLevel === 0) return 0;
            const target = config.endLevel - config.startLevel + 1;
            return Math.max(0, Math.min(Math.max(Math.floor(saved), progress), target));
        });
        if (Array.isArray(data.pendingCollectionUnlockIds)) {
            this.pendingCollectionUnlockIds = data.pendingCollectionUnlockIds
                .map((id: any) => Number(id))
                .filter((id: number) => this.isPendingUnlockStillValid(id));
        }
        if (typeof data.totalCoin === 'number') this.totalCoin = data.totalCoin;
        if (typeof data.totalStar === 'number') this.totalStar = data.totalStar;
        if (typeof data.totalScore === 'number') this.totalScore = data.totalScore;
        if (typeof data.propAddMoves === 'number') this.propAddMoves = data.propAddMoves;
        if (typeof data.propTnt === 'number') this.propTnt = data.propTnt;
        if (typeof data.propHammer === 'number') this.propHammer = data.propHammer;
        if (typeof data.propDrill === 'number') this.propDrill = data.propDrill;
        if (Array.isArray(data.seenSpecialMapItems)) {
            this.seenSpecialMapItems = data.seenSpecialMapItems
                .map((id: any) => Number(id))
                .filter((id: number) => Number.isInteger(id) && id >= 1 && id <= 15);
        }
        if (typeof data.levelRewardClaimed === 'number') this.levelRewardClaimed = Math.max(0, Math.floor(data.levelRewardClaimed));
        if (typeof data.levelRewardPassed === 'number') this.levelRewardPassed = Math.max(0, Math.floor(data.levelRewardPassed));
        if (typeof data.levelRewardCycleEnd === 'number') this.levelRewardCycleEnd = data.levelRewardCycleEnd;
        // 保留旧版每档 3 关的存档补齐规则，避免按新门槛虚增通关进度。
        this.levelRewardPassed = Math.max(this.levelRewardPassed, this.levelRewardClaimed * 3);
        if (typeof data.signClaimedCount === 'number') this.signClaimedCount = Math.max(0, Math.floor(data.signClaimedCount));
        if (typeof data.signLastClaimDate === 'string') this.signLastClaimDate = data.signLastClaimDate;
        if (typeof data.signResetVersion === 'number') this.signResetVersion = data.signResetVersion;
        if (typeof data.lastSpinTimestamp === 'number') this.lastSpinTimestamp = data.lastSpinTimestamp;
        if (typeof data.musicOn === 'boolean') this.musicOn = data.musicOn;
        if (typeof data.soundOn === 'boolean') this.soundOn = data.soundOn;
    }

    /**
     * 重置所有数据为初始默认值
     */
    public resetData(): void {
        this.resetToNewUser();
    }

    /**
     * 核心方法：重置为新用户状态 (清空本地缓存，恢复第1关及初始资源)
     */
    public resetToNewUser(): void {
        try {
            sys.localStorage.removeItem(GameData.STORAGE_KEY);
        } catch (err) {
        }

        this.isNewUser = true;
        this.isRemoveAds = false;
        this.currentLevel = 1;
        this.hasSeenFirstLevelGuide = false;
        this.collectionProgress = calculateCollectionProgress(0);
        this.pendingCollectionUnlockIds = [];
        this.playLandmarkReveal = false;
        this.totalCoin = 1000;
        this.totalStar = 0;
        this.totalScore = 0;
        this.propAddMoves = 2;
        this.propTnt = 2;
        this.propHammer = 2;
        this.propDrill = 2;
        this.seenSpecialMapItems = [];
        this.levelRewardClaimed = 0;
        this.levelRewardPassed = 0;
        this.levelRewardCycleEnd = 0;
        this.signClaimedCount = 0;
        this.signLastClaimDate = '';
        this.signResetVersion = 2;
        this.lastSpinTimestamp = 0;
        this.musicOn = true;
        this.soundOn = true;
        this.saveData();

        GameData.event.emit(GameDataEvent.COIN_CHANGED, this.totalCoin);
        GameData.event.emit(GameDataEvent.STAR_CHANGED, this.totalStar);
        GameData.event.emit(GameDataEvent.LEVEL_CHANGED, this.currentLevel);
        GameData.event.emit(GameDataEvent.SCORE_CHANGED, this.totalScore);
        GameData.event.emit(GameDataEvent.PROP_CHANGED, 'ALL');
        GameData.event.emit(GameDataEvent.REMOVE_ADS_CHANGED, this.isRemoveAds);
        GameData.event.emit(GameDataEvent.REWARD_STATE_CHANGED);

    }

    /**
     * 设置去广告状态 (内购解锁)
     */
    public setRemoveAds(value: boolean = true): void {
        if (this.isRemoveAds === value) return;
        this.isRemoveAds = value;
        this.saveData();
        GameData.event.emit(GameDataEvent.REMOVE_ADS_CHANGED, this.isRemoveAds);
    }

    /** 静态快捷调用 */
    public static resetToNewUser(): void {
        GameData.instance.resetToNewUser();
    }

    // ======================================== 道具存取操作方法 ========================================
    /**
     * 获取指定道具的数量
     */
    public getPropCount(propType: string): number {
        const type = propType.toUpperCase();
        if (type.includes('MOVE')) return this.propAddMoves;
        if (type.includes('TNT')) return this.propTnt;
        if (type.includes('HAMMER')) return this.propHammer;
        if (type.includes('DRILL')) return this.propDrill;
        return 0;
    }

    /**
     * 消耗道具
     * @returns 是否消耗成功
     */
    public useProp(propType: string, count: number = 1): boolean {
        const type = propType.toUpperCase();
        if (!['ADD_MOVES', 'TNT', 'HAMMER', 'DRILL'].includes(type) || !Number.isInteger(count) || count <= 0) return false;
        const current = this.getPropCount(propType);
        if (current < count) return false;

        if (type.includes('MOVE')) this.propAddMoves -= count;
        else if (type.includes('TNT')) this.propTnt -= count;
        else if (type.includes('HAMMER')) this.propHammer -= count;
        else if (type.includes('DRILL')) this.propDrill -= count;

        this.saveData();
        GameData.event.emit(GameDataEvent.PROP_CHANGED, propType);
        GameSDK.inst.logEvent('useProp', { value: type, count });
        return true;
    }

    /**
     * 增加道具
     */
    public addProp(propType: string, count: number = 1): void {
        const type = propType.toUpperCase();
        if (type.includes('MOVE')) this.propAddMoves += count;
        else if (type.includes('TNT')) this.propTnt += count;
        else if (type.includes('HAMMER')) this.propHammer += count;
        else if (type.includes('DRILL')) this.propDrill += count;

        this.saveData();
        GameData.event.emit(GameDataEvent.PROP_CHANGED, propType);
    }

    public hasSeenSpecialMapItem(guideId: number): boolean {
        return this.seenSpecialMapItems.indexOf(guideId) >= 0;
    }

    public markSpecialMapItemSeen(guideId: number): void {
        if (this.hasSeenSpecialMapItem(guideId)) return;
        this.seenSpecialMapItems.push(guideId);
        this.saveData();
    }

    // ======================================== 快捷业务操作方法 ========================================
    /**
     * 增加金币
     * @param amount 增加数量
     */
    public addCoin(amount: number): void {
        if (amount <= 0) return;
        this.totalCoin += amount;
        this.saveData();
        GameData.event.emit(GameDataEvent.COIN_CHANGED, this.totalCoin);
    }

    /**
     * 消耗金币
     * @param amount 消耗数量
     * @returns 是否消耗成功 (余额不足返回 false)
     */
    public useCoin(amount: number): boolean {
        if (amount <= 0) return false;
        if (this.totalCoin < amount) return false;
        this.totalCoin -= amount;
        this.saveData();
        GameData.event.emit(GameDataEvent.COIN_CHANGED, this.totalCoin);
        return true;
    }

    /**
     * 增加星星
     * @param amount 增加数量
     */
    public addStar(amount: number): void {
        if (amount <= 0) return;
        this.totalStar += amount;
        this.saveData();
        GameData.event.emit(GameDataEvent.STAR_CHANGED, this.totalStar);
    }

    /**
     * 关卡胜利结算：进入下一关
     */
    public passLevel(): void {
        this.currentLevel += 1;
        this.updateCollectionProgress();
        this.isNewUser = false;
        this.noteLevelRewardProgress();
        this.saveData();
        GameData.event.emit(GameDataEvent.LEVEL_CHANGED, this.currentLevel);
    }

    /**
     * 周期到点则清空关卡奖励进度，并记下新的结束时间。
     * @returns 这次是否重新开了一轮
     */
    public ensureLevelRewardCycle(): boolean {
        const now = Date.now();
        if (this.levelRewardCycleEnd > now) return false;
        this.levelRewardClaimed = 0;
        this.levelRewardPassed = 0;
        this.levelRewardCycleEnd = now + GameData.LEVEL_REWARD_CYCLE_MS;
        this.saveData();
        GameData.event.emit(GameDataEvent.REWARD_STATE_CHANGED);
        return true;
    }

    /** 本周期已解锁的档数 */
    public get levelRewardUnlocked(): number {
        let unlocked = 0;
        for (let count = 1; count <= GameData.LEVEL_REWARD_LEVELS_PER_STEP.length; count++) {
            if (this.levelRewardPassed < GameData.levelRewardThreshold(count)) break;
            unlocked = count;
        }
        return Math.max(this.levelRewardClaimed, unlocked);
    }

    /** 记一次通关，达到各档累计门槛时解锁下一档。调用方负责存档。 */
    public noteLevelRewardProgress(): void {
        const now = Date.now();
        if (this.levelRewardCycleEnd <= now) {
            this.levelRewardClaimed = 0;
            this.levelRewardPassed = 0;
            this.levelRewardCycleEnd = now + GameData.LEVEL_REWARD_CYCLE_MS;
        }
        this.levelRewardPassed += 1;
        GameData.event.emit(GameDataEvent.REWARD_STATE_CHANGED);
    }

    /** 领取当前这一档。周期已过或还没通关则不推进。 */
    public claimNextLevelReward(): boolean {
        if (this.levelRewardCycleEnd <= Date.now()) return false;
        if (this.levelRewardClaimed >= this.levelRewardUnlocked) return false;
        this.levelRewardClaimed += 1;
        this.saveData();
        GameData.event.emit(GameDataEvent.REWARD_STATE_CHANGED);
        return true;
    }

    /**
     * 设置当前关卡 (用于测试或跳转关卡)
     * @param level 目标关卡数 (必须 >= 1)
     */
    public setLevel(level: number): void {
        this.currentLevel = Math.max(1, level);
        this.updateCollectionProgress();
        this.isNewUser = false;
        this.saveData();
        GameData.event.emit(GameDataEvent.LEVEL_CHANGED, this.currentLevel);
    }

    public hasPendingCollectionUnlock(): boolean {
        return this.pendingCollectionUnlockIds.length > 0;
    }

    /** 收藏页解锁动画结束后调用，首页随后换上新地标。 */
    public finishCollectionUnlockPresentation(): void {
        this.pendingCollectionUnlockIds = [];
        this.playLandmarkReveal = true;
        this.saveData();
        GameData.event.emit(GameDataEvent.COLLECTION_UNLOCK_SHOWN);
    }

    /** 将主线已通关关卡同步到各藏品进度；刚打满的藏品记入待播放队列。 */
    private updateCollectionProgress(): void {
        const passedLevels = Math.max(0, Math.floor(this.currentLevel) - 1);
        const next = calculateCollectionProgress(passedLevels);
        for (let index = 0; index < COLLECTION_LEVEL_CONFIGS.length; index++) {
            const config = COLLECTION_LEVEL_CONFIGS[index];
            if (config.startLevel === 0) continue;
            const wasDone = isCollectionCompleted(config, this.collectionProgress[index] || 0);
            const nowDone = isCollectionCompleted(config, next[index] || 0);
            if (!wasDone && nowDone && this.pendingCollectionUnlockIds.indexOf(config.id) < 0) {
                this.pendingCollectionUnlockIds.push(config.id);
            }
        }
        this.collectionProgress = next;
        this.pendingCollectionUnlockIds = this.pendingCollectionUnlockIds.filter(id => this.isPendingUnlockStillValid(id));
    }

    private isPendingUnlockStillValid(id: number): boolean {
        const index = COLLECTION_LEVEL_CONFIGS.findIndex(config => config.id === id);
        if (index < 0) return false;
        const config = COLLECTION_LEVEL_CONFIGS[index];
        return config.startLevel !== 0 && isCollectionCompleted(config, this.collectionProgress[index] || 0);
    }

    /**
     * 增加历史积分
     * @param amount 增加的分数
     */
    public addScore(amount: number): void {
        if (amount <= 0) return;
        this.totalScore += amount;
        this.saveData();
        GameData.event.emit(GameDataEvent.SCORE_CHANGED, this.totalScore);
    }

    // ======================================== SDK 存取接口 ========================================
    /**
     * 保存数据到平台 SDK / 云端存储
     * 后续接 SDK 时在此调用平台接口
     */
    private saveDataToSDK(data: any): void {
        if (GameData.sdkReady) GameSDK.inst.setData(data);
    }

    /**
     * 从平台 SDK / 云端存储读取数据
     * 后续接 SDK 时在此获取数据
     */
    private loadDataFromSDK(): any {
        return GameData.sdkReady ? GameSDK.inst.readData() : null;
    }
}

// 挂载到全局 window，方便在浏览器/调试控制台直接输入 resetUser()
if (typeof window !== 'undefined') {
    (window as any).GameData = GameData;
    (window as any).resetUser = () => {
        GameData.resetToNewUser();
    };
}
