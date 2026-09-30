# V2 外部依据与实际应用登记

检索与查看日期：2026-09-29。图像为设计研究依据，未将厂商或设计公司的照片作为交付贴图。模型源代码为本项目原创。实施状态随样板复核更新。

| ID / 目标 | 实际查看的来源 | 原图缺口 → 采用方案 | 实现位置 / 限制 |
|---|---|---|---|
| S01 工业冷却塔 | [BAC Series 3000](https://baltimoreaircoil.com/products/cooling-towers/series-3000-cooling-tower)；产品主图 950x836_3000.png；官方产品册 | 模糊圆圈与盒体 → 风机口、百叶进风面、检修门、平台、爬梯及模块化排列 | `tools/v2/equipment.py` 的 cooling_cell；采用形态逻辑，尺寸与台数为展示估算，不声明为该型号工程选型 |
| S02 厂房 | [TSMC 厂房外观图库](https://pr.tsmc.com/english/gallery-fabs-outside)，Fab 18 的 407A9160_0.jpg 实景照片，已在浏览器查看 | 单一白盒 → 金属面板分缝、连续条窗、入口雨棚与玻璃带 | `tools/v2/architecture.py` industrial；屋面设备另依据 R1/R2 与 S01，不从这张立面照片推断生产工艺 |
| S03 幕墙 | [Schüco FWS 50](https://www.schueco.com/de-en/fabricators/products/facades/mullion-transom-facades/fws-50)，产品剖切图与系统说明 | 蓝色平面 → 玻璃、竖梃、横梁、楼板带和结构深度分别表达 | architecture.py glazing/HQ；材料体系借鉴，展示模型窗格尺寸不冒充厂商节点详图 |
| S04 景观 | [Sasaki 信阳学院南湖校区门户景观](https://www.sasaki.com/projects/xinyang-university-south-bay-campus-gateway-landscape/)；96232_03U_N235 实景图，已在浏览器查看 | 原图岸边碎片不清 → 亲水步道、低驳岸、挺水植物、乔灌层次和步道栏杆 | `tools/v2/landscape.py`；采用岸线与种植层次，不移植河南植物清单或水处理性能 |
| S05 道路 | [NACTO Gateway](https://nacto.org/publication/urban-street-design-guide/street-design-elements/curb-extensions/gateway/) 与[Major Intersections](https://nacto.org/publication/urban-street-design-guide/intersections/major-intersections/) 的页面文字说明；浏览器图示加载超时，未声称完成图示核验 | 原图断续道路与模糊门区 → 入口过街、中央岛、车行分流、连续人行空间 | landscape.py roads；用于展示空间组织，不作为中国道路规范合规认证或车辆扫掠验证 |
| S06 地域背景 | [珠海高新区红花山/凤凰山相关林地介绍](https://www.zhuhai-hitech.gov.cn/gxxw/gxdt/content/mpost_3624011.html)；用户确认山在南侧 | 背景位置不明 → 南侧分层山脊、连续常绿林冠，北侧街区 | landscape.py context；艺术化地形，无实测高程 |
| S07 可交付材质 | [Poly Haven](https://polyhaven.com/) CC0：grass_path_2、grey_roof_tiles、brown_planks_03、kloofendal_48d_partly_cloudy_puresky；沿用 V1 asphalt_track/concrete_floor | 单色表面 → 草地微观纹理、瓦片、木平台、室外环境光 | `assets/v2/manifest.json` 记录下载 URL 和散列；按部位调整颜色/尺度，不整幅投射 AI 图片 |

## AI 假象处理

- 两图餐厅标签互换：保留东西方位与坡屋顶/平屋顶的对应关系，界面使用“东侧餐厅/西侧餐厅”。
- 展馆屋顶两图表达不一致：采用 R1 清楚的中厅与低侧翼、深檐口及金属屋面；不将不确定的瓦屋顶当成强制身份特征。
- 屋顶管线与设备连接缺失：设备按冷却、空气处理、工艺塔、主管架、检修区分组，补足支承与支管；不复现图像中的悬空杂线。
- 道路模糊处：建立连续环路与北门连接，建筑入口设独立步道；各条车道必须连入同一交通网络。
- 山林：不把原图云雾直接贴到三维背景；使用三维地形和有层次的植物，方位固定。

## 样板核验

第一轮样板见 `renders/v2/sample_admin.png`、`sample_roof.png`、`sample_lake.png`、`sample_north.png`。复核后实施了以下修改：

- HQ：幕墙独立凹凸构件、柱廊、塔楼、雨棚、屋顶采光脊清晰；补齐入口前场铺装与喷泉两侧绕行步道。
- FAB 屋面：冷却塔的风机口、叶片/格栅、百叶与平台可分辨；AHU、工艺塔、罐组、分层管架具有不同轮廓；补入设备支管，仍为展示性的系统连接。
- 湖岸：保留双湖和餐厅半岛，增加岛上组团、岸边挺水植物、分层乔灌和细叶片；加密南侧山林以消除过多裸地。
- 全园：草地照片中的土色让场景偏干黄，最终仅保留该素材粗糙度与法线，基础色恢复原图绿色；北侧背景加入变化体量、院落与沿街树。
- 道路：数值检查定位到 LAB/MASK 角部的环路交叠，调整曲线并重新生成植栽。17 段道路连通，路面边缘采样与主体建筑轮廓无交叠，树根未进入道路或主体建筑。详见 `evidence/v2/layout-check.json`。

最终六视角与 V1 对照在 `viewer-v2/review.html`；检验范围和剩余差距见 `analysis/v2/交付核验.md`。
