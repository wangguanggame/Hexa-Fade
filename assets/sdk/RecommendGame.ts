import { Sprite, SpriteFrame, Texture2D, Node, Widget, Vec3, tween, Tween, log, warn, assetManager, JsonAsset, UITransform, isValid } from "cc";
import { GameSDK } from "./GameSDK";

type Texture2DAssetMap = Record<string, Texture2D>;
type JsonAssetMap = Record<string, JsonAsset>;


export default class RecommendGame {
    private static _instance: RecommendGame;
    public static getInstance(): RecommendGame {
        if (!this._instance) {
            this._instance = new RecommendGame();
        }
        return this._instance;
    }

    private showNowIndex: number = -1;
    private RecommentNode: Node = null;
    private RecommendJsonData: { id: string, name: string, icon: string, weight: number, spriteFrame: SpriteFrame }[] = [];

    private texture2DAssetMap: Texture2DAssetMap = {};
    private jsonAssetMap: JsonAssetMap = {};

    init() {
        this.RequestGameConfigJsonData().then((data) => {
            if (data && data.shareApp) {
                this.RecommendJsonData = JSON.parse(data.shareApp);

                this.RecommendJsonData = this.weightedShuffle(this.RecommendJsonData);

                this.loadRecommendImage();
                log("Parsed recommend game data:", this.RecommendJsonData);
            } else {
                console.error("Failed to load recommend game data.");
            }
        }).catch((error) => {
            console.error("Error loading recommend game data:", error);
        });
    }

    private loadRecommendImage() {
        if (this.RecommendJsonData && this.RecommendJsonData.length > 0) {
            for (let i = 0; i < this.RecommendJsonData.length; i++) {
                const item = this.RecommendJsonData[i];
                this.loadAsset(item.icon).then((result) => {
                    let sp = new SpriteFrame();
                    const texture = new Texture2D();
                    texture.image = result;
                    sp.texture = texture;
                    item.spriteFrame = sp;
                }).catch((error) => {
                    console.error("Error loading image for recommend game:", error);
                });
            }
        }
    }

    HideGameRecomment() {
        if (!this.RecommentNode) return; // 节点不存在直接返回
        this.RecommentNode.active = false;
        Tween.stopAllByTarget(this.RecommentNode);
    }

    ShowGameRecomment(parent: Node, distance: { left?: number; top?: number; right?: number; bottom?: number }, size?: { width: number, height: number }) {
        if (GameSDK.inst.GetPlatForm()) return;
        this.showNowIndex++; // 更新索引，准备下次显示下一个游戏

        const item = this.RecommendJsonData[this.showNowIndex % this.RecommendJsonData.length];
        log("当前推荐游戏", this.showNowIndex, item);

        // 如果节点已失效，重置为 null 触发重新创建
        if (this.RecommentNode && !isValid(this.RecommentNode)) {
            this.RecommentNode = null;
        }

        // 如果已显示且节点可见，直接返回
        if ((this.RecommentNode && this.RecommentNode.active) || !item) return;

        // 如果节点不存在，创建一个
        if (!this.RecommentNode) {
            const node = new Node();
            node.addComponent(Sprite);
            node.addComponent(Widget);
            let width = size?.width || 120;
            let height = size?.height || 140;
            node.getComponent(UITransform).width = width;
            node.getComponent(UITransform).height = height;
            node.parent = parent;
            this.RecommentNode = node;

            this.RecommentNode.on(Node.EventType.TOUCH_END, () => {
                let currentItem = this.RecommendJsonData[(this.showNowIndex) % this.RecommendJsonData.length];
                log("点击了推荐游戏", currentItem);

                GameSDK.inst.switchGameAsync(currentItem.id, { switch_game_name: currentItem.name })
                    .then((bo) => {
                        if (bo) {
                            log("成功跳转游戏", currentItem.name);
                        }
                        else {
                            this.showNowIndex++; // 索引递增，切换下一个推荐
                            this.updateRecommendSprite(); // 调用更新图片的方法
                            warn("跳转失败，尝试切换推荐游戏");

                        }
                    })
                    .catch((error) => {
                        warn("跳转失败，尝试切换推荐游戏", error);

                    });
            }, this); // 点击事件
        } else {
            // 确保节点挂载到最新的父节点，防止之前的父节点被销毁导致无法显示
            this.RecommentNode.parent = parent;
        }

        if (!item) {
            console.error("RecommendJsonData is empty or invalid");
            return;
        }

        // ✅ 设置当前推荐图片
        this.updateRecommendSprite();

        const widget = this.RecommentNode.getComponent(Widget)!;

        // ✅ 动态设置 Widget 对齐并开启对应的 isAlign 开关
        widget.isAlignLeft = widget.isAlignTop = widget.isAlignRight = widget.isAlignBottom = false;

        if (distance.left !== undefined) {
            widget.isAlignLeft = true;
            widget.left = distance.left;
        }
        if (distance.top !== undefined) {
            widget.isAlignTop = true;
            widget.top = distance.top;
        }
        if (distance.right !== undefined) {
            widget.isAlignRight = true;
            widget.right = distance.right;
        }
        if (distance.bottom !== undefined) {
            widget.isAlignBottom = true;
            widget.bottom = distance.bottom;
        }

        widget.updateAlignment();

        this.RecommentNode.active = true;

        // ✅ 清理旧动画
        Tween.stopAllByTarget(this.RecommentNode);

        // ✅ 动画
        this.RecommentNode.setScale(new Vec3(0, 0, 1));
        tween(this.RecommentNode)
            .delay(0.2)
            .to(0.6, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
            .call(() => {
                tween(this.RecommentNode)
                    .repeatForever(
                        tween()
                            .to(1, { scale: new Vec3(1.1, 1.1, 1) })
                            .to(1, { scale: new Vec3(1, 1, 1) })
                    )
                    .start();
            })
            .start();
    }

    /**
     * ✅ 单独封装：更新推荐图片逻辑
     */
    private updateRecommendSprite() {
        const item = this.RecommendJsonData[this.showNowIndex % this.RecommendJsonData.length];
        if (!item) return;

        const spriteComp = this.RecommentNode.getComponent(Sprite)!;
        spriteComp.sizeMode = Sprite.SizeMode.CUSTOM;

        if (item.spriteFrame) {
            spriteComp.spriteFrame = item.spriteFrame;
        } else {
            this.loadAsset(item.icon)
                .then((result: Texture2D) => {
                    const sp = new SpriteFrame();
                    sp.texture = result;
                    item.spriteFrame = sp;
                    spriteComp.spriteFrame = sp;
                })
                .catch((error) => {
                    console.error("Error loading image for recommend game:", error);
                });
        }
    }



    // ✅ 加权随机排序算法
    private weightedShuffle<T extends { weight: number }>(arr: T[]): T[] {
        return arr
            .map(item => ({
                ...item,
                _rand: Math.random() ** (1 / item.weight) // 权重大 → 值更小 → 更靠前
            }))
            .sort((a, b) => a._rand - b._rand) // 按随机值升序排序
            .map(item => {
                delete item._rand;
                return item;
            });
    }

    /**
     * 
     * @returns 返回所有所有分组和模板列表
     */
    private async RequestGameConfigJsonData(): Promise<any> {
        return await this.loadJsonUrlAsset(GameSDK.inst.GetGameRecommendJsonData());
    }

    loadJsonUrlAsset(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.jsonAssetMap[url]) {
                resolve(this.jsonAssetMap[url].json);
            }
            else {
                assetManager.loadRemote<JsonAsset>(url, (error, resources: JsonAsset) => {
                    if (!error) {
                        this.jsonAssetMap[url] = resources;
                        resolve(resources.json);
                    } else {
                        reject(error);
                    }
                });
            }
        })
    }

    loadAsset(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.texture2DAssetMap[url]) {
                resolve(this.texture2DAssetMap[url]);
            }
            else {
                assetManager.loadRemote<Texture2D>(url, { ext: '.jpg' }, (error, resources: Texture2D) => {
                    if (!error) {
                        this.texture2DAssetMap[url] = resources;
                        resolve(resources);
                    } else {
                        reject(error);
                    }
                });
            }
        })
    }
}

