import { _decorator, Component, Node } from 'cc';
const { ccclass, property, menu } = _decorator;

@ccclass('LevelRender')
@menu("性能优化/LevelRender")
export class LevelRender extends Component {
    onLoad() {
        this.node[`__enableLevelRender`] = true;
    }
}

