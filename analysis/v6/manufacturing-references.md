# V6 制造设备与物流：参考、推定和实现

访问日期：2026-09-30。两张园区 AI 图及 `fab1.jpg` 只能确认厂房与工艺区意图，无法确认机型、内部机构或设备台数。本模型补充一条可运行的代表制造物流链。**FAB-1 为八类代表工位；FAB-2 展示相同概念单元但禁用，不增加一期产能。八类工位用于代表性演示，不是已确认的完整工艺清单。**

| 真实参考 | 实际查看内容 | 落实到 V6 模型 | 适用边界 |
|---|---|---|---|
| [TEL 产品目录](https://www.tel.com/about/cn/sombaq000000010f-att/product_catalog.pdf) | 本地渲染并目视 PDF 实际第 2、4、7、9、11 页：LITHIUS Pro Z、CELLESTA-i、Tactras、TELINDY PLUS、Episode 1 | EFEM/FOUP 前装载区、操作屏、面板与检修分缝、涂胶显影层叠模块、清洗模块、热处理高机身、沉积/刻蚀多模组识别 | 没有采购确认或厂商尺寸；热处理、CMP、刻蚀的部分外罩作展示性打开，暴露功能模块，不能作为 OEM 精确外形 |
| [Applied Materials：平台结构](https://www.appliedmaterials.com/us/en/blog/blog-posts/a-new-equipment-platform-for-a-new-era-of-chipmaking.html) | 原厂正文：factory interface、transfer chamber/robot、process chambers | ETCH 四腔、DEPO 六腔围绕中央传输腔，具有真空连接颈、腔盖和螺栓，前部 EFEM | 腔数与占地为演示设计；非指定 Endura/Centura 采购方案 |
| [Applied Materials：Reflexion LK CMP](https://www.appliedmaterials.com/us/en/product-library/reflexion-lk-cmp.html) | 原厂正文和网页实物照片：three-platen、集成清洗、装载口、控制面板 | CMP 三个抛光盘、压头支架、清洗侧柜、装载口 | 内部机构为解释性示意；不声称精确恢复不可见结构 |
| [Applied Materials：VIISta 900 3D](https://www.appliedmaterials.com/us/en/product-library/viista-900-3d.html) | 原厂正文与网页照片：束线架构、三磁体、前置装载口、后部屏蔽机罩 | IMPLANT 线性束线、三组磁体体量、源柜、终端腔、局部屏蔽罩 | 未采用原厂角度精度、产能或工艺数值，模型为通用类别而非指定型号 |
| [ASML：DUV 光刻系统](https://www.asml.com/en/products/duv-lithography-systems) | 官方文字说明：双工作台浸润式光刻类别；用于识别代表性光刻设备类别 | LITHO 光刻主机与相邻涂胶显影侧模块分体识别，独立 EFEM 和服务柜 | 仅类别参考，未验证照片中的内部光学结构；主机高度、光学塔体量为概念推定；不表达已选型或可制造 7/5 nm 的证明 |
| [KLA：光学检查与缺陷复判产品公告](https://ir.kla.com/news-events/press-releases/detail/43/kla-announces-new-defect-inspection-and-review-portfolio) | 一手产品功能：光学缺陷检查、分类与复判 | METRO 量测/缺陷检查示意站，遮光罩、平台、装载口；配合引擎的结果/Hold/人工放行 | 光学头形态为通用推定；不复刻型号。检索到的 8930 SiC 资料适用功率器件，没有将其移植成 7nm 逻辑机台 |
| [Daifuku：半导体生产线运输系统](https://www.daifuku.com/daifuku-square/article/000999/) | 官方文字：OHT 运输 FOUP、stocker 暂存、天花轨道、等待加工；网页视频未能加载，未声称目视视频验证 | 独立 OHT 与 FOUP 资产；6 储位库、垂直装卸口、闭合环轨及逐站节点；运输车不等于载具 | 轨道与数量均为演示提案；不推定跨 FAB 桥接或真实调度吞吐能力 |

所有图仅为研究，未把厂商图片或标识作为模型贴图。交付几何由本项目 FreeCAD 源码独立构造。研究 PDF 保存在 `reference-research/`，不作为浏览器运行依赖。

## 可复现模型与数据

- `tools/v6/manufacturing_layout.py` → `analysis/v6/manufacturing-layout.json`：50 个运行资产，两楼每楼 8 机台、8 load port、1 stocker、1 OHT、6 FOUP、1 rail；FAB-2 `enabled=false`。
- `tools/v6/manufacturing_cad.py` → `output/cad-v6/Phoenix_Manufacturing_V6.FCStd`、两份 STEP、BRep 三角化数据。528 个独立 CAD 子构件，不是 528 台机台。
- `tools/v6/manufacturing_to_blender.py` **实际经 `tools/mcp_client.py` 调用 Blender MCP**。每运行资产一个根节点，子构件保留 `asset_id/component_id/role`，活动灯标 `status_light`。
- 输出 `output/manufacturing-web/{FAB1,FAB2}.glb`、逐资产元数据、`.blend`；各约 1.02 MB。模型根的 glTF 位置是 CAD `[x,z,-y]`，足以保持动态搬运与原生实体一致。
- CAD 使用毫米，浏览器和 JSON 使用米。F1 实际旧 CAD 楼板顶 +15.400 m；装载口 +16.400 m；轨道 +21.200 m。轨道高于 V4 局部房间示意吊顶，制造视图必须采用厂房工艺层开放空间，不能把原有 3.2 m 代表房间高度当成已批准洁净室净高。
- 八站单次经过只演示配送、加工、量测放行。真实晶圆工艺会重复访问多个站点，本轮没有建立可生产的半导体工艺配方。

## 质量约束与已做核验

img2threejs 已读取，`forge/next.py` 检查当前状态未停止。沿用项目“图像拆解、身份特征、材料、局部对照”的适用范围。用户明确要求 FreeCAD 和 Blender MCP，因此不声称通过该 skill 的纯 Three.js 严格构建认证，既有 `.img2threejs` 状态不伪造为完成。

识别约束：光刻与 track 双体量；刻蚀四腔/沉积六腔及传输室；注入束线三磁体；双立式热处理塔；CMP 三盘与清洗柜；四模块清洗；遮光量测罩；FOUP 顶部搬运法兰与前门；独立 OHT 吊具；六储位、闭环轨道。以上特征均有命名 CAD 子构件，非文字标签代替形态。

`evidence/v6/manufacturing-native-review.json`：FCStd 重开有效、528 BRep 有效、两份 STEP 回读有效、16 装载口与上方轨道节点水平误差为零、2 闭环全节点可达、运行 FOUP 顶部法兰与吊具接触且体积不穿透。对原 CAD 实际结构柱进行 BRep 交集检查，新增机台、端口与 stocker 无柱体穿插。

真实 MCP 渲染见 `evidence/v6/manufacturing-{etch,litho,cmp,stocker}.png`，已逐张目视：不同族群有可辨识轮廓、端口独立、轨道高于装载区、库内六 FOUP 与车体分开。仍属展示级概念设备，厂家内部结构、洁净室工艺吊顶、tool hook-up 与维护净距未工程化。
