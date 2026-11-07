import { _decorator, BlockInputEvents, Component, instantiate, Node, Prefab, resources, Sprite, tween, UIOpacity } from 'cc';

const { ccclass } = _decorator;

/**
 * 页面实例化时的等待遮罩。
 * 打开签到、转盘、奖励页前先盖住界面，实例化结束后再关掉。
 */
@ccclass('LoadingWaiting')
export class LoadingWaiting extends Component {
    private static _prefab: Prefab | null = null;
    private static _node: Node | null = null;
    private static _parent: Node | null = null;
    private static _holders = 0;
    private static _loading = false;
    private static _waiters: Array<() => void> = [];

    /** 全局统一超时兜底时间 (秒) */
    public static readonly DEFAULT_TIMEOUT_SEC: number = 5.0;
    private static _watchdogTimer: any = null;

    private _icon: Node | null = null;

    private static _startWatchdog(timeoutSec: number = LoadingWaiting.DEFAULT_TIMEOUT_SEC): void {
        this._clearWatchdog();
        this._watchdogTimer = setTimeout(() => {
            if (this._holders > 0 || (this._node && this._node.isValid)) {
                this.forceClose();
            }
        }, timeoutSec * 1000);
    }

    private static _clearWatchdog(): void {
        if (this._watchdogTimer) {
            clearTimeout(this._watchdogTimer);
            this._watchdogTimer = null;
        }
    }

    /**
     * 显示等待页。遮罩挂上之后才执行 onReady，保证页面实例化开始前已经盖住。
     * 统一具备 5 秒安全看门狗兜底，防止任何调用方未及时 release 导致遮罩卡死。
     */
    public static acquire(parent: Node, onReady: () => void, timeoutSec: number = LoadingWaiting.DEFAULT_TIMEOUT_SEC): void {
        this._holders++;
        this._parent = parent;
        this._startWatchdog(timeoutSec);

        if (this._node && this._node.isValid) {
            if (this._node.parent !== parent) {
                this._node.setParent(parent);
            }
            this.raise();
            onReady();
            return;
        }

        this._waiters.push(onReady);
        if (this._loading) return;
        this._loading = true;

        const mount = (prefab: Prefab) => {
            this._loading = false;
            const waiters = this._waiters.splice(0);
            if (this._holders <= 0 || !this._parent || !this._parent.isValid) {
                waiters.forEach((fn) => fn());
                return;
            }
            if (!this._node || !this._node.isValid) {
                const node = instantiate(prefab);
                node.setParent(this._parent);
                this._node = node;
                if (!node.getComponent(LoadingWaiting)) {
                    node.addComponent(LoadingWaiting);
                }
            }
            this.raise();
            waiters.forEach((fn) => fn());
        };

        if (this._prefab) {
            mount(this._prefab);
            return;
        }

        resources.load('Public/View/LoadingWaiting', Prefab, (err, prefab) => {
            if (err || !prefab) {
                this._loading = false;
                const waiters = this._waiters.splice(0);
                waiters.forEach((fn) => fn());
                return;
            }
            this._prefab = prefab;
            mount(prefab);
        });
    }

    /** 一次打开流程结束时调用。没有其它页面还在等，就关掉遮罩。 */
    public static release(): void {
        this._holders = Math.max(0, this._holders - 1);
        if (this._holders > 0) return;
        this._clearWatchdog();
        if (this._node && this._node.isValid) {
            this._node.destroy();
        }
        this._node = null;
    }

    /** 强制清空所有等待计数并立即关闭遮罩 */
    public static forceClose(): void {
        this._holders = 0;
        this._clearWatchdog();
        if (this._node && this._node.isValid) {
            this._node.destroy();
        }
        this._node = null;
    }

    /** 等待遮罩 bg 的 alpha，需与 LoadingWaiting.prefab 保持一致。 */
    public static readonly DIM_ALPHA = 220;

    /**
     * 接手等待遮罩的页面背景应从这个 UIOpacity 起步：乘上背景图自身 alpha 后与等待遮罩一样暗，
     * 等待遮罩撤掉的那一帧屏幕亮度不变，不会闪一下。
     */
    public static coverOpacity(bg: Node | null): number {
        const alpha = bg?.getComponent(Sprite)?.color.a ?? 255;
        if (alpha <= 0) return 255;
        return Math.min(255, Math.round(this.DIM_ALPHA * 255 / alpha));
    }

    /** 整页淡入的页面接手等待遮罩时用：背景直接全显，只淡入背景以外的内容。 */
    public static fadeInExcept(root: Node, bg: Node | null, duration: number): void {
        const rootOpacity = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
        rootOpacity.opacity = 255;
        for (const child of root.children) {
            if (child === bg) continue;
            const opacity = child.getComponent(UIOpacity) || child.addComponent(UIOpacity);
            opacity.opacity = 0;
            tween(opacity).to(duration, { opacity: 255 }).start();
        }
    }

    /** 页面节点后挂上来时，把等待层重新放到最上面。 */
    public static raise(): void {
        if (!this._node || !this._node.isValid || !this._node.parent) return;
        this._node.setSiblingIndex(this._node.parent.children.length - 1);
    }

    onLoad(): void {
        this._icon = this.node.getChildByName('loadingIcon');
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }
    }

    update(dt: number): void {
        if (!this._icon || !this._icon.isValid) return;
        this._icon.angle -= 360 * dt;
    }
}
