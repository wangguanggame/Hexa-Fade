import { EPSILON, Node, RenderData, StencilManager, UIRenderer, approx, cclegacy, clamp, gfx, log } from "cc";
enum Stage {
    // Stencil disabled
    DISABLED = 0,
    // Clear stencil buffer
    CLEAR = 1,
    // Entering a new level, should handle new stencil
    ENTER_LEVEL = 2,
    // In content
    ENABLED = 3,
    // Exiting a level, should restore old stencil or disable
    EXIT_LEVEL = 4,
    // Clear stencil buffer & USE INVERTED
    CLEAR_INVERTED = 5,
    // Entering a new level & USE INVERTED
    ENTER_LEVEL_INVERTED = 6,
}

export default class CCCExtension {
    static init() {
        this._extendRender3_x();
    }

    private static _extendRender3_x() {
        const batch2d = cclegacy[`internal`][`Batcher2D`];
        let __renderQueue: Node[][] = [];

        const levelSplit = (node: Node, lv: number, itemIndex) => {
            if (!__renderQueue[lv]) {
                __renderQueue[lv] = [];
            }
            __renderQueue[lv].push(node);
            lv++;
            node["__renderLv"] = lv;
            node["__levelRender"] = true;
            node["__itemIndex"] = itemIndex;
            const cs = node.children;
            for (let i = 0; i < cs.length; ++i) {
                const c = cs[i];
                if (!__renderQueue[lv]) {
                    __renderQueue[lv] = [];
                }
                lv = levelSplit(c, lv, itemIndex);
            }
            return lv;
        }
        Object.defineProperty(batch2d.prototype, "walk", {
            value: function (node: Node, level = 0) {
                if (!node[`activeInHierarchy`]) {
                    return;
                }
                const children = node.children;
                const uiProps = node._uiProps;
                const render = uiProps.uiComp as UIRenderer;
                // Save opacity
                let parentOpacity = 1;
                if (node.parent) {
                    parentOpacity = node.parent._uiProps.opacity;
                }
                let opacity = parentOpacity;
                // TODO Always cascade ui property's local opacity before remove it
                const selfOpacity = render && render.color ? render.color.a / 255 : 1;

                opacity *= selfOpacity * uiProps.localOpacity;
                // TODO Set opacity to ui property's opacity before remove it
                if (uiProps[`setOpacity`]) {
                    uiProps[`setOpacity`](opacity);
                } else {
                    uiProps[`_opacity`] = opacity;
                }
                if (!approx(opacity, 0, EPSILON)) {
                    if (uiProps.colorDirty) {
                        // Cascade color dirty state
                        this._opacityDirty++;
                    }

                    // Render assembler update logic
                    if (render && render.enabledInHierarchy) {
                        render.fillBuffers(this);// for rendering
                    }

                    // Update cascaded opacity to vertex buffer
                    if (this._opacityDirty && render && !render.useVertexOpacity && render.renderData && render.renderData.vertexCount > 0) {
                        // HARD COUPLING
                        updateOpacity(render.renderData, opacity);
                        const buffer = render.renderData.getMeshBuffer();
                        if (buffer) {
                            buffer.setDirty();
                        }
                    }

                    if (children.length > 0 && !node._static) {
                        if (!node[`__levelRender`]) {
                            __renderQueue = [];
                            for (let i = 0; i < children.length; ++i) {
                                const child = children[i];
                                const enableLevelRender = node[`__enableLevelRender`];
                                if (!enableLevelRender) {
                                    this.walk(child, level);
                                } else {
                                    levelSplit(child, 0, i);
                                }
                            }
                            while (__renderQueue.length > 0) {
                                const list = __renderQueue.shift();
                                if (list.length > 0) {
                                    while (list.length > 0) {
                                        const n = list.shift();
                                        this.walk(n, level);
                                    }
                                }
                            }
                        }
                    }

                    if (uiProps.colorDirty) {
                        // Reduce cascaded color dirty state
                        this._opacityDirty--;
                        // Reset color dirty
                        uiProps.colorDirty = false;
                    }
                }
                // Restore opacity
                // this._pOpacity = parentOpacity;

                // Post render assembler update logic
                // ATTENTION: Will also reset colorDirty inside postUpdateAssembler
                if (render && render.enabledInHierarchy) {
                    render.postUpdateAssembler(this);
                    if ((render.stencilStage as any === Stage.ENTER_LEVEL || render.stencilStage as any === Stage.ENTER_LEVEL_INVERTED)
                        && (StencilManager.sharedManager!.getMaskStackSize() > 0)) {
                        this.autoMergeBatches(this._currComponent!);
                        this.resetRenderStates();
                        StencilManager.sharedManager!.exitMask();
                    }
                }
                level += 1;
            }
        });
    }
}

export function updateOpacity(renderData: RenderData, opacity: number) {
    const vfmt = renderData.vertexFormat;
    const vb = renderData.chunk.vb;
    let attr; let format; let stride;
    // Color component offset
    let offset = 0;
    for (let i = 0; i < vfmt.length; ++i) {
        attr = vfmt[i];
        format = gfx.FormatInfos[attr.format];
        if (format.hasAlpha) {
            stride = renderData.floatStride;
            if (format.size / format.count === 1) {
                const alpha = ~~clamp(Math.round(opacity * 255), 0, 255);
                // Uint color RGBA8
                for (let color = offset; color < vb.length; color += stride) {
                    vb[color] = ((vb[color] & 0xffffff00) | alpha) >>> 0;
                }
            } else if (format.size / format.count === 4) {
                // RGBA32 color, alpha at position 3
                for (let alpha = offset + 3; alpha < vb.length; alpha += stride) {
                    vb[alpha] = opacity;
                }
            }
        }
        offset += format.size >> 2;
    }
}