/** 单件藏品的关卡区间，id 对应 Sculpture_1 ~ Sculpture_12。首件用 0~0 表示默认解锁。 */
export interface CollectionLevelConfig {
    id: number;
    startLevel: number;
    endLevel: number;
}

/** 从第二件起，每通关一个 15 关区间就解锁一件藏品。 */
export const COLLECTION_LEVEL_CONFIGS: ReadonlyArray<CollectionLevelConfig> = [
    { id: 1, startLevel: 0, endLevel: 0 },
    { id: 2, startLevel: 1, endLevel: 15 },
    { id: 3, startLevel: 16, endLevel: 30 },
    { id: 4, startLevel: 31, endLevel: 45 },
    { id: 5, startLevel: 46, endLevel: 60 },
    { id: 6, startLevel: 61, endLevel: 75 },
    { id: 7, startLevel: 76, endLevel: 90 },
    { id: 8, startLevel: 91, endLevel: 105 },
    { id: 9, startLevel: 106, endLevel: 120 },
    { id: 10, startLevel: 121, endLevel: 135 },
    { id: 11, startLevel: 136, endLevel: 150 },
    { id: 12, startLevel: 151, endLevel: 165 },
];

/** Sculpture_1 ~ Sculpture_12 的 SpriteFrame，首页地标按解锁结果切换。 */
export const COLLECTION_SCULPTURE_FRAME_UUIDS: ReadonlyArray<string> = [
    '9a0300d8-d908-4bf3-90da-b5b2983b60b0@f9941',
    '6bf40971-a106-4dff-88dd-328d97acc9e1@f9941',
    'b908f030-f3d9-4548-86f6-e2a57cb55687@f9941',
    '92b46dad-2d79-4e8b-9548-14e1b4ef98a4@f9941',
    'a57e6d13-f7ab-4df2-a672-9416f3d5fab6@f9941',
    '54cf13f8-d2c0-42b4-a2c6-8a7b63676936@f9941',
    '214b1b0d-e6ab-4e03-ab6f-5171ed960acb@f9941',
    '16638324-1ffa-4ad2-829e-9292fe5a3157@f9941',
    '2398e6f9-dbf2-4589-84f5-a285fe48ab71@f9941',
    'efc80eb7-89a2-4700-a65a-262c23a0c600@f9941',
    'bec160ff-538e-448d-823a-0584d5d8c947@f9941',
    '41f24942-612b-41ea-a9ac-88151963807e@f9941',
];

/** 返回每件藏品对应关卡区间内的已通关数；第 1 件默认解锁，不计进度。 */
export function calculateCollectionProgress(passedLevels: number): number[] {
    return COLLECTION_LEVEL_CONFIGS.map(config => {
        if (config.startLevel === 0) return 0;
        const target = config.endLevel - config.startLevel + 1;
        return Math.max(0, Math.min(passedLevels - config.startLevel + 1, target));
    });
}

export function collectionTargetCount(config: CollectionLevelConfig): number {
    return config.endLevel - config.startLevel + 1;
}

/** 第 1 件默认完成；其余要打满自己的关卡区间。 */
export function isCollectionCompleted(config: CollectionLevelConfig, progress: number): boolean {
    if (config.startLevel === 0) return true;
    return progress >= collectionTargetCount(config);
}

/**
 * 首页当前该摆哪件地标。
 * 还有待播放的解锁时，先停在上一件，等收藏页播完再换。
 */
export function homeLandmarkId(progress: readonly number[], pendingIds: readonly number[]): number {
    if (pendingIds.length > 0) return Math.max(1, pendingIds[0] - 1);
    let id = 1;
    for (let index = 0; index < COLLECTION_LEVEL_CONFIGS.length; index++) {
        const config = COLLECTION_LEVEL_CONFIGS[index];
        if (isCollectionCompleted(config, progress[index] || 0)) id = config.id;
    }
    return id;
}
