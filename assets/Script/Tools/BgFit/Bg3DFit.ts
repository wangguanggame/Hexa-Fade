import { _decorator, Component, Node, Camera, view, screen } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('Bg3DFit')
@executeInEditMode(true)
export class Bg3DFit extends Component {
    @property({ type: Camera, tooltip: '绑定的3D相机，不填则默认获取父节点或场景主相机' })
    public targetCamera: Camera | null = null;

    @property({ tooltip: '背景原图宽度' })
    public bgWidth: number = 1080;

    @property({ tooltip: '背景原图高度' })
    public bgHeight: number = 1920;

    @property({ tooltip: '是否保持原图比例等比铺满（Aspect Fill，不变形无黑边）' })
    public aspectFill: boolean = true;

    onLoad() {
        this.fit();
    }

    start() {
        this.fit();
    }

    onEnable() {
        this.fit();
        if (view && typeof view.on === 'function') {
            view.on('canvas-resize', this.fit, this);
        }
        if (screen && typeof screen.on === 'function') {
            screen.on('window-resize', this.fit, this);
        }
    }

    onDisable() {
        if (view && typeof view.off === 'function') {
            view.off('canvas-resize', this.fit, this);
        }
        if (screen && typeof screen.off === 'function') {
            screen.off('window-resize', this.fit, this);
        }
    }

    /**
     * 3D背景自适应铺满相机视锥体
     */
    public fit() {
        if (!this.node || !this.node.isValid) return;

        // 1. 获取相机
        let cam = this.targetCamera;
        if (!cam) {
            cam = this.node.parent?.getComponent(Camera) || null;
        }
        if (!cam && this.node.scene) {
            cam = this.node.scene.getComponentInChildren(Camera) || null;
        }
        if (!cam) return;

        // 2. 获取屏幕可视宽高
        let screenWidth = 1080;
        let screenHeight = 1920;
        if (view && typeof view.getVisibleSize === 'function') {
            const visibleSize = view.getVisibleSize();
            if (visibleSize && visibleSize.width > 0 && visibleSize.height > 0) {
                screenWidth = visibleSize.width;
                screenHeight = visibleSize.height;
            }
        }
        const screenAspect = screenWidth / screenHeight;

        // 3. 计算相机到 Quad 的距离（沿着相机主轴 Z 方向）
        const distance = Math.abs(this.node.position.z);
        if (distance <= 0) return;

        let frustumWidth = 0;
        let frustumHeight = 0;

        if (cam.projection === Camera.ProjectionType.PERSPECTIVE) {
            // 透视相机：根据 FOV 和 距离计算视野平面尺寸
            const fov = cam.fov;
            const halfFovRad = (fov * Math.PI) / 360; // (fov / 2) * (PI / 180)
            
            // 0: VERTICAL, 1: HORIZONTAL
            if (cam.fovAxis === 1) {
                // 水平 FOV
                frustumWidth = 2 * distance * Math.tan(halfFovRad);
                frustumHeight = frustumWidth / screenAspect;
            } else {
                // 垂直 FOV
                frustumHeight = 2 * distance * Math.tan(halfFovRad);
                frustumWidth = frustumHeight * screenAspect;
            }
        } else {
            // 正交相机
            frustumHeight = cam.orthoHeight * 2;
            frustumWidth = frustumHeight * screenAspect;
        }

        // 4. 计算 Quad 最终缩放
        let scaleX = frustumWidth;
        let scaleY = frustumHeight;

        if (this.aspectFill && this.bgWidth > 0 && this.bgHeight > 0) {
            const imgAspect = this.bgWidth / this.bgHeight;
            if (screenAspect > imgAspect) {
                // 屏幕比图片更宽：以宽度撑满，高度等比放大
                scaleX = frustumWidth;
                scaleY = frustumWidth / imgAspect;
            } else {
                // 屏幕比图片更高：以高度撑满，宽度等比放大
                scaleY = frustumHeight;
                scaleX = frustumHeight * imgAspect;
            }
        }

        // 默认 Quad 为 1x1 单位大小
        this.node.setScale(scaleX, scaleY, 1);
        this.node.setPosition(0, 0, this.node.position.z);
    }
}
