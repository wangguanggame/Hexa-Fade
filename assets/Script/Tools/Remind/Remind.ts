import { _decorator, Component, Node, Label, Prefab, resources, instantiate, tween, Vec3, UIOpacity, director, find, easing } from 'cc';
import { GameScene } from '../../Scene/GameScene';

const { ccclass, property } = _decorator;

/**
 * 全局浮动提示管理器 (Remind / Toast)
 * 对应预制体: resources/Public/View/Remind.prefab
 * 提供轻量级浮窗动画展示与自动销毁机制。
 */
@ccclass('Remind')
export class Remind extends Component {
    private static _cachedPrefab: Prefab | null = null;
    private static _currentRemindNode: Node | null = null;

    /**
     * 预加载 Remind 预制体
     */
    public static preload(callback?: (prefab: Prefab) => void) {
        if (this._cachedPrefab) {
            if (callback) callback(this._cachedPrefab);
            return;
        }

        resources.load('Public/View/Remind', Prefab, (err, prefab) => {
            if (!err && prefab) {
                Remind._cachedPrefab = prefab;
                if (callback) callback(prefab);
            }
        });
    }

    /**
     * 弹出系统提示浮窗 (对齐 4095_SniperZone showTipRemind 接口)
     * @param text 提示文字内容
     * @param fontSize 可选指定字号大小
     * @param duration 停留展示时间 (秒，默认 1.3s)
     * @param parent 挂载父节点 (默认为 GameScene.topUI 或 Canvas)
     */
    public static showTipRemind(text: string, fontSize?: number, duration: number = 1.3, parent?: Node) {
        Remind.show(text, fontSize, duration, parent);
    }

    /**
     * 弹出系统提示浮窗 (快捷方法)
     * @param text 提示文字内容
     * @param fontSize 可选指定字号大小
     * @param duration 停留展示时间 (秒，默认 1.3s)
     * @param parent 挂载父节点 (默认为 GameScene.topUI 或 Canvas)
     */
    public static show(text: string, fontSize?: number, duration: number = 1.3, parent?: Node) {
        if (!text) return;

        const spawnTip = (prefab: Prefab) => {
            // 若当前已有正在展示的 Remind，平滑顶替销毁，防止文字堆叠重影
            if (Remind._currentRemindNode && Remind._currentRemindNode.isValid) {
                tween(Remind._currentRemindNode).stop();
                const oldOp = Remind._currentRemindNode.getComponent(UIOpacity);
                if (oldOp) tween(oldOp).stop();
                Remind._currentRemindNode.destroy();
                Remind._currentRemindNode = null;
            }

            // 智能寻找最佳挂载父节点 (优先 topUI 顶层容器，其次 Canvas)
            let targetParent = parent;
            if (!targetParent || !targetParent.isValid) {
                const gameScene = GameScene.instance || director.getScene()?.getComponentInChildren(GameScene);
                if (gameScene && typeof gameScene.getTopUIParent === 'function') {
                    targetParent = gameScene.getTopUIParent();
                } else {
                    targetParent = find('Canvas/topUI') || find('Canvas') || director.getScene()?.getChildByName('Canvas') || (director.getScene() as any);
                }
            }

            if (!targetParent || !targetParent.isValid) {
                return;
            }

            const temp = instantiate(prefab);
            temp.parent = targetParent;
            temp.setSiblingIndex(targetParent.children.length - 1);
            Remind._currentRemindNode = temp;

            // 兼容检索 text / remindText / 任意子节点 Label
            const textNode = temp.getChildByName('text') || temp.getChildByName('remindText') || temp.getChildByName('Label');
            const lbl = (textNode ? textNode.getComponent(Label) : null) || temp.getComponentInChildren(Label);
            if (lbl) {
                lbl.string = text;
                if (fontSize && fontSize > 0) {
                    lbl.fontSize = fontSize;
                    lbl.lineHeight = fontSize;
                }
            }

            // 确保挂载 UIOpacity 用于透明度渐变
            let opacityComp = temp.getComponent(UIOpacity);
            if (!opacityComp) {
                opacityComp = temp.addComponent(UIOpacity);
            }

            // 初始状态配置 (居中偏中上方展示)
            temp.setPosition(0, 80, 0);
            temp.setScale(new Vec3(0.6, 0.6, 1));
            opacityComp.opacity = 0;

            // 动效：弹性放大淡入 -> 悬停停留 -> 向上微飘淡出销毁
            tween(temp)
                .to(0.22, { scale: new Vec3(1.06, 1.06, 1) }, { easing: easing.sineOut })
                .to(0.12, { scale: new Vec3(1.0, 1.0, 1) }, { easing: easing.sineIn })
                .start();

            tween(opacityComp)
                .to(0.22, { opacity: 255 }, { easing: easing.sineOut })
                .delay(duration)
                .to(0.35, { opacity: 0 }, { easing: easing.sineIn })
                .start();

            tween(temp)
                .delay(duration + 0.22)
                .by(0.35, { position: new Vec3(0, 120, 0) }, { easing: easing.sineIn })
                .call(() => {
                    if (temp.isValid) {
                        temp.destroy();
                    }
                    if (Remind._currentRemindNode === temp) {
                        Remind._currentRemindNode = null;
                    }
                })
                .start();
        };

        if (Remind._cachedPrefab) {
            spawnTip(Remind._cachedPrefab);
        } else {
            Remind.preload((prefab) => {
                spawnTip(prefab);
            });
        }
    }
}
