import { AudioClip, AudioSource, director, Node, resources } from 'cc';
import { GameData } from '../../Config/GameData';

/** 音效文件名，对应 resources/Audio 下的 mp3。 */
export const AudioId = {
    bgm: 'bgm',
    uiClick: 'ui_click',
    sign: 'sign',
    buy: 'buy',
    claim: 'claim',
    rotate: 'rotate',
    iceClear: 'ice_clear',
    score: 'score',
    gameClick: 'game_click',
    stone: 'stone',
    victory: 'victory',
    stoneDrop: 'stone_drop',
    stoneRoll: 'stone_roll',
    stoneBlock: 'stone_block',
    combo3: 'combo_3',
    combo5: 'combo_5',
    combo6: 'combo_6',
    combo7: 'combo_7',
    combo8: 'combo_8',
    propStep: 'prop_step',
    propBomb: 'prop_bomb',
    propSaw: 'prop_saw',
    propHammer: 'prop_hammer',
    obstacle: 'obstacle',
} as const;

const HOME_DIR = 'Audio/Home';
const GAME_DIR = 'Audio/Game';
const SFX_COUNT = 4;
const SAME_CLIP_GAP = 80;

const CLIP_PATH: Record<string, string> = {
    [AudioId.bgm]: `${HOME_DIR}/bgm`,
    [AudioId.uiClick]: `${HOME_DIR}/ui_click`,
    [AudioId.sign]: `${HOME_DIR}/sign`,
    [AudioId.buy]: `${HOME_DIR}/buy`,
    [AudioId.claim]: `${HOME_DIR}/claim`,
    [AudioId.rotate]: `${GAME_DIR}/rotate`,
    [AudioId.iceClear]: `${GAME_DIR}/ice_clear`,
    [AudioId.score]: `${GAME_DIR}/score`,
    [AudioId.gameClick]: `${GAME_DIR}/game_click`,
    [AudioId.stone]: `${GAME_DIR}/stone`,
    [AudioId.victory]: `${GAME_DIR}/victory`,
    [AudioId.stoneDrop]: `${GAME_DIR}/stone_drop`,
    [AudioId.stoneRoll]: `${GAME_DIR}/stone_roll`,
    [AudioId.stoneBlock]: `${GAME_DIR}/stone_block`,
    [AudioId.combo3]: `${GAME_DIR}/combo_3`,
    [AudioId.combo5]: `${GAME_DIR}/combo_5`,
    [AudioId.combo6]: `${GAME_DIR}/combo_6`,
    [AudioId.combo7]: `${GAME_DIR}/combo_7`,
    [AudioId.combo8]: `${GAME_DIR}/combo_8`,
    [AudioId.propStep]: `${GAME_DIR}/prop_step`,
    [AudioId.propBomb]: `${GAME_DIR}/prop_bomb`,
    [AudioId.propSaw]: `${GAME_DIR}/prop_saw`,
    [AudioId.propHammer]: `${GAME_DIR}/prop_hammer`,
    [AudioId.obstacle]: `${GAME_DIR}/obstacle`,
};

/**
 * 音效管理。
 * 大厅音效在启动时后台加载，关卡音效在进关进度里加载。
 * 背景音乐挂在常驻节点上，切场景不会断。
 */
export class Audio {
    private static clips = new Map<string, AudioClip>();
    private static homeTask: Promise<void> | null = null;
    private static gameTask: Promise<void> | null = null;
    private static root: Node | null = null;
    private static bgmSource: AudioSource | null = null;
    private static sfxSources: AudioSource[] = [];
    private static sfxIndex = 0;
    private static lastPlayAt = new Map<string, number>();
    private static musicOn = true;
    private static soundOn = true;

    /** 进游戏前后台加载大厅音效，不阻塞切场景。 */
    static preloadHome(onProgress?: (ratio: number) => void): Promise<void> {
        if (!this.homeTask) {
            this.homeTask = this.preloadDir(HOME_DIR, onProgress);
        } else if (onProgress) {
            this.homeTask.then(() => onProgress(1));
        }
        return this.homeTask;
    }

    /** 进关卡时加载对局音效。 */
    static preloadGame(onProgress?: (ratio: number) => void): Promise<void> {
        if (!this.gameTask) {
            this.gameTask = this.preloadDir(GAME_DIR, onProgress, true).catch(err => {
                this.gameTask = null;
                throw err;
            });
        } else if (onProgress) {
            return this.gameTask.then(() => onProgress(1));
        }
        return this.gameTask;
    }

    /** 创建常驻音源，并开始播背景音乐。 */
    static boot(): void {
        this.sync();
        this.ensure();
        this.sync();
        this.preloadHome().then(() => this.playBgm());
    }

    static play(id: string): void {
        if (!this.soundOn) return;
        const now = Date.now();
        const last = this.lastPlayAt.get(id) || 0;
        if (now - last < SAME_CLIP_GAP) return;
        this.lastPlayAt.set(id, now);

        const clip = this.clips.get(id);
        if (clip) {
            this.shot(clip);
            return;
        }
        const path = CLIP_PATH[id];
        if (!path) return;
        resources.load(path, AudioClip, (err, loaded) => {
            if (err || !loaded) {
                return;
            }
            this.clips.set(loaded.name || id, loaded);
            if (this.soundOn) this.shot(loaded);
        });
    }

    /** 连击 3/5/6/7/8 播对应音效，其余消除播得分。 */
    static playCombo(combo: number): void {
        if (combo >= 8) this.play(AudioId.combo8);
        else if (combo === 7) this.play(AudioId.combo7);
        else if (combo === 6) this.play(AudioId.combo6);
        else if (combo === 5) this.play(AudioId.combo5);
        else if (combo === 3) this.play(AudioId.combo3);
        else this.play(AudioId.score);
    }

    static playBgm(): void {
        const start = (clip: AudioClip) => {
            const source = this.ensure();
            if (source.clip !== clip) source.clip = clip;
            source.loop = true;
            this.sync();
        };
        const cached = this.clips.get(AudioId.bgm);
        if (cached) {
            start(cached);
            return;
        }
        resources.load(CLIP_PATH[AudioId.bgm], AudioClip, (err, loaded) => {
            if (err || !loaded) {
                return;
            }
            this.clips.set(AudioId.bgm, loaded);
            start(loaded);
        });
    }

    /** 读取设置里的音乐、音效开关，并套到音源上。 */
    static sync(): void {
        this.readSetting();
        const source = this.bgmSource;
        if (!source || !source.isValid) return;
        source.volume = this.musicOn ? 1 : 0;
        if (source.clip) {
            if (!this.musicOn && source.playing) source.pause();
            if (this.musicOn && !source.playing) source.play();
        }
        for (let i = 0; i < this.sfxSources.length; i++) {
            const sfx = this.sfxSources[i];
            if (sfx && sfx.isValid) sfx.volume = this.soundOn ? 1 : 0;
        }
    }

    private static readSetting(): void {
        const data = GameData.instance;
        this.musicOn = data.musicOn;
        this.soundOn = data.soundOn;
    }

    private static preloadDir(dir: string, onProgress?: (ratio: number) => void, required = false): Promise<void> {
        return new Promise((resolve, reject) => {
            resources.loadDir(
                dir,
                AudioClip,
                (finished: number, total: number) => {
                    if (total > 0 && onProgress) onProgress(finished / total);
                },
                (err, assets) => {
                    if (err && required) { reject(err); return; }
                    if (!err && assets) {
                        for (let i = 0; i < assets.length; i++) {
                            const clip = assets[i];
                            if (clip && clip.name) this.clips.set(clip.name, clip);
                        }
                    }
                    if (onProgress) onProgress(1);
                    resolve();
                }
            );
        });
    }

    private static ensure(): AudioSource {
        if (this.bgmSource && this.bgmSource.isValid && this.root && this.root.isValid) {
            return this.bgmSource;
        }
        const root = new Node('Audio');
        director.addPersistRootNode(root);

        const bgmNode = new Node('bgm');
        bgmNode.setParent(root);
        const bgm = bgmNode.addComponent(AudioSource);
        bgm.loop = true;
        bgm.playOnAwake = false;
        this.root = root;
        this.bgmSource = bgm;
        this.sfxSources = [];

        for (let i = 0; i < SFX_COUNT; i++) {
            const node = new Node('sfx');
            node.setParent(root);
            const source = node.addComponent(AudioSource);
            source.loop = false;
            source.playOnAwake = false;
            this.sfxSources.push(source);
        }
        return bgm;
    }

    private static shot(clip: AudioClip): void {
        this.ensure();
        if (this.sfxSources.length === 0) return;
        const source = this.sfxSources[this.sfxIndex % this.sfxSources.length];
        this.sfxIndex++;
        if (!source || !source.isValid) return;
        source.volume = this.soundOn ? 1 : 0;
        source.playOneShot(clip, 1);
    }
}
