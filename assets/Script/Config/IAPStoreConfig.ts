import { RewardKind } from '../View/RewardPage';

/**
 * 单项道具奖励结构
 */
export interface IAPPropReward {
    type: RewardKind;
    count: number;
}

/**
 * 内购商品配置接口
 */
export interface IAPProductItem {
    /** 平台内购商品 ID（必须与平台后台注册的 Product ID 严格一致） */
    id: string;
    /** 逻辑唯一标识 */
    key: string;
    /** 对应 IapPage.prefab 视图层次中的节点名称 */
    nodeName: string;
    /** 商品显示名称 */
    title: string;
    /** 商品描述 */
    description: string;
    /** 美元标价数值 (如 0.99, 1.99) */
    priceUSD: number;
    /** 是否属于非消耗品（如永久去广告，购买后不再展示） */
    isNonConsumable?: boolean;
    /** 是否包含永久免去插屏广告权益 */
    isRemoveAds?: boolean;
    /** 包含金币奖励数 */
    coins: number;
    /** 包含道具奖励列表 */
    props?: IAPPropReward[];
}

/**
 * 格式化内购价格，兼容位图字体 numimage1.fnt
 * 在 numimage1.fnt 中，小数点 '.' 使用字符 'D' 代替，如 1.99 -> "$1D99"
 */
export function formatIapFontPrice(priceUSD: number): string {
    const priceStr = priceUSD.toFixed(2);
    return `$${priceStr.replace('.', 'D')}`;
}

/**
 * IapPage 默认商店商品配置列表
 * 精确匹配 IapPage.prefab 中的节点结构与美术标签
 */
export const DEFAULT_IAP_PRODUCTS: IAPProductItem[] = [
    {
        id: 'com.kayiyou.hexafade.iap.gift1',
        key: 'SPECIAL_OFFER',
        nodeName: 'SpecialOffer',
        title: 'Special Offer',
        description: 'Includes 500 Coins and 3 of every Booster!',
        priceUSD: 3.99,
        coins: 500,
        props: [
            { type: 'MOVE', count: 3 },
            { type: 'HAMMER', count: 3 },
            { type: 'DRILL', count: 3 },
            { type: 'TNT', count: 3 },
        ],
    },
    {
        id: 'com.kayiyou.hexafade.iap.removead',
        key: 'REMOVE_ADS',
        nodeName: 'RemoveAds',
        title: 'Remove Ads',
        description: 'Permanently remove ads and get 200 Coins!',
        priceUSD: 2.99,
        isNonConsumable: true,
        isRemoveAds: true,
        coins: 200,
    },
    {
        id: 'com.kayiyou.hexafade.iap.gift2',
        key: 'SUPER_BUNDLE',
        nodeName: 'SuperBundle',
        title: 'Super Bundle',
        description: 'Includes 200 Coins and 2 of every Booster!',
        priceUSD: 1.99,
        coins: 200,
        props: [
            { type: 'MOVE', count: 2 },
            { type: 'HAMMER', count: 2 },
            { type: 'DRILL', count: 2 },
            { type: 'TNT', count: 2 },
        ],
    },
    {
        id: 'com.kayiyou.hexafade.iap.gift4',
        key: 'COIN_100',
        nodeName: 'Coin100',
        title: '100 Coins',
        description: 'Get 100 Coins',
        priceUSD: 0.99,
        coins: 100,
    },
    {
        id: 'com.kayiyou.hexafade.iap.gift5',
        key: 'COIN_200',
        nodeName: 'Coin200',
        title: '200 Coins',
        description: 'Get 200 Coins',
        priceUSD: 1.99,
        coins: 200,
    },
    {
        id: 'com.kayiyou.hexafade.iap.gift6',
        key: 'COIN_300',
        nodeName: 'Coin300',
        title: '300 Coins',
        description: 'Get 300 Coins',
        priceUSD: 2.99,
        coins: 300,
    },
    {
        id: 'com.kayiyou.hexafade.iap.gift7',
        key: 'COIN_500',
        nodeName: 'Coin500',
        title: '500 Coins',
        description: 'Get 500 Coins',
        priceUSD: 3.99,
        coins: 500,
    },
];

/**
 * 根据节点名称获取对应的内购商品配置
 */
export function getProductByNodeName(nodeName: string): IAPProductItem | undefined {
    return DEFAULT_IAP_PRODUCTS.find(p => p.nodeName === nodeName);
}

/**
 * 根据 Product ID 获取对应的内购商品配置
 */
export function getProductById(productId: string): IAPProductItem | undefined {
    return DEFAULT_IAP_PRODUCTS.find(p => p.id === productId);
}
