import { instantiate, Node, ParticleSystem, Prefab, resources, Vec3, tween } from 'cc';

/** 爆炸特效统一加载器：按名称缓存，并在播放结束后回收实例。 */
export class BoomParticle {
    private static preloadTask: Promise<void> | null = null;
    private static readonly cache = new Map<string, Prefab>();
    private static readonly paths: Record<string, string> = {
        boom: 'Main/Game/Particle/Boom/Boom',
        piece: 'Main/Game/Particle/Boom/Boom-piece',
        ice: 'Main/Game/Particle/Boom/Boom-ice',
        smoke: 'Main/Game/Particle/Boom/Boom-ice-smoke',
        trail: 'Main/Game/Particle/Boom/Trail',
    };

    /** 加载页提前填充播放缓存，首次爆炸不再等异步加载。 */
    public static preload(): Promise<void> {
        if (!this.preloadTask) {
            this.preloadTask = Promise.all(Object.values(this.paths).map(path => new Promise<void>((resolve, reject) => {
                if (this.cache.has(path)) { resolve(); return; }
                resources.load(path, Prefab, (err, prefab) => {
                    if (err || !prefab) { reject(err || new Error('Missing effect: ' + path)); return; }
                    this.cache.set(path, prefab);
                    resolve();
                });
            }))).then(() => {}).catch(err => { this.preloadTask = null; throw err; });
        }
        return this.preloadTask;
    }

    public static play(name: keyof typeof BoomParticle.paths, parent: Node, worldPosition: Vec3, lifetime = 2.5): void {
        if (!parent?.isValid) return;
        const path = this.paths[name];
        const cached = this.cache.get(path);
        if (cached) { this.spawn(cached, parent, worldPosition, lifetime); return; }
        resources.load(path, Prefab, (error, prefab) => {
            if (error || !prefab) return;
            this.cache.set(path, prefab);
            if (parent.isValid) this.spawn(prefab, parent, worldPosition, lifetime);
        });
    }

    private static spawn(prefab: Prefab, parent: Node, worldPosition: Vec3, lifetime: number): void {
        const node = instantiate(prefab);
        node.setParent(parent);
        node.setWorldPosition(worldPosition);
        node.getComponentsInChildren(ParticleSystem).forEach(system => system.simulationSpeed = 1.0);
        tween(node).delay(lifetime).call(() => { if (node.isValid) node.destroy(); }).start();
    }
}
