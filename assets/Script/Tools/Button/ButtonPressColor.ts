import * as cc from "cc";
const { ccclass, property } = cc._decorator;

/**
 * 按钮点击变色工具组件
 * 功能：点击按钮时，节点及其所有子节点（Sprite/Label）变色，松开或取消时恢复原色
 */
@ccclass('ButtonPressColor')
export class ButtonPressColor extends cc.Component {
    // ================================================================================================================================
    // 挂载变量
    // ================================================================================================================================
    @property({ type: cc.Color, displayName: "按下颜色", tooltip: "按钮按下时变为何种颜色", group: { name: "基础设置", id: "0" } })
    public pressColor: cc.Color = new cc.Color(211, 211, 211, 255);

    // ================================================================================================================================
    // 私有变量
    // ================================================================================================================================
    /** 用于记录按下前的原始颜色映射表 */
    private _originalColors: Map<cc.Node, cc.Color> = new Map();

    // ================================================================================================================================
    // 生命周期
    // ================================================================================================================================
    /**
     * 生命周期 - 启用
     */
    onEnable() {
        this.node.on(cc.Node.EventType.TOUCH_START, this.onPress, this);
        this.node.on(cc.Node.EventType.TOUCH_END, this.onRelease, this);
        this.node.on(cc.Node.EventType.TOUCH_CANCEL, this.onRelease, this);
    }

    /**
     * 生命周期 - 禁用
     */
    onDisable() {
        this.node.off(cc.Node.EventType.TOUCH_START, this.onPress, this);
        this.node.off(cc.Node.EventType.TOUCH_END, this.onRelease, this);
        this.node.off(cc.Node.EventType.TOUCH_CANCEL, this.onRelease, this);

        // 预防：当组件禁用时，如果是按下状态应清理记录
        this._originalColors.clear();
    }

    // ================================================================================================================================
    // 内部逻辑
    // ================================================================================================================================
    /**
     * 处理按钮按下逻辑
     */
    private onPress() {
        this._originalColors.clear();
        this.applyColorRecursive(this.node, true);
    }

    /**
     * 处理按钮释放/取消逻辑
     */
    private onRelease() {
        this.applyColorRecursive(this.node, false);
        this._originalColors.clear();
    }

    /**
     * 递归遍历并应用/恢复颜色
     * @param root 当前处理的根节点
     * @param isPress 是否是应用按下色
     */
    private applyColorRecursive(root: cc.Node, isPress: boolean) {
        if (!root) return;

        // 1. 处理 Sprite 组件
        const sprite = root.getComponent(cc.Sprite);
        if (sprite) {
            if (isPress) {
                this._originalColors.set(root, sprite.color.clone());
                sprite.color = this.pressColor;
            } else {
                const originalColor = this._originalColors.get(root);
                if (originalColor) sprite.color = originalColor;
            }
        }

        // 2. 处理 Label 组件
        const label = root.getComponent(cc.Label);
        if (label) {
            if (isPress) {
                // 如果之前没记过色再记一遍（防止同一节点多组件冲突）
                if (!this._originalColors.has(root)) {
                    this._originalColors.set(root, label.color.clone());
                }
                label.color = this.pressColor;
            } else {
                const originalColor = this._originalColors.get(root);
                if (originalColor) label.color = originalColor;
            }
        }

        // 3. 处理 Spine 组件
        const skeleton = root.getComponent(cc.sp.Skeleton);
        if (skeleton) {
            if (isPress) {
                if (!this._originalColors.has(root)) {
                    this._originalColors.set(root, skeleton.color.clone());
                }
                skeleton.color = this.pressColor;
            } else {
                const originalColor = this._originalColors.get(root);
                if (originalColor) skeleton.color = originalColor;
            }
        }

        // 4. 递归处理所有子节点
        for (const child of root.children) {
            this.applyColorRecursive(child, isPress);
        }
    }
}