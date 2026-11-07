import { Color, instantiate, Node, ParticleSystem, Prefab, resources, tween, Vec3 } from 'cc';
import { HexBlock } from './HexBlock';

// ======================================== 六边形破碎粒子管理器 ========================================
/**
 * 统一管理六边形方块的分色破碎粒子：
 * 1. 根据方块方向/颜色编号选择 Broken1~6；
 * 2. 按需加载并缓存粒子预制体；
 * 3. 保留方块销毁前的世界坐标，确保异步加载后仍能准确播放；
 * 4. 粒子播放结束后自动销毁节点。
 */
export class BrokenParticle {
    // ======================================== 资源配置与缓存 ========================================
    private static readonly prefabPath = 'Main/Game/Particle/Broken/Broken';
    private static readonly recycleDelay = 2.5;
    private static readonly playbackSpeed = 2.2;
    private static readonly floorTemplateId = 4;
    private static readonly floorColor = new Color(159, 151, 181, 255);
    private static readonly prefabCache = new Map<number, Prefab>();
    private static preloadTask: Promise<void> | null = null;

    /** 加载页准备六种颜色及底座使用的破碎特效，直接填充播放缓存。 */
    public static preload(): Promise<void> {
        if (!this.preloadTask) {
            this.preloadTask = Promise.all([1, 2, 3, 4, 5, 6].map(id => new Promise<void>((resolve, reject) => {
                if (this.prefabCache.has(id)) { resolve(); return; }
                resources.load(`${this.prefabPath}${id}`, Prefab, (err, prefab) => {
                    if (err || !prefab) { reject(err || new Error('Missing broken effect: ' + id)); return; }
                    this.prefabCache.set(id, prefab);
                    resolve();
                });
            }))).then(() => {}).catch(err => { this.preloadTask = null; throw err; });
        }
        return this.preloadTask;
    }

    // ======================================== 对外播放接口 ========================================
    /**
     * 在指定方块位置播放对应颜色的破碎粒子。
     * @param block 即将被击碎的六边形方块
     * @param parent 粒子节点挂载容器，通常为棋盘容器
     */
    public static play(block: HexBlock, parent: Node): void {
        if (!block?.node?.isValid || !parent?.isValid) return;

        const colorId = Math.min(6, Math.max(1, block.dir));
        // 方块可能在资源加载完成前销毁，因此必须提前保存世界坐标。
        const worldPosition = block.node.worldPosition.clone();
        this.loadAndSpawn(colorId, parent, worldPosition);
    }

    /** 在底板位置播放与 ColorFloor 材质一致的灰紫色破碎粒子。 */
    public static playFloor(floorNode: Node, parent: Node): void {
        if (!floorNode?.isValid || !parent?.isValid) return;
        this.loadAndSpawn(this.floorTemplateId, parent, floorNode.worldPosition.clone(), this.floorColor);
    }

    /**
     * 在指定世界坐标处播放对应方向颜色的破碎粒子 (专供锯齿轮粉碎、特殊机关等使用)
     * @param worldPosition 粒子爆炸的世界坐标
     * @param parent 粒子节点挂载容器 (通常为棋盘容器)
     * @param colorId 颜色/方向编号 1~6
     * @param tint 可选着色
     */
    public static playAtWorldPos(worldPosition: Vec3, parent: Node, colorId: number = 1, tint?: Color): void {
        if (!parent?.isValid) return;
        const validId = Math.min(6, Math.max(1, colorId));
        this.loadAndSpawn(validId, parent, worldPosition.clone(), tint);
    }

    // ======================================== 资源加载 ========================================
    private static loadAndSpawn(prefabId: number, parent: Node, worldPosition: Vec3, tint?: Color): void {
        const cachedPrefab = this.prefabCache.get(prefabId);

        if (cachedPrefab) {
            this.spawn(cachedPrefab, parent, worldPosition, tint);
            return;
        }

        resources.load(`${this.prefabPath}${prefabId}`, Prefab, (error, prefab) => {
            if (error || !prefab) {
                return;
            }

            this.prefabCache.set(prefabId, prefab);
            if (parent.isValid) this.spawn(prefab, parent, worldPosition, tint);
        });
    }

    // ======================================== 粒子实例化与回收 ========================================
    /** 创建粒子实例，并在完整播放后释放临时节点。 */
    private static spawn(prefab: Prefab, parent: Node, worldPosition: Vec3, tint?: Color): void {
        const particleNode = instantiate(prefab);
        particleNode.setParent(parent);
        particleNode.setWorldPosition(worldPosition);

        // 统一加快所有子粒子系统，保持各层碎片原有的速度比例和运动方向。
        particleNode.getComponentsInChildren(ParticleSystem).forEach(particleSystem => {
            particleSystem.simulationSpeed = this.playbackSpeed;
            // 透明辅助粒子保持原样，只调整实际可见的三层碎片颜色。
            if (tint && particleSystem.startColor.color.a > 0) {
                particleSystem.startColor.color.set(tint);
            }
        });

        tween(particleNode)
            .delay(this.recycleDelay)
            .call(() => {
                if (particleNode.isValid) particleNode.destroy();
            })
            .start();
    }
}
