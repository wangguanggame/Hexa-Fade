import { _decorator, TextAsset } from 'cc';

// ======================================== 关卡数据接口定义 ========================================
/**
 * 单个六边形方块关卡配置数据
 */
export interface LevelBlockData {
    /** 关卡网格行 r (row) */
    r: number;
    /** 关卡网格列 c (col) */
    c: number;
    /** 方向 ID (1~6 对应 6 个六边形标准邻接方向) */
    dir: number;
    /** 特殊类型或扩展标记 (如 101: 障碍石块, 301: 全方位 TNT 炸药桶, 401~403: 旋转连杆机关等) */
    specialType?: number;
    /** 额外数值参数 (如冰封计数 count) */
    extraParam?: number;
    /** 1101 多向层叠方块的各层逃逸方向列表 (从顶层到底层，如 [6, 1, 2]) */
    subDirections?: number[];
}

/**
 * 单个底座槽位关卡配置数据
 */
export interface LevelSlotData {
    /** 槽位行 r (row) */
    r: number;
    /** 槽位列 c (col) */
    c: number;
}

/**
 * 完整关卡配置数据结构
 */
export interface LevelData {
    /** 关卡编号 ID (1 ~ 500) */
    id: number;
    /** 关卡版本号 */
    version: number;
    /** 通关步数限制 (step) */
    step: number;
    /** 通关步数限制别名 (兼容 limitSteps 访问) */
    limitSteps?: number;
    /** 关卡难度系数 */
    dif: number;
    /** 地图底座/槽位坐标列表 */
    slots: LevelSlotData[];
    /** 初始彩色方块数据列表 */
    blocks: LevelBlockData[];
}

// ======================================== 关卡数据管理器 ========================================
/**
 * 关卡数据管理器 (单例)
 * 负责解析 CSV 关卡配置文件 (GameConfig1.csv)，并提供基于 levelId 的关卡数据快速检索
 */
export class LevelManager {
    // ======================================== 单例模式 ========================================
    private static _instance: LevelManager | null = null;
    public static get instance(): LevelManager {
        if (!this._instance) {
            this._instance = new LevelManager();
        }
        return this._instance;
    }

    /** 每关在配置步数基础上随机赠送 6～8 步，解析后本次运行内保持不变。 */
    public static readonly EXTRA_STEPS_MIN: number = 6;
    public static readonly EXTRA_STEPS_MAX: number = 8;

    /** 关卡映射表 Map: key = levelId, value = LevelData */
    private _levelMap: Map<number, LevelData> = new Map();
    /** 是否已经成功加载解析 */
    private _isLoaded: boolean = false;
    private _parsedCsv: string | null = null;

    // ======================================== CSV 解析与数据检索 ========================================
    /**
     * 解析 TextAsset 传入的 CSV 文本数据
     * @param textAsset Cocos TextAsset 资源对象
     */
    public parseCsvAsset(textAsset: TextAsset): boolean {
        if (!textAsset || !textAsset.text) {
            return false;
        }
        return this.parseCSV(textAsset.text);
    }

    /**
     * 解析 CSV 字符串内容为关卡数据表
     * 兼容表头大小写 (ID/id, MapData/map, LvData/data) 与分隔符 (#, |)
     * @param csvContent CSV 文本原始内容
     */
    public parseCSV(csvContent: string): boolean {
        if (this._isLoaded && this._parsedCsv === csvContent) return true;
        try {
            this._isLoaded = false;
            this._levelMap.clear();
            const lines = csvContent.split(/\r?\n/);
            if (lines.length <= 1) {
                return false;
            }

            // 1. 获取表头映射 (统一转小写匹配)
            const headerLine = lines[0].trim();
            const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
            const idIdx = headers.indexOf('id');
            const versionIdx = headers.indexOf('version');
            const stepIdx = headers.indexOf('step');
            const difIdx = headers.indexOf('dif');
            let mapIdx = headers.indexOf('mapdata');
            if (mapIdx === -1) mapIdx = headers.indexOf('map');
            let dataIdx = headers.indexOf('lvdata');
            if (dataIdx === -1) dataIdx = headers.indexOf('data');

            // 2. 逐行解析数据行 (跳过第2行类型行与第3行版本行)
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const cols = this.splitCsvLine(line);
                if (cols.length <= idIdx) continue;

                // 纯数字 ID 才是有效关卡数据行
                const id = parseInt(cols[idIdx], 10);
                if (isNaN(id) || id <= 0) continue;

                const version = versionIdx !== -1 ? parseInt(cols[versionIdx], 10) || 1 : 1;
                const extraSteps = LevelManager.EXTRA_STEPS_MIN + Math.floor(Math.random()
                    * (LevelManager.EXTRA_STEPS_MAX - LevelManager.EXTRA_STEPS_MIN + 1));
                const step = (stepIdx !== -1 ? parseInt(cols[stepIdx], 10) || 30 : 30) + extraSteps;
                const dif = difIdx !== -1 ? parseInt(cols[difIdx], 10) || 1 : 1;

                // 3. 解析底座槽位坐标 (MapData: "8_6#9_5#..." 或 "8_6|9_5|...")
                const mapStr = mapIdx !== -1 ? cols[mapIdx] : '';
                const slots = this.parseMapSlots(mapStr);

                // 4. 解析方块初始数据 (LvData: "9_5_2#9_6_4#..." 或 "9_5_2|9_6_4|...")
                const dataStr = dataIdx !== -1 ? cols[dataIdx] : '';
                const blocks = this.parseBlocksData(dataStr);

                const levelData: LevelData = {
                    id,
                    version,
                    step,
                    limitSteps: step,
                    dif,
                    slots,
                    blocks
                };

                this._levelMap.set(id, levelData);
            }

            this._isLoaded = true;
            this._parsedCsv = csvContent;
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * 获取指定关卡的数据
     * @param levelId 关卡编号 (1 ~ 500)
     */
    public getLevel(levelId: number): LevelData | undefined {
        const direct = this._levelMap.get(levelId);
        if (direct) return direct;
        if (!Number.isInteger(levelId) || levelId < 1 || this._levelMap.size === 0) return undefined;
        const ids = Array.from(this._levelMap.keys()).sort((a, b) => a - b);
        const lastId = ids[ids.length - 1];
        if (levelId <= lastId) return undefined;
        // 对齐 CarMatch：关卡内容用完后从第 6 关循环，玩家关卡号继续递增。
        const loopIds = ids.filter(id => id >= 6);
        const candidates = loopIds.length ? loopIds : ids;
        const contentId = candidates[(levelId - lastId - 1) % candidates.length];
        return this._levelMap.get(contentId);
    }

    /**
     * 获取已加载的总关卡数
     */
    public get totalLevels(): number {
        return this._levelMap.size;
    }

    /**
     * 是否已完成配置加载
     */
    public get isLoaded(): boolean {
        return this._isLoaded;
    }

    // ======================================== 内部解析辅助方法 ========================================
    /**
     * 解析底座槽位字符串: 兼容 "r_c#r_c#..." 与 "r_c|r_c|..."
     */
    private parseMapSlots(mapStr: string): LevelSlotData[] {
        const slots: LevelSlotData[] = [];
        if (!mapStr) return slots;

        // 统一按 '#' 或 '|' 分隔
        const items = mapStr.split(/[#|]/);
        for (const item of items) {
            if (!item) continue;
            const parts = item.split('_');
            if (parts.length >= 2) {
                const r = parseInt(parts[0], 10);
                const c = parseInt(parts[1], 10);
                if (!isNaN(r) && !isNaN(c)) {
                    slots.push({ r, c });
                }
            }
        }
        return slots;
    }

    /**
     * 解析方块数据字符串: 兼容 "r_c_dir#r_c_dir#..." 与 "r_c_dir|r_c_dir|..."
     */
    private parseBlocksData(dataStr: string): LevelBlockData[] {
        const blocks: LevelBlockData[] = [];
        if (!dataStr) return blocks;

        const items = dataStr.split(/[#|]/);
        for (const item of items) {
            if (!item) continue;
            const parts = item.split('_');
            if (parts.length >= 3) {
                const r = parseInt(parts[0], 10);
                const c = parseInt(parts[1], 10);
                const val3 = parseInt(parts[2], 10);
                let dir = val3;
                let specialType: number | undefined = undefined;
                let extraParam: number | undefined = undefined;
                let subDirections: number[] | undefined = undefined;

                // 1. 201 锁链为同坐标附加层，直接跳过生成，底层的真实基础箭头方块将正常生成并顺利逃逸
                if (val3 === 201) {
                    continue;
                }

                if (val3 === 1101 || val3 === 1301) {
                    // 1101 与 1301 统一作为多向层叠生成井处理，解析批次方向序列
                    specialType = 1101;
                    if (parts.length >= 4) {
                        const dirStrings = parts[3].split('^');
                        subDirections = [];
                        for (const ds of dirStrings) {
                            const d = parseInt(ds, 10);
                            if (!isNaN(d)) subDirections.push(d);
                        }
                    }
                    dir = (subDirections && subDirections.length > 0) ? subDirections[0] : 1;
                } else if ((val3 >= 1401 && val3 <= 1404) || (val3 >= 1411 && val3 <= 1414)) {
                    // 1401~1404(锁) 与 1411~1414(钥匙) 统一平替为 301 TNT 炸药桶，点击或受撞即引爆周围，100% 杜绝卡关死锁
                    specialType = 301;
                    dir = 1;
                } else if (val3 === 1701) {
                    // 特殊元素 1701：双向交替分流转向板 (RandomTurnBlock，配置格式如 1701_2^4)
                    specialType = 1701;
                    if (parts.length >= 4) {
                        const dirStrings = parts[3].split('^');
                        subDirections = [];
                        for (const ds of dirStrings) {
                            const d = parseInt(ds, 10);
                            if (!isNaN(d)) subDirections.push(d);
                        }
                    }
                    dir = (subDirections && subDirections.length > 0) ? subDirections[0] : 1;
                } else if (val3 >= 1201 && val3 <= 1206) {
                    specialType = val3;
                    dir = val3 - 1200;
                } else if (val3 >= 1501 && val3 <= 1506) {
                    specialType = val3;
                    dir = val3 - 1500;
                } else if (val3 >= 100) {
                    specialType = val3;
                    dir = 1; // 特殊元素保底默认方向，避免越界访问材质
                }

                if (val3 !== 1101 && val3 !== 1301 && val3 !== 1701 && parts.length >= 4) {
                    const val4 = parseInt(parts[3], 10);
                    if (!isNaN(val4)) {
                        if (val3 >= 100) {
                            extraParam = val4; // 例如 202_16 中的 16 为解冻计数
                        } else {
                            specialType = val4;
                        }
                    }
                }

                if (!isNaN(r) && !isNaN(c) && !isNaN(dir)) {
                    blocks.push({ r, c, dir, specialType, extraParam, subDirections });
                }
            }
        }
        return blocks;
    }

    /**
     * 安全拆分 CSV 行 (处理可能包含双引号包裹逗号的情形)
     */
    private splitCsvLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }
}
