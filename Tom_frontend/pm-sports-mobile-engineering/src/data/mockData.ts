import type { BetRecord, League, Match, MarketGroup, MarketKey, OddOption } from '../types';

const odd = (
  marketKey: MarketKey,
  marketName: string,
  id: string,
  label: string,
  value: number,
  line?: string,
  status: OddOption['status'] = 'open'
): OddOption => ({ id, marketKey, marketName, label, value, line, status });

const groups = (home: string, away: string): MarketGroup[] => [
  {
    key: 'handicap',
    title: '让球',
    count: 56,
    options: [
      odd('handicap', '让球', 'h-175-home', home, 2.0, '-1.75'),
      odd('handicap', '让球', 'h-175-away', away, 1.8, '+1.75'),
      odd('handicap', '让球', 'h-15-home', home, 1.85, '-1.5'),
      odd('handicap', '让球', 'h-15-away', away, 1.95, '+1.5'),
      odd('handicap', '让球', 'h-2-home', home, 2.25, '-2'),
      odd('handicap', '让球', 'h-2-away', away, 1.63, '+2')
    ]
  },
  {
    key: 'total',
    title: '大小',
    count: 56,
    options: [
      odd('total', '大小', 't-25-over', '大', 1.8, '2.5'),
      odd('total', '大小', 't-25-under', '小', 2.0, '2.5'),
      odd('total', '大小', 't-3-over', '大', 2.25, '3'),
      odd('total', '大小', 't-3-under', '小', 1.63, '3'),
      odd('total', '大小', 't-225-over', '大', 1.6, '2/2.5'),
      odd('total', '大小', 't-225-under', '小', 2.3, '2/2.5')
    ]
  },
  {
    key: 'moneyline',
    title: '独赢',
    count: 56,
    options: [
      odd('moneyline', '独赢', 'ml-home', home, 2.2),
      odd('moneyline', '独赢', 'ml-draw', '平局', 3.1),
      odd('moneyline', '独赢', 'ml-away', away, 3.4)
    ]
  },
  {
    key: 'half',
    title: '半场',
    count: 21,
    options: [
      odd('half', '半场独赢', 'ht-home', home, 1.67),
      odd('half', '半场独赢', 'ht-draw', '平局', 2.75),
      odd('half', '半场独赢', 'ht-away', away, 8.5),
      odd('half', '半场让球', 'ht-h-home', home, 1.98, '-0.75'),
      odd('half', '半场让球', 'ht-h-away', away, 1.82, '+0.75')
    ]
  },
  {
    key: 'corner',
    title: '角球',
    count: 12,
    options: [
      odd('corner', '角球大小', 'corner-over', '大', 1.92, '8.5'),
      odd('corner', '角球大小', 'corner-under', '小', 1.88, '8.5')
    ]
  }
];

export const leagues: League[] = [
  { id: 'all', name: '全部', count: 347, region: '全球', featured: true },
  { id: 'international', name: '国际比赛', shortName: '国际', count: 4, region: '国际', featured: true, liveOnly: true },
  { id: 'premier', name: '英超', count: 14, region: '英格兰', featured: true },
  { id: 'laliga', name: '西甲', count: 12, region: '西班牙', featured: true },
  { id: 'seriea', name: '意甲', count: 9, region: '意大利', featured: true },
  { id: 'bundesliga', name: '德甲', count: 8, region: '德国', featured: true },
  { id: 'ligue1', name: '法甲', count: 7, region: '法国', featured: true },
  { id: 'lebanon2', name: '黎巴嫩2级', count: 2, region: '黎巴嫩', liveOnly: true },
  { id: 'uzbek', name: '乌兹别克斯坦第一师', count: 1, region: '乌兹别克斯坦' },
  { id: 'ukraine', name: '乌克兰Vyscha联赛季后赛', count: 1, region: '乌克兰' },
  { id: 'uruguay', name: '乌拉圭后备队联赛', count: 1, region: '乌拉圭' },
  { id: 'u19', name: 'U19 国际比赛', count: 1, region: '国际' },
  { id: 'u20', name: 'U20 国际比赛', count: 1, region: '国际' }
];

export const matches: Match[] = [
  {
    id: 'm-ind-moz',
    leagueId: 'international',
    leagueName: '国际比赛',
    leagueType: '联赛',
    status: 'live',
    minute: 21,
    startTime: '21:00',
    dateLabel: '今日',
    home: { name: '印度尼西亚', shortName: 'IND', tone: 'gold' },
    away: { name: '莫桑比克', shortName: 'MOZ', tone: 'neutral' },
    homeScore: 0,
    awayScore: 0,
    marketCount: 56,
    isHot: true,
    markets: groups('印度尼西亚', '莫桑比克')
  },
  {
    id: 'm-cam-hon',
    leagueId: 'international',
    leagueName: '国际比赛',
    leagueType: '联赛',
    status: 'halftime',
    phaseLabel: '中场休息',
    startTime: '20:30',
    dateLabel: '今日',
    home: { name: '柬埔寨', shortName: 'CAM', tone: 'blue' },
    away: { name: '中国香港', shortName: 'HON', tone: 'red' },
    homeScore: 1,
    awayScore: 0,
    marketCount: 63,
    isHot: true,
    markets: groups('柬埔寨', '中国香港')
  },
  {
    id: 'm-chi-tha',
    leagueId: 'international',
    leagueName: '国际比赛',
    leagueType: '联赛',
    status: 'live',
    minute: 61,
    startTime: '20:00',
    dateLabel: '今日',
    home: { name: '中国', shortName: 'CHI', tone: 'green' },
    away: { name: '泰国', shortName: 'THA', tone: 'blue' },
    homeScore: 0,
    awayScore: 0,
    marketCount: 65,
    isHot: false,
    markets: groups('中国', '泰国')
  },
  {
    id: 'm-phi-mya',
    leagueId: 'international',
    leagueName: '国际比赛',
    leagueType: '联赛',
    status: 'live',
    minute: 69,
    startTime: '19:30',
    dateLabel: '今日',
    home: { name: '菲律宾', shortName: 'PHI', tone: 'gold' },
    away: { name: '缅甸', shortName: 'MYA', tone: 'green' },
    homeScore: 2,
    awayScore: 0,
    marketCount: 71,
    isHot: true,
    markets: groups('菲律宾', '缅甸')
  },
  {
    id: 'm-fcl-kat',
    leagueId: 'lebanon2',
    leagueName: '黎巴嫩2级',
    leagueType: '联赛',
    status: 'upcoming',
    startTime: '20:30',
    dateLabel: '今日',
    home: { name: '洛钦竞技', shortName: 'FCL', tone: 'gold' },
    away: { name: '卡塔尔竞技', shortName: 'KAT', tone: 'green' },
    homeScore: 0,
    awayScore: 0,
    marketCount: 18,
    isHot: false,
    markets: groups('洛钦竞技', '卡塔尔竞技')
  },
  {
    id: 'm-pfc-pfc',
    leagueId: 'ukraine',
    leagueName: '乌克兰Vyscha联赛季后赛',
    leagueType: '联赛',
    status: 'upcoming',
    startTime: '20:30',
    dateLabel: '明天',
    home: { name: '利维竞技', shortName: 'LVI', tone: 'gold' },
    away: { name: 'PFC 竞技', shortName: 'PFC', tone: 'red' },
    homeScore: 0,
    awayScore: 0,
    marketCount: 47,
    isHot: false,
    markets: groups('利维竞技', 'PFC 竞技')
  },
  {
    id: 'm-qatar-swiss',
    leagueId: 'u19',
    leagueName: 'U19 国际比赛',
    leagueType: '联赛',
    status: 'upcoming',
    startTime: '17:26',
    dateLabel: '06/14 周日',
    home: { name: '卡塔尔', shortName: 'QAT', tone: 'gold' },
    away: { name: '瑞士', shortName: 'SUI', tone: 'red' },
    homeScore: 0,
    awayScore: 0,
    marketCount: 38,
    isHot: true,
    markets: groups('卡塔尔', '瑞士')
  },
  {
    id: 'm-rivers-angels',
    leagueId: 'u20',
    leagueName: 'U20 国际比赛',
    leagueType: '冠军',
    status: 'upcoming',
    startTime: '18:40',
    dateLabel: '06/15 周一',
    home: { name: 'Rivers Angels(女)', shortName: 'RIV', tone: 'blue' },
    away: { name: 'Abia Angels FC(女)', shortName: 'ABI', tone: 'green' },
    homeScore: 0,
    awayScore: 0,
    marketCount: 24,
    isHot: true,
    isChampion: true,
    markets: groups('Rivers Angels(女)', 'Abia Angels FC(女)')
  }
];

export const betRecords: BetRecord[] = [
  {
    id: 'PM202606190001',
    tags: ['大小球', '大小'],
    leagueName: '国际比赛',
    matchName: '秘鲁 vs 西班牙',
    placedAt: '2026/6/9 11:29:51',
    stake: 100,
    odds: 2,
    returnAmount: 200,
    status: '退款 / 取消'
  },
  {
    id: 'PM202606190002',
    tags: ['独赢', '强盘'],
    leagueName: '国际比赛',
    matchName: 'Bhutan vs Sri Lanka',
    placedAt: '2026/6/8 20:26:08',
    stake: 100,
    odds: 41,
    returnAmount: 4100,
    status: '退款 / 取消'
  },
  {
    id: 'PM202606190003',
    tags: ['半场独赢', '半场赛果'],
    leagueName: 'U20 国际比赛',
    matchName: 'Abia Angels FC(女) vs Rivers Angels(女)',
    placedAt: '2026/6/8 17:36:26',
    stake: 150,
    odds: 51,
    returnAmount: 7650,
    status: '进行中'
  },
  {
    id: 'PM202606190004',
    tags: ['让球', '让球'],
    leagueName: 'U19 国际比赛',
    matchName: '卡塔尔 vs 瑞士',
    placedAt: '2026/6/8 17:26:26',
    stake: 150,
    odds: 1.88,
    returnAmount: 282,
    status: '进行中'
  }
];
