import { Vec3 } from 'cc';

// ======================================== 基础类型与枚举定义 ========================================
/** 六边形坐标接口 (r: row 行, c: col 列, layer: 高度层数) */
export interface HexCoord {
    r: number;
    c: number;
    layer?: number;
}

/** 
 * 关卡编辑器 hexout_level_editor 与原版 Unity 严格对应的 6 个标准方向与真机颜色
 * 1: 黄色 -> 正上 ↑ (-90°)  Vector3(0, 0, -1)
 * 2: 粉色 -> 右上 ↗ (-30°)  Vector3(0.866, 0, -0.5)
 * 3: 天蓝 -> 右下 ↘ (+30°)  Vector3(0.866, 0, 0.5)
 * 4: 蓝色 -> 正下 ↓ (+90°)  Vector3(0, 0, 1)
 * 5: 红色 -> 左下 ↙ (+150°) Vector3(-0.866, 0, 0.5)
 * 6: 绿色 -> 左上 ↖ (-150°) Vector3(-0.866, 0, -0.5)
 */
export enum HexDirection {
    UP = 1,          // 1: 正上 ↑
    UP_RIGHT = 2,    // 2: 右上 ↗
    DOWN_RIGHT = 3,  // 3: 右下 ↘
    DOWN = 4,        // 4: 正下 ↓
    DOWN_LEFT = 5,   // 5: 左下 ↙
    UP_LEFT = 6      // 6: 左上 ↖
}

// ======================================== 网格偏移常量配置 ========================================
/**
 * 偶数列 (c % 2 === 0) 下 6 个标准方向在 (r, c) 蜂窝网格下的位移 (dr, dc)
 */
export const HEX_DIR_OFFSETS_EVEN: Record<number, { dr: number; dc: number }> = {
    1: { dr: 1, dc: 0 },   // 1: 正上 ↑
    2: { dr: 1, dc: 1 },   // 2: 右上 ↗
    3: { dr: 0, dc: 1 },   // 3: 右下 ↘
    4: { dr: -1, dc: 0 },  // 4: 正下 ↓
    5: { dr: 0, dc: -1 },  // 5: 左下 ↙
    6: { dr: 1, dc: -1 }   // 6: 左上 ↖
};

/**
 * 奇数列 (c % 2 !== 0) 下 6 个标准方向在 (r, c) 蜂窝网格下的位移 (dr, dc)
 */
export const HEX_DIR_OFFSETS_ODD: Record<number, { dr: number; dc: number }> = {
    1: { dr: 1, dc: 0 },   // 1: 正上 ↑
    2: { dr: 0, dc: 1 },   // 2: 右上 ↗
    3: { dr: -1, dc: 1 },  // 3: 右下 ↘
    4: { dr: -1, dc: 0 },  // 4: 正下 ↓
    5: { dr: -1, dc: -1 }, // 5: 左下 ↙
    6: { dr: 0, dc: -1 }   // 6: 左上 ↖
};

/** 兼容旧代码引用 (默认提供偶数列偏移) */
export const HEX_DIR_OFFSETS = HEX_DIR_OFFSETS_EVEN;

// ======================================== 六边形核心数学与空间换算类 ========================================
export class HexMath {
    /** 默认基准外接圆半径 (模型跨宽 0.546 -> R=0.28，严丝合缝紧密贴合) */
    public static readonly DEFAULT_RADIUS: number = 0.28;
    /** 默认单层高度 */
    public static readonly DEFAULT_LAYER_HEIGHT: number = 0.10;

    // ======================================== 坐标转换 ========================================
    /**
     * 将关卡编辑器中的 (r, c) 网格坐标转换为 3D 世界坐标 Vec3
     * 100% 严密对齐 hexout_level_editor (与原版 Unity 源码 GameMain.GamePlay 一致):
     * - W = 1.5 * R (列间距)
     * - H = sqrt(3) * R (行间距)
     * - yOffset = (c % 2 !== 0) ? -0.5 : 0 (奇数列纵向错位半行)
     * - x = (c - 6) * W (以 c=6 为中心横向展开)
     * - z = -(r - 9 + yOffset) * H (以 r=9 为中心纵向展开，Cocos 中相机朝 -Z 视口，r 增大向上取负)
     */
    public static hexToWorld(
        r: number,
        c: number,
        layer: number = 0,
        radius: number = HexMath.DEFAULT_RADIUS,
        layerHeight: number = HexMath.DEFAULT_LAYER_HEIGHT
    ): Vec3 {
        const W = 1.5 * radius;
        const H = Math.sqrt(3) * radius;
        const yOffset = (c % 2 !== 0) ? -0.5 : 0;
        const x = (c - 6) * W;
        const z = -(r - 9 + yOffset) * H;
        const y = layer * layerHeight;
        return new Vec3(x, y, z);
    }

    // ======================================== 方向向量与旋转角 ========================================
    /**
     * 获取指定方向对应的 3D 单位方向向量
     * @param dir 1~6 方向编号
     * @param fromC 起始所在列 c (用于奇偶列精确微调，理论上 6 方向的归一化 3D 向量恒定)
     * @param radius 六边形外接圆半径
     */
    public static getDirVector3D(dir: number, fromC: number = 6, radius: number = HexMath.DEFAULT_RADIUS): Vec3 {
        const nextCoord = HexMath.getNeighborCoord(9, fromC, dir);
        const p0 = HexMath.hexToWorld(9, fromC, 0, radius);
        const p1 = HexMath.hexToWorld(nextCoord.r, nextCoord.c, 0, radius);
        return new Vec3(p1.x - p0.x, 0, p1.z - p0.z).normalize();
    }

    /**
     * 获取指示箭头的 Y 轴旋转角 (度数)
     * 基于 3D 运动向量精确推导，确保指示箭头与实际飞行方向 100% 绝对一致
     * @param dir 1~6 方向编号
     * @param fromC 起始所在列 c
     */
    public static getArrowAngleY(dir: number, fromC: number = 6): number {
        const dirVec = HexMath.getDirVector3D(dir, fromC);
        const rad = Math.atan2(dirVec.x, dirVec.z);
        return rad * (180 / Math.PI);
    }

    // ======================================== 邻居与射线扫描 ========================================
    /**
     * 根据 (r, c) 直接获取指定方向的相邻格坐标 (自动适配奇数列与偶数列错位)
     * @param r 行号
     * @param c 列号
     * @param dir 移动方向 (1~6)
     */
    public static getNeighborCoord(r: number, c: number, dir: number): HexCoord {
        const offsetMap = (c % 2 !== 0) ? HEX_DIR_OFFSETS_ODD : HEX_DIR_OFFSETS_EVEN;
        const offset = offsetMap[dir] || offsetMap[1];
        return {
            r: r + offset.dr,
            c: c + offset.dc,
            layer: 0
        };
    }

    /**
     * 获取指定方向的相邻格 (r, c) 坐标
     * @param coord 起始坐标
     * @param dir 移动方向
     */
    public static getNeighbor(coord: HexCoord, dir: number): HexCoord {
        const next = HexMath.getNeighborCoord(coord.r, coord.c, dir);
        next.layer = coord.layer ?? 0;
        return next;
    }

    /**
     * 获取指定 (r, c) 坐标周围全部 6 个相邻格子的坐标列表
     * @param r 行号
     * @param c 列号
     */
    public static getAllNeighbors(r: number, c: number): HexCoord[] {
        const neighbors: HexCoord[] = [];
        const offsetMap = (c % 2 !== 0) ? HEX_DIR_OFFSETS_ODD : HEX_DIR_OFFSETS_EVEN;
        for (let dir = 1; dir <= 6; dir++) {
            const offset = offsetMap[dir];
            if (offset) {
                neighbors.push({
                    r: r + offset.dr,
                    c: c + offset.dc,
                    layer: 0
                });
            }
        }
        return neighbors;
    }

    /** 兼容别名：获取周围全部 6 个相邻格坐标列表 */
    public static getNeighborCoords(r: number, c: number): HexCoord[] {
        return HexMath.getAllNeighbors(r, c);
    }

    /**
     * 从起始点开始，沿着指定方向延伸 maxSteps 步经过的所有六边形网格坐标列表 (用于阻挡检测)
     * @param start 起始网格坐标
     * @param dir 扫描方向
     * @param maxSteps 最大扫描步数 (默认 25)
     */
    public static getRayCoords(start: HexCoord, dir: number, maxSteps: number = 25): HexCoord[] {
        const result: HexCoord[] = [];
        let currR = start.r;
        let currC = start.c;

        for (let i = 0; i < maxSteps; i++) {
            const next = HexMath.getNeighborCoord(currR, currC, dir);
            currR = next.r;
            currC = next.c;
            result.push({ r: currR, c: currC, layer: start.layer ?? 0 });
        }

        return result;
    }

    /**
     * 格式化 Key 字符串用于 Map 存储: "r_c_layer"
     */
    public static getHexKey(r: number, c: number, layer: number = 0): string {
        return `${r}_${c}_${layer}`;
    }
}
