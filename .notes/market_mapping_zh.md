# Goalserve ↔ Fast API ↔ PHP ↔ 后台中文 — 盘口对照表
> 数据来源：实时抓取 `/dev/shm/goalserve_*` 全部快照，共 **174** 个不同盘口；其中 **29** 个可自动结算，其余为人工结算。
## 字段说明
- **Goalserve ID**：Goalserve 盘口键位（`market_id_int`）。
- **Fast API ID**：`/gs/events/{gid}/markets` 返回的 `market_id`（= Goalserve ID 左补零至 6 位）；`market_name` 原样透传英文名。
- **中文显示**：前端 `translateMarket()` 的输出，亦即下注后 `bet.ptype` 存入、后台管理所见的中文名。
- **PHP 结算**：`settle_bets.php` `gradeBet()` 使用的 `wtype`；`— 人工结算 —` 表示无自动判级逻辑，须在后台手动结算。

## 可自动结算的 wtype 一览
| wtype | 含义 |
|---|---|
| `ML` | 独赢(全场) |
| `HT_ML` | 独赢(上半场) |
| `SP` | 让球(全场) |
| `HT_SP` | 让球(上半场) |
| `OU` | 大小球(全场) |
| `HT_OU` | 大小球(上半场) |
| `DNB` | 平局退款 |
| `DC` | 双重机会 |
| `BTS` | 双方进球(全场) |
| `HT_BTS` | 双方进球(上半场) |
| `CS` | 波胆(全场) |
| `HT_CS` | 波胆(上半场) |
| `OE` | 进球单双 |
| `CORNER_OU` | 角球大小 |
| `CORNER_HDP` | 角球让球 |

## 主胜负
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 2102 | 1st Half Winner | 002102 | 上半场胜负 | `HT_ML` · 独赢(上半场) |
| 27 | 1x2 (1st Half) | 000027 | 上半场独赢 | `HT_ML` · 独赢(上半场) |
| 380 | 1x2 - 10 minutes | 000380 | 独赢 - 10分钟 | — 人工结算 — |
| 1344 | 1x2 - 20 minutes | 001344 | 独赢 - 20分钟 | — 人工结算 — |
| 740 | 1x2 - 30 minutes | 000740 | 独赢 - 30分钟 | — 人工结算 — |
| 1345 | 1x2 - 40 minutes | 001345 | 独赢 - 40分钟 | — 人工结算 — |
| 741 | 1x2 - 50 minutes | 000741 | 独赢 - 50分钟 | — 人工结算 — |
| 1291 | 1x2 - 60 minutes | 001291 | 独赢 - 60分钟 | — 人工结算 — |
| 742 | 1x2 - 70 minutes | 000742 | 独赢 - 70分钟 | — 人工结算 — |
| 1346 | 1x2 - 80 minutes | 001346 | 独赢 - 80分钟 | — 人工结算 — |
| 3 | 2nd Half Winner | 000003 | 下半场胜负 | — 人工结算 — |
| 22626 | First 10 min Winner | 022626 | 前10分钟胜负 | — 人工结算 — |
| 1777 | Fulltime Result | 001777 | 全场独赢 | `ML` · 独赢(全场) |
| 226 | Half Time/Full Time | 000226 | 半全场 | — 人工结算 — |
| 2 | Home/Away | 000002 | 主胜/客胜 | `ML` · 独赢(全场) |
| 12 | HT/FT Double | 000012 | 半全场双重 | — 人工结算 — |
| 1 | Match Winner | 000001 | 独赢 | `ML` · 独赢(全场) |

## 让球
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 11 | 3-Way Handicap | 000011 | 三项让球 | — 人工结算 — |
| 4 | Asian Handicap | 000004 | 让球 | `SP` · 让球(全场) |
| 29 | Asian Handicap (1st Half) | 000029 | 上半场让球 | `HT_SP` · 让球(上半场) |
| 22601 | Asian Handicap First Half | 022601 | 上半场让球 | `HT_SP` · 让球(上半场) |
| 2000 | European Handicap (1st Half) | 002000 | 上半场欧洲让球 | — 人工结算 — |
| 79 | Handicap Result | 000079 | 让球胜平负 | — 人工结算 — |
| 22600 | Handicap Result 1st Half | 022600 | 上半场让球胜平负 | — 人工结算 — |

## 大小球/进球数
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 22655 | 1st Half Exact Goals Number | 022655 | 上半场精确进球数 | — 人工结算 — |
| 22619 | 2nd Half Exact Goals Number | 022619 | 下半场精确进球数 | — 人工结算 — |
| 22617 | Away Team Exact Goals Number | 022617 | 客队精确进球数 | — 人工结算 — |
| 2 | Away Team Goals | 000002 | 客队进球大小 | — 人工结算 — |
| 22614 | Exact Goals Number | 022614 | 精确进球数 | — 人工结算 — |
| 22836 | Goal Line | 022836 | 进球线 | — 人工结算 — |
| 22837 | Goal Line (1st Half) | 022837 | 上半场进球线 | — 人工结算 — |
| 5 | Goals Over/Under | 000005 | 进球大小球 | `OU` · 大小球(全场) |
| 7 | Goals Over/Under 2nd Half | 000007 | 下半场大小球 | — 人工结算 — |
| 22616 | Home Team Exact Goals Number | 022616 | 主队精确进球数 | — 人工结算 — |
| 1 | Home Team Goals | 000001 | 主队进球大小 | — 人工结算 — |
| 1002 | How many goals will Away Team score? | 001002 | 客队进球数 | — 人工结算 — |
| 1001 | How many goals will Home Team score? | 001001 | 主队进球数 | — 人工结算 — |
| 421 | Match Goals | 000421 | 全场进球大小 | `OU` · 大小球(全场) |
| 31 | Over/Under (1st Half) | 000031 | 上半场大小球 | `HT_OU` · 大小球(上半场) |
| 90008 | Over/Under Line | 090008 | 大小球 | `OU` · 大小球(全场) |
| 90009 | Over/Under Line (1st Half) | 090009 | 上半场大小球 | `HT_OU` · 大小球(上半场) |
| 22621 | Result/Total Goals | 022621 | 胜负+总进球 | — 人工结算 — |
| 22956 | Result/Total Goals (1st Half) | 022956 | 上半场胜负+总进球 | — 人工结算 — |
| 22125 | Total - Away | 022125 | 客队进球大小 | — 人工结算 — |
| 22124 | Total - Home | 022124 | 主队进球大小 | — 人工结算 — |

## 双方进球
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 15 | Both Teams To Score | 000015 | 双方都进球 | `BTS` · 双方进球(全场) |
| 10565 | Both Teams to Score | 010565 | 双方都进球 | `BTS` · 双方进球(全场) |
| 317 | Both Teams To Score (1st Half) | 000317 | 上半场双方都进球 | `HT_BTS` · 双方进球(上半场) |
| 318 | Both Teams To Score (2nd Half) | 000318 | 下半场双方都进球 | — 人工结算 — |
| 22604 | Both Teams To Score - 1st Half | 022604 | 上半场双方都进球 | `HT_BTS` · 双方进球(上半场) |
| 22605 | Both Teams To Score - 2nd Half | 022605 | 下半场双方都进球 | — 人工结算 — |
| 50461 | Result / Both Teams To Score | 050461 | 胜负+双方进球 | — 人工结算 — |
| 22620 | Results/Both Teams To Score | 022620 | 胜负+双方进球 | — 人工结算 — |
| 22834 | Total Goals/Both Teams To Score | 022834 | 总进球+双方进球 | — 人工结算 — |

## 波胆
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 81 | Correct Score | 000081 | 波胆 | `CS` · 波胆(全场) |
| 227 | Correct Score (1st Half) | 000227 | 上半场波胆 | `HT_CS` · 波胆(上半场) |
| 181 | Correct Score 1st Half | 000181 | 上半场波胆 | `HT_CS` · 波胆(上半场) |
| 10001 | Final Score | 010001 | 波胆 | `CS` · 波胆(全场) |

## 双重机会/退款
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 222 | Double Chance | 000222 | 双重机会 | `DC` · 双重机会 |
| 22602 | Double Chance - 1st Half | 022602 | 上半场双重机会 | — 人工结算 — |
| 10563 | Draw No Bet | 010563 | 平局退款 | `DNB` · 平局退款 |

## 单双
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 22611 | Away Odd/Even | 022611 | 客队单双 | — 人工结算 — |
| 10562 | Goals Odd/Even | 010562 | 进球单双 | `OE` · 进球单双 |
| 22610 | Home Odd/Even | 022610 | 主队单双 | — 人工结算 — |
| 22608 | Odd/Even | 022608 | 单双 | `OE` · 进球单双 |
| 22713 | Odd/Even (2nd Half) | 022713 | 下半场单双 | — 人工结算 — |
| 22609 | Odd/Even 1st Half | 022609 | 上半场单双 | — 人工结算 — |

## 角球
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 90006 | Asian Corners | 090006 | 角球让球 | `CORNER_OU` · 角球大小 |
| 22843 | Away Corners Over/Under | 022843 | 客队角球大小 | — 人工结算 — |
| 22841 | Corners Asian Handicap | 022841 | 角球让球 | `CORNER_HDP` · 角球让球 |
|  | Corners Asian Handicap (1st Half) |  | 上半场角球让球 | — 人工结算 — |
| 22644 | Corners Over Under | 022644 | 角球大小 | `CORNER_OU` · 角球大小 |
| 23859 | Corners Race To | 023859 | 角球率先到 | — 人工结算 — |
| 23681 | Corners. European Handicap | 023681 | 角球欧洲让球 | — 人工结算 — |
| 23853 | Corners. Total (Range) | 023853 | 角球总数范围 | — 人工结算 — |
| 23862 | Corners. Total between 0 and 10m | 023862 | 角球总数(0-10分钟) | — 人工结算 — |
| 22842 | Home Corners Over/Under | 022842 | 主队角球大小 | — 人工结算 — |
| 91001 | Last Corner | 091001 | 最后一个角球 | — 人工结算 — |
| 16 | Match Corners | 000016 | 全场角球 | — 人工结算 — |
| 23861 | Multicorners | 023861 | 多重角球 | — 人工结算 — |
| 9200437 | Race to the 3rd corner? | 9200437 | 率先到第3角球 | — 人工结算 — |
| 9200439 | Race to the 5th corner? | 9200439 | 率先到第5角球 | — 人工结算 — |
| 9200441 | Race to the 7th corner? | 9200441 | 率先到第7角球 | — 人工结算 — |
| 9200443 | Race to the 9th corner? | 9200443 | 率先到第9角球 | — 人工结算 — |
| 520 | Total Corners | 000520 | 角球大小 | `CORNER_OU` · 角球大小 |
| 22905 | Total Corners (1st Half) | 022905 | 上半场角球大小 | — 人工结算 — |
| 22850 | Total Corners (3 way) | 022850 | 角球总数(三项) | — 人工结算 — |
| 524 | Total Corners (3 way) (1st Half) | 000524 | 上半场角球总数(三项) | — 人工结算 — |
| 525 | Total Corners (3way) (2nd Half) | 000525 | 下半场角球总数(三项) | — 人工结算 — |
| 9200421 | Which team will score the 2nd corner? (2 Way) | 9200421 | 哪队拿到第2角球(2项) | — 人工结算 — |
| 9200422 | Which team will score the 3rd corner? (2 Way) | 9200422 | 哪队拿到第3角球(2项) | — 人工结算 — |
| 9200423 | Which team will score the 4th corner? (2 Way) | 9200423 | 哪队拿到第4角球(2项) | — 人工结算 — |
| 9200424 | Which team will score the 5th corner? (2 Way) | 9200424 | 哪队拿到第5角球(2项) | — 人工结算 — |
| 9200425 | Which team will score the 6th corner? (2 Way) | 9200425 | 哪队拿到第6角球(2项) | — 人工结算 — |
| 9200426 | Which team will score the 7th corner? (2 Way) | 9200426 | 哪队拿到第7角球(2项) | — 人工结算 — |
| 9200427 | Which team will score the 8th corner? (2 Way) | 9200427 | 哪队拿到第8角球(2项) | — 人工结算 — |
| 9200428 | Which team will score the 9th corner? (2 Way) | 9200428 | 哪队拿到第9角球(2项) | — 人工结算 — |

## 红黄牌
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 22961 | Away Team Total Cards | 022961 | 客队红黄牌总数 | — 人工结算 — |
| 22959 | Cards Asian Handicap | 022959 | 红黄牌让球 | — 人工结算 — |
| 22957 | Cards European Handicap | 022957 | 红黄牌欧洲让球 | — 人工结算 — |
| 22958 | Cards Over/Under | 022958 | 红黄牌大小 | — 人工结算 — |
| 23865 | Cards over/under between 0 and 10 m | 023865 | 红黄牌大小(0-10分钟) | — 人工结算 — |
| 23864 | First Card Received (3 way) | 023864 | 首张牌(三项) | — 人工结算 — |
| 22960 | Home Team Total Cards | 022960 | 主队红黄牌总数 | — 人工结算 — |

## 进球球队
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 90311 | Away Team to Score in Both Halves | 090311 | 客队两半场均进球 | — 人工结算 — |
| 44 | Last Team to Score (3 way) | 000044 | 最后进球队(三项) | — 人工结算 — |
| 2224 | Team To Score First | 002224 | 最先进球队 | — 人工结算 — |
| 2225 | Team To Score Last | 002225 | 最后进球队 | — 人工结算 — |
| 92000 | Which team will score the 1st goal? | 092000 | 哪队攻入第1球 | — 人工结算 — |
| 1000 | Which team will score the 2nd goal? | 001000 | 哪队攻入第2球 | — 人工结算 — |
| 1016 | Which team will score the 3rd goal? | 001016 | 哪队攻入第3球 | — 人工结算 — |
| 1019 | Which team will score the 4th goal? | 001019 | 哪队攻入第4球 | — 人工结算 — |
| 1017 | Which team will score the 5th goal? | 001017 | 哪队攻入第5球 | — 人工结算 — |
|  | Which team will score the 6th goal? |  | 哪队攻入第6球 | — 人工结算 — |

## 进球球员/方式
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 22845 | Anytime Goal Scorer | 022845 | 任意时间进球者 | — 人工结算 — |
| 23687 | Away Anytime Goal Scorer | 023687 | 客队任意时间进球者 | — 人工结算 — |
| 23688 | Away First Goal Scorer | 023688 | 客队首位进球者 | — 人工结算 — |
| 23697 | Away Goal Method Header | 023697 | 客队头球进球 | — 人工结算 — |
| 23689 | Away Last Goal Scorer | 023689 | 客队最后进球者 | — 人工结算 — |
| 22838 | First Goal Method | 022838 | 首球进球方式 | — 人工结算 — |
| 22846 | First Goal Scorer | 022846 | 首位进球者 | — 人工结算 — |
| 23876 | Game Decided After Penalties | 023876 | 点球大战决胜 | — 人工结算 — |
| 23698 | Goal Method Outside the Box | 023698 | 禁区外进球方式 | — 人工结算 — |
| 23701 | Home Anytime Goal Scorer | 023701 | 主队任意时间进球者 | — 人工结算 — |
| 23702 | Home First Goal Scorer | 023702 | 主队首位进球者 | — 人工结算 — |
| 23696 | Home Goal Method Header | 023696 | 主队头球进球 | — 人工结算 — |
| 23703 | Home Last Goal Scorer | 023703 | 主队最后进球者 | — 人工结算 — |
| 22847 | Last Goal Scorer | 022847 | 最后进球者 | — 人工结算 — |
| 22844 | Own Goal | 022844 | 乌龙球 | — 人工结算 — |
| 23267 | To Miss A Penalty | 023267 | 射失点球 | — 人工结算 — |
| 23266 | To Score A Penalty | 023266 | 罚入点球 | — 人工结算 — |

## 技术统计/球员
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 23705 | Away Player Assists | 023705 | 客队球员助攻 | — 人工结算 — |
| 23691 | Away Player Shots | 023691 | 客队球员射门数 | — 人工结算 — |
| 23717 | Away Player Shots On Target Total | 023717 | 客队球员射正总数 | — 人工结算 — |
| 23709 | Goalkeeper Saves | 023709 | 门将扑救数 | — 人工结算 — |
| 23690 | Home Player Shots | 023690 | 主队球员射门数 | — 人工结算 — |
| 23711 | Home Player Shots On Target Total | 023711 | 主队球员射正总数 | — 人工结算 — |
| 23591 | Offsides Away Total | 023591 | 客队越位总数 | — 人工结算 — |
| 23590 | Offsides Home Total | 023590 | 主队越位总数 | — 人工结算 — |
| 23587 | Offsides Total | 023587 | 越位总数 | — 人工结算 — |
| 23542 | Player Assists | 023542 | 球员助攻 | — 人工结算 — |
| 23685 | Player Fouls Committed | 023685 | 球员犯规数 | — 人工结算 — |
| 23541 | Player Passes | 023541 | 球员传球数 | — 人工结算 — |
| 23132 | Player Shots | 023132 | 球员射门数 | — 人工结算 — |
| 23692 | Player Shots On Target | 023692 | 球员射正数 | — 人工结算 — |
| 23136 | Player Tackles | 023136 | 球员抢断数 | — 人工结算 — |
| 23599 | ShotOnTarget 1x2 | 023599 | 射正数独赢 | — 人工结算 — |
| 23718 | Shots. Away Total | 023718 | 客队射门总数 | — 人工结算 — |
| 23005 | Shots.1x2 | 023005 | 射门数独赢 | — 人工结算 — |
| 23119 | Total ShotOnGoal | 023119 | 射正总数 | — 人工结算 — |
| 23878 | Total Tackles | 023878 | 抢断总数 | — 人工结算 — |

## 时间/赛果特殊
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 1328 | 1st Goal in Interval | 001328 | 首球时间区间 | — 人工结算 — |
| 1332 | Away 1st Goal in Interval | 001332 | 客队首球时间区间 | — 人工结算 — |
| 23877 | Game Decided in Extra Time | 023877 | 加时决胜 | — 人工结算 — |
| 1331 | Home 1st Goal in Interval | 001331 | 主队首球时间区间 | — 人工结算 — |
| 23411 | Method of Victory | 023411 | 获胜方式 | — 人工结算 — |
| 561127132 | Next 10 Minutes Total | 561127132 | 未来10分钟进球数 | — 人工结算 — |
| 22618 | To Qualify | 022618 | 晋级 | — 人工结算 — |

## 其它特殊
| Goalserve ID | Goalserve 名称 (EN) | Fast API ID | 中文显示 | PHP 结算 |
|---|---|---|---|---|
| 90007 | 90007 | 090007 | 特别盘口 | — 人工结算 — |
| 23607 | Away Highest Scoring Half | 023607 | 客队进球最多半场 | — 人工结算 — |
| 90308 | Away Team Score a Goal (2nd Half) | 090308 | 客队下半场进球 | — 人工结算 — |
| 14 | Clean Sheet - Away | 000014 | 客队零封 | — 人工结算 — |
| 13 | Clean Sheet - Home | 000013 | 主队零封 | — 人工结算 — |
| 91 | Highest Scoring Half | 000091 | 进球最多半场 | — 人工结算 — |
| 23606 | Home Highest Scoring Half | 023606 | 主队进球最多半场 | — 人工结算 — |
| 90310 | Home Team  to Score in Both Halves | 090310 | 主队两半场均进球 | — 人工结算 — |
| 90307 | Home Team Score a Goal (2nd Half) | 090307 | 主队下半场进球 | — 人工结算 — |
| 22833 | To Score In Both Halves By Teams | 022833 | 球队两半场均进球 | — 人工结算 — |
| 50246 | To Win 2nd Half | 050246 | 赢下半场 | — 人工结算 — |
| 22615 | To Win Either Half | 022615 | 任一半场获胜 | — 人工结算 — |
| 23851 | To Win From Behind | 023851 | 落后逆转取胜 | — 人工结算 — |
| 2293 | Win Both Halves | 002293 | 两半场全胜 | — 人工结算 — |
| 22607 | Win To Nil | 022607 | 零封获胜 | — 人工结算 — |
| 22832 | Winning Margin | 022832 | 净胜球 | — 人工结算 — |
