import { _decorator, Component, Node, Prefab, instantiate, resources, Vec3, tween, Color, Sprite, UITransform, BlockInputEvents, Widget } from 'cc';
import { LoadingWaiting } from './LoadingWaiting';
import { GameScene } from '../Scene/GameScene';
import { IapPage } from './IapPage';
import { ChampionshipPage } from './ChampionshipPage';
import { CollectionPage } from './CollectionPage';
import { GameData, GameDataEvent } from '../Config/GameData';
import { Audio, AudioId } from '../Tools/Audio/Audio';
import { GameSDK } from '../../sdk/GameSDK';

const { ccclass, property } = _decorator;

@ccclass('TabPage')
export class TabPage extends Component {
    // ======================================== 挂载变量 ========================================
    @property({ type: Node, tooltip: '页面展示容器节点 (showPage)', group: { name: '节点', id: '0' } })
    public showPage: Node = null!;

    @property({ type: Node, tooltip: '底部导航栏容器节点（tab）', group: { name: '节点', id: '0' } })
    public tab: Node = null!;

    @property({ type: Node, tooltip: '底栏背景节点（tabBg，支持纯色或图片）', group: { name: '节点', id: '0' } })
    public tabBg: Node | null = null;

    @property({ type: Node, tooltip: '选中高亮节点（highlightBg，支持纯色或图片）', group: { name: '节点', id: '0' } })
    public highlightBg: Node | null = null;

    @property({ type: Prefab, tooltip: 'HomePage 预制体（可选，留空则自动从 resources 动态加载）', group: { name: '预制体', id: '1' } })
    public homePagePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: 'RankPage 预制体（可选，支持在编辑器中直接拖拽挂载）', group: { name: '预制体', id: '1' } })
    public rankPagePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: 'IapPage 预制体（可选，支持在编辑器中直接拖拽挂载）', group: { name: '预制体', id: '1' } })
    public iapPagePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: 'ChampionshipPage 锦标赛预制体（可选，支持在编辑器中直接拖拽挂载）', group: { name: '预制体', id: '1' } })
    public championshipPagePrefab: Prefab | null = null;

    // ======================================== 私有变量 ========================================
    /** 当前 showPage 容器下唯一挂载的子页面实例节点 */
    private _currentPageNode: Node | null = null;

    /** 当前选中的 Tab 按钮名称 */
    private _currentTabName: string = '';
    private _tabButtonBasePositions = new Map<Node, Vec3>();

    /** 藏品解锁演出进行中，挡住底部 Tab，避免玩家中途点走。 */
    private _lockTabs: boolean = false;
    private _presentingUnlock: boolean = false;

    // ======================================== 生命周期 ========================================
    onLoad() {
        GameData.event.on(GameDataEvent.COLLECTION_UNLOCK_SHOWN, this.onCollectionUnlockShown, this);
    }

    start() {
        // 1. 检查并初始化底栏纯色背景与选中高亮
        this.ensureBackgrounds();
        this.applyPlatformTabHeight();

        // 2. 初始化底部 Tab 按钮点击事件。
        this.initTabEvents();

        // 3. 默认进入首页大厅，首次渲染立即定位。
        this.switchTab('btnHome', true);

        this.scheduleOnce(() => GameScene.instance?.warmUpGameResources(), 0);

        // 4. 刚解锁藏品时，先在首页停一下，再切进收藏页播解锁。
        this.tryPresentCollectionUnlock();
    }

    onDestroy() {
        GameData.event.off(GameDataEvent.COLLECTION_UNLOCK_SHOWN, this.onCollectionUnlockShown, this);
    }

    // ======================================== 初始化与事件绑定 ========================================
    private applyPlatformTabHeight(): void {
        const transform = this.tab?.getComponent(UITransform);
        if (!transform) return;
        transform.height = GameSDK.inst.GetPlatForm() === 1 ? 468 : 408;
        // 先定位底栏，再刷新背景、高亮及顶部对齐的按钮容器。
        this.tab.getComponent(Widget)?.updateAlignment();
        for (const child of this.tab.children) {
            child.getComponent(Widget)?.updateAlignment();
        }
    }

    /**
     * 确保底栏背景和高亮节点存在，并提供纯色兜底。
     */
    private ensureBackgrounds() {
        if (!this.tab) return;

        // 1. 查找或获取 tabBg 节点。
        if (!this.tabBg) {
            this.tabBg = this.tab.getChildByName('tabBg');
        }
        if (!this.tabBg) {
            this.tabBg = new Node('tabBg');
            const tf = this.tabBg.addComponent(UITransform);
            tf.setContentSize(1080, this.tab.getComponent(UITransform)?.height ?? 248);
            const sp = this.tabBg.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.color = new Color(56, 61, 140, 255); // 深蓝紫色底板纯色
            this.tabBg.setParent(this.tab);
            this.tabBg.setSiblingIndex(0);
        }

        // 2. 查找或获取 highlightBg 节点
        if (!this.highlightBg) {
            this.highlightBg = this.tab.getChildByName('highlightBg');
        }
        if (!this.highlightBg) {
            this.highlightBg = new Node('highlightBg');
            const tf = this.highlightBg.addComponent(UITransform);
            tf.setContentSize(216, this.tab.getComponent(UITransform)?.height ?? 248);
            const sp = this.highlightBg.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.color = new Color(75, 72, 185, 255); // 选中高亮底色纯色
            this.highlightBg.setParent(this.tab);
            this.highlightBg.setSiblingIndex(1);
        }
    }

    /**
     * 绑定底部 Tab 导航栏中所有按钮的点击事件
     */
    private getTabButtons(): Node[] {
        const container = this.tab?.getChildByName('buttonBox') || this.tab;
        return container?.children.filter(child => child.name.startsWith('btn')) || [];
    }

    private initTabEvents() {
        if (!this.tab) {
            return;
        }

        // 兼容 buttonBox 容器与原先直接挂在 tab 下的按钮。
        this.getTabButtons().forEach(btnNode => {

            btnNode.on(Node.EventType.TOUCH_END, () => {
                if (this._lockTabs) return;
                Audio.play(AudioId.uiClick);
                this.switchTab(btnNode.name);
            }, this);
        });
    }

    // ======================================== Tab 页面切换与销毁重建 ========================================
    /**
     * 切换选中 Tab 页面（销毁旧页面，重新创建新页面，保证 showPage 下最多只有一个页面）
     * @param tabName 按钮节点名称 ("btnHome" | "btnCollection" | "btnRank" | "btnPass" | "btnIap")
     * @param immediate 是否立即定位（用于初次启动，不播放位移动画）
     * @param fromFlow 解锁演出内部切换，不受 Tab 锁影响
     */
    public switchTab(tabName: string, immediate: boolean = false, fromFlow: boolean = false) {
        if (this._lockTabs && !fromFlow) return;
        // 1. 若点击的是当前已处于激活状态的同一 Tab，直接拦截，绝不执行销毁重建
        if (this._currentTabName === tabName && !immediate) {
            return;
        }
        this._currentTabName = tabName;

        // 2. 彻底销毁旧页面并清空 showPage 容器
        this.destroyCurrentPage();

        // 3. 更新底部按钮状态（处理 icon / txt / 选中高亮底块 / 微抬起）
        this.updateTabButtonsState(tabName, immediate);

        // 4. 重新创建并挂载目标页面
        this.createPage(tabName);
    }

    /** 有待播放的藏品解锁时：首页短暂停留，再进入收藏页。 */
    private tryPresentCollectionUnlock(): void {
        if (this._presentingUnlock || !GameData.instance.hasPendingCollectionUnlock()) return;
        this._presentingUnlock = true;
        this._lockTabs = true;
        this.setUnlockInputBlocked(true);
        this.scheduleOnce(() => {
            if (!this.isValid) return;
            if (!GameData.instance.hasPendingCollectionUnlock()) {
                this.endUnlockFlow();
                return;
            }
            this.switchTab('btnCollection', false, true);
        }, 0.45);
    }

    private onCollectionUnlockShown(): void {
        if (!this.isValid) return;
        this.switchTab('btnHome', false, true);
        this.scheduleOnce(() => this.endUnlockFlow(), 0.55);
    }

    private endUnlockFlow(): void {
        this._presentingUnlock = false;
        this._lockTabs = false;
        this.setUnlockInputBlocked(false);
    }

    private setUnlockInputBlocked(blocked: boolean): void {
        const blocker = this.ensureUnlockBlocker();
        blocker.active = blocked;
        if (blocked) blocker.setSiblingIndex(this.node.children.length - 1);
    }

    private ensureUnlockBlocker(): Node {
        let blocker = this.node.getChildByName('UnlockBlocker');
        if (!blocker) {
            blocker = new Node('UnlockBlocker');
            const transform = blocker.addComponent(UITransform);
            transform.setContentSize(3000, 3000);
            blocker.addComponent(BlockInputEvents);
            blocker.setParent(this.node);
        }
        return blocker;
    }

    /**
     * 销毁当前已挂载的页面。
     */
    private destroyCurrentPage() {
        if (this._currentPageNode && this._currentPageNode.isValid) {
            this._currentPageNode.removeFromParent();
            this._currentPageNode.destroy();
            this._currentPageNode = null;
        }

        if (this.showPage && this.showPage.isValid) {
            const children = this.showPage.children.slice();
            children.forEach(child => {
                if (child && child.isValid) {
                    child.removeFromParent();
                    child.destroy();
                }
            });
        }
    }

    /**
     * 根据 Tab 标识实例化新页面并挂载到 showPage
     */
    private createPage(tabName: string) {
        if (!this.showPage) return;

        // 1. 若 Inspector 面板已绑定对应的预制体，直接实例化
        if (tabName === 'btnHome' && this.homePagePrefab) {
            const pageNode = instantiate(this.homePagePrefab);
            this.mountPage(pageNode);
            this._currentPageNode = pageNode;
            return;
        }

        if (tabName === 'btnRank' && this.rankPagePrefab) {
            const pageNode = instantiate(this.rankPagePrefab);
            this.mountPage(pageNode);
            this._currentPageNode = pageNode;
            return;
        }

        if (tabName === 'btnIap' && this.iapPagePrefab) {
            const targetParent = GameScene.instance?.getTopUIParent() || this.showPage;
            LoadingWaiting.acquire(targetParent, () => {
                if (!this.isValid || this._currentTabName !== tabName || !this.showPage?.isValid) {
                    LoadingWaiting.release();
                    return;
                }
                const pageNode = instantiate(this.iapPagePrefab!);
                const page = pageNode.getComponent(IapPage) || pageNode.addComponent(IapPage);
                page.markLoadingHeld();
                this.mountPage(pageNode);
                this._currentPageNode = pageNode;
                LoadingWaiting.raise();
            });
            return;
        }

        if ((tabName === 'btnPass' || tabName === 'btnTm' || tabName === 'btnChampionship') && this.championshipPagePrefab) {
            const pageNode = instantiate(this.championshipPagePrefab);
            const champComp = pageNode.getComponent(ChampionshipPage) || pageNode.addComponent(ChampionshipPage);
            this.mountPage(pageNode);
            this._currentPageNode = pageNode;
            return;
        }

        // 2. 动态加载候选路径（支持首选路径与回退路径，使用 LoadingWaiting 等待遮罩）
        const candidatePaths = this.getCandidatePathsByTab(tabName);
        if (!candidatePaths || candidatePaths.length === 0) return;

        const targetParent = GameScene.instance?.getTopUIParent() || this.showPage;
        LoadingWaiting.acquire(targetParent, () => {
            this.loadPrefabFromCandidates(tabName, candidatePaths, 0);
        });
    }

    /**
     * 顺序尝试候选路径加载预制体
     */
    private loadPrefabFromCandidates(tabName: string, paths: string[], index: number) {
        if (index >= paths.length) {
            LoadingWaiting.release();
            return;
        }

        const resPath = paths[index];
        resources.load(resPath, Prefab, (err, prefab) => {
            // 如果加载失败，自动回退到下一个候选路径
            if (err || !prefab) {
                this.loadPrefabFromCandidates(tabName, paths, index + 1);
                return;
            }

            // 异步加载完成后，确认当前选中的 Tab 仍对应本页面
            if (this._currentTabName !== tabName) {
                LoadingWaiting.release();
                return;
            }

            // 再次确保容器清空
            this.destroyCurrentPage();

            const pageNode = instantiate(prefab);
            if (tabName === 'btnCollection') {
                const collection = pageNode.getComponent(CollectionPage) || pageNode.addComponent(CollectionPage);
                collection.markLoadingHeld();
            } else if (tabName === 'btnIap') {
                const iapComp = pageNode.getComponent(IapPage) || pageNode.addComponent(IapPage);
                iapComp.markLoadingHeld();
            } else if (tabName === 'btnPass' || tabName === 'btnTm' || tabName === 'btnChampionship') {
                const champComp = pageNode.getComponent(ChampionshipPage) || pageNode.addComponent(ChampionshipPage);
                champComp.markLoadingHeld();
            } else {
                LoadingWaiting.release();
            }

            this.mountPage(pageNode);
            this._currentPageNode = pageNode;
            LoadingWaiting.raise();
        });
    }

    /** 子页面仍使用全屏坐标，只调整原先为 200 高底栏预留的内容边距。 */
    private mountPage(pageNode: Node): void {
        const tabTransform = this.tab?.getComponent(UITransform);
        const tabWidget = this.tab?.getComponent(Widget);
        const bottomOffset = tabWidget?.isAlignBottom && tabWidget.isAbsoluteBottom ? tabWidget.bottom : 0;
        const extraBottom = (tabTransform?.height ?? 248) + bottomOffset - 200;
        // 首页预制体按 468 高底栏摆放，关卡按钮保留原有间距并跟随平台高度。
        if (this._currentTabName === 'btnHome') {
            const startWidget = pageNode.getChildByName('btnStart')?.getComponent(Widget);
            if (startWidget?.isAlignBottom && startWidget.isAbsoluteBottom) {
                startWidget.bottom += (tabTransform?.height ?? 468) + bottomOffset - 468;
            }
        }
        const frame = pageNode.getChildByName('Frame');
        if (frame) {
            for (const child of frame.children) {
                const widget = child.getComponent(Widget);
                if (widget?.isAlignBottom && widget.isAbsoluteBottom && widget.bottom >= 200) {
                    widget.bottom += extraBottom;
                }
            }
        }
        pageNode.setParent(this.showPage);
        // 先刷新页面及画框，再刷新列表，使首次显示就使用正确的可视高度。
        pageNode.getComponent(Widget)?.updateAlignment();
        pageNode.getChildByName('btnStart')?.getComponent(Widget)?.updateAlignment();
        frame?.getComponent(Widget)?.updateAlignment();
        if (frame) {
            for (const child of frame.children) child.getComponent(Widget)?.updateAlignment();
        }
    }

    /**
     * 获取页面对应的 resources 动态加载候选路径列表（按优先级排列）
     */
    private getCandidatePathsByTab(tabName: string): string[] {
        switch (tabName) {
            case 'btnHome': return ['Main/Home/View/HomePage'];
            case 'btnRank': return ['Other/View/RankPage', 'Main/Home/View/RankPage'];
            case 'btnCollection': return ['Other/View/CollectionPage'];
            case 'btnPass':
            case 'btnTm':
            case 'btnChampionship': return ['Other/View/ChampionshipPage', 'Main/Home/View/ChampionshipPage'];
            case 'btnIap':  return ['Other/View/IapPage', 'Main/Home/View/IapPage'];
            default:        return ['Main/Home/View/HomePage'];
        }
    }

    /**
     * 更新底部 Tab 按钮选中视觉状态：
     * 1. 选中 Tab：显示 txt，icon 向上浮动，icon 微放大，按钮整体微抬起，选中高亮底块滑动到位
     * 2. 未选中的 Tab 隐藏文本、居中图标，并恢复默认缩放和位置。
     * @param activeTabName 当前激活的 Tab 名称
     * @param immediate 是否立即更新而不播放过渡动画
     */
    private updateTabButtonsState(activeTabName: string, immediate: boolean = false) {
        if (!this.tab) return;

        const btnNodes = this.getTabButtons();
        let activeBtnNode: Node | null = null;

        btnNodes.forEach(btnNode => {
            // 首次切换前记录预制体位置，后续动画始终使用同一基准，避免累计偏移。
            if (!this._tabButtonBasePositions.has(btnNode)) {
                this._tabButtonBasePositions.set(btnNode, btnNode.position.clone());
            }
            const baseBtnPos = this._tabButtonBasePositions.get(btnNode)!;
            const isSelected = (btnNode.name === activeTabName);
            const iconNode = btnNode.getChildByName('icon');
            const txtNode = btnNode.getChildByName('txt');

            if (isSelected) {
                activeBtnNode = btnNode;

                // 1. 选中 Tab 显示文字
                if (txtNode) {
                    txtNode.active = true;
                }

                // 2. 选中 Tab 图标上移，给文字留出空间，并略微放大
                if (iconNode) {
                    const targetIconPos = new Vec3(0, 18, 0);
                    const targetIconScale = new Vec3(1.08, 1.08, 1);
                    if (immediate) {
                        iconNode.setPosition(targetIconPos);
                        iconNode.setScale(targetIconScale);
                    } else {
                        tween(iconNode).stop();
                        tween(iconNode)
                            .to(0.12, { position: targetIconPos, scale: new Vec3(1.15, 1.15, 1) }, { easing: 'quadOut' })
                            .to(0.08, { scale: targetIconScale }, { easing: 'quadIn' })
                            .start();
                    }
                }

                // 3. 选中 Tab 整体微抬起（y 偏移 +8）
                const targetBtnPos = new Vec3(baseBtnPos.x, baseBtnPos.y + 8, baseBtnPos.z);
                if (immediate) {
                    btnNode.setPosition(targetBtnPos);
                } else {
                    tween(btnNode).stop();
                    tween(btnNode)
                        .to(0.15, { position: targetBtnPos }, { easing: 'quadOut' })
                        .start();
                }
            } else {
                // 1. 未选中 Tab 隐藏文字（完全对齐主页效果图规范）
                if (txtNode) {
                    txtNode.active = false;
                }

                // 2. 未选中 Tab 图标垂直居中对齐，缩放恢复 1.0
                if (iconNode) {
                    const targetIconPos = new Vec3(0, 0, 0);
                    const targetIconScale = new Vec3(1, 1, 1);
                    if (immediate) {
                        iconNode.setPosition(targetIconPos);
                        iconNode.setScale(targetIconScale);
                    } else {
                        tween(iconNode).stop();
                        tween(iconNode)
                            .to(0.15, { position: targetIconPos, scale: targetIconScale }, { easing: 'quadOut' })
                            .start();
                    }
                }

                // 3. 未选中 Tab 恢复预制体设置的位置。
                const targetBtnPos = baseBtnPos.clone();
                if (immediate) {
                    btnNode.setPosition(targetBtnPos);
                } else {
                    tween(btnNode).stop();
                    tween(btnNode)
                        .to(0.15, { position: targetBtnPos }, { easing: 'quadOut' })
                        .start();
                }
            }
        });

        // 4. 移动选中高亮底色 highlightBg 到当前选中按钮水平位置
        if (this.highlightBg && activeBtnNode) {
            this.highlightBg.active = true;
            // 按钮与高亮可能分属不同父节点，先换算到高亮父节点坐标。
            const local = this.highlightBg.parent!.inverseTransformPoint(new Vec3(), (activeBtnNode as Node).worldPosition);
            const targetX = local.x;
            if (immediate) {
                this.highlightBg.setPosition(targetX, 0, 0);
            } else {
                tween(this.highlightBg).stop();
                tween(this.highlightBg)
                    .to(0.18, { position: new Vec3(targetX, 0, 0) }, { easing: 'cubicOut' })
                    .start();
            }
        }
    }
}
