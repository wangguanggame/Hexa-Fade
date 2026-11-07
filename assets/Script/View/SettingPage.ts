import {
    _decorator, assetManager, AudioSource, Component, director, instantiate,
    Node, Prefab, resources, Sprite, SpriteFrame, tween, UIOpacity, Vec3,
} from 'cc';
import { GameData } from '../Config/GameData';
import { GameMain, GameState } from '../Logic/GameMain';
import { PropsManager } from '../Logic/PropsManager';
import { GameScene } from '../Scene/GameScene';
import { Remind } from '../Tools/Remind/Remind';
import { GameSDK } from '../../sdk/GameSDK';
import { LoadingWaiting } from './LoadingWaiting';
import { GamePage } from './GamePage';
import { Audio, AudioId } from '../Tools/Audio/Audio';

const { ccclass, property } = _decorator;

export type SettingFrom = 'home' | 'game';

const TOGGLE_ON_UUID = '17b4c85b-930f-4b93-b366-860b1fb0cada@f9941';
const TOGGLE_OFF_UUID = 'caf82ba7-57e7-43dc-b62d-ffdcc7a95137@f9941';


/**
 * 设置页。
 * 首页打开：只显示分享。
 * 游戏页打开：显示重开和回首页，并暂停对局。
 */
@ccclass('SettingPage')
export class SettingPage extends Component {
    private static _current: Node | null = null;
    private static _opening = false;
    private static _audioLoaded = false;
    private static _musicOn = true;
    private static _soundOn = true;

    @property({ type: Node, tooltip: '遮罩', group: { name: '节点', id: '0' } })
    public mask: Node | null = null;

    @property({ type: Node, tooltip: '面板', group: { name: '节点', id: '0' } })
    public frame: Node | null = null;

    @property({ type: Node, tooltip: '关闭按钮', group: { name: '节点', id: '0' } })
    public btnClose: Node | null = null;

    @property({ type: Node, tooltip: '音乐开关', group: { name: '节点', id: '0' } })
    public btnMusic: Node | null = null;

    @property({ type: Node, tooltip: '音效开关', group: { name: '节点', id: '0' } })
    public btnSound: Node | null = null;

    @property({ type: Node, tooltip: '分享按钮', group: { name: '按钮', id: '1' } })
    public btnShare: Node | null = null;

    @property({ type: Node, tooltip: '回首页按钮', group: { name: '按钮', id: '1' } })
    public btnHome: Node | null = null;

    @property({ type: Node, tooltip: '重开按钮', group: { name: '按钮', id: '1' } })
    public btnRetry: Node | null = null;

    @property({ type: SpriteFrame, tooltip: '开关打开图', group: { name: '开关图', id: '2' } })
    public toggleOn: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '开关关闭图', group: { name: '开关图', id: '2' } })
    public toggleOff: SpriteFrame | null = null;

    private _from: SettingFrom = 'home';
    private _pausedGame = false;
    private _isClosing = false;
    private _sharing = false;
    private _holdsLoading = false;
    private _openSettled = false;

    public static get musicOn(): boolean {
        this.loadAudio();
        return this._musicOn;
    }

    public static get soundOn(): boolean {
        this.loadAudio();
        return this._soundOn;
    }

    /** 启动时套用上次保存的音乐、音效开关。 */
    public static applySaved(): void {
        this.loadAudio();
        this.applyAudio();
    }

    public static show(from: SettingFrom = 'home', parent?: Node): void {
        if (this._current && this._current.isValid) return;
        if (this._opening) return;

        const targetParent = parent || GameScene.instance?.getTopUIParent();
        if (!targetParent?.isValid) {
            return;
        }

        this._opening = true;
        LoadingWaiting.acquire(targetParent, () => {
            resources.load('Other/View/SettingPage', Prefab, (error, prefab) => {
                const abort = () => {
                    this._opening = false;
                    LoadingWaiting.release();
                };
                if (error || !prefab) {
                    abort();
                    return;
                }
                if (!targetParent.isValid || (this._current && this._current.isValid)) {
                    abort();
                    return;
                }

                const node = instantiate(prefab);
                const page = node.getComponent(SettingPage) || node.addComponent(SettingPage);
                page.prepare(from);
                page.markLoadingHeld();
                node.setParent(targetParent);
                node.setSiblingIndex(targetParent.children.length - 1);
                LoadingWaiting.raise();
                this._current = node;
                this._opening = false;
            });
        });
    }

    public prepare(from: SettingFrom): void {
        this._from = from;
    }

    public markLoadingHeld(): void {
        this._holdsLoading = true;
    }

    onLoad(): void {
        GameSDK.inst.logEvent('showPage', { value: 'settingPage' });
        SettingPage.loadAudio();
        this.bindNodes();

        if (!this.toggleOn) {
            this.toggleOn = this.btnMusic?.getComponent(Sprite)?.spriteFrame
                || this.btnSound?.getComponent(Sprite)?.spriteFrame
                || null;
        }

        this.applyMode();
        this.refreshToggles();
        this.bindButtons();
        SettingPage.applyAudio();

        if (this._from === 'game') this.pauseGame();

        if (this.frame) this.frame.setScale(new Vec3(0, 0, 1));
        if (this.mask) {
            const maskOpacity = this.mask.getComponent(UIOpacity) || this.mask.addComponent(UIOpacity);
            maskOpacity.opacity = 0;
        }
    }

    start(): void {
        this.ensureToggleFrames(() => {
            if (this.node && this.node.isValid) this.refreshToggles();
        });
        this.finishOpen(true);
    }

    onDestroy(): void {
        this.unbindButtons();
        this.resumeGame();
        this.finishOpen(false);
        if (SettingPage._current === this.node) SettingPage._current = null;
    }

    /** 编辑器没拖上时，按预制体节点名补上。 */
    private bindNodes(): void {
        if (!this.mask) this.mask = this.node.getChildByName('Mask');
        if (!this.frame) this.frame = this.node.getChildByName('Frame');
        if (!this.btnClose) this.btnClose = this.frame?.getChildByName('BtnClose') || this.node.getChildByName('BtnClose');
        if (!this.btnMusic) this.btnMusic = this.frame?.getChildByPath('music/btnMusic') || null;
        if (!this.btnSound) this.btnSound = this.frame?.getChildByPath('sound/btnSound') || null;
        if (!this.btnShare) this.btnShare = this.frame?.getChildByName('BtnShare') || null;
        if (!this.btnHome) this.btnHome = this.frame?.getChildByName('BtnHome') || null;
        if (!this.btnRetry) this.btnRetry = this.frame?.getChildByName('BtnRetry') || null;
    }

    private applyMode(): void {
        const fromGame = this._from === 'game';
        if (this.btnShare) this.btnShare.active = !fromGame;
        if (this.btnHome) this.btnHome.active = fromGame;
        if (this.btnRetry) this.btnRetry.active = fromGame;
    }

    private bindButtons(): void {
        if (this.btnClose) this.btnClose.on(Node.EventType.TOUCH_END, this.onClose, this);
        if (this.btnMusic) this.btnMusic.on(Node.EventType.TOUCH_END, this.onToggleMusic, this);
        if (this.btnSound) this.btnSound.on(Node.EventType.TOUCH_END, this.onToggleSound, this);
        if (this.btnShare) this.btnShare.on(Node.EventType.TOUCH_END, this.onShare, this);
        if (this.btnHome) this.btnHome.on(Node.EventType.TOUCH_END, this.onHome, this);
        if (this.btnRetry) this.btnRetry.on(Node.EventType.TOUCH_END, this.onRetry, this);
    }

    private unbindButtons(): void {
        if (this.btnClose?.isValid) this.btnClose.off(Node.EventType.TOUCH_END, this.onClose, this);
        if (this.btnMusic?.isValid) this.btnMusic.off(Node.EventType.TOUCH_END, this.onToggleMusic, this);
        if (this.btnSound?.isValid) this.btnSound.off(Node.EventType.TOUCH_END, this.onToggleSound, this);
        if (this.btnShare?.isValid) this.btnShare.off(Node.EventType.TOUCH_END, this.onShare, this);
        if (this.btnHome?.isValid) this.btnHome.off(Node.EventType.TOUCH_END, this.onHome, this);
        if (this.btnRetry?.isValid) this.btnRetry.off(Node.EventType.TOUCH_END, this.onRetry, this);
    }

    private onClose(): void {
        Audio.play(AudioId.uiClick);
        this.close();
    }

    private onToggleMusic(): void {
        if (this._isClosing) return;
        Audio.play(AudioId.uiClick);
        SettingPage._musicOn = !SettingPage._musicOn;
        SettingPage.saveAudio();
        SettingPage.applyAudio();
        this.refreshToggles();
    }

    private onToggleSound(): void {
        if (this._isClosing) return;
        Audio.play(AudioId.uiClick);
        SettingPage._soundOn = !SettingPage._soundOn;
        SettingPage.saveAudio();
        SettingPage.applyAudio();
        this.refreshToggles();
    }

    private onShare(): void {
        if (this._isClosing || this._sharing || this._from !== 'home') return;
        Audio.play(AudioId.uiClick);
        this._sharing = true;
        GameSDK.inst.shareAsync().then(() => {
            this._sharing = false;
        }).catch(() => {
            this._sharing = false;
        });
    }

    private onHome(): void {
        if (this._isClosing || this._from !== 'game') return;
        Audio.play(AudioId.uiClick);
        this.cancelProp();
        this._pausedGame = false;
        this.close(() => {
            const gameScene = GameScene.instance || director.getScene()?.getComponentInChildren(GameScene);
            gameScene?.backToHome();
        });
    }

    private onRetry(): void {
        if (this._isClosing || this._from !== 'game') return;
        Audio.play(AudioId.uiClick);
        this.cancelProp();
        this._pausedGame = false;
        this.close(() => {
            const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
            const levelId = gameMain?.currentLevelId || GameData.instance.currentLevel || 1;
            gameMain?.renderLevel(levelId);
            GamePage.instance?.updateMovesDisplay();
            GamePage.instance?.updateLevelDisplay(levelId);
            GamePage.instance?.updateScoreDisplay(0);
        });
    }

    private cancelProp(): void {
        if (PropsManager.instance && PropsManager.instance.isPropActive) {
            PropsManager.instance.cancelProp();
        }
    }

    private pauseGame(): void {
        const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
        if (!gameMain || gameMain.gameState !== GameState.PLAYING) return;
        gameMain.gameState = GameState.PAUSE;
        gameMain.isPlaying = false;
        this._pausedGame = true;
    }

    private resumeGame(): void {
        if (!this._pausedGame) return;
        this._pausedGame = false;
        const gameMain = GameMain.instance || director.getScene()?.getComponentInChildren(GameMain);
        if (!gameMain) return;
        if (gameMain.gameState === GameState.VICTORY || gameMain.gameState === GameState.FAIL) return;
        if (gameMain.gameState === GameState.PAUSE) {
            gameMain.gameState = GameState.PLAYING;
            gameMain.isPlaying = true;
        }
    }

    private refreshToggles(): void {
        this.setToggle(this.btnMusic, SettingPage._musicOn);
        this.setToggle(this.btnSound, SettingPage._soundOn);
    }

    private setToggle(node: Node | null, on: boolean): void {
        const sprite = node?.getComponent(Sprite);
        if (!sprite) return;
        const frame = on ? this.toggleOn : this.toggleOff;
        if (frame) sprite.spriteFrame = frame;
    }

    private ensureToggleFrames(done: () => void): void {
        let pending = 0;
        const finishOne = () => {
            pending--;
            if (pending <= 0) done();
        };
        const load = (uuid: string, assign: (frame: SpriteFrame) => void, missing: boolean) => {
            if (!missing) return;
            pending++;
            assetManager.loadAny(uuid, (error: Error | null, asset: SpriteFrame) => {
                if (!error && asset) assign(asset);
                finishOne();
            });
        };
        load(TOGGLE_ON_UUID, (frame) => { this.toggleOn = frame; }, !this.toggleOn);
        load(TOGGLE_OFF_UUID, (frame) => { this.toggleOff = frame; }, !this.toggleOff);
        if (pending === 0) done();
    }

    private finishOpen(playAnim: boolean): void {
        if (this._openSettled) return;
        this._openSettled = true;
        if (playAnim && this.node && this.node.isValid) this.playEnterAnimation();
        if (this._holdsLoading) {
            this._holdsLoading = false;
            LoadingWaiting.release();
        }
    }

    private playEnterAnimation(): void {
        if (this.mask && this.mask.isValid) {
            const maskOpacity = this.mask.getComponent(UIOpacity) || this.mask.addComponent(UIOpacity);
            maskOpacity.opacity = this._holdsLoading ? LoadingWaiting.coverOpacity(this.mask) : 0;
            tween(maskOpacity).to(0.2, { opacity: 230 }).start();
        }
        if (!this.frame || !this.frame.isValid) return;
        this.frame.setScale(new Vec3(0.2, 0.2, 1));
        tween(this.frame)
            .to(0.28, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'cubicOut' })
            .to(0.1, { scale: Vec3.ONE }, { easing: 'quadOut' })
            .start();
    }

    private close(after?: () => void): void {
        if (this._isClosing || !this.node || !this.node.isValid) return;
        this._isClosing = true;

        if (this.frame && this.frame.isValid) {
            tween(this.frame)
                .to(0.18, { scale: new Vec3(0.2, 0.2, 1) }, { easing: 'quadIn' })
                .start();
        }
        if (this.mask && this.mask.isValid) {
            const maskOpacity = this.mask.getComponent(UIOpacity);
            if (maskOpacity) tween(maskOpacity).to(0.18, { opacity: 0 }).start();
        }

        this.scheduleOnce(() => {
            if (!after) this.resumeGame();
            if (SettingPage._current === this.node) SettingPage._current = null;
            if (this.node && this.node.isValid) this.node.destroy();
            if (after) after();
        }, 0.2);
    }

    private static loadAudio(): void {
        if (this._audioLoaded) return;
        this._audioLoaded = true;
        const data = GameData.instance;
        this._musicOn = data.musicOn;
        this._soundOn = data.soundOn;
    }

    private static saveAudio(): void {
        const data = GameData.instance;
        data.musicOn = this._musicOn;
        data.soundOn = this._soundOn;
        data.saveData();
    }

    /** 循环音源当背景音乐，其余当音效。没挂音频时只记住开关。 */
    private static applyAudio(): void {
        const scene = director.getScene();
        if (!scene) {
            Audio.sync();
            return;
        }
        const sources = scene.getComponentsInChildren(AudioSource);
        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            const isMusic = source.loop || /music|bgm/i.test(source.node.name);
            if (isMusic) {
                source.volume = this._musicOn ? 1 : 0;
                if (!source.clip) continue;
                if (!this._musicOn && source.playing) source.pause();
                if (this._musicOn && !source.playing) source.play();
            } else {
                source.volume = this._soundOn ? 1 : 0;
            }
        }
        Audio.sync();
    }
}
